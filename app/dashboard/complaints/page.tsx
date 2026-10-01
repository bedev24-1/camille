// ─────────────────────────────────────────────────────────────────────────────
// app/dashboard/complaints/page.tsx
//
// Les réclamations, et surtout : RENDRE LA MAIN À CAMILLE.
//
// Pourquoi cette page existe, et pourquoi son absence était grave.
//
// Quand un client réclame, Camille se tait pour ce client — c'est la bonne
// règle : répondre par-dessus un humain est pire que ne pas répondre. Mais
// l'API qui pose ce silence existait depuis le début, et RIEN dans
// l'application ne permettait de le lever. Le drapeau `human_takeover` restait
// à vrai pour toujours.
//
// Observé en production, sur le numéro Buyticle : un client demande « qu'est-ce
// qui se passe si ma commande ne vient pas ? » — une question, pas une
// réclamation. Camille passe la main. Le client écrit ensuite « tu peux me
// proposer un truc pour écouter ? » et ne reçoit PLUS RIEN. Jamais. Un client
// prêt à acheter, perdu par une question.
//
// D'où les deux gestes de cette page, délibérément séparés :
//   • rendre la parole à Camille, sans classer le dossier ;
//   • classer le dossier, ce qui rend aussi la parole.
// Garder la main sur un client sans clore son dossier est un cas réel ; clore
// un dossier en laissant l'agent muet à vie ne doit plus en être un.
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "@/lib/auth-client";

type Complaint = {
  id: string;
  phone: string;
  title: string;
  content: Record<string, unknown> | null;
  status: string;
  created_at: string;
  agent_id: string;
  business_name: string;
  human_takeover: boolean;
};

/** « il y a 3 h » plutôt qu'une date : c'est l'attente qui compte ici. */
function depuis(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mn = Math.round(ms / 60000);
  if (!Number.isFinite(mn) || mn < 1) return "à l'instant";
  if (mn < 60) return `il y a ${mn} min`;
  const h = Math.round(mn / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.round(h / 24);
  return `il y a ${j} jour${j > 1 ? "s" : ""}`;
}

/** Le message du client, tel qu'il l'a écrit. C'est la seule chose qui compte. */
function messageDe(c: Complaint): string {
  const v = c.content && typeof c.content === "object" ? c.content : {};
  const m = (v as Record<string, unknown>).message;
  return typeof m === "string" && m.trim() ? m : "(sans message)";
}

export default function ComplaintsPage() {
  const [liste, setListe] = useState<Complaint[] | null>(null);
  const [filtre, setFiltre] = useState<"active" | "done">("active");
  const [err, setErr] = useState("");
  const [enCours, setEnCours] = useState<string>("");

  const charger = useCallback(async () => {
    try {
      const r = await fetch(`/api/complaints?status=${filtre}`, { headers: await authHeaders() });
      const d = await r.json();
      setListe(Array.isArray(d.complaints) ? d.complaints : []);
      setErr(d.error && !d.complaints?.length ? String(d.error) : "");
    } catch (e) {
      setErr((e as Error).message);
      setListe([]);
    }
  }, [filtre]);

  useEffect(() => { charger(); }, [charger]);

  /** Les deux gestes passent par le même appel, avec un corps différent. */
  const agir = async (id: string, corps: Record<string, unknown>) => {
    setEnCours(id);
    setErr("");
    try {
      const r = await fetch("/api/complaints", {
        method: "PATCH",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...corps }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Action refusée");
      await charger();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setEnCours("");
    }
  };

  const muets = (liste || []).filter((c) => c.human_takeover).length;

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "28px 20px 80px" }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, color: "var(--cl-ink)", margin: 0 }}>
        Réclamations
      </h1>
      <p style={{ color: "var(--cl-sub)", fontSize: 13.5, lineHeight: 1.55, marginTop: 6, maxWidth: "62ch" }}>
        Quand un client réclame, Camille se tait pour lui : répondre par-dessus
        quelqu&apos;un de l&apos;équipe serait pire que ne rien dire. C&apos;est ici qu&apos;on lui
        rend la parole, une fois le problème réglé.
      </p>

      {/* Le compteur n'est pas décoratif : chaque client muet est un client qui
          n'obtient plus aucune réponse, même pour une question anodine. */}
      {muets > 0 ? (
        <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 10,
          background: "#FDF1DC", border: "1px solid #E0B870", fontSize: 13, lineHeight: 1.5 }}>
          <strong>{muets} client{muets > 1 ? "s" : ""}</strong> {muets > 1 ? "sont" : "est"} entre
          vos mains : Camille ne leur répond plus, même s&apos;{muets > 1 ? "ils écrivent" : "il écrit"} pour
          autre chose. Rendez-lui la parole dès que c&apos;est réglé.
        </div>
      ) : null}

      {err ? (
        <div style={{ marginTop: 14, padding: "11px 13px", borderRadius: 10,
          background: "#F7E8E4", border: "1px solid #A63D28", fontSize: 13 }}>
          {err}
        </div>
      ) : null}

      {/* ── Les deux vues ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        {([["active", "En cours"], ["done", "Réglées"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => { setListe(null); setFiltre(v); }}
            style={{ fontSize: 12.5, fontWeight: 600, padding: "6px 13px", borderRadius: 999,
              cursor: "pointer", border: "1px solid var(--cl-line)",
              background: filtre === v ? "var(--cl-ink)" : "#fff",
              color: filtre === v ? "#fff" : "var(--cl-sub)" }}>
            {l}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        {liste === null ? (
          <p style={{ color: "var(--cl-sub)", fontSize: 13 }}>Chargement…</p>
        ) : liste.length === 0 ? (
          <p style={{ color: "var(--cl-sub)", fontSize: 13 }}>
            {filtre === "active"
              ? "Aucune réclamation en cours 🙌"
              : "Aucune réclamation réglée pour l'instant."}
          </p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {liste.map((c) => {
              const occupe = enCours === c.id;
              return (
                <div key={c.id} style={{ border: "1px solid var(--cl-line)", borderRadius: 12,
                  background: "#fff", padding: "13px 15px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--cl-ink)" }}>
                      {c.phone || "numéro inconnu"}
                    </span>
                    <span style={{ fontSize: 11.5, color: "var(--cl-sub)" }}>
                      {c.business_name} · {depuis(c.created_at)}
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700,
                      padding: "3px 9px", borderRadius: 999,
                      background: c.human_takeover ? "#FDF1DC" : "#E7F8F0",
                      color: c.human_takeover ? "#8A5A00" : "#1B6E51" }}>
                      {c.human_takeover ? "Camille est muette" : "Camille répond"}
                    </span>
                  </div>

                  <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--cl-ink)",
                    margin: "9px 0 0", whiteSpace: "pre-wrap" }}>
                    « {messageDe(c)} »
                  </p>

                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                    {/* Le geste que l'application ne savait pas faire. */}
                    {c.human_takeover ? (
                      <button disabled={occupe} onClick={() => agir(c.id, { takeover: false })}
                        style={{ fontSize: 12.5, fontWeight: 700, padding: "7px 13px", borderRadius: 9,
                          border: "none", background: "var(--cl-ink)", color: "#fff",
                          cursor: occupe ? "wait" : "pointer", opacity: occupe ? 0.6 : 1 }}>
                        {occupe ? "…" : "Rendre la main à Camille"}
                      </button>
                    ) : (
                      <button disabled={occupe} onClick={() => agir(c.id, { takeover: true })}
                        style={{ fontSize: 12.5, fontWeight: 600, padding: "7px 13px", borderRadius: 9,
                          border: "1px solid var(--cl-line)", background: "#fff", color: "var(--cl-sub)",
                          cursor: occupe ? "wait" : "pointer" }}>
                        {occupe ? "…" : "Je m'en occupe moi-même"}
                      </button>
                    )}

                    {c.status !== "done" ? (
                      <button disabled={occupe} onClick={() => agir(c.id, { status: "done" })}
                        style={{ fontSize: 12.5, fontWeight: 600, padding: "7px 13px", borderRadius: 9,
                          border: "1px solid var(--cl-line)", background: "#fff",
                          color: "var(--cl-sub)", cursor: occupe ? "wait" : "pointer" }}>
                        C&apos;est réglé
                      </button>
                    ) : (
                      <button disabled={occupe} onClick={() => agir(c.id, { status: "active" })}
                        style={{ fontSize: 12.5, fontWeight: 600, padding: "7px 13px", borderRadius: 9,
                          border: "1px solid var(--cl-line)", background: "#fff",
                          color: "var(--cl-sub)", cursor: occupe ? "wait" : "pointer" }}>
                        Rouvrir
                      </button>
                    )}

                    <a href={`https://wa.me/${c.phone}`} target="_blank" rel="noreferrer"
                      style={{ fontSize: 12.5, fontWeight: 600, padding: "7px 13px", borderRadius: 9,
                        border: "1px solid var(--cl-line)", color: "var(--cl-sub)",
                        textDecoration: "none", marginLeft: "auto" }}>
                      Écrire au client
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p style={{ color: "var(--cl-sub)", fontSize: 12, lineHeight: 1.55, marginTop: 26, maxWidth: "62ch" }}>
        « C&apos;est réglé » rend aussi la parole à Camille et prévient le client.
        « Je m&apos;en occupe moi-même » la fait taire sans clore le dossier — utile
        quand vous voulez suivre ce client de bout en bout.
      </p>
    </div>
  );
}
