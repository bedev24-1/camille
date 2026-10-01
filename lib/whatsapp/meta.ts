// ─────────────────────────────────────────────────────────────────────────────
// Pilote WhatsApp Cloud API (Meta).
//
// C'est le troisième transport de Camille, après WAHA puis camille-core. Les
// deux premiers ont été échangés sans que le reste de l'application s'en
// aperçoive, parce que `lib/waha.ts` gardait ses noms d'exports. On tient la
// même discipline ici : ce fichier est NEUF, il ne modifie rien, et rien ne
// l'appelle tant qu'un agent n'est pas explicitement marqué `transport='meta'`.
//
// Aucun client existant ne passe par ce code.
//
// Les identifiants viennent de l'environnement — jamais du dépôt :
//   WHATSAPP_TOKEN · PHONE_NUMBER_ID · CATALOG_ID · GRAPH_VERSION
//   WHATSAPP_VERIFY_TOKEN · WHATSAPP_APP_SECRET
// ─────────────────────────────────────────────────────────────────────────────

const GRAPH = (process.env.GRAPH_VERSION || "v26.0").replace(/^\/?/, "");
const TOKEN = process.env.WHATSAPP_TOKEN || "";
const PHONE_ID = process.env.PHONE_NUMBER_ID || "";
const CATALOG_ID = process.env.CATALOG_ID || "";

export type MetaResult = { ok: boolean; id?: string; error?: string; status?: number };

/** Le numéro tel que Meta le veut : chiffres seuls, sans +, sans suffixe. */
export function normalizePhone(raw: string): string {
  return String(raw || "").replace(/[^0-9]/g, "");
}

/**
 * Un appel à l'API Graph.
 *
 * Ne lève jamais : un envoi qui échoue ne doit pas emporter le traitement du
 * message. L'erreur remonte telle que Meta l'a écrite — c'est elle qui permet
 * de corriger, pas un « échec » générique. La leçon vient de FCM, où l'on
 * désactivait des jetons valides faute de lire le corps de la réponse.
 */
async function post(path: string, body: unknown): Promise<MetaResult> {
  if (!TOKEN || !PHONE_ID) {
    return { ok: false, error: "WHATSAPP_TOKEN ou PHONE_NUMBER_ID absent de l'environnement" };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const txt = await res.text();
    let json: Record<string, unknown> = {};
    try { json = txt ? JSON.parse(txt) : {}; } catch { /* Meta a renvoyé autre chose que du JSON */ }

    if (!res.ok) {
      const err = (json.error || {}) as {
        message?: string; code?: number; error_subcode?: number;
        error_user_msg?: string; error_data?: { details?: string };
      };
      // `error_data.details` est INDISPENSABLE : c'est le seul endroit où Meta
      // nomme ce qui cloche — « product not found for product_retailer_id,
      // m4castvg8j ». Le `message` seul se contente de « Parameter value is not
      // valid », sur quoi aucun repli ne peut raisonner. On l'avait omis, et
      // sendCarouselRobuste ne pouvait donc jamais identifier la fiche fautive.
      const bouts = [
        err.message,
        err.code != null ? `(code ${err.code}${err.error_subcode ? `/${err.error_subcode}` : ""})` : "",
        err.error_data?.details,
        err.error_user_msg,
      ].filter(Boolean);
      return {
        ok: false,
        status: res.status,
        error: bouts.length ? bouts.join(" — ") : txt.slice(0, 300),
      };
    }
    const msgs = json.messages as { id?: string }[] | undefined;
    return { ok: true, id: msgs?.[0]?.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const send = (to: string, payload: Record<string, unknown>) =>
  post(`${PHONE_ID}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizePhone(to),
    ...payload,
  });

// ── Messages simples ────────────────────────────────────────────────────────

export function sendText(to: string, text: string, previewUrl = true): Promise<MetaResult> {
  // Meta coupe à 4096 caractères ; on tronque proprement plutôt que de laisser
  // l'API refuser tout le message.
  const body = String(text || "").slice(0, 4096);
  return send(to, { type: "text", text: { body, preview_url: previewUrl } });
}

export function sendImage(to: string, url: string, caption?: string): Promise<MetaResult> {
  return send(to, {
    type: "image",
    image: { link: url, ...(caption ? { caption: caption.slice(0, 1024) } : {}) },
  });
}

export function sendLocation(
  to: string, lat: number, lng: number, name?: string, address?: string
): Promise<MetaResult> {
  return send(to, {
    type: "location",
    location: { latitude: lat, longitude: lng, name: name || "", address: address || "" },
  });
}

/**
 * Marque le message comme lu et affiche l'indicateur de frappe.
 *
 * Chez Meta la frappe n'est pas une action libre : elle s'attache à un message
 * reçu et retombe seule au bout de ~25 s ou à l'envoi de la réponse. Il n'y a
 * donc pas de `stopTyping` — et plus besoin du nœud `Wait` qui simulait le
 * délai côté camille-core.
 */
export function markReadTyping(messageId: string): Promise<MetaResult> {
  return post(`${PHONE_ID}/messages`, {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
    typing_indicator: { type: "text" },
  });
}

// ── Boutons et listes — natifs, donc fiables ────────────────────────────────

/**
 * Jusqu'à trois boutons de réponse rapide.
 *
 * Chaque choix fait par un bouton est un tour où l'analyse de texte libre ne
 * peut pas se tromper — et, pour la moitié d'entre eux, un tour qui ne coûte
 * aucun token. Les boutons ne sont pas un confort d'affichage : ce sont des
 * questions retirées au modèle.
 */
export function sendButtons(
  to: string, body: string, buttons: { id: string; title: string }[], footer?: string
): Promise<MetaResult> {
  return send(to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body.slice(0, 1024) },
      ...(footer ? { footer: { text: footer.slice(0, 60) } } : {}),
      action: {
        // Meta refuse un titre de plus de 20 caractères, et le refus porte sur
        // tout le message : on tronque ici plutôt que de perdre l'envoi.
        buttons: buttons.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
        })),
      },
    },
  });
}

export function sendList(
  to: string, body: string, buttonLabel: string,
  sections: { title: string; rows: { id: string; title: string; description?: string }[] }[],
  footer?: string
): Promise<MetaResult> {
  return send(to, {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body.slice(0, 1024) },
      ...(footer ? { footer: { text: footer.slice(0, 60) } } : {}),
      action: {
        button: buttonLabel.slice(0, 20),
        sections: sections.slice(0, 10).map((s) => ({
          title: s.title.slice(0, 24),
          rows: s.rows.slice(0, 10).map((r) => ({
            id: r.id.slice(0, 200),
            title: r.title.slice(0, 24),
            ...(r.description ? { description: r.description.slice(0, 72) } : {}),
          })),
        })),
      },
    },
  });
}

// ── Catalogue : ce qui remplace nos albums ──────────────────────────────────

/**
 * Une fiche produit native, tirée du catalogue Meta.
 *
 * C'est le remplacement de `sendImage` + légende bricolée : le client voit le
 * prix, la photo et la description tenus par le catalogue, et peut ajouter au
 * PANIER WhatsApp natif sans qu'on ait à interpréter « oui je veux ça ».
 */
export function sendProduct(
  to: string, retailerId: string, body?: string, catalogId = CATALOG_ID
): Promise<MetaResult> {
  return send(to, {
    type: "interactive",
    interactive: {
      type: "product",
      ...(body ? { body: { text: body.slice(0, 1024) } } : {}),
      action: { catalog_id: catalogId, product_retailer_id: retailerId },
    },
  });
}

/**
 * Plusieurs produits en une vitrine — l'équivalent natif de notre album, en
 * mieux : le client parcourt, choisit les quantités et renvoie un panier.
 *
 * Meta impose un en-tête texte et au moins une section.
 */
export function sendProductList(
  to: string, header: string, body: string,
  sections: { title: string; retailerIds: string[] }[],
  footer?: string, catalogId = CATALOG_ID
): Promise<MetaResult> {
  return send(to, {
    type: "interactive",
    interactive: {
      type: "product_list",
      header: { type: "text", text: header.slice(0, 60) },
      body: { text: body.slice(0, 1024) },
      ...(footer ? { footer: { text: footer.slice(0, 60) } } : {}),
      action: {
        catalog_id: catalogId,
        sections: sections.slice(0, 10).map((s) => ({
          title: s.title.slice(0, 24),
          product_items: s.retailerIds.slice(0, 30).map((id) => ({ product_retailer_id: id })),
        })),
      },
    },
  });
}

/**
 * Le carrousel : des fiches produit qui défilent horizontalement.
 *
 * C'est le format le plus vendeur, et celui qui remplace vraiment nos albums :
 * chaque carte porte la photo, le nom et le prix tenus par le catalogue, et le
 * client ajoute au panier sans écrire une phrase.
 *
 * Trois contraintes imposées par Meta, apprises en les heurtant :
 *   - de 2 à 10 cartes (une seule carte est refusée → on envoie une fiche) ;
 *   - ni en-tête, ni pied de page, ni boutons ;
 *   - toutes les cartes dans le MÊME catalogue, et chaque `retailer_id` est
 *     vérifié côté serveur. Un identifiant qui figure dans le catalogue en
 *     lecture mais n'y est pas réellement rattaché fait rejeter TOUT le
 *     message — pas seulement sa carte.
 */
export function sendCarousel(
  to: string, body: string, retailerIds: string[], catalogId = CATALOG_ID
): Promise<MetaResult> {
  const ids = retailerIds.slice(0, 10);
  if (ids.length < 2) {
    return ids.length === 1
      ? sendProduct(to, ids[0], body, catalogId)
      : Promise.resolve({ ok: false, error: "carrousel : aucune fiche à montrer" });
  }
  return send(to, {
    type: "interactive",
    interactive: {
      type: "carousel",
      body: { text: body.slice(0, 1024) },
      action: {
        cards: ids.map((rid, i) => ({
          card_index: i,
          type: "product",
          action: { product_retailer_id: rid, catalog_id: catalogId },
        })),
      },
    },
  });
}

/**
 * Le carrousel, qui se répare lui-même.
 *
 * Le catalogue de production contenait trois produits « importés » que l'API de
 * lecture donnait pour `in stock` et `published`, et que WhatsApp refusait à
 * l'envoi : « product not found for product_retailer_id … in catalog_id … ».
 *
 * Aucun contrôle préalable ne les distingue — c'est justement l'API de lecture
 * qui les renvoie. La seule chose qui les révèle est l'échec, et Meta a la
 * courtoisie de NOMMER le coupable dans `error_data.details`. On s'en sert :
 * on retire la fiche incriminée et on réessaie, au lieu de laisser le client
 * sans rien parce qu'un produit sur cinq est fantôme.
 */
export async function sendCarouselRobuste(
  to: string, body: string, retailerIds: string[], catalogId = CATALOG_ID
): Promise<MetaResult & { rejetes?: string[] }> {
  let ids = retailerIds.slice(0, 10);
  const rejetes: string[] = [];

  // Au pire un tour par fiche ; en pratique un ou deux.
  for (let essai = 0; essai < ids.length + 1; essai++) {
    const r = await sendCarousel(to, body, ids, catalogId);
    if (r.ok) return rejetes.length ? { ...r, rejetes } : r;

    // On ne retente que sur « produit introuvable », et seulement si Meta
    // nomme lequel. Toute autre erreur est rendue telle quelle.
    const coupable = ids.find((id) => r.error?.includes(id));
    if (!coupable) return rejetes.length ? { ...r, rejetes } : r;

    console.warn(`[meta] fiche produit injoignable, retirée de la vitrine : ${coupable}`);
    rejetes.push(coupable);
    ids = ids.filter((id) => id !== coupable);
    if (!ids.length) return { ok: false, error: "aucune fiche envoyable", rejetes };
  }
  return { ok: false, error: "aucune fiche envoyable", rejetes };
}

/** La vitrine entière, telle que le catalogue la tient. */
export function sendCatalog(to: string, body: string, footer?: string): Promise<MetaResult> {
  return send(to, {
    type: "interactive",
    interactive: {
      type: "catalog_message",
      body: { text: body.slice(0, 1024) },
      ...(footer ? { footer: { text: footer.slice(0, 60) } } : {}),
      action: { name: "catalog_message" },
    },
  });
}

// ── Templates — le seul envoi permis hors de la fenêtre de 24 h ─────────────

/**
 * Hors des 24 h qui suivent le dernier message du client, seul un template
 * approuvé passe. C'est ce qui concerne le remerciement à la livraison, la
 * prise en charge d'une réclamation, sa clôture, et un bon de commande envoyé
 * plus tard — quatre envois que Camille fait aujourd'hui en texte libre.
 */
export function sendTemplate(
  to: string, name: string, lang = "fr", params: string[] = []
): Promise<MetaResult> {
  return send(to, {
    type: "template",
    template: {
      name,
      language: { code: lang },
      ...(params.length
        ? { components: [{ type: "body", parameters: params.map((t) => ({ type: "text", text: t })) }] }
        : {}),
    },
  });
}

// ── Lecture du catalogue Meta ───────────────────────────────────────────────

export type MetaCatalogItem = {
  retailer_id: string;
  name: string;
  price?: string;
  availability?: string;
  image_url?: string;
  description?: string;
};

/**
 * Les produits du catalogue Meta.
 *
 * Utile pour vérifier ce que Meta tient réellement — un `retailer_id` absent
 * ou un produit en `out of stock` fait échouer l'envoi d'une fiche, et le
 * message d'erreur de Meta ne dit pas lequel.
 */
export async function listCatalog(catalogId = CATALOG_ID, limit = 50): Promise<{
  ok: boolean; items: MetaCatalogItem[]; error?: string;
}> {
  if (!TOKEN || !catalogId) return { ok: false, items: [], error: "WHATSAPP_TOKEN ou CATALOG_ID absent" };
  try {
    const fields = "retailer_id,name,price,availability,image_url,description";
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH}/${catalogId}/products?fields=${fields}&limit=${limit}`,
      { headers: { Authorization: `Bearer ${TOKEN}` } }
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (json.error || {}) as { message?: string };
      return { ok: false, items: [], error: err.message || `HTTP ${res.status}` };
    }
    return { ok: true, items: (json.data || []) as MetaCatalogItem[] };
  } catch (e) {
    return { ok: false, items: [], error: (e as Error).message };
  }
}

/** Ce que l'environnement porte réellement — sans jamais divulguer le jeton. */
export function metaConfigured(): {
  ok: boolean; phone_number_id: string; catalog_id: string; graph: string; token: string;
} {
  return {
    ok: Boolean(TOKEN && PHONE_ID),
    phone_number_id: PHONE_ID || "(absent)",
    catalog_id: CATALOG_ID || "(absent)",
    graph: GRAPH,
    // Les quatre derniers caractères suffisent à vérifier qu'on parle du bon
    // jeton sans l'exposer dans un journal ou une réponse d'API.
    token: TOKEN ? `…${TOKEN.slice(-4)} (${TOKEN.length} car.)` : "(absent)",
  };
}
