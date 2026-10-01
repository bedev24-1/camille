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
        actions.push({ faire: "repondre", texte: texte.slice(0, 900) });
        break;
      }
    }
  }

  if (!actions.length) return null;

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
const MODELE = process.env.IA_MODEL || "llama-3.3-70b-versatile";

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

  return `Tu analyses le message d'un client qui écrit sur WhatsApp à ${faits.nom}${
    resto ? ", un restaurant" : ", une boutique"
  }.

Ta SEULE tâche : dire ce que le client veut, en JSON. Tu ne rédiges pas de message commercial, tu ne choisis pas la mise en forme, tu n'ajoutes aucune politesse.

Actions disponibles :
- {"faire":"vitrine"} — il veut voir tout ce qu'on propose
- {"faire":"montrer","produits":["id",...]} — il veut voir des articles précis : mets leurs identifiants. Une catégorie entière ? mets tous les identifiants de cette catégorie.
- {"faire":"repondre","texte":"..."} — il pose une question à laquelle les faits ci-dessous répondent. Réponds en une ou deux phrases, tutoiement, français simple.
- {"faire":"mode_emploi"} — il ne sait pas comment ça marche, ou demande comment commander
- {"faire":"infos"} — il veut l'adresse, les horaires, où vous êtes
- {"faire":"humain"} — il veut parler à une personne, il se plaint, il est mécontent
- {"faire":"position"} — il veut donner ou corriger son adresse de livraison
- {"faire":"retrait"} — il préfère venir chercher sur place
- {"faire":"accueil"} — simple salutation, rien de plus

RÈGLES ABSOLUES
1. Plusieurs intentions dans un message ? Mets PLUSIEURS actions, dans l'ordre où il les a exprimées.
2. N'invente JAMAIS un identifiant de produit. Utilise uniquement ceux de la liste. Si ce qu'il demande n'y est pas, réponds {"faire":"vitrine"}.
3. N'invente JAMAIS un chiffre : prix, stock, délai, frais. Si un chiffre n'est pas dans les faits ci-dessous, ne l'écris pas. Pas de délai de livraison, jamais.
4. Tu ne sais pas ? Baisse "certitude". Une certitude basse est traitée sans toi, ce n'est pas un échec.

FAITS (la seule vérité)
Commerce : ${faits.nom}${faits.adresse ? ` — ${faits.adresse}` : ""}
${faits.horaires ? `Horaires : ${faits.horaires}` : "Horaires : non renseignés"}
Livraison : ${
    faits.livraison
      ? faits.fraisLivraison != null
        ? `oui, ${faits.fraisLivraison} ${faits.devise}`
        : "oui, frais non renseignés"
      : "non, retrait sur place"
  }

CATALOGUE (identifiant | nom | catégorie | prix)
${liste || "(vide)"}

Réponds uniquement : {"actions":[...],"certitude":0.0,"raisonnement":"..."}`;
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

  const ctl = new AbortController();
  const minuteur = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      signal: ctl.signal,
      headers: { Authorization: `Bearer ${CLE}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODELE,
        temperature: 0,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: consigne(prods, faits, resto) },
          ...historique.slice(-6).map((h) => ({
            role: h.role === "assistant" ? "assistant" : "user",
            content: String(h.content).slice(0, 500),
          })),
          { role: "user", content: message.slice(0, 1000) },
        ],
      }),
    });
    if (!r.ok) {
      console.error("[comprendre] modèle indisponible :", r.status, (await r.text()).slice(0, 200));
      return null;
    }
    const d = await r.json();
    const brut = d?.choices?.[0]?.message?.content;
    if (!brut) return null;
    return valider(JSON.parse(brut), prods, faits, message);
  } catch (e) {
    // Un abandon au bout de 6 s n'est pas une anomalie : c'est la décision.
    console.error("[comprendre] abandon :", (e as Error).message);
    return null;
  } finally {
    clearTimeout(minuteur);
  }
}
