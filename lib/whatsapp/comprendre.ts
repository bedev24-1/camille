// ─────────────────────────────────────────────────────────────────────────────
// Comprendre ce que le client veut — et non reconnaître des mots.
//
// L'escalier de regex qu'il y avait avant ne comprend rien : il suit une
// séquence de mots. « quest ce que vous avec comme produit a vendre » passait à
// travers parce qu'il manquait une apostrophe. Pour chaque faute rattrapée, il
// en reste mille — et surtout, il ne sait pas faire DEUX choses à la fois :
// « c'est combien la montre et vous livrez à Bonapriso ? » est une question de
// prix ET une question de livraison, et l'escalier n'en traite qu'une.
//
// Ici, le modèle fait une seule chose : lire la phrase et dire ce que le client
// veut, sous forme d'une LISTE d'actions. Il ne rédige pas la réponse
// commerciale, il ne choisit pas le format d'affichage, il n'invente aucun
// produit — il choisit parmi les identifiants qu'on lui donne.
//
// C'est CVA, inchangé : LE MODÈLE COMPREND, LE CODE VÉRIFIE ET EXÉCUTE.
//   • le modèle ne renvoie que des identifiants du catalogue qu'on lui a fourni,
//     et `valider()` jette ceux qu'il aurait inventés ;
//   • tout nombre d'une phrase libre est confronté aux faits connus par
//     `phraseAncree()` — un prix inventé ne sort jamais ;
//   • une certitude faible ou un modèle indisponible retombe sur l'escalier,
//     qui est dégradé mais ne mentira pas.
//
// Et sans clé configurée, tout continue de fonctionner. Ce n'est pas une
// précaution théorique : le compte Groq est à sec aujourd'hui.
// ─────────────────────────────────────────────────────────────────────────────

/** Ce que le code sait exécuter. Rien d'autre n'est acceptable en retour. */
export type Action =
  | { faire: "vitrine" }
  | { faire: "montrer"; produits: string[] }
  | { faire: "repondre"; texte: string }
  | { faire: "mode_emploi" }
  | { faire: "infos" }
  | { faire: "humain" }
  | { faire: "position" }
  | { faire: "retrait" }
  | { faire: "accueil" };

export type Comprehension = {
  actions: Action[];
  /** 0 à 1. Sous le seuil, on préfère l'escalier déterministe. */
  certitude: number;
  /** Pourquoi — enregistré dans conversation_traces, jamais montré au client. */
  raisonnement: string;
  source: "modele" | "repli";
};

/** Le peu qu'il faut savoir d'un produit pour le reconnaître et en parler. */
export type ProduitConnu = {
  id: string;
  name: string;
  price: number | null;
  currency: string;
  category: string | null;
  stock: number | null;
};

/** Les faits vérifiables du commerce. Rien ici n'est négociable par le modèle. */
export type FaitsCommerce = {
  nom: string;
  adresse?: string | null;
  horaires?: string | null;
  fraisLivraison?: number | null;
  livraison: boolean;
  devise: string;
};

// ── L'ancrage : la règle qui empêche d'inventer ─────────────────────────────

/** Les groupes de chiffres d'un texte, espaces et séparateurs de milliers ôtés. */
export function nombresDe(texte: string): string[] {
  const t = String(texte || "").replace(/(\d)[\s.,](?=\d{3}\b)/g, "$1");
  return (t.match(/\d+/g) || []).map((n) => String(Number(n)));
}

/**
 * Tout nombre de cette phrase est-il ancré dans un fait connu ?
 *
 * C'est la pièce centrale de CVA, et elle était jusqu'ici décrite dans la
 * documentation sans exister en code. Un modèle qui écrit « ça fait 15 000 »
 * alors que le produit est à 12 000 fait perdre de l'argent au commerçant à
 * chaque message ; un modèle qui écrit « livré en 2 jours » prend un engagement
 * que personne n'a autorisé.
 *
 * Les nombres du message du CLIENT comptent comme connus : s'il demande trois
 * montres, la réponse a le droit de dire trois.
 *
 * Volontairement strict. Le coût d'un rejet est une réponse déterministe un peu
 * sèche ; le coût d'un chiffre inventé est un client qui se sent trompé.
 */
export function phraseAncree(texte: string, faitsConnus: string[]): boolean {
  const connus = new Set(faitsConnus.flatMap((f) => nombresDe(f)));
  return nombresDe(texte).every((n) => connus.has(n));
}

/**
 * Cette phrase promet-elle une action que l'agent ne sait pas faire ?
 *
 * Le second garde-fou, et il est né d'un cas observé. Sur « ça fait 3 jours
 * que j'attends ma commande, c'est inadmissible », le modèle a répondu « je
 * vérifie immédiatement et je reviens vers toi ». Tout était ancré, aucun
 * chiffre inventé — et c'était pourtant la pire réponse possible : l'agent ne
 * peut pas consulter une commande, et personne n'avait été alerté. Le client
 * attend un rappel qui ne viendra jamais.
 *
 * L'ancrage protège les CHIFFRES ; celui-ci protège les ENGAGEMENTS. Une
 * promesse n'est tenable que si un outil la réalise — donc, pour tout ce qui
 * relève du suivi, seul le passage à un humain est honnête.
 *
 * Oui, c'est une liste de mots, et c'est précisément ce que je dis vouloir
 * éviter ailleurs. La différence : ce n'est pas le chemin de compréhension,
 * c'est le filet en dessous. Il ne décide de rien, il refuse.
 */
export function promesseNonTenable(texte: string): boolean {
  const t = texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // L'apostrophe devient une espace : « je m'en occupe » et « je m en
    // occupe » sont la même promesse.
    .replace(/['’`´]/g, " ")
    .replace(/\s+/g, " ");
  return (
    /\bje (vais )?(verifi|regard|contact|appel|relanc|transmet|signal|renseign|confirm)/.test(t) ||
    /\bje (te )?(revien|reponds|rappelle|recontacte|tiens au courant|previens)/.test(t) ||
    /\b(on|nous) (te )?(revient|rappelle|recontacte|reviendra|contacter)/.test(t) ||
    /\bje m en occupe\b|\bje regarde ca\b|\bje check\b|\bdes que possible\b|\btres vite\b/.test(t)
  );
}

/** Tout ce qui, dans cette conversation, autorise un nombre dans une réponse. */
export function faitsNumeriques(
  prods: ProduitConnu[], faits: FaitsCommerce, messageClient: string
): string[] {
  return [
    messageClient,
    faits.horaires || "",
    faits.adresse || "",
    faits.fraisLivraison != null ? String(faits.fraisLivraison) : "",
    ...prods.flatMap((p) => [
      p.price != null ? String(p.price) : "",
      p.stock != null ? String(p.stock) : "",
      p.name, // « Oraimo Watch 6 » autorise le 6
    ]),
  ].filter(Boolean);
}

// ── La validation du retour du modèle ──────────────────────────────────────

/**
 * Ne garder que ce qui est exécutable et vrai.
 *
 * Cette fonction est pure, et c'est délibéré : c'est elle qui protège le
 * client, donc c'est elle qu'il faut pouvoir éprouver sans appeler personne.
 */
export function valider(
  brut: unknown, prods: ProduitConnu[], faits: FaitsCommerce, messageClient: string
): Comprehension | null {
  if (!brut || typeof brut !== "object") return null;
  const o = brut as Record<string, unknown>;

  const connus = new Set(prods.map((p) => p.id));
  const ancres = faitsNumeriques(prods, faits, messageClient);
  const actions: Action[] = [];
  const rejets: string[] = [];
  let promesse = false;

  for (const a of Array.isArray(o.actions) ? o.actions : []) {
    if (!a || typeof a !== "object") continue;
    const x = a as Record<string, unknown>;
    switch (x.faire) {
      case "vitrine":
      case "mode_emploi":
      case "infos":
      case "humain":
      case "position":
      case "retrait":
      case "accueil":
        actions.push({ faire: x.faire } as Action);
        break;

      case "montrer": {
        // Le modèle choisit PARMI les identifiants fournis. Tout identifiant
        // inconnu est inventé : on le jette, on ne le cherche pas.
        const ids = (Array.isArray(x.produits) ? x.produits : [])
          .map((v) => String(v))
          .filter((v, i, t) => connus.has(v) && t.indexOf(v) === i);
        if (ids.length) actions.push({ faire: "montrer", produits: ids });
        else rejets.push("montrer sans produit connu");
        break;
      }

      case "repondre": {
        const texte = String(x.texte || "").trim();
        if (!texte) break;
        // L'ancrage. Un seul nombre non vérifiable disqualifie la phrase
        // entière : on ne sait pas lequel est faux, donc on ne garde rien.
        if (!phraseAncree(texte, ancres)) {
          rejets.push(`nombre non ancré : « ${texte.slice(0, 80)} »`);
          break;
        }
        // Un engagement de suivi est tenable SI un humain prend réellement le
        // relais. On ne peut pas le savoir ici — `humain` peut arriver après
        // dans la liste — donc on note et on tranche à la fin.
        if (promesseNonTenable(texte)) promesse = true;
        actions.push({ faire: "repondre", texte: texte.slice(0, 900) });
        break;
      }
    }
  }

  if (!actions.length) return null;

  // Une promesse de suivi sans humain au bout est un mensonge. On n'essaie pas
  // de la réécrire : on écarte toute la compréhension, et le repli
  // déterministe envoie la réclamation à un humain — ce qu'il fallait faire.
  if (promesse && !actions.some((a) => a.faire === "humain")) return null;

  const c = Number(o.certitude);
  return {
    actions,
    certitude: Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0.5,
    raisonnement:
      String(o.raisonnement || "").slice(0, 500) +
      (rejets.length ? ` | rejeté: ${rejets.join(" ; ")}` : ""),
    source: "modele",
  };
}

// ── L'appel au modèle ──────────────────────────────────────────────────────

const BASE = (process.env.IA_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
const CLE = process.env.IA_KEY || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || "";

/**
 * Les modèles, du meilleur au plus modeste.
 *
 * Chez Groq la limite de jetons par minute est comptée PAR MODÈLE : 8000 sur
 * l'offre gratuite, soit une douzaine de messages par minute. Basculer sur le
 * modèle suivant à la première saturation triple donc la capacité, sans un
 * centime — et c'est le genre de minute qui compte, puisque c'est précisément
 * quand ça afflue que ça sature.
 *
 * Le repli déterministe reste derrière, si les trois saturent ensemble.
 */
const MODELES = (process.env.IA_MODEL || "openai/gpt-oss-120b,openai/gpt-oss-20b,qwen/qwen3.8-27b")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

export function comprehensionDisponible(): boolean {
  return Boolean(CLE);
}

function consigne(prods: ProduitConnu[], faits: FaitsCommerce, resto: boolean): string {
  const liste = prods
    .slice(0, 60)
    .map(
      (p) =>
        `- ${p.id} | ${p.name}${p.category ? ` | ${p.category}` : ""}${
          p.price != null ? ` | ${p.price} ${p.currency}` : ""
        }`
    )
    .join("\n");

  return `Tu es le vendeur de ${faits.nom}${resto ? " (restaurant)" : " (boutique)"} sur WhatsApp.

Tu as une boîte à outils. Chaque outil PRODUIT quelque chose chez le client — à toi de choisir le ou les bons, comme un technicien choisit sa clé.

{"faire":"montrer","produits":["id","id"]} → envoie la VRAIE fiche WhatsApp : photo, prix, et le bouton « Ajouter au panier ». C'est le SEUL outil avec lequel le client peut acheter. Dès qu'il parle d'un article qu'on a, utilise-le : décrire un produit par du texte au lieu d'envoyer sa fiche, c'est lui retirer le bouton d'achat.
{"faire":"vitrine"} → la même chose pour tout le catalogue. Quand il n'a rien visé de précis.
{"faire":"repondre","texte":"..."} → un simple message. Pour ce qui n'est PAS un produit : livraison, horaires, une confirmation. Une ou deux phrases, tutoiement.
{"faire":"infos"} → envoie l'adresse et notre position sur la carte.
{"faire":"position"} → affiche le bouton natif « Envoyer ma position ». Pour obtenir ou corriger une adresse de livraison.
{"faire":"retrait"} → il vient chercher sur place.
{"faire":"mode_emploi"} → la vidéo qui montre comment commander.
{"faire":"humain"} → passe la main à l'équipe, et tu te tais après.
{"faire":"accueil"} → une salutation, rien de plus à faire.

COMBINER est normal, et souvent meilleur : un prix se répond ET se montre (repondre + montrer), « des écouteurs, et vous livrez ? » c'est montrer + repondre. Mets les outils dans l'ordre utile.

INTERDITS
• Un identifiant hors catalogue. Ce qu'il cherche n'y est pas → dis-le avec repondre, puis vitrine.
• Un chiffre absent des faits : prix, stock, frais. Et JAMAIS de délai de livraison — personne ne te l'a autorisé.
• NE PROMETS JAMAIS une action que tes outils ne font pas. Tu ne peux pas consulter une commande, relancer un livreur, rappeler quelqu'un, ni « revenir vers lui ». Un client qui attend, qui réclame, qui se plaint, dont la commande a un problème → {"faire":"humain"}, et RIEN d'autre. C'est la seule réponse honnête : une personne prend vraiment le relais.
• Tu hésites → baisse certitude. En dessous de 0,55 c'est traité sans toi, ce n'est pas un échec.

FAITS — la seule vérité
${faits.nom}${faits.adresse ? ` · ${faits.adresse}` : ""}${faits.horaires ? ` · ouvert ${faits.horaires}` : ""}
Livraison : ${
    faits.livraison
      ? faits.fraisLivraison != null
        ? `oui, ${faits.fraisLivraison} ${faits.devise}`
        : "oui, frais non renseignés"
      : "non, retrait sur place uniquement"
  }

CATALOGUE — id | nom | catégorie | prix
${liste || "(vide)"}

Réponds en JSON seul : {"actions":[...],"certitude":0.0,"raisonnement":"..."}`;
}

/**
 * Comprendre le message. Renvoie `null` dès que le moindre doute subsiste —
 * l'appelant retombe alors sur l'escalier déterministe.
 *
 * Le délai est court (6 s) et volontaire : sur WhatsApp, une réponse juste qui
 * arrive après trente secondes a déjà perdu le client. Mieux vaut la réponse
 * déterministe tout de suite.
 */
export async function comprendre(
  message: string,
  prods: ProduitConnu[],
  faits: FaitsCommerce,
  resto: boolean,
  historique: { role: string; content: string }[] = []
): Promise<Comprehension | null> {
  if (!CLE || !message.trim()) return null;

  const corps = {
    temperature: 0,
    max_tokens: 500,
    response_format: { type: "json_object" as const },
    messages: [
      { role: "system", content: consigne(prods, faits, resto) },
      ...historique.slice(-6).map((h) => ({
        role: h.role === "assistant" ? "assistant" : "user",
        content: String(h.content).slice(0, 500),
      })),
      { role: "user", content: message.slice(0, 1000) },
    ],
  };

  for (const [i, modele] of MODELES.entries()) {
    const ctl = new AbortController();
    const minuteur = setTimeout(() => ctl.abort(), 6000);
    try {
      const r = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        signal: ctl.signal,
        headers: { Authorization: `Bearer ${CLE}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: modele, ...corps }),
      });

      if (r.status === 429 || r.status === 503) {
        // Saturé : le modèle suivant a son propre compteur.
        console.warn(`[comprendre] ${modele} saturé (${r.status})`);
        continue;
      }
      if (!r.ok) {
        console.error(`[comprendre] ${modele} refuse :`, r.status, (await r.text()).slice(0, 200));
        continue;
      }

      const d = await r.json();
      const brut = d?.choices?.[0]?.message?.content;
      if (!brut) continue;
      const c = valider(JSON.parse(brut), prods, faits, message);
      // Un retour illisible ou entièrement rejeté : le modèle suivant peut
      // mieux faire. Mais on ne tente pas éternellement — le client attend.
      if (!c) continue;
      return i === 0 ? c : { ...c, raisonnement: `${c.raisonnement} | via ${modele}` };
    } catch (e) {
      // Un abandon au bout de 6 s n'est pas une anomalie : c'est la décision.
      console.error(`[comprendre] ${modele} abandonné :`, (e as Error).message);
    } finally {
      clearTimeout(minuteur);
    }
  }
  return null;
}
