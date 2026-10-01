// Banc d'essai de la recherche produit.
//
// Il exécute LE VRAI module — `recherche.ts` compilé — et non une imitation.
// C'est la leçon d'une panne : une imitation écrite à la main avait fini par
// inclure un champ d'erreur que le code ne gardait pas. Elle passait pendant
// que la production échouait.
//
//   npx tsc lib/whatsapp/recherche.ts --outDir /tmp/r --module esnext \
//           --target es2022 --moduleResolution bundler
//   node lib/whatsapp/recherche.test.mjs /tmp/r/recherche.js
//
// Chaque cas vient d'un message réellement reçu sur le numéro Buyticle.

const cible = process.argv[2];
if (!cible) {
  console.error("usage : node recherche.test.mjs <chemin/vers/recherche.js compilé>");
  process.exit(2);
}
const { chercher, formatPour, veutToutVoir } = await import(cible);

// Le catalogue réel de Buyticle, tel que l'API Meta le renvoie.
const CAT = [
  { name: "Oraimo Watch 6 - Premium" },
  { name: "Oraimo FreePods" },
  { name: "Oraimo Watch 6 - Promo" },
  { name: "Oraimo Watch 6 - Standard" },
  { name: "Montre Test Buyticle" },
];

let ok = 0, ko = 0;
const chk = (titre, vrai, detail = "") => {
  vrai ? ok++ : ko++;
  console.log(`  ${vrai ? "ok  " : "KO  "}${titre}${vrai ? "" : "   => " + detail}`);
};

console.log("\n— « montre » OBJET : cherche, n'ouvre pas le catalogue —");
// « est qye t'as une montre » : message réel, avec sa faute de frappe.
for (const m of ["est qye t'as une montre", "t'as une montre ?", "je cherche une montre",
                 "vous avez des montres", "combien la montre"]) {
  const n = chercher(CAT, m).length;
  chk(`"${m}" → ${n} produit(s), ${formatPour(n)}`,
      !veutToutVoir(m) && n >= 3, `vitrine=${veutToutVoir(m)} n=${n}`);
}

console.log("\n— « montrer » VERBE : ouvre la vitrine —");
for (const m of ["montre moi vos produits", "montrez moi la boutique",
                 "montre moi tout", "montre les produits"]) {
  chk(`"${m}"`, veutToutVoir(m), "non détecté");
}

console.log("\n— un produit nommé → la FICHE —");
for (const m of ["freepods", "je veux les freepods", "ecouteurs",
                 "oraimo watch 6 premium", "la watch premium", "montre test"]) {
  const n = chercher(CAT, m).length;
  chk(`"${m}" → ${formatPour(n)}`, formatPour(n) === "fiche", `${n} produit(s)`);
}

console.log("\n— plusieurs produits → le CARROUSEL —");
for (const m of ["t'as une montre ?", "oraimo", "je cherche une montre"]) {
  const n = chercher(CAT, m).length;
  chk(`"${m}" → ${n} produits, ${formatPour(n)}`, formatPour(n) === "carrousel", `${n}`);
}

console.log("\n— ponts français ↔ anglais —");
chk('"une montre" trouve les 4 Oraimo Watch + la Montre Test',
    chercher(CAT, "une montre").length === 4, JSON.stringify(chercher(CAT, "une montre").map(p => p.name)));
chk('"des ecouteurs" trouve les FreePods',
    chercher(CAT, "tu as des ecouteurs").some(p => p.name.includes("FreePods")), "");

console.log("\n— les seuils de format —");
chk("0 → aucun", formatPour(0) === "aucun");
chk("1 → fiche", formatPour(1) === "fiche");
chk("2 → carrousel", formatPour(2) === "carrousel");
chk("10 → carrousel", formatPour(10) === "carrousel");
chk("11 → liste", formatPour(11) === "liste");

console.log("\n— non-régression —");
chk('"catalogue" ouvre la vitrine', veutToutVoir("je veux voir le catalogue"));
chk('"les prix" ouvre la vitrine', veutToutVoir("c est quoi les prix"));
chk('"bonjour" n\'ouvre rien', !veutToutVoir("bonjour"));
chk('restauration : "le menu" ouvre la carte', veutToutVoir("je veux le menu", true));

console.log(`\n${ok} ok, ${ko} ko\n`);
process.exit(ko ? 1 : 0);
