// ─────────────────────────────────────────────────────────────────────────────
// La mémoire d'un client.
//
// Ce qu'elle change : un client qui revient n'est plus un inconnu. Camille sait
// ce qu'il a acheté, ce qu'il avait dit aimer, et peut le resservir en un
// geste. C'est la différence entre une borne automatique et le vendeur du
// quartier qui lance « la même chose ? ».
//
// DEUX SOURCES, et elles n'ont pas le même statut :
//
//   • LES COMMANDES PASSÉES — `camille.orders`. Ce sont des FAITS : il a payé,
//     c'est écrit. Leurs prix peuvent donc ancrer une réponse.
//   • LES GOÛTS NOTÉS — « préfère le noir », « petit budget ». C'est le modèle
//     qui les écrit, donc ce ne sont PAS des faits. Ils renseignent la
//     conversation, et ils n'ancrent RIEN : sinon une note inventée
//     blanchirait un prix inventé au tour suivant. C'est la faille qu'il faut
//     tenir fermée.
//
// LA DISCRÉTION EST UNE EXIGENCE, pas une politesse. « Je vois que tu as déjà
// commandé… » à chaque message est étouffant, et un client étouffé s'en va. La
// mémoire sert quand elle sert la demande du moment, et se tait le reste du
// temps.
// ─────────────────────────────────────────────────────────────────────────────

export type Achat = { quand: string; articles: string[]; total: number | null };

export type Souvenir = {
  achats: Achat[];
  /** Les goûts, en clair. Jamais traités comme des faits vérifiables. */
  notes: string[];
};

/** Nombre de notes conservées. Au-delà, la mémoire devient un fourre-tout. */
export const MAX_NOTES = 8;

/** « il y a 3 jours », parce qu'une date exacte n'apporte rien ici. */
function anciennete(iso: string, maintenant: Date): string {
  const j = Math.floor((maintenant.getTime() - new Date(iso).getTime()) / 86400000);
  if (!Number.isFinite(j) || j < 0) return "récemment";
  if (j === 0) return "aujourd'hui";
  if (j === 1) return "hier";
  if (j < 30) return `il y a ${j} jours`;
  const m = Math.round(j / 30);
  return `il y a ${m} mois`;
}

/**
 * Le bloc remis au modèle. Court exprès.
 *
 * Une mémoire longue fait deux dégâts : elle dilue la demande du client dans
 * un dossier, et elle mange le budget de jetons — qui est de 8000 par minute
 * sur l'offre gratuite. Deux derniers achats, huit notes au plus.
 *
 * Chaîne vide quand il n'y a rien : on n'envoie pas « aucun historique » au
 * modèle, ça ne lui apprend rien et ça l'invite à en parler.
 */
export function resumeMemoire(s: Souvenir, maintenant: Date = new Date()): string {
  const bouts: string[] = [];
  for (const a of s.achats.slice(0, 2)) {
    if (!a.articles.length) continue;
    bouts.push(`A acheté ${anciennete(a.quand, maintenant)} : ${a.articles.slice(0, 4).join(", ")}`);
  }
  if (s.notes.length) bouts.push(`On sait de lui : ${s.notes.slice(0, MAX_NOTES).join(" ; ")}`);
  return bouts.join("\n");
}

/**
 * Fusionner de nouvelles notes aux anciennes.
 *
 * Sans dédoublonnage, « préfère le noir » s'empile à chaque conversation et la
 * mémoire se remplit de la même phrase. La comparaison ignore la casse et les
 * accents, parce que le modèle n'écrit pas deux fois pareil.
 *
 * Les plus récentes passent devant, et surtout : UN GOÛT QUI CHANGE CHASSE
 * L'ANCIEN. Sans ça, « préfère le noir » et « préfère le bleu » cohabitent et
 * le modèle reçoit deux consignes contradictoires — observé au premier essai
 * contre le vrai modèle.
 *
 * Le sujet d'une note, c'est son PREMIER mot porteur — l'attribut, pas la
 * valeur. « préfère le bleu » et « préfère le noir » partagent « prefere » :
 * le neuf remplace l'ancien. Deux mots ne suffisaient pas, puisque c'est
 * justement le second qui change. C'est une heuristique, et elle se trompera parfois — « achète pour
 * sa fille » chassera « achète pour son fils ». Le compromis est assumé : une
 * mémoire un peu courte vaut mieux qu'une mémoire qui se contredit.
 */
export function fusionnerNotes(anciennes: string[], nouvelles: string[]): string[] {
  const norm = (x: string) =>
    x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  // Les mots outils ne disent rien du sujet d'une note.
  const OUTILS = new Set(["le", "la", "les", "un", "une", "des", "du", "de", "d",
    "a", "au", "aux", "en", "son", "sa", "ses", "toujours", "plutot"]);
  const sujet = (x: string) =>
    norm(x).split(" ").filter((w) => w && !OUTILS.has(w))[0] || "";

  const vues = new Set<string>();
  const sujets = new Set<string>();
  const sortie: string[] = [];
  for (const n of [...nouvelles, ...anciennes]) {
    const t = String(n || "").trim().slice(0, 120);
    if (!t) continue;
    const k = norm(t);
    const sj = sujet(t);
    if (!k || vues.has(k) || (sj && sujets.has(sj))) continue;
    vues.add(k);
    if (sj) sujets.add(sj);
    sortie.push(t);
    if (sortie.length >= MAX_NOTES) break;
  }
  return sortie;
}

/**
 * Les notes proposées par le modèle, nettoyées.
 *
 * On refuse ce qui ressemble à une phrase de conversation plutôt qu'à un fait
 * durable : une note est un trait du client, pas un compte rendu. Et on refuse
 * les notes qui parlent de la commande en cours — elles seront fausses demain.
 */
export function validerNotes(brut: unknown): string[] {
  if (!Array.isArray(brut)) return [];
  return brut
    .map((n) => String(n || "").trim())
    .filter((n) => n.length >= 3 && n.length <= 120)
    .filter((n) => !/^(bonjour|merci|ok|oui|non)\b/i.test(n))
    // « a commandé 2 montres aujourd'hui » n'est pas un goût, c'est un
    // événement : l'historique des commandes le sait déjà, et mieux.
    .filter((n) => !/\b(aujourd.?hui|maintenant|a l.?instant|ce matin|ce soir)\b/i.test(n))
    .slice(0, MAX_NOTES);
}

/** Ce que les achats passés autorisent comme nombres dans une réponse. */
export function faitsDesAchats(s: Souvenir): string[] {
  // Les notes sont volontairement absentes : elles viennent du modèle, donc
  // les laisser ancrer un nombre reviendrait à lui faire valider ses propres
  // inventions avec un tour de retard.
  return s.achats.map((a) => (a.total != null ? String(a.total) : "")).filter(Boolean);
}
