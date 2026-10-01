// ─────────────────────────────────────────────────────────────────────────────
// Montrer la même chose, en prenant moins de place.
//
// LE PROBLÈME. Observé sur le numéro Buyticle : le même carrousel de cinq
// articles parti quatre fois dans une conversation. Chaque envoi était justifié
// pris isolément — l'ensemble étouffe. Le client remonte son fil et voit quatre
// fois les mêmes montres.
//
// CE QU'IL NE FAUT PAS FAIRE, et c'est ma première tentative : lui répondre
// « c'est juste au-dessus 👆 ». Ça lui donne du travail — remonter, chercher —
// et ça lui retire un accès qu'il avait. Un outil ne doit pas se défausser sur
// son utilisateur, et il ne doit pas limiter une action dans le temps.
//
// CE QU'IL FAUT FAIRE. WhatsApp fournit plusieurs composants pour montrer les
// MÊMES articles, et ils n'occupent pas le même volume visuel :
//
//   carousel       les fiches en grand, photo par photo — très vendeur, très
//                  encombrant : cinq articles remplissent l'écran
//   product_list   une liste par catégories, repliée derrière un bouton — tout
//                  est là, en quatre lignes
//   catalog_message une seule carte compacte qui ouvre le catalogue entier
//
// Alors on ne retire rien et on ne reporte rien : on redescend d'un cran dans
// l'encombrement. Le client garde exactement le même accès à exactement les
// mêmes articles, et son fil reste lisible.
//
// La répétition se recompte à zéro dès que le CONTENU change : un nouveau
// produit ou une rupture, c'est une information neuve, elle a droit au grand
// format.
//
// L'état vit en mémoire du processus, volontairement. Il se perd au
// redéploiement, et au pire un client revoit un grand carrousel. Une table en
// base pour ça coûterait une migration et une écriture par message.
// ─────────────────────────────────────────────────────────────────────────────

/** Au-delà, on considère que le client a tourné la page. */
export const FENETRE_MS = Number(process.env.VITRINE_FENETRE_S || 1800) * 1000;

/** Les formats, du plus encombrant au plus discret. */
export type Format = "fiche" | "carrousel" | "liste" | "catalogue";

type Trace = { signature: string; vues: number; quand: number };
const VUES = new Map<string, Trace>();
const MAX = 2000;

/** La signature d'un ensemble d'articles : son contenu, pas son ordre. */
export function signature(ids: string[]): string {
  return [...ids].sort().join(",");
}

/**
 * Le format naturel pour ce nombre d'articles, sans tenir compte du passé.
 *
 *   1            → la fiche, photo et prix du catalogue
 *   2 à 10       → le carrousel, le plus vendeur
 *   plus de 10   → la liste par catégories
 */
export function formatNaturel(n: number): Format {
  if (n <= 0) return "catalogue";
  if (n === 1) return "fiche";
  if (n <= 10) return "carrousel";
  return "liste";
}

/** Un cran plus discret, à encombrement décroissant. */
function allegé(f: Format): Format {
  if (f === "carrousel") return "liste";
  if (f === "liste") return "catalogue";
  return f; // une fiche unique est déjà discrète : rien à alléger
}

/**
 * Comment montrer ces articles à CE client, maintenant ?
 *
 * Premier envoi : le format naturel. Deuxième envoi du même ensemble : un cran
 * plus discret. Troisième et au-delà : la carte de catalogue, la plus compacte.
 *
 * Rien n'est retiré au client à aucun moment — les mêmes articles restent
 * atteignables, en un geste. Seul l'encombrement de son fil diminue.
 *
 * L'horloge est injectable pour que le test ne dépende pas de l'heure réelle.
 */
export function formatVitrine(
  cle: string, ids: string[], maintenant = Date.now()
): Format {
  const naturel = formatNaturel(ids.length);
  const sig = signature(ids);
  const vue = VUES.get(cle);

  // Jamais vu, contenu différent, ou page tournée : le grand format.
  if (!vue || vue.signature !== sig || maintenant - vue.quand > FENETRE_MS) return naturel;

  let f = naturel;
  for (let i = 0; i < vue.vues; i++) f = allegé(f);
  return f;
}

/** Noter qu'on vient de l'envoyer, pour que le prochain soit plus discret. */
export function noterEnvoi(cle: string, ids: string[], maintenant = Date.now()) {
  const sig = signature(ids);
  const vue = VUES.get(cle);
  const vues = vue && vue.signature === sig && maintenant - vue.quand <= FENETRE_MS ? vue.vues + 1 : 1;

  if (!VUES.has(cle) && VUES.size >= MAX) {
    const vieille = VUES.keys().next().value;
    if (vieille) VUES.delete(vieille);
  }
  VUES.delete(cle);
  VUES.set(cle, { signature: sig, vues, quand: maintenant });
}

/** Pour les tests. */
export function oublierTout() {
  VUES.clear();
}
