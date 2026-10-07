-- ═══════════════════════════════════════════════════════════════════════════
-- migration_meta_inbound.sql
--
-- Anti-doublon des messages reçus par le webhook WhatsApp Cloud API.
--
-- Meta peut livrer DEUX FOIS le même message (réessai après un accusé jugé trop
-- lent, incident de son côté). Sans cette table, un panier reçu deux fois
-- donnait deux commandes et décomptait le stock deux fois. Chaque message Meta
-- porte un identifiant unique (wamid) : on le réserve avant de traiter, et un
-- second passage le trouve déjà pris.
--
-- ENTIÈREMENT ADDITIVE. Rejouable sans risque.
--   psql "$DATABASE_URL" -f migration_meta_inbound.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS camille.meta_inbound (
  wamid       text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- Pour la purge : on ne garde que quelques jours, Meta ne réessaie pas au-delà.
CREATE INDEX IF NOT EXISTS meta_inbound_received_idx ON camille.meta_inbound (received_at);

COMMENT ON TABLE camille.meta_inbound IS
  'Identifiants (wamid) des messages Meta déjà traités : empêche les doubles réponses et les doubles commandes quand Meta relivre un message.';

-- Le compte de l'application (s'il existe) doit pouvoir y écrire.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_camille') THEN
    GRANT SELECT, INSERT, DELETE ON camille.meta_inbound TO app_camille;
  END IF;
END $$;
