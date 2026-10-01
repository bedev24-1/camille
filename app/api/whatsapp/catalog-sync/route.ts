// ─────────────────────────────────────────────────────────────────────────────
// POST /api/whatsapp/catalog-sync?agentId=…
//
// Pousse le catalogue Camille vers le catalogue Meta, et enregistre la
// correspondance dans `products.meta_retailer_id`.
//
// Ce que ça débloque, et pourquoi ça compte :
//
//   • LE STOCK BAISSE. Aujourd'hui le flux WhatsApp lit le catalogue Meta, où
//     les produits n'ont pas d'identifiant Camille — donc `applyStock()` ne
//     peut rien décompter. C'était la demande d'origine : « à chaque commande
//     validée le stock demeure le même ».
//   • Une seule saisie. Le commerçant gère ses produits dans Camille, Meta en
//     reçoit le reflet.
//   • Les photos dans les commandes, puisque les noms correspondent enfin.
//   • Un seul identifiant de produit partout : `camille.products.id` sert de
//     `retailer_id`, et servira de `content_id` au Pixel et à CAPI.
//
// GET renvoie l'état de la correspondance, sans rien écrire.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth-server";
import { query } from "@/lib/db";
import * as meta from "@/lib/whatsapp/meta";

/** L'agent appartient-il bien à l'utilisateur connecté ? */
async function proprietaire(req: NextRequest, agentId: string) {
  const user = await getUserFromRequest(req);
  if (!user) return null;
  const r = await query(
    `SELECT id, business_name, website_url FROM camille.agents
      WHERE id = $1 AND user_id = $2 AND status != 'archived'`,
    [agentId, user.id]
  );
  return r.rows[0] || null;
}

const PRODUITS = `
  SELECT id, name, description, price, COALESCE(currency,'XAF') AS currency,
         image_url, stock, category, active
    FROM camille.products
   WHERE agent_id = $1
   ORDER BY sort_order ASC, created_at DESC`;

// ── État, sans rien modifier ────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const agentId = (req.nextUrl.searchParams.get("agentId") || "").trim();
  if (!agentId) return NextResponse.json({ error: "agentId requis" }, { status: 400 });
  const agent = await proprietaire(req, agentId);
  if (!agent) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const [cam, met] = await Promise.all([
    query(PRODUITS, [agentId]).catch(() => ({ rows: [] })),
    meta.listCatalog(),
  ]);

  // La colonne arrive par migration_meta_transport.sql : son absence ne doit
  // pas faire échouer la lecture d'état, elle doit être signalée.
  let mappes = 0;
  let colonne = true;
  try {
    const r = await query(
      `SELECT COUNT(*)::int AS n FROM camille.products
        WHERE agent_id = $1 AND meta_retailer_id IS NOT NULL`,
      [agentId]
    );
    mappes = r.rows[0]?.n ?? 0;
  } catch {
    colonne = false;
  }

  const parId = new Map(met.items.map((i) => [i.retailer_id, i]));
  return NextResponse.json({
    camille: { total: cam.rows.length, mappes, colonne_meta_retailer_id: colonne },
    meta: {
      ok: met.ok,
      error: met.error,
      total: met.items.length,
      envoyables: met.items.filter((i) => i.sendable).length,
      en_attente_whatsapp: met.items.filter((i) => !i.sendable).map((i) => i.retailer_id),
    },
    // Ce que la synchronisation ferait, produit par produit.
    apercu: cam.rows.map((p: Record<string, unknown>) => ({
      name: p.name,
      synchronise: parId.has(String(p.id)),
      envoyable: parId.get(String(p.id))?.sendable ?? false,
      bloquant: !p.image_url ? "pas d'image" : p.price == null ? "pas de prix" : null,
    })),
  });
}

// ── La synchronisation ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const agentId = (req.nextUrl.searchParams.get("agentId") || "").trim();
  if (!agentId) return NextResponse.json({ error: "agentId requis" }, { status: 400 });
  const agent = await proprietaire(req, agentId);
  if (!agent) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let produits;
  try {
    const r = await query(PRODUITS, [agentId]);
    produits = r.rows as meta.ProduitASyncer[];
  } catch (e) {
    return NextResponse.json({ error: "Lecture du catalogue impossible", detail: (e as Error).message }, { status: 500 });
  }
  if (!produits.length) {
    return NextResponse.json({ error: "Ce catalogue est vide — ajoute des produits d'abord." }, { status: 400 });
  }

  const r = await meta.syncCatalogue(produits, {
    lien: (agent.website_url as string) || `https://camille.vps.buyticle.com/catalog/${agentId}`,
    marque: (agent.business_name as string) || undefined,
  });

  if (!r.ok) {
    return NextResponse.json({ error: r.error || "Synchronisation refusée par Meta", avertissements: r.avertissements }, { status: 400 });
  }

  // La correspondance : l'identifiant Camille EST le retailer_id Meta. On
  // l'écrit pour que le flux WhatsApp retrouve le produit — et donc décompte
  // son stock. Sans cette écriture, la synchronisation ne sert à rien.
  let enregistres = 0;
  let colonneAbsente = false;
  try {
    const ids = produits.filter((p) => p.image_url && p.price != null).map((p) => p.id);
    if (ids.length) {
      const u = await query(
        `UPDATE camille.products SET meta_retailer_id = id::text, updated_at = NOW()
          WHERE agent_id = $1 AND id = ANY($2::uuid[])`,
        [agentId, ids]
      );
      enregistres = u.rowCount ?? 0;
    }
  } catch (e) {
    // 42703 : migration_meta_transport.sql pas encore appliquée. La
    // synchronisation a bien eu lieu chez Meta, mais le stock ne baissera pas
    // tant que la correspondance n'est pas enregistrée. On le dit clairement.
    if ((e as { code?: string }).code === "42703") colonneAbsente = true;
    else return NextResponse.json({ error: "Correspondance non enregistrée", detail: (e as Error).message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    envoyes: r.envoyes,
    enregistres,
    avertissements: r.avertissements,
    ...(colonneAbsente
      ? {
          attention:
            "Produits envoyés à Meta, mais la colonne products.meta_retailer_id est absente : " +
            "applique migration_meta_transport.sql, sinon le stock ne baissera pas sur les commandes WhatsApp.",
        }
      : {}),
    // Le délai est normal et il faut le dire, sinon le commerçant croit que la
    // synchronisation a échoué.
    note:
      "WhatsApp examine chaque nouveau produit avant de l'autoriser dans un message. " +
      "Un produit tout juste synchronisé n'est donc pas envoyable immédiatement — " +
      "recharge cette page dans quelques heures pour voir passer son statut.",
  });
}
