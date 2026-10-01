// ─────────────────────────────────────────────────────────────────────────────
// Apparier le catalogue Camille et le catalogue Meta.
//
// Aucun import que `sansAccent` : cette fonction peut ABÎMER le catalogue du
// marchand. Se tromper ici, c'est lui créer un doublon de chacun de ses
// produits — et il n'y a pas de bouton pour revenir en arrière. Elle doit donc
// être éprouvable sans base de données, sans réseau, sans rien.
// ─────────────────────────────────────────────────────────────────────────────
import { sansAccent } from "./recherche";

/** Le minimum pour reconnaître un article, de chaque côté. */
export type VuChezMeta = { retailer_id: string; name?: string };
export type VuChezCamille = { id: string; name: string; meta_retailer_id?: string | null };

export type Decision =
  | { faire: "rien"; retailerId: string; item: VuChezMeta }
  | { faire: "relier"; retailerId: string; camilleId: string; item: VuChezMeta }
  | { faire: "importer"; retailerId: string; item: VuChezMeta };

/**
 * Que faire de chaque article vu chez Meta ?
 *
 * Isolée du reste, et sans base de données, parce que c'est la fonction qui
 * peut ABÎMER le catalogue du marchand. Se tromper ici, c'est lui créer des
 * doublons de tous ses produits — et il n'y a pas de bouton pour revenir en
 * arrière.
 *
 * L'ordre des règles est le fond du sujet :
 *   1. le retailer_id est déjà un identifiant Camille → c'est le même article
 *   2. un produit porte ce retailer_id → c'est le même article
 *   3. un produit porte le même nom → on RELIE, on ne duplique pas
 *   4. sinon → on importe
 *
 * Un nom déjà relié à un AUTRE retailer_id n'est pas repris : deux articles
 * Meta de même nom ne peuvent pas se brancher sur le même produit Camille,
 * sinon le second écraserait le lien du premier.
 */
export function decider(camille: VuChezCamille[], items: VuChezMeta[]): Decision[] {
  const parId = new Set(camille.map((p) => String(p.id)));
  const parLien = new Set(camille.map((p) => p.meta_retailer_id).filter(Boolean) as string[]);

  // Un nom n'est disponible que s'il n'est pas déjà relié ailleurs.
  const libresParNom = new Map<string, string>();
  for (const p of camille) {
    const n = sansAccent(p.name);
    if (!n || p.meta_retailer_id || libresParNom.has(n)) continue;
    libresParNom.set(n, String(p.id));
  }

  const sortie: Decision[] = [];
  for (const it of items) {
    const rid = String(it.retailer_id || "");
    if (!rid) continue;
    if (parId.has(rid) || parLien.has(rid)) {
      sortie.push({ faire: "rien", retailerId: rid, item: it });
      continue;
    }
    const n = sansAccent(it.name || "");
    const jumeau = n ? libresParNom.get(n) : undefined;
    if (jumeau) {
      libresParNom.delete(n); // consommé : un produit Camille, un seul lien
      sortie.push({ faire: "relier", retailerId: rid, camilleId: jumeau, item: it });
      continue;
    }
    sortie.push({ faire: "importer", retailerId: rid, item: it });
  }
  return sortie;
}

