// ─────────────────────────────────────────────────────────────────────────────
// app/dashboard/[agentId]/catalog-sync/page.tsx
//
// Le catalogue unique : Camille et WhatsApp, vus d'un seul endroit.
//
// Pourquoi cette page existe. La réconciliation était écrite et éprouvée, mais
// elle ne se déclenchait que par un appel d'API — autrement dit, le marchand ne
// pouvait pas la lancer. Une fonction qu'on ne peut pas déclencher n'existe pas.
//
// Ce qu'elle doit rendre évident, et c'est tout son travail :
//   • ce qui est des deux côtés, et ce qui manque d'un côté ;
//   • POURQUOI un article ne part pas — pas d'image, pas de prix. C'est la
//     question que le commerçant se pose, et la réponse est actionnable ;
//   • qu'un article tout juste envoyé n'est PAS immédiatement vendable sur
//     WhatsApp : il attend l'examen commerce de Meta. Sans cette explication,
//     le marchand croit que la synchronisation a échoué, la relance, et
//     conclut que l'outil ne marche pas.
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { authHeaders } from "@/lib/auth-client";

type Apercu = { name: string; synchronise: boolean; envoyable: boolean; bloquant: string | null };

type Etat = {
  camille: { total: number; mappes: number; colonne_meta_retailer_id: boolean };
  meta: { ok: boolean; error?: string; total: number; envoyables: number; en_attente_whatsapp: string[] };
  apercu: Apercu[];
};

type Resultat = {
  ok?: boolean;
  error?: string;
  envoyes_chez_meta?: number;
  importes_dans_camille?: number;
  relies?: number;
  avertissements?: string[];
  note?: string;
};

const CADRE = { border: "1px solid var(--cl-line)", borderRadius: 12, background: "#fff" };

function Chiffre({ n, quoi, alerte }: { n: number; quoi: string; alerte?: boolean }) {
  return (
    <div style={{ ...CADRE, padding: "13px 15px", flex: "1 1 150px" }}>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5,
        color: alerte && n > 0 ? "#A63D28" : "var(--cl-ink)" }}>
        {n}
      </div>
      <div style={{ fontSize: 12, color: "var(--cl-sub)", marginTop: 2, lineHeight: 1.35 }}>{quoi}</div>
    </div>
  );
}

export default function CatalogSyncPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const [etat, setEtat] = useState<Etat | null>(null);
  const [res, setRes] = useState<Resultat | null>(null);
  const [err, setErr] = useState("");
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    try {
      const r = await fetch(`/api/whatsapp/catalog-sync?agentId=${agentId}`, { headers: await authHeaders() });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Lecture impossible");
      setEtat(d);
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [agentId]);

  useEffect(() => { charger(); }, [charger]);

  const synchroniser = async () => {
    setOccupe(true);
    setErr("");
    setRes(null);
    try {
      const r = await fetch(`/api/whatsapp/catalog-sync?agentId=${agentId}`, {
        method: "POST",
        headers: await authHeaders(),
      });
      const d = await r.json();
      setRes(d);
      if (!r.ok) setErr(d.error || "Synchronisation refusée");
      await charger();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setOccupe(false);
    }
  };

  const bloques = (etat?.apercu || []).filter((a) => a.bloquant);
  const attente = etat?.meta.en_attente_whatsapp.length || 0;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 20px 80px" }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, color: "var(--cl-ink)", margin: 0 }}>
        Catalogue WhatsApp
      </h1>
      <p style={{ color: "var(--cl-sub)", fontSize: 13.5, lineHeight: 1.55, marginTop: 6, maxWidth: "64ch" }}>
        Vos produits et le catalogue WhatsApp doivent être <strong>un seul catalogue</strong>.
        Ce qui est chez vous part là-bas, ce qui est là-bas et vous manque est
        importé. Un article que vous créez ou modifiez part tout seul — ce bouton
        sert à remettre les deux côtés d&apos;accord, après un import ou un ajout
        fait directement dans Meta.
      </p>

      {err ? (
        <div style={{ marginTop: 14, padding: "11px 13px", borderRadius: 10,
          background: "#F7E8E4", border: "1px solid #A63D28", fontSize: 13 }}>
          {err}
        </div>
      ) : null}

      {/* ── L'état, en quatre chiffres ─────────────────────────────────────── */}
      {etat ? (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 20 }}>
            <Chiffre n={etat.camille.total} quoi="produits chez vous" />
            <Chiffre n={etat.meta.total} quoi="articles dans le catalogue WhatsApp" />
            <Chiffre n={etat.meta.envoyables} quoi="vendables dès maintenant sur WhatsApp" />
            <Chiffre n={bloques.length} quoi="bloqués : image ou prix manquant" alerte />
          </div>

          {/* La migration manquante empêche la moitié du travail : on le dit
              là où le marchand regarde, pas seulement dans un journal. */}
          {!etat.camille.colonne_meta_retailer_id ? (
            <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 10,
              background: "#FDF1DC", border: "1px solid #E0B870", fontSize: 13, lineHeight: 1.5 }}>
              <strong>Une migration manque.</strong> Sans elle, l&apos;import depuis WhatsApp est
              suspendu — on ne pourrait pas retenir quel article correspond à quel
              produit, et vos articles seraient réimportés en double à chaque
              synchronisation. Le stock ne baisserait pas non plus sur les commandes
              WhatsApp. Appliquez <code>migration_meta_transport.sql</code>.
            </div>
          ) : null}

          {attente > 0 ? (
            <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 10,
              background: "#EEF3FB", border: "1px solid #B9CCE8", fontSize: 13, lineHeight: 1.5 }}>
              <strong>{attente} article{attente > 1 ? "s" : ""} en attente chez WhatsApp.</strong>{" "}
              C&apos;est normal, et ce n&apos;est pas une erreur : WhatsApp examine chaque
              nouvel article avant d&apos;autoriser son envoi dans un message. En
              attendant, Camille ne les propose pas — mieux vaut ne pas les montrer
              que de voir le carrousel échouer. Ça prend quelques heures.
            </div>
          ) : null}

          {etat.meta.ok === false ? (
            <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 10,
              background: "#F7E8E4", border: "1px solid #A63D28", fontSize: 13 }}>
              Catalogue WhatsApp illisible : {etat.meta.error}
            </div>
          ) : null}
        </>
      ) : (
        <p style={{ color: "var(--cl-sub)", fontSize: 13, marginTop: 20 }}>Chargement…</p>
      )}

      <button onClick={synchroniser} disabled={occupe || !etat}
        style={{ marginTop: 20, fontSize: 13.5, fontWeight: 700, padding: "10px 18px",
          borderRadius: 10, border: "none", background: "var(--cl-ink)", color: "#fff",
          cursor: occupe ? "wait" : "pointer", opacity: occupe || !etat ? 0.6 : 1 }}>
        {occupe ? "Synchronisation…" : "Synchroniser les deux catalogues"}
      </button>

      {/* ── Le compte rendu ───────────────────────────────────────────────── */}
      {res?.ok ? (
        <div style={{ ...CADRE, marginTop: 18, padding: "14px 16px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--cl-ink)" }}>C&apos;est fait</div>
          <ul style={{ fontSize: 13, color: "var(--cl-sub)", lineHeight: 1.7, margin: "8px 0 0", paddingLeft: 18 }}>
            <li><strong>{res.envoyes_chez_meta ?? 0}</strong> envoyés de Camille vers WhatsApp</li>
            <li><strong>{res.importes_dans_camille ?? 0}</strong> importés de WhatsApp vers Camille</li>
            <li>
              <strong>{res.relies ?? 0}</strong> rapprochés — ils existaient des deux
              côtés sous le même nom, et sont maintenant un seul article
            </li>
          </ul>
          {res.note ? (
            <p style={{ fontSize: 12.5, color: "var(--cl-sub)", lineHeight: 1.5, marginTop: 10 }}>{res.note}</p>
          ) : null}
        </div>
      ) : null}

      {res?.avertissements?.length ? (
        <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 10,
          background: "#FDF1DC", border: "1px solid #E0B870" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#8A5A00" }}>
            Ce qui n&apos;est pas parti, et pourquoi
          </div>
          <ul style={{ fontSize: 12.5, lineHeight: 1.65, margin: "6px 0 0", paddingLeft: 18, color: "#8A5A00" }}>
            {res.avertissements.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      ) : null}

      {/* ── Article par article ───────────────────────────────────────────── */}
      {etat?.apercu.length ? (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--cl-ink)", margin: "28px 0 10px" }}>
            Vos produits, un par un
          </h2>
          <div style={{ ...CADRE, overflow: "hidden" }}>
            {etat.apercu.map((a, i) => (
              <div key={a.name + i} style={{ display: "flex", alignItems: "center", gap: 12,
                padding: "11px 14px", borderTop: i === 0 ? "none" : "1px solid #F2F2F2" }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "var(--cl-ink)" }}>{a.name}</div>
                {a.bloquant ? (
                  <span style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 9px", borderRadius: 999,
                    background: "#F7E8E4", color: "#A63D28" }}>
                    {a.bloquant}
                  </span>
                ) : a.envoyable ? (
                  <span style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 9px", borderRadius: 999,
                    background: "#E7F8F0", color: "#1B6E51" }}>
                    vendable sur WhatsApp
                  </span>
                ) : a.synchronise ? (
                  <span style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 9px", borderRadius: 999,
                    background: "#EEF3FB", color: "#3A5B8C" }}>
                    en attente d&apos;examen
                  </span>
                ) : (
                  <span style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 9px", borderRadius: 999,
                    background: "#F2F2F2", color: "#666" }}>
                    pas encore envoyé
                  </span>
                )}
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: "var(--cl-sub)", lineHeight: 1.55, marginTop: 12, maxWidth: "64ch" }}>
            Un article sans <strong>image</strong> ou sans <strong>prix</strong> est refusé par
            WhatsApp : ce sont les deux seules choses à corriger dans votre catalogue
            pour qu&apos;il parte.
          </p>
        </>
      ) : null}
    </div>
  );
}
