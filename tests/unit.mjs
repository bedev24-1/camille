// ─────────────────────────────────────────────────────────────────────────────
// Banc d'essai des modules purs de Camille.
//
//   npm test
//
// Il n'y a pas de cadre de test : les modules éprouvés ici n'ont aucune
// dépendance, et un `node` suffit. Ce qui compte n'est pas l'outillage, c'est
// que chaque cas vienne d'un défaut RÉELLEMENT survenu en production — pas
// d'un cas inventé qui fait plaisir.
//
// Et il exécute les modules COMPILÉS depuis le dépôt, jamais une imitation
// écrite à la main. Deux fois dans la même journée, une imitation a fini par
// diverger du code et à passer pendant que la production échouait.
// ─────────────────────────────────────────────────────────────────────────────

let ok = 0;
const echecs = [];

function groupe(titre) { console.log(`\n── ${titre} ${"─".repeat(Math.max(0, 62 - titre.length))}`); }
function chk(titre, vrai, detail = "") {
  if (vrai) { ok++; console.log(`  ok   ${titre}`); }
  else { echecs.push(titre); console.log(`  ÉCHEC ${titre}${detail ? "   → " + detail : ""}`); }
}
const eq = (titre, a, b) => chk(titre, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

// Résolu depuis le dossier d'exécution, pas depuis ce fichier : sinon
// `npm test` et un appel direct ne pointent pas au même endroit.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const DIST = pathToFileURL(resolve(process.cwd(), process.argv[2] || ".test-build")).href;

// ═══ lib/productFields — le 500 sur la mise à jour du stock ═════════════════
{
  const { coerce } = await import(`${DIST}/productFields.js`);
  groupe("productFields — l'origine du 500 au stock");

  // Le formulaire mobile envoie `null` pour un champ vide ; `description` est
  // NOT NULL en base. Changer le stock d'un produit sans description faisait
  // donc échouer la requête, et la route renvoyait un 500 muet.
  eq("description vide → chaîne vide, pas null", coerce("description", null), "");
  eq("description absente → chaîne vide", coerce("description", undefined), "");
  eq("currency vide → XAF", coerce("currency", ""), "XAF");
  eq("min_order vide → 1", coerce("min_order", null), 1);
  eq("active vide → true", coerce("active", null), true);
  eq("sort_order vide → 0", coerce("sort_order", null), 0);

  // Une colonne nullable doit rester nulle : mettre 0 dans `price` afficherait
  // « gratuit » au lieu de « prix non renseigné ».
  eq("price vide reste null", coerce("price", ""), null);
  eq("stock vide reste null", coerce("stock", null), null);

  // Une saisie non numérique arrivait telle quelle jusqu'à Postgres, qui
  // refusait la requête entière pour un seul caractère.
  eq("stock « 12 » → 12", coerce("stock", "12"), 12);
  eq("stock « douze » → null plutôt que de tout casser", coerce("stock", "douze"), null);
  eq("min_order « abc » → 1 (NOT NULL)", coerce("min_order", "abc"), 1);
  eq("price « 1 000 » non numérique → null", coerce("price", "1 000"), null);

  eq("tags non tableau → tableau JSON vide", coerce("tags", "oups"), "[]");
  eq("images tableau → JSON", coerce("images", ["a", "b"]), '["a","b"]');
}

// ═══ lib/sectorProfiles — restaurant ou boutique ════════════════════════════
{
  const { sectorProfile, sertDesRepas } = await import(`${DIST}/sectorProfiles.js`);
  groupe("sectorProfiles — l'aiguillage du flux WhatsApp");

  chk("ecommerce → mode catalogue", sectorProfile("ecommerce").mode === "catalogue");
  chk("food_beverage → mode catalogue", sectorProfile("food_beverage").mode === "catalogue");
  chk("beauty_wellness → mode services", sectorProfile("beauty_wellness").mode === "services");
  chk("secteur inconnu → profil par défaut, jamais null", sectorProfile("zzz").mode === "catalogue");
  chk("secteur absent → profil par défaut", sectorProfile(null).mode === "catalogue");

  // C'est ce booléen qui décide si l'agent parle de « carte » ou de « boutique ».
  chk("un restaurant sert des repas", sertDesRepas("food_beverage") === true);
  chk("un hôtel aussi — il a une cuisine", sertDesRepas("hospitality") === true);
  chk("une boutique, non", sertDesRepas("ecommerce") === false);

  // Le welcome porte {b} : un agent sans nom ne doit pas afficher « {b} ».
  chk("le welcome contient le jeton {b}", sectorProfile("ecommerce").welcome.includes("{b}"));
}

// ═══ lib/whatsapp/recherche — les bugs signalés par le marchand ═════════════
{
  const { chercher, formatPour, veutToutVoir } = await import(`${DIST}/whatsapp/recherche.js`);
  groupe("recherche — « montre » verbe contre « montre » objet");

  const CAT = [
    { name: "Oraimo Watch 6 - Premium" }, { name: "Oraimo FreePods" },
    { name: "Oraimo Watch 6 - Promo" }, { name: "Oraimo Watch 6 - Standard" },
    { name: "Montre Test Buyticle" },
  ];

  // Message réel reçu sur le numéro Buyticle, faute de frappe incluse. Il
  // recevait le catalogue entier au lieu des montres.
  chk('« est qye t\'as une montre » n\'ouvre pas le catalogue', !veutToutVoir("est qye t'as une montre"));
  chk('« est qye t\'as une montre » trouve les 4 montres', chercher(CAT, "est qye t'as une montre").length === 4);
  chk('« montre moi vos produits » ouvre la vitrine', veutToutVoir("montre moi vos produits"));
  chk('« je cherche une montre » cherche', !veutToutVoir("je cherche une montre"));

  // Le catalogue est en anglais, le client écrit en français. Structurel pour
  // tout marchand qui vend de l'importé.
  chk('pont « ecouteurs » → FreePods', chercher(CAT, "des ecouteurs").some((p) => p.name.includes("FreePods")));
  chk('un produit nommé → une seule fiche', formatPour(chercher(CAT, "freepods").length) === "fiche");
  chk('plusieurs produits → carrousel', formatPour(chercher(CAT, "une montre").length) === "carrousel");

  eq("0 → aucun", formatPour(0), "aucun");
  eq("1 → fiche", formatPour(1), "fiche");
  eq("10 → carrousel", formatPour(10), "carrousel");
  eq("11 → liste", formatPour(11), "liste");

  chk("« bonjour » n'ouvre rien", !veutToutVoir("bonjour"));
  chk("restauration : « le menu » ouvre la carte", veutToutVoir("je veux le menu", true));

  // Message réel reçu sur le numéro Buyticle : « avec » pour « avez », pas
  // d'apostrophe à « quest ». La demande la plus explicite qu'un client puisse
  // faire — et il recevait « Je n'ai pas trouvé » avec sa faute tronquée.
  chk("« quest ce que vous avec comme produit a vendre »", veutToutVoir("quest ce que vous avec comme produit a vendre"));
  chk("« qu est ce que vous vendez »", veutToutVoir("qu est ce que vous vendez"));
  chk("« c'est quoi vos produits »", veutToutVoir("c'est quoi vos produits"));
  chk("« vous avez quoi en stock »", veutToutVoir("vous avez quoi en stock"));
  chk("« quels articles disponibles »", veutToutVoir("quels articles disponibles"));
  chk("« je veux voir la boutique »", veutToutVoir("je veux voir la boutique"));
  chk("« c'est quoi les prix »", veutToutVoir("c est quoi les prix"));
  // Et l'inverse : une offre générique ne doit pas avaler une recherche nommée.
  chk("« t'as des freepods ? » reste une recherche", !veutToutVoir("t as des freepods"));
  chk("« le prix de la montre oraimo » reste une recherche", !veutToutVoir("la montre oraimo"));
  chk("resto : « vous avez quoi comme plat »", veutToutVoir("vous avez quoi comme plat", true));
  chk("resto : « je veux du poulet » reste une recherche", !veutToutVoir("je veux du poulet", true));
}

// ═══ lib/orders — les heures d'ouverture en texte libre ═════════════════════
{
  const { closedNotice, lireHoraires, estOuvert } = await import(`${DIST}/horaires.js`);
  groupe("horaires — ne rien promettre à 2 h du matin");

  // Un accusé qui dit « on te contacte tout de suite » à 2 h du matin est un
  // mensonge. Mais un format d'horaires illisible ne doit rien inventer non
  // plus : mieux vaut se taire que promettre faux.
  chk("horaires absents → on ne promet rien", closedNotice(null) === "");
  chk("horaires vides → on ne promet rien", closedNotice("") === "");
  chk("« Sur rendez-vous » → on ne promet rien", closedNotice("Sur rendez-vous") === "");
  chk("texte illisible → on ne promet rien", closedNotice("quand on peut, ça dépend") === "");
  // Horloge injectée : un test qui dépend de l'heure réelle passe le matin et
  // échoue le soir, et on finit par ne plus le croire.
  const a = (h) => new Date(Date.UTC(2026, 9, 1, h, 0, 0));
  chk("fermé à 2 h → on annonce l'ouverture", closedNotice("8h - 18h", 1, a(1)).includes("8h"));
  chk("ouvert à 10 h → rien", closedNotice("8h - 18h", 1, a(9)) === "");
  chk("fermé à 20 h → on annonce", closedNotice("8h - 18h", 1, a(19)).includes("8h"));
  chk("« 24/24 » → jamais de message", closedNotice("ouvert 24/24", 1, a(3)) === "");

  // Un commerce de nuit — courant en restauration à Douala.
  eq("« 20h - 02h » est lu", lireHoraires("20h - 02h"), { ouvre: 20, ferme: 2 });
  chk("ouvert à 23 h sur 20h-02h", estOuvert(20, 2, 23) === true);
  chk("ouvert à 1 h sur 20h-02h", estOuvert(20, 2, 1) === true);
  chk("fermé à 10 h sur 20h-02h", estOuvert(20, 2, 10) === false);
  eq("« 8h30 - 18h » garde les minutes", lireHoraires("8h30 - 18h"), { ouvre: 8.5, ferme: 18 });
  chk("8h30 s'écrit « 8h30 »", closedNotice("8h30 - 18h", 1, a(1)).includes("8h30"));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(66)}`);
if (echecs.length) {
  console.log(`${ok} ok, ${echecs.length} ÉCHEC(S) :`);
  echecs.forEach((t) => console.log(`   • ${t}`));
  process.exit(1);
}
console.log(`${ok} cas, tous passés.`);
