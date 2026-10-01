-- ─────────────────────────────────────────────────────────────────────────────
-- Migration : la mémoire des goûts d'un client
--
-- Les COMMANDES passées se lisent déjà dans camille.orders — rien à ajouter.
-- Ce qui manquait : les goûts énoncés en conversation. « Préfère le noir »,
-- « petit budget », « achète pour sa fille ». Un client qui doit se répéter à
-- chaque visite a l'impression de parler à une borne.
--
-- Entièrement additive. Sans elle, Camille se souvient quand même des
-- commandes — la mémoire est simplement plus pauvre. Le code gère l'absence de
-- la colonne (42703) et continue.
--
-- Exécuter sur : supabase.vps.buyticle.com:5432 (base camille)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE camille.contacts
  ADD COLUMN IF NOT EXISTS notes JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN camille.contacts.notes IS
  'Goûts du client, énoncés en conversation, 8 au plus, les plus récents devant. '
  'Écrits par le modèle, donc JAMAIS traités comme des faits vérifiables : '
  'ils ne peuvent pas ancrer un prix ni un délai dans une réponse.';

-- Retrouver les commandes d'un client par son numéro, pour la mémoire.
-- Sans cet index, la lecture balaie toute la table à chaque message.
CREATE INDEX IF NOT EXISTS idx_orders_agent_phone_date
  ON camille.orders (agent_id, contact_phone, created_at DESC);
