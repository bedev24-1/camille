// ─────────────────────────────────────────────────────────────────────────────
// Les modèles de message WhatsApp du commerçant.
//
//   GET   liste les modèles du compte, avec leur statut d'approbation
//   POST  en soumet un nouveau à Meta
//
// Pourquoi cet écran existe : hors de la fenêtre de 24 h, seul un modèle
// approuvé par Meta peut être envoyé. Chaque marchand a donc besoin des SIENS —
// accusé de commande, suivi de livraison, prise en charge d'une réclamation.
// Sans cette page, c'est lui qui doit aller les créer dans les outils de Meta,
// ou nous qui les créons à la main pour chacun.
//
// L'accès est réservé au propriétaire connecté : un modèle engage le nom de son
// commerce auprès de ses clients.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth-server";
import * as meta from "@/lib/whatsapp/meta";

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const r = await meta.listTemplates();
  if (!r.ok) return NextResponse.json({ templates: [], error: r.error }, { status: 200 });

  // Trié par statut : ce qui demande une action du commerçant remonte.
  const rang = (s?: string) =>
    s === "REJECTED" ? 0 : s === "PENDING" || s === "IN_APPEAL" ? 1 : 2;
  const templates = [...r.templates].sort(
    (a, b) => rang(a.status) - rang(b.status) || a.name.localeCompare(b.name)
  );
  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const name = String(b.name || "").trim();
  const body = String(b.body || "").trim();
  const category = String(b.category || "UTILITY").toUpperCase();

  if (!name) return NextResponse.json({ error: "Donne un nom au modèle." }, { status: 400 });
  if (!body) return NextResponse.json({ error: "Écris le message du modèle." }, { status: 400 });
  if (!["UTILITY", "MARKETING", "AUTHENTICATION"].includes(category)) {
    return NextResponse.json({ error: "Catégorie inconnue." }, { status: 400 });
  }

  // Les variables se comptent avant l'envoi : Meta refuse un modèle dont les
  // exemples manquent, et le dire ici évite un refus trois jours plus tard.
  const variables = (body.match(/\{\{\s*\d+\s*\}\}/g) || []).length;
  const examples = Array.isArray(b.examples) ? b.examples.map((x: unknown) => String(x ?? "").trim()) : [];
  if (variables > 0 && examples.filter(Boolean).length < variables) {
    return NextResponse.json(
      {
        error:
          `Ce modèle contient ${variables} variable(s). Donne un exemple pour chacune — ` +
          `Meta refuse un modèle dont il ne peut pas juger le rendu réel.`,
      },
      { status: 400 }
    );
  }

  const r = await meta.createTemplate({
    name,
    category: category as "UTILITY" | "MARKETING" | "AUTHENTICATION",
    language: String(b.language || "fr"),
    body,
    examples,
    footer: b.footer ? String(b.footer) : undefined,
  });

  if (!r.ok) {
    // On rend la raison telle que Meta l'a écrite : c'est elle qui permet de
    // corriger. « Un modèle de ce nom existe déjà » et « la catégorie ne
    // correspond pas au contenu » ne se règlent pas de la même façon.
    return NextResponse.json({ error: r.error || "Soumission refusée par Meta" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id: r.id, status: r.status || "PENDING" }, { status: 201 });
}
