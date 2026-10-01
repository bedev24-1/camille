// ─────────────────────────────────────────────────────────────────────────────
// Le flux boutique, sur les composants natifs de Meta.
//
// Ce que les composants natifs changent, et c'est l'essentiel : le client ne
// tape plus « oui je veux ça », il appuie sur un bouton et compose son panier
// dans WhatsApp. Les deux bugs les plus coûteux de la version n8n — « oui »
// après une rupture, et « okey je veux donc ça » — ne peuvent PAS se produire
// ici : il n'y a plus de phrase à interpréter à ces endroits.
//
// Conséquence directe : ce fichier n'appelle AUCUN modèle de langue. Tout ce
// qu'il fait est déterministe, donc gratuit. C'est la moitié du système qu'on
// peut porter et éprouver sans clé Groq payante.
//
// Le modèle reviendra pour ce qu'il sait faire — comprendre une phrase libre,
// l'argot, une faute de frappe — et le code continuera de vérifier. CVA ne
// change pas ; sa surface se réduit.
// ─────────────────────────────────────────────────────────────────────────────
import { query } from "@/lib/db";
import { sectorProfile } from "@/lib/sectorProfiles";
import { createOrder } from "@/lib/orders";
import * as meta from "./meta";
import { tracer, sessionMeta, type Contexte } from "./handle";

// ── Identifiants de nos propres boutons ─────────────────────────────────────
// Préfixés pour ne jamais être confondus avec un identifiant de catalogue.
const B = {
  catalogue: "cam:catalogue",
  conseiller: "cam:conseiller",
  livrer: "cam:livrer",
  retirer: "cam:retirer",
  infos: "cam:infos",
} as const;

type Produit = {
  id: string;
  name: string;
  price: number | null;
  currency: string;
  category: string | null;
  stock: number | null;
  image_url: string | null;
  retailerId: string;
};

function sansAccent(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`´]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function money(n: number, cur = "XAF"): string {
  return `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ${cur}`;
}

// ── Le catalogue ────────────────────────────────────────────────────────────

/**
 * Les produits vendables de cet agent.
 *
 * Deux sources, dans cet ordre :
 *
 *   1. `camille.products`, quand les produits portent un `meta_retailer_id` —
 *      c'est l'état visé, une fois la synchronisation en place : Camille reste
 *      la source de vérité du stock et des prix.
 *   2. Le catalogue Meta lui-même, sinon. C'est ce qui permet de tester
 *      aujourd'hui avec un catalogue déjà rempli côté Meta, sans rien migrer.
 *
 * Un article épuisé n'est jamais renvoyé : proposer ce qu'on ne peut pas
 * honorer est la faute qui coûte un client.
 */
async function catalogue(agentId: string): Promise<Produit[]> {
  try {
    const r = await query(
      `SELECT id, name, price, COALESCE(currency,'XAF') AS currency, category, stock, image_url,
              to_jsonb(p)->>'meta_retailer_id' AS retailer
         FROM camille.products p
        WHERE agent_id = $1 AND active = true
        ORDER BY sort_order ASC, created_at DESC
        LIMIT 100`,
      [agentId]
    );
    const mappes = r.rows
      .filter((x: Record<string, unknown>) => x.retailer)
      .map((x: Record<string, unknown>) => ({
        id: String(x.id),
        name: String(x.name),
        price: x.price != null ? Number(x.price) : null,
        currency: String(x.currency || "XAF"),
        category: (x.category as string) || null,
        stock: x.stock != null ? Number(x.stock) : null,
        image_url: (x.image_url as string) || null,
        retailerId: String(x.retailer),
      }))
      .filter((p) => p.stock == null || p.stock > 0);
    if (mappes.length) return mappes;
  } catch { /* colonne absente ou base non migrée : on lit chez Meta */ }

  const m = await meta.listCatalog();
  if (!m.ok) {
    console.error("[boutique] catalogue Meta illisible :", m.error);
    return [];
  }
  return m.items
    .filter((it) => it.availability !== "out of stock")
    .map((it) => {
      // Meta renvoie le prix formaté (« 5 000,00 XAF ») : on en extrait le
      // nombre pour pouvoir calculer un total.
      const n = Number(String(it.price || "").replace(/[^0-9]/g, "")) / 100;
      return {
        id: it.retailer_id,
        name: it.name,
        price: Number.isFinite(n) && n > 0 ? n : null,
        currency: "XAF",
        category: null,
        stock: null,
        image_url: it.image_url || null,
        retailerId: it.retailer_id,
      };
    });
}

/** Les produits dont le nom recoupe la demande. */
function chercher(prods: Produit[], demande: string): Produit[] {
  const mots = sansAccent(demande)
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (!mots.length) return [];
  const notes = prods.map((p) => {
    const foin = sansAccent(`${p.name} ${p.category || ""}`);
    return { p, n: mots.filter((w) => foin.includes(w)).length };
  });
  const max = Math.max(...notes.map((x) => x.n), 0);
  return max > 0 ? notes.filter((x) => x.n === max).map((x) => x.p) : [];
}

// ── Les envois ──────────────────────────────────────────────────────────────

/**
 * Montrer des produits — un format par situation.
 *
 * Les quatre formats natifs ont été éprouvés en production sur le numéro
 * Buyticle, et ils ne se valent pas :
 *
 *   1 produit        → `product`   une fiche, photo + prix du catalogue
 *   2 à 10 produits  → `carousel`  les fiches défilent horizontalement — le
 *                                  format le plus vendeur, celui qui remplace
 *                                  vraiment les albums bricolés
 *   plus de 10       → `product_list` une liste par catégories
 *   rien de précis   → `catalog_message` un bouton vers tout le catalogue
 *
 * Le carrousel interdit en-tête, pied de page et boutons : c'est la fiche qui
 * porte le prix et le bouton « ajouter au panier ». Le texte passe donc dans
 * le corps, et c'est le seul endroit où l'on parle.
 */
async function montrerVitrine(ctx: Contexte, prods: Produit[], entete: string, corps: string) {
  const { phone } = ctx;

  if (!prods.length) {
    await meta.sendText(phone, "Je n'ai rien à te montrer pour le moment 😔 Réécris-moi un peu plus tard.");
    return;
  }

  // ── Une seule fiche ──────────────────────────────────────────────────────
  if (prods.length === 1) {
    const p = prods[0];
    const prix = p.price != null ? ` — ${money(p.price, p.currency)}` : "";
    const texte = (corps || `${p.name}${prix}`) + "\n\nTu peux l'ajouter à ton panier ici 👇";
    const r = await meta.sendProduct(phone, p.retailerId, texte);
    if (!r.ok) {
      console.error("[boutique] fiche produit refusée :", r.error);
      // Le produit est injoignable (fiche fantôme) : on ne laisse pas le
      // client sans réponse, on lui ouvre le catalogue.
      await meta.sendCatalog(phone, "Je n'arrive pas à afficher cet article — voici tout notre catalogue 👇");
    }
    await tracer(ctx.agent.id, phone, "assistant", `[fiche] ${p.name}`);
    return;
  }

  // ── De 2 à 10 : le carrousel ─────────────────────────────────────────────
  if (prods.length <= 10) {
    const r = await meta.sendCarouselRobuste(
      phone,
      (corps || "Voici ce qu'on a pour toi") +
        "\n\nFais défiler 👉 touche une fiche pour l'ajouter à ton panier, puis envoie-moi le panier.",
      prods.map((p) => p.retailerId)
    );
    if (r.rejetes?.length) {
      console.warn("[boutique] fiches retirées de la vitrine :", r.rejetes.join(", "));
    }
    if (!r.ok) {
      console.error("[boutique] carrousel refusé :", r.error);
      await meta.sendCatalog(phone, corps || "Voici notre catalogue 👇");
    }
    await tracer(ctx.agent.id, phone, "assistant", `[carrousel] ${prods.length} articles`);
    return;
  }

  // ── Au-delà de 10 : la liste par catégories ──────────────────────────────
  const parCat = new Map<string, string[]>();
  for (const p of prods.slice(0, 30)) {
    const k = p.category || "Nos articles";
    if (!parCat.has(k)) parCat.set(k, []);
    parCat.get(k)!.push(p.retailerId);
  }
  const sections = [...parCat.entries()].map(([title, retailerIds]) => ({ title, retailerIds }));

  const r = await meta.sendProductList(
    phone, entete || "Notre boutique", corps || "Voici tout ce qu'on propose",
    sections, "Ajoute au panier et envoie-le 🛒"
  );
  if (!r.ok) {
    console.error("[boutique] vitrine refusée :", r.error);
    await meta.sendCatalog(phone, corps || "Voici notre catalogue 👇");
  }
  await tracer(ctx.agent.id, phone, "assistant", `[liste] ${prods.length} articles`);
}

/** Le panier natif reçu : on enregistre la commande, puis on demande où livrer. */
async function recevoirPanier(ctx: Contexte) {
  const { agent, msg, phone } = ctx;
  const items = msg.order?.items || [];
  if (!items.length) return;

  const prods = await catalogue(agent.id);
  const parRetailer = new Map(prods.map((p) => [p.retailerId, p]));

  const lignes = items.map((it) => {
    const p = parRetailer.get(it.retailerId);
    return {
      // Quand le produit vient de Camille, on passe son vrai identifiant :
      // c'est lui qui permet de décompter le stock.
      productId: p && p.id !== p.retailerId ? p.id : undefined,
      name: p?.name || it.retailerId,
      qty: Math.max(1, it.quantity),
      price: it.price || p?.price || 0,
      currency: it.currency || p?.currency || agent.currency || "XAF",
    };
  });

  const total = lignes.reduce((t, l) => t + (l.price || 0) * (l.qty || 1), 0);
  const cur = lignes[0]?.currency || "XAF";

  const res = await createOrder({
    agentId: agent.id,
    items: lignes,
    phone,
    customerName: msg.contactName || "",
    note: msg.order?.note || "",
    source: "whatsapp",
    session: sessionMeta(agent.id),
  });

  if ("ok" in res && res.ok === false) {
    console.error("[boutique] commande refusée :", res.error);
    await meta.sendText(
      phone,
      `Je n'ai pas pu enregistrer ta commande 🙏\n${res.error}\n\nDis-moi *conseiller* et quelqu'un s'en occupe tout de suite.`
    );
    return;
  }

  const ref = (res as { ref?: string }).ref || "";
  const recap = lignes.map((l) => `• ${l.qty} × ${l.name}`).join("\n");

  await meta.sendText(
    phone,
    `✅ C'est noté${ref ? ` — commande *${ref}*` : ""}\n\n${recap}\n\n` +
      `Total : *${money(total, cur)}*` +
      (agent.delivery_enabled && agent.delivery_fee ? `\n_Livraison : ${money(Number(agent.delivery_fee), cur)}_` : "")
  );

  if (agent.delivery_enabled) {
    await meta.sendButtons(
      phone,
      "Tu veux qu'on te livre, ou tu passes retirer ?",
      [
        { id: B.livrer, title: "Me livrer" },
        { id: B.retirer, title: "Je viens retirer" },
      ],
      agent.business_name || undefined
    );
  } else {
    await meta.sendText(phone, "On prépare ça, tu peux passer le retirer 🙌");
  }
  await tracer(agent.id, phone, "assistant", `[commande] ${ref} ${money(total, cur)}`);
}

// ── La réponse ──────────────────────────────────────────────────────────────

export async function repondreBoutique(
  ctx: Contexte,
  mode: "boutique" | "restaurant"
): Promise<void> {
  const { agent, msg, phone } = ctx;
  const profil = sectorProfile(agent.sector);
  const resto = mode === "restaurant";

  // 1. Un panier natif : c'est une commande, pas une phrase à comprendre.
  if (msg.type === "order") return recevoirPanier(ctx);

  // 2. Une position partagée : elle complète la dernière commande.
  if (msg.type === "location" && msg.location) {
    try {
      await query(
        `UPDATE camille.orders SET lat = $1, lng = $2, updated_at = NOW()
          WHERE id = (SELECT id FROM camille.orders
                       WHERE agent_id = $3
                         AND regexp_replace(COALESCE(contact_phone,''), '[^0-9]', '', 'g') = $4
                       ORDER BY created_at DESC LIMIT 1)`,
        [msg.location.lat, msg.location.lng, agent.id, phone]
      );
    } catch (e) {
      console.error("[boutique] position non enregistrée :", (e as Error).message);
    }
    await meta.sendText(phone, "Position reçue 📍 On part là-dessus, merci !");
    return;
  }

  // 3. Un choix fait sur un bouton ou une liste : aucune ambiguïté possible.
  if (msg.type === "interactive" && msg.choiceId) {
    const id = msg.choiceId;

    if (id === B.catalogue) {
      const prods = await catalogue(agent.id);
      return montrerVitrine(
        ctx, prods,
        resto ? "Notre carte" : "Notre boutique",
        resto ? "Voici ce qu'on propose 🍽️" : "Voici ce qu'on a en ce moment 🛍️"
      );
    }
    if (id === B.conseiller) return passerLaMain(ctx);
    if (id === B.livrer) {
      await meta.sendText(
        phone,
        "Parfait 🙌 Envoie-moi ta *position* (le trombone 📎 puis Position) — ou écris ton quartier et un repère."
      );
      return;
    }
    if (id === B.retirer) {
      const ou = agent.location ? `\n📍 ${agent.location}` : "";
      await meta.sendText(phone, `C'est noté, on te garde ça 👌${ou}`);
      if (agent.latitude != null && agent.longitude != null) {
        await meta.sendLocation(
          phone, Number(agent.latitude), Number(agent.longitude),
          agent.business_name || "", agent.location || ""
        );
      }
      return;
    }
    if (id === B.infos) return donnerInfos(ctx);

    // Un identifiant qui n'est pas des nôtres vient du catalogue : le client a
    // touché un produit. On lui montre la fiche.
    const prods = await catalogue(agent.id);
    const p = prods.find((x) => x.retailerId === id);
    if (p) return montrerVitrine(ctx, [p], "", "");
  }

  const t = sansAccent(msg.text);

  // 4. Demande d'un humain — toujours en premier parmi les phrases libres.
  if (/conseiller|humain|quelqu un|une personne|parler a|responsable|patron|gerant/.test(t)) {
    return passerLaMain(ctx);
  }

  // 5. Infos boutique.
  if (/ou (etes|est)|adresse|vous etes ou|horaire|ouvert|ferme|localisation|c est ou/.test(t)) {
    return donnerInfos(ctx);
  }

  // 6. Le catalogue, demandé de mille façons.
  const veutVitrine = resto
    ? /\bmenu\b|la carte|vos plats|qu est ce que vous avez|qu est ce qu il y a|proposez/.test(t)
    : /catalogue|boutique|vos (produits|articles)|qu est ce que vous (avez|vendez)|montre|voir tout|tout voir|les prix/.test(t);
  if (veutVitrine) {
    const prods = await catalogue(agent.id);
    return montrerVitrine(
      ctx, prods,
      resto ? "Notre carte" : "Notre boutique",
      resto ? "Voici ce qu'on propose 🍽️" : "Voici ce qu'on a en ce moment 🛍️"
    );
  }

  // 7. Une recherche nommée : « la montre oraimo », « les freepods ».
  if (t.length >= 3) {
    const prods = await catalogue(agent.id);
    const trouves = chercher(prods, t);
    if (trouves.length) {
      return montrerVitrine(
        ctx, trouves,
        trouves.length > 1 ? "Ce que j'ai trouvé" : "",
        trouves.length > 1 ? "Voilà ce qui correspond 👇" : ""
      );
    }
  }

  // 8. Accueil et repli — tous deux mènent quelque part, jamais à un cul-de-sac.
  const salut = /^(bonjour|bonsoir|salut|slt|hello|hey|coucou|bjr|cc|yo|allo|on dit quoi)/.test(t);
  const accueil = (profil.welcome || "Bonjour 👋").replace(/\{b\}/g, agent.business_name || "nous");

  await meta.sendButtons(
    phone,
    salut || !t
      ? accueil
      : `Je n'ai pas trouvé « ${msg.text.slice(0, 40)} » 🤔 Regarde ${resto ? "la carte" : "la boutique"}, ou demande un conseiller.`,
    [
      { id: B.catalogue, title: resto ? "Voir la carte" : "Voir la boutique" },
      { id: B.infos, title: "Infos & horaires" },
      { id: B.conseiller, title: "Un conseiller" },
    ],
    agent.business_name || undefined
  );
  await tracer(agent.id, phone, "assistant", salut ? "[accueil]" : "[repli]");
}

// ── Deux réponses partagées ─────────────────────────────────────────────────

async function donnerInfos(ctx: Contexte) {
  const { agent, phone } = ctx;
  const bouts = [
    agent.business_name ? `*${agent.business_name}*` : "",
    agent.location ? `📍 ${agent.location}` : "",
    agent.business_hours ? `🕒 ${agent.business_hours}` : "",
    agent.website_url ? `🔗 ${agent.website_url}` : "",
  ].filter(Boolean);
  await meta.sendText(phone, bouts.length ? bouts.join("\n") : "Écris-moi ce que tu cherches, je te renseigne 🙂");
  if (agent.latitude != null && agent.longitude != null) {
    await meta.sendLocation(
      phone, Number(agent.latitude), Number(agent.longitude),
      agent.business_name || "", agent.location || ""
    );
  }
}

/**
 * Passer la main à un humain.
 *
 * Surtout pas de lien wa.me vers le numéro de l'agent : c'est celui où le
 * client écrit déjà. On l'y renvoyait vers lui-même — le bug avait été signalé
 * en production. Le client est au bon endroit ; c'est l'humain qui vient à lui.
 */
async function passerLaMain(ctx: Contexte) {
  const { agent, msg, phone } = ctx;

  try {
    await query(
      `INSERT INTO camille.owner_tasks (agent_id, phone, type, title, content)
       VALUES ($1, $2, 'complaint', $3, $4::jsonb)`,
      [
        agent.id, phone,
        `Demande à parler à quelqu'un — ${phone}`,
        JSON.stringify({ kind: "talk_to_human", message: msg.text || "(sans message)", contact: phone }),
      ]
    );
    await query(
      `INSERT INTO camille.contacts (agent_id, phone, human_takeover, created_at, updated_at)
       VALUES ($1, $2, true, NOW(), NOW())
       ON CONFLICT (agent_id, phone) DO UPDATE SET human_takeover = true, updated_at = NOW()`,
      [agent.id, phone]
    );
  } catch (e) {
    console.error("[boutique] passage de main incomplet :", (e as Error).message);
  }

  await meta.sendText(
    phone,
    "Bien sûr 🙏 Je passe le relais à l'équipe.\n\n" +
      "Un conseiller prend la suite **dans cette conversation** — reste ici, tu n'as rien à faire 🙌"
  );
  await tracer(agent.id, phone, "assistant", "[relais humain]");
}
