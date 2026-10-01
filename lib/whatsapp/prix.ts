// ─────────────────────────────────────────────────────────────────────────────
// Lire un prix tel que Meta l'écrit.
//
// Aucun import : c'est une fonction de lecture, et elle doit être éprouvable
// sans rien démarrer. Elle a son propre fichier parce qu'elle a coûté cher.
//
// LE DÉFAUT QU'ELLE CORRIGE. Le code faisait :
//
//     Number(price.replace(/[^0-9]/g, "")) / 100
//
// en supposant que Meta renvoie toujours deux décimales — « 9 000,00 XAF ».
// C'est vrai pour l'euro et le dollar. Ce ne l'est PAS pour le franc CFA, qui
// est une devise SANS décimales : Meta écrit « 9 000 FCFA ». Les chiffres
// extraits valaient donc 9000, et la division donnait 90.
//
// Résultat observé en production : le carrousel affichait « 9 000 FCFA » — le
// vrai prix, tenu par Meta — et notre propre texte annonçait « 90 XAF » juste
// à côté. Un prix cent fois trop bas, dans la même conversation que le bon.
// C'est la pire catégorie de faute : elle ne plante pas, elle fait perdre de
// l'argent, et le client a une preuve écrite.
//
// La leçon, et c'est pour ça que ce fichier existe : on ne DEVINE pas le format
// d'un nombre qui vient d'ailleurs. On le lit.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le montant contenu dans un prix formaté, ou `null` si on n'en lit aucun.
 *
 * La règle qui tranche entre séparateur décimal et séparateur de milliers : le
 * DERNIER séparateur n'est décimal que s'il est suivi d'exactement une ou deux
 * décimales en fin de nombre. Partout ailleurs, c'est un séparateur de
 * milliers. Cela couvre les écritures réellement rencontrées :
 *
 *   « 9 000 FCFA »    → 9000    (CFA, sans décimales — le cas qui a échoué)
 *   « 9 000,00 XAF »  → 9000    (deux décimales, à ignorer)
 *   « 1.500 FCFA »    → 1500    (point comme séparateur de milliers)
 *   « 12,50 EUR »     → 12.5    (deux décimales, à garder)
 *   « $12.5 »         → 12.5
 *   « 1,234,567 »     → 1234567
 *
 * `null` plutôt que 0 : un prix inconnu doit s'afficher « prix non renseigné »,
 * jamais « gratuit ».
 */
export function lirePrix(brut: unknown): number | null {
  const t = String(brut ?? "").trim();
  if (!t) return null;

  // On ne garde que les chiffres et les séparateurs, dans l'ordre.
  const chiffres = t.replace(/[^0-9.,]/g, "");
  if (!/\d/.test(chiffres)) return null;

  const dernier = Math.max(chiffres.lastIndexOf("."), chiffres.lastIndexOf(","));
  let entier = chiffres;
  let decimales = "";

  if (dernier !== -1) {
    const apres = chiffres.slice(dernier + 1);
    if (/^\d{1,2}$/.test(apres)) {
      entier = chiffres.slice(0, dernier);
      decimales = apres;
    }
  }

  const n = Number(`${entier.replace(/[.,]/g, "") || "0"}.${decimales || "0"}`);
  return Number.isFinite(n) ? n : null;
}
