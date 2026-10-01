// ─────────────────────────────────────────────────────────────────────────────
// Un seul catalogue, vu de deux endroits.
//
// Camille et Meta tenaient chacun sa liste. Le commerçant ajoutait un article
// dans Camille, il n'apparaissait pas dans WhatsApp ; il en ajoutait un dans
// Commerce Manager, Camille l'ignorait — et ne pouvait pas décompter son stock.
// Deux vérités, donc aucune.
//
// Ici, une seule réconciliation, dans les deux sens :
//
//   CAMILLE → META   tout article de Camille est poussé chez Meta, et son
//                    identifiant Camille DEVIENT le retailer_id. C'est ce qui
//                    permet au flux WhatsApp de décompter le bon stock.
//   META → CAMILLE   tout article présent chez Meta et inconnu de Camille est
//                    importé, avec `meta_retailer_id` pour le relier.
//
// L'APPARIEMENT, dans cet ordre, et l'ordre compte :
//   1. le retailer_id EST un identifiant Camille — c'est nous qui l'avons écrit
//   2. `products.meta_retailer_id` correspond
//   3. le NOM correspond, aux accents et à la casse près → on relie, on ne
//      duplique pas. Sans cette étape, un catalogue alimenté des deux côtés
//      se retrouve en double après la première synchronisation.
//   4. sinon seulement : on crée.
//
// SANS `products.meta_retailer_id` (migration_meta_transport.sql non
// appliquée), le sens META → CAMILLE est REFUSÉ. On ne pourrait pas enregistrer
// le lien, donc on réimporterait les mêmes articles à chaque passage, et le
// catalogue du marchand se remplirait de doublons. Mieux vaut ne rien faire et
// le dire.
// ─────────────────────────────────────────────────────────────────────────────
import { query } from "@/lib/db";
import * as meta from "./meta";
import { lirePrix } from "./prix";
import { decider } from "./appariement";

export type Rapport = {
  ok: boolean;
  /** Articles de Camille envoyés chez Meta. */
  pousses: number;
  /** Articles de Meta créés dans Camille. */
  importes: number;
  /** Articles qui existaient des deux côtés et qu'on vient de relier. */
  relies: number;
  /** Ce qui n'a pas pu partir, avec la raison, article par article. */
  avertissements: string[];
  error?: string;
};

type Ligne = {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  currency: string;
  image_url: string | null;
  stock: number | null;
  category: string | null;
  active: boolean;
  meta_retailer_id: string | null;
};

/** La colonne de liaison est-elle là ? Tout le sens Meta → Camille en dépend. */
async function colonneLiaison(): Promise<boolean> {
  try {
    await query(
      `SELECT meta_retailer_id FROM camille.products LIMIT 1`
    );
    return true;
  } catch {
    return false;
  }
}

async function produitsCamille(agentId: string): Promise<Ligne[]> {
  const r = await query(
    `SELECT id, name, description, price, COALESCE(currency,'XAF') AS currency,
            image_url, stock, category, COALESCE(active, true) AS active,
            to_jsonb(p)->>'meta_retailer_id' AS meta_retailer_id
       FROM camille.products p
      WHERE agent_id = $1
      ORDER BY sort_order ASC, created_at DESC
      LIMIT 500`,
    [agentId]
  );
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    id: String(x.id),
    name: String(x.name || ""),
    description: (x.description as string) || null,
    price: x.price != null ? Number(x.price) : null,
    currency: String(x.currency || "XAF"),
    image_url: (x.image_url as string) || null,
    stock: x.stock != null ? Number(x.stock) : null,
    category: (x.category as string) || null,
    active: x.active !== false,
    meta_retailer_id: (x.meta_retailer_id as string) || null,
  }));
}

// ── La réconciliation ───────────────────────────────────────────────────────

export async function reconcilier(
  agentId: string,
  options: { lien?: string; marque?: string } = {}
): Promise<Rapport> {
  const rapport: Rapport = { ok: true, pousses: 0, importes: 0, relies: 0, avertissements: [] };

  const [camille, chezMeta, liaison] = await Promise.all([
    produitsCamille(agentId).catch((e) => {
      rapport.avertissements.push(`Catalogue Camille illisible : ${(e as Error).message}`);
      return [] as Ligne[];
    }),
    meta.listCatalog(),
    colonneLiaison(),
  ]);

  if (!chezMeta.ok) {
    return { ...rapport, ok: false, error: chezMeta.error || "Catalogue Meta illisible" };
  }

  // ── Sens 1 : CAMILLE → META ───────────────────────────────────────────────
  // On pousse tout : `items_batch` avec la méthode UPDATE fait un upsert, donc
  // un article déjà présent est simplement mis à jour. Pousser la totalité
  // plutôt que le delta évite une dérive silencieuse des prix et des stocks.
  const envoyables = camille.filter((p) => p.active && p.image_url && p.price != null);
  for (const p of camille) {
    if (!p.active) continue;
    if (!p.image_url) rapport.avertissements.push(`${p.name} : pas d'image, non envoyé chez Meta`);
    else if (p.price == null) rapport.avertissements.push(`${p.name} : pas de prix, non envoyé chez Meta`);
  }

  if (envoyables.length) {
    const r = await meta.syncCatalogue(envoyables, options);
    if (!r.ok) {
      rapport.ok = false;
      rapport.error = r.error || "Envoi refusé par Meta";
    } else {
      rapport.pousses = r.envoyes;
      rapport.avertissements.push(...(r.avertissements || []));
      if (liaison) {
        await query(
          `UPDATE camille.products SET meta_retailer_id = id::text, updated_at = NOW()
            WHERE agent_id = $1 AND id = ANY($2::uuid[])
              AND COALESCE(meta_retailer_id, '') <> id::text`,
          [agentId, envoyables.map((p) => p.id)]
        ).catch((e) => rapport.avertissements.push(`Liens non enregistrés : ${(e as Error).message}`));
      }
    }
  }

  // ── Sens 2 : META → CAMILLE ───────────────────────────────────────────────
  if (!liaison) {
    rapport.avertissements.push(
      "Import depuis Meta suspendu : la colonne products.meta_retailer_id est absente. " +
        "Sans elle, les mêmes articles seraient réimportés à chaque passage et votre " +
        "catalogue se remplirait de doublons. Appliquez migration_meta_transport.sql."
    );
    return rapport;
  }

  for (const d of decider(camille, chezMeta.items)) {
    if (d.faire === "rien") continue;
    const it = chezMeta.items.find((x) => x.retailer_id === d.retailerId)!;
    const rid = d.retailerId;

    // 3. Même nom des deux côtés : on RELIE. Créer ici ferait un doublon, et
    //    c'est le cas le plus fréquent d'un catalogue alimenté des deux bords.
    if (d.faire === "relier") {
      try {
        await query(
          `UPDATE camille.products SET meta_retailer_id = $1, updated_at = NOW()
            WHERE id = $2 AND agent_id = $3`,
          [rid, d.camilleId, agentId]
        );
        rapport.relies++;
      } catch (e) {
        rapport.avertissements.push(`${it.name} : lien impossible — ${(e as Error).message}`);
      }
      continue;
    }

    // 4. Inconnu : on l'importe. Meta ne tient pas de quantité, seulement
    //    « en stock » ou « épuisé » — le stock reste donc NULL (inconnu), ce
    //    qui vaut mieux que d'inventer un nombre que le commerçant croirait.
    try {
      await query(
        `INSERT INTO camille.products
           (agent_id, name, description, price, currency, image_url, category,
            active, stock, meta_retailer_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9)`,
        [
          agentId,
          String(it.name || "Sans nom").slice(0, 200),
          String(it.description || "").slice(0, 4000),
          lirePrix(it.price),
          "XAF",
          it.image_url || null,
          null,
          it.availability !== "out of stock",
          rid,
        ]
      );
      rapport.importes++;
    } catch (e) {
      rapport.avertissements.push(`${it.name} : import impossible — ${(e as Error).message}`);
    }
  }

  return rapport;
}

// ── La poussée d'un seul article, à la création ─────────────────────────────

/**
 * Envoyer UN article chez Meta, tout de suite après sa création.
 *
 * C'est ce qui rend le catalogue unique à l'usage : le commerçant ajoute un
 * produit dans Camille, et il est dans WhatsApp sans qu'il ait rien à faire.
 *
 * Volontairement silencieuse en cas d'échec : la création du produit dans
 * Camille a déjà réussi, et la faire échouer parce que Meta n'a pas répondu
 * serait absurde. La réconciliation complète rattrapera l'article.
 */
export async function pousserUn(
  agentId: string,
  p: { id: string; name: string; description?: string | null; price?: number | null;
       currency?: string | null; image_url?: string | null; stock?: number | null;
       category?: string | null; active?: boolean | null },
  options: { lien?: string; marque?: string } = {}
): Promise<void> {
  if (!meta.metaConfigured().ok) return;
  if (p.active === false || !p.image_url || p.price == null) return;

  const r = await meta.syncCatalogue(
    [{
      id: p.id, name: p.name, description: p.description ?? null,
      price: Number(p.price), currency: p.currency || "XAF",
      image_url: p.image_url, stock: p.stock ?? null,
      category: p.category ?? null, active: true,
    }],
    options
  );
  if (!r.ok) {
    console.error(`[catalogue] ${p.name} non poussé chez Meta : ${r.error}`);
    return;
  }
  await query(
    `UPDATE camille.products SET meta_retailer_id = id::text, updated_at = NOW()
      WHERE id = $1 AND agent_id = $2`,
    [p.id, agentId]
  ).catch(() => {
    // 42703 : l'article est bien chez Meta, mais le lien n'est pas noté. Le
    // stock ne baissera pas sur ses commandes jusqu'à la migration.
    console.warn(`[catalogue] ${p.name} poussé, lien non noté — migration_meta_transport.sql`);
  });
}

/**
 * Retirer un article de Meta quand il disparaît de Camille.
 *
 * Sans ça, un produit supprimé reste proposable dans WhatsApp : le client le
 * met au panier, la commande tombe, et le commerçant n'a rien à vendre. C'est
 * le pire des deux mondes — on a encaissé l'attente du client sans la
 * marchandise.
 */
export async function retirerUn(retailerId: string | null | undefined): Promise<void> {
  if (!retailerId || !meta.metaConfigured().ok) return;
  const r = await meta.supprimerDuCatalogue([retailerId]);
  if (!r.ok) console.error(`[catalogue] ${retailerId} non retiré de Meta : ${r.error}`);
}
