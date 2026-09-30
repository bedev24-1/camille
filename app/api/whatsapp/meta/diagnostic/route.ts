// ─────────────────────────────────────────────────────────────────────────────
// GET /api/whatsapp/meta/diagnostic
//
// Dit si le branchement Meta est bon AVANT d'envoyer le premier message.
// Sans ça, un envoi qui échoue laisse deviner entre cinq causes : jeton
// périmé, mauvais phone_number_id, catalogue vide, retailer_id inconnu, agent
// introuvable. Chacune se corrige autrement.
//
// Aucun secret n'est renvoyé — le jeton n'apparaît que par ses quatre derniers
// caractères, de quoi vérifier qu'on parle du bon sans pouvoir s'en servir.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { sectorProfile } from "@/lib/sectorProfiles";
import * as meta from "@/lib/whatsapp/meta";
import { modeDeVente, type Agent } from "@/lib/whatsapp/handle";

export async function GET(req: NextRequest) {
  const problemes: string[] = [];
  const config = meta.metaConfigured();
  if (!config.ok) problemes.push("WHATSAPP_TOKEN ou PHONE_NUMBER_ID absent de l'environnement.");
  if (!process.env.WHATSAPP_VERIFY_TOKEN)
    problemes.push("WHATSAPP_VERIFY_TOKEN absent : Meta ne pourra pas valider l'abonnement au webhook.");
  if (!process.env.WHATSAPP_APP_SECRET)
    problemes.push("WHATSAPP_APP_SECRET absent : la signature des messages entrants n'est PAS vérifiée. Acceptable pour un test sur ton propre numéro, à ne pas laisser dès qu'un marchand est dessus.");

  // ── L'agent visé ──────────────────────────────────────────────────────────
  const agentId = req.nextUrl.searchParams.get("agentId") || process.env.META_TEST_AGENT_ID || "";
  let agent: Agent | null = null;
  let agentErr = "";
  if (!agentId) {
    problemes.push("Aucun agent : passe ?agentId=… ou renseigne META_TEST_AGENT_ID.");
  } else {
    try {
      const r = await query(
        // to_jsonb pour tout ce qui vient d'une migration : sur une base qui ne
        // l'a pas, on veut NULL, pas la perte de toute la requête.
        `SELECT a.id, a.user_id, a.business_name, a.sector, a.location, a.website_url,
                a.latitude, a.longitude, a.status,
                COALESCE(to_jsonb(a)->>'currency', 'XAF') AS currency,
                to_jsonb(a)->>'business_hours' AS business_hours,
                to_jsonb(a)->>'meta_phone_number_id' AS meta_phone_number_id,
                to_jsonb(a)->>'transport' AS transport,
                (to_jsonb(a)->>'delivery_fee')::numeric AS delivery_fee,
                COALESCE((to_jsonb(a)->>'delivery_enabled')::boolean, true) AS delivery_enabled
           FROM camille.agents a WHERE a.id = $1`,
        [agentId]
      );
      agent = (r.rows[0] as Agent) || null;
      if (!agent) problemes.push(`Agent ${agentId} introuvable dans camille.agents.`);
      else if ((r.rows[0] as { status?: string }).status !== "active")
        problemes.push(`L'agent est en statut « ${(r.rows[0] as { status?: string }).status} » : le webhook le refusera. Passe-le en active.`);
    } catch (e) {
      agentErr = (e as Error).message;
      problemes.push(`Lecture de l'agent impossible : ${agentErr}`);
    }
  }

  // ── Le catalogue Meta ─────────────────────────────────────────────────────
  const cat = await meta.listCatalog();
  if (!cat.ok) problemes.push(`Catalogue Meta illisible : ${cat.error}`);
  else if (!cat.items.length) problemes.push("Le catalogue Meta ne renvoie aucun produit.");

  const epuises = cat.items.filter((i) => i.availability === "out of stock");
  if (epuises.length)
    problemes.push(
      `${epuises.length} produit(s) en « out of stock » côté Meta : une fiche produit les concernant sera refusée par l'API (${epuises.map((i) => i.retailer_id).join(", ")}).`
    );

  // ── La correspondance entre les deux catalogues ───────────────────────────
  // C'est le point qui décide si Camille reste la source de vérité du stock,
  // ou si l'on lit chez Meta faute de mieux.
  let produitsCamille = 0;
  let produitsMappes = 0;
  let colonneMapping = true;
  if (agent) {
    try {
      const r = await query(
        `SELECT COUNT(*)::int AS total,
                COUNT(to_jsonb(p)->>'meta_retailer_id')::int AS mappes
           FROM camille.products p WHERE agent_id = $1 AND active = true`,
        [agent.id]
      );
      produitsCamille = r.rows[0]?.total ?? 0;
      produitsMappes = r.rows[0]?.mappes ?? 0;
    } catch {
      colonneMapping = false;
    }
  }
  if (agent && !colonneMapping)
    problemes.push("Colonne products.meta_retailer_id absente (migration_meta_transport.sql) : le flux lira le catalogue Meta, donc SANS le stock de Camille.");
  else if (agent && produitsCamille > 0 && produitsMappes === 0)
    problemes.push(`Aucun des ${produitsCamille} produits Camille n'a de meta_retailer_id : le flux lira le catalogue Meta, donc sans décompte de stock.`);

  const profil = agent ? sectorProfile(agent.sector) : null;

  return NextResponse.json({
    config,
    webhook: {
      url: "https://camille.vps.buyticle.com/api/whatsapp/meta/webhook",
      verify_token_present: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
      signature_verifiee: Boolean(process.env.WHATSAPP_APP_SECRET),
    },
    agent: agent
      ? {
          id: agent.id,
          business_name: agent.business_name,
          sector: agent.sector,
          secteur_label: profil?.label,
          sector_mode: profil?.mode,
          // Ce que l'aiguillage fera réellement de cet agent.
          mode_de_vente: modeDeVente(agent),
          location: agent.location,
          business_hours: agent.business_hours,
          delivery_enabled: agent.delivery_enabled,
          delivery_fee: agent.delivery_fee,
          // Renseignés seulement après migration_meta_transport.sql.
          transport: (agent as unknown as { transport?: string }).transport ?? "(colonne absente)",
          meta_phone_number_id:
            (agent as unknown as { meta_phone_number_id?: string }).meta_phone_number_id ??
            "(colonne absente — repli META_TEST_AGENT_ID)",
        }
      : { error: agentErr || "absent" },
    catalogue_meta: {
      ok: cat.ok,
      error: cat.error,
      total: cat.items.length,
      produits: cat.items.map((i) => ({
        retailer_id: i.retailer_id,
        name: i.name,
        price: i.price,
        availability: i.availability,
      })),
    },
    catalogue_camille: { total: produitsCamille, mappes: produitsMappes, colonne_presente: colonneMapping },
    problemes: problemes.length ? problemes : ["Aucun problème détecté : tu peux écrire au numéro."],
  });
}
