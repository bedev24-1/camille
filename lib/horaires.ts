// ─────────────────────────────────────────────────────────────────────────────
// Les heures d'ouverture, telles que le commerçant les écrit.
//
// Aucun import : cette logique est éprouvable telle quelle, sans base de
// données ni réseau. Elle vivait dans `lib/orders.ts`, qui parle à Postgres et
// à Firebase — donc impossible à exécuter dans un test, donc jamais testée.
//
// Ce qu'elle protège : un accusé de commande qui promet « on te recontacte tout
// de suite » à 2 h du matin est un mensonge, et le client le constate le
// lendemain. Mais inventer un horaire à partir d'un texte qu'on n'a pas comprise
// serait pire — alors on se taît plutôt que de promettre faux.
// ─────────────────────────────────────────────────────────────────────────────

/** `8h30` plutôt que `8.5`. */
function libelle(x: number): string {
  const n = Math.floor(x);
  const mn = Math.round((x - n) * 60);
  return `${n}h${mn ? String(mn).padStart(2, "0") : ""}`;
}

/**
 * Les heures d'ouverture lues dans un texte libre.
 *
 * Renvoie `null` quand le texte n'est pas interprétable — « Sur rendez-vous »,
 * « quand on peut », une case vide. C'est le cas le plus fréquent, et il doit
 * rester silencieux : le commerçant n'a aucune obligation de remplir ce champ
 * dans un format précis.
 */
export function lireHoraires(hours?: string | null): { ouvre: number; ferme: number } | null {
  const t = String(hours || "").toLowerCase().replace(/\s+/g, " ");
  if (/24\s*\/\s*24|non.?stop/.test(t)) return null; // toujours ouvert : rien à annoncer

  const m = t.match(/(\d{1,2})\s*h(?:\s*(\d{2}))?\s*(?:[-—–a à ]+)\s*(\d{1,2})\s*h(?:\s*(\d{2}))?/);
  if (!m) return null;

  const ouvre = Number(m[1]) + Number(m[2] || 0) / 60;
  const ferme = Number(m[3]) + Number(m[4] || 0) / 60;
  if (!(ouvre >= 0 && ouvre <= 24 && ferme >= 0 && ferme <= 24) || ouvre === ferme) return null;
  return { ouvre, ferme };
}

/**
 * Le commerce est-il ouvert à cette heure ?
 *
 * `heure` est en heures décimales locales. Le cas `ouvre > ferme` est celui
 * d'un commerce qui travaille la nuit — « 20h - 02h » — et il est courant à
 * Douala pour la restauration.
 */
export function estOuvert(ouvre: number, ferme: number, heure: number): boolean {
  return ouvre < ferme ? heure >= ouvre && heure < ferme : heure >= ouvre || heure < ferme;
}

/** L'heure locale décimale, à partir d'un décalage UTC. */
export function heureLocale(maintenant: Date, offset: number): number {
  return ((((maintenant.getUTCHours() + offset) % 24) + 24) % 24) + maintenant.getUTCMinutes() / 60;
}

/**
 * La phrase à ajouter à l'accusé de commande quand le commerce est fermé.
 *
 * Chaîne vide dans tous les cas où l'on ne sait pas : horaires absents,
 * illisibles, ou commerce ouvert. Le silence est la bonne réponse — c'est
 * mieux qu'une promesse inventée.
 *
 * `maintenant` est injectable pour que le test ne dépende pas de l'horloge.
 */
export function closedNotice(
  hours?: string | null,
  offset = 1,
  maintenant: Date = new Date()
): string {
  const h = lireHoraires(hours);
  if (!h) return "";
  if (estOuvert(h.ouvre, h.ferme, heureLocale(maintenant, offset))) return "";
  return `\n\n😴 On est fermé pour le moment. Ta commande est bien enregistrée et sera prise en charge dès l'ouverture, à ${libelle(h.ouvre)}.`;
}
