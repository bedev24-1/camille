// ─────────────────────────────────────────────────────────────────────────────
// Ne pas renvoyer au client ce qu'il a déjà sous les yeux.
//
// Observé sur le numéro Buyticle : le même carrousel de cinq articles est parti
// quatre fois dans une seule conversation. Le client remonte son fil et voit
// quatre fois les mêmes montres. Ce n'est pas une erreur technique — chaque
// envoi était justifié pris isolément — c'est un étouffement, et c'est ce qui
// fait fermer la conversation.
//
// Le principe : la vitrine complète est un geste COÛTEUX pour l'attention du
// client. On ne le refait pas tant que rien n'a changé et que ce qu'il a reçu
// est encore visible dans son fil.
//
// Deux choses ne sont JAMAIS retenues :
//   • une sélection ciblée — s'il demande les montres puis les écouteurs, il
//     doit voir les deux. C'est une réponse, pas une répétition.
//   • une vitrine dont le CONTENU a changé — nouveau produit, rupture de
//     stock : c'est une information neuve.
//
// L'état vit en mémoire du processus, volontairement. Il se perd à chaque
// redéploiement, et c'est sans conséquence : au pire un client revoit un
// carrousel. Une table en base pour ça coûterait une migration, une écriture
// par message, et un risque — pour éviter un désagrément passager.
// ─────────────────────────────────────────────────────────────────────────────

/** Combien de temps un carrousel reste « encore sous les yeux » du client. */
export const FENETRE_MS = Number(process.env.VITRINE_FENETRE_S || 600) * 1000;

type Trace = { signature: string; quand: number };
const VUES = new Map<string, Trace>();
const MAX = 2000;

/** La signature d'un ensemble d'articles : son contenu, pas son ordre. */
export function signature(ids: string[]): string {
  return [...ids].sort().join(",");
}

/**
 * Faut-il renvoyer cette vitrine ?
 *
 * `true` quand le client ne l'a pas vue, ou qu'elle a changé, ou que la
 * fenêtre est passée. L'horloge est injectable pour que le test ne dépende pas
 * de l'heure réelle.
 */
export function aRenvoyer(
  cle: string, ids: string[], maintenant = Date.now()
): boolean {
  const sig = signature(ids);
  const vue = VUES.get(cle);
  if (!vue) return true;
  if (vue.signature !== sig) return true; // le catalogue a changé : c'est neuf
  return maintenant - vue.quand > FENETRE_MS;
}

/** Noter qu'on vient de l'envoyer. */
export function noterEnvoi(cle: string, ids: string[], maintenant = Date.now()) {
  if (VUES.size >= MAX) {
    const vieille = VUES.keys().next().value;
    if (vieille) VUES.delete(vieille);
  }
  VUES.delete(cle);
  VUES.set(cle, { signature: signature(ids), quand: maintenant });
}

/** Pour les tests. */
export function oublierTout() {
  VUES.clear();
}
