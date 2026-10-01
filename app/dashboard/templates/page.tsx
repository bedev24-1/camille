// ─────────────────────────────────────────────────────────────────────────────
// app/dashboard/templates/page.tsx
//
// Les modèles de message WhatsApp du commerçant.
//
// Pourquoi cette page existe : hors de la fenêtre de 24 h qui suit le dernier
// message du client, seul un modèle approuvé par Meta peut partir. C'est le cas
// de l'accusé de commande envoyé le lendemain, du suivi de livraison, et de la
// réponse à une réclamation. Sans cette page, le commerçant devrait aller les
// créer dans les outils de Meta — qu'il ne connaît pas et dont tout l'intérêt
// de Camille est de le dispenser.
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "@/lib/auth-client";

type Template = {
  id?: string;
  name: string;
  status?: string;
  category?: string;
  language?: string;
};

/** Ce que le commerçant comprend, par opposition au statut technique de Meta. */
const ETAT: Record<string, { texte: string; fond: string; encre: string }> = {
  APPROVED: { texte: "Approuvé", fond: "#E7F8F0", encre: "#1B6E51" },
  PENDING: { texte: "En attente", fond: "#FDF1DC", encre: "#8A5A00" },
  IN_APPEAL: { texte: "En appel", fond: "#FDF1DC", encre: "#8A5A00" },
  REJECTED: { texte: "Refusé", fond: "#F7E8E4", encre: "#A63D28" },
  PAUSED: { texte: "Suspendu", fond: "#F7E8E4", encre: "#A63D28" },
  DISABLED: { texte: "Désactivé", fond: "#F2F2F2", encre: "#666" },
};

const CATEGORIES = [
  { v: "UTILITY", l: "Utilitaire", aide: "Information liée à une commande du client. C'est ce qu'il faut dans presque tous les cas." },
  { v: "MARKETING", l: "Marketing", aide: "Promotion, nouveauté. Plus cher, et refusable si le client n'a rien demandé." },
];

// Les trois modèles dont tout commerce a besoin. Proposés tels quels pour que
// le commerçant n'ait pas la page blanche devant un formulaire Meta.
const MODELES = [
  {
    l: "Commande confirmée",
    name: "commande_confirmee",
    body: "Bonjour {{1}}, ta commande {{2}} est bien enregistrée ✅ Total : {{3}}. On te prévient dès qu'elle part.",
    examples: ["David", "BC-AA12", "9 000 FCFA"],
  },
  {
    l: "Partie en livraison",
    name: "livraison",
    body: "Bonjour {{1}}, ta commande {{2}} vient de partir en livraison 🛵 Tu la reçois très bientôt !",
    examples: ["David", "BC-AA12"],
  },
  {
    l: "Réclamation prise en charge",
    name: "reclamation_prise_en_charge",
    body: "Bonjour {{1}}, on a bien reçu ton message et quelqu'un s'en occupe 🙏 On te répond ici même très vite.",
    examples: ["David"],
  },
];

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [err, setErr] = useState("");
  const [form, setForm] = useState(false);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("UTILITY");
  const [body, setBody] = useState("");
  const [footer, setFooter] = useState("");
  const [examples, setExamples] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const r = await fetch("/api/whatsapp/templates", { headers: { ...authHeaders() } });
      const d = await r.json();
      if (d.error) setErr(d.error);
      setTemplates(Array.isArray(d.templates) ? d.templates : []);
    } catch (e) {
      setErr((e as Error).message);
      setTemplates([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Le nombre d'exemples suit les variables écrites dans le message : Meta
  // refuse un modèle dont il ne peut pas juger le rendu réel.
  const variables = (body.match(/\{\{\s*\d+\s*\}\}/g) || []).length;

  function prendreModele(m: (typeof MODELES)[number]) {
    setName(m.name);
    setBody(m.body);
    setExamples(m.examples);
    setCategory("UTILITY");
    setFooter("");
    setMsg("");
  }

  async function soumettre() {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/whatsapp/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name, category, body, footer, examples, language: "fr" }),
      });
      const d = await r.json();
      if (!r.ok || d.error) { setMsg(d.error || "Soumission refusée"); return; }
      setMsg(`Soumis à Meta — statut ${d.status}. L'examen prend jusqu'à 24 h.`);
      setName(""); setBody(""); setFooter(""); setExamples([]);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const champ: React.CSSProperties = {
    width: "100%", padding: "9px 11px", borderRadius: 9, fontSize: 13.5,
    border: "1px solid var(--cl-line)", background: "#fff", color: "var(--cl-ink)",
  };

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "28px 20px 80px" }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, color: "var(--cl-ink)", margin: 0 }}>
        Modèles de message
      </h1>
      <p style={{ color: "var(--cl-sub)", fontSize: 13.5, lineHeight: 1.55, marginTop: 6, maxWidth: "60ch" }}>
        Passé 24 h sans nouvelle du client, WhatsApp n&apos;autorise que des messages
        approuvés à l&apos;avance. C&apos;est le cas de l&apos;accusé envoyé le lendemain, du
        suivi de livraison, et de la réponse à une réclamation.
      </p>

      {err ? (
        <div style={{ marginTop: 14, padding: "11px 13px", borderRadius: 10,
          background: "#F7E8E4", border: "1px solid #A63D28", fontSize: 13 }}>
          {err}
        </div>
      ) : null}

      {/* ── Les modèles existants ─────────────────────────────────────────── */}
      <div style={{ marginTop: 22 }}>
        {templates === null ? (
          <p style={{ color: "var(--cl-sub)", fontSize: 13 }}>Chargement…</p>
        ) : templates.length === 0 ? (
          <p style={{ color: "var(--cl-sub)", fontSize: 13 }}>
            Aucun modèle pour le moment. Crées-en un ci-dessous.
          </p>
        ) : (
          <div style={{ border: "1px solid var(--cl-line)", borderRadius: 12, overflow: "hidden" }}>
            {templates.map((t, i) => {
              const e = ETAT[String(t.status)] || { texte: t.status || "—", fond: "#F2F2F2", encre: "#666" };
              return (
                <div key={t.id || t.name} style={{ display: "flex", alignItems: "center", gap: 12,
                  padding: "11px 14px", background: "#fff",
                  borderTop: i === 0 ? "none" : "1px solid #F2F2F2" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--cl-ink)" }}>{t.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--cl-sub)", marginTop: 1 }}>
                      {t.category === "UTILITY" ? "Utilitaire" : t.category === "MARKETING" ? "Marketing" : t.category}
                      {t.language ? ` · ${t.language}` : ""}
                    </div>
                  </div>
                  <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, padding: "4px 9px",
                    borderRadius: 999, background: e.fond, color: e.encre }}>
                    {e.texte}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Création ──────────────────────────────────────────────────────── */}
      {!form ? (
        <button onClick={() => setForm(true)}
          style={{ marginTop: 18, padding: "11px 18px", borderRadius: 999, border: "none",
            background: "#101012", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
          Créer un modèle
        </button>
      ) : (
        <div style={{ marginTop: 20, padding: 18, border: "1px solid var(--cl-line)", borderRadius: 12, background: "#fff" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 4px", color: "var(--cl-ink)" }}>
            Nouveau modèle
          </h2>
          <p style={{ fontSize: 12.5, color: "var(--cl-sub)", margin: "0 0 16px" }}>
            Pars d&apos;un modèle courant, ou écris le tien.
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 18 }}>
            {MODELES.map((m) => (
              <button key={m.name} onClick={() => prendreModele(m)}
                style={{ padding: "7px 12px", borderRadius: 999, fontSize: 12.5, cursor: "pointer",
                  border: "1px solid var(--cl-line)", background: "#FAFAF8", color: "var(--cl-ink)" }}>
                {m.l}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gap: 14 }}>
            <label style={{ display: "grid", gap: 5 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--cl-ink)" }}>Nom</span>
              <input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="livraison" style={champ} />
              <span style={{ fontSize: 11.5, color: "var(--cl-sub)" }}>
                Minuscules, chiffres et tirets bas. Ce nom ne sera pas vu par le client.
              </span>
            </label>

            <label style={{ display: "grid", gap: 5 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--cl-ink)" }}>Catégorie</span>
              <select id="tpl-cat" value={category} onChange={(e) => setCategory(e.target.value)} style={champ}>
                {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
              <span style={{ fontSize: 11.5, color: "var(--cl-sub)" }}>
                {CATEGORIES.find((c) => c.v === category)?.aide}
              </span>
            </label>

            <label style={{ display: "grid", gap: 5 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--cl-ink)" }}>Message</span>
              <textarea id="tpl-body" value={body} onChange={(e) => setBody(e.target.value)} rows={4}
                placeholder="Bonjour {{1}}, ta commande {{2}} vient de partir en livraison 🛵"
                style={{ ...champ, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} />
              <span style={{ fontSize: 11.5, color: "var(--cl-sub)" }}>
                Écris <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>… là où le prénom, la référence ou le
                montant viendront se placer.
              </span>
            </label>

            {variables > 0 ? (
              <div style={{ display: "grid", gap: 7 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--cl-ink)" }}>
                  Exemples ({variables} variable{variables > 1 ? "s" : ""})
                </span>
                {Array.from({ length: variables }, (_, i) => (
                  <input key={i} id={`tpl-ex-${i}`} value={examples[i] || ""}
                    onChange={(e) => {
                      const v = [...examples]; v[i] = e.target.value; setExamples(v);
                    }}
                    placeholder={`exemple pour {{${i + 1}}}`} style={champ} />
                ))}
                <span style={{ fontSize: 11.5, color: "var(--cl-sub)" }}>
                  Meta refuse un modèle dont il ne peut pas juger le rendu réel. Ces exemples ne
                  sont jamais envoyés à un client.
                </span>
              </div>
            ) : null}

            <label style={{ display: "grid", gap: 5 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--cl-ink)" }}>
                Pied de page <span style={{ fontWeight: 400, color: "var(--cl-sub)" }}>· facultatif</span>
              </span>
              <input id="tpl-footer" value={footer} onChange={(e) => setFooter(e.target.value)}
                placeholder="BUYTICLE · Douala" style={champ} />
            </label>
          </div>

          {msg ? (
            <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 9, fontSize: 13,
              background: msg.startsWith("Soumis") ? "#E7F8F0" : "#F7E8E4",
              border: `1px solid ${msg.startsWith("Soumis") ? "#1B6E51" : "#A63D28"}` }}>
              {msg}
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 9, marginTop: 18 }}>
            <button onClick={soumettre} disabled={busy || !name.trim() || !body.trim()}
              style={{ padding: "11px 18px", borderRadius: 999, border: "none", background: "#101012",
                color: "#fff", fontSize: 13.5, fontWeight: 700,
                cursor: busy ? "default" : "pointer", opacity: busy || !name.trim() || !body.trim() ? 0.5 : 1 }}>
              {busy ? "Envoi…" : "Soumettre à Meta"}
            </button>
            <button onClick={() => { setForm(false); setMsg(""); }}
              style={{ padding: "11px 18px", borderRadius: 999, background: "transparent",
                border: "1px solid var(--cl-line)", color: "var(--cl-ink)", fontSize: 13.5, cursor: "pointer" }}>
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
