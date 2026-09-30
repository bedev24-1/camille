-- ═══════════════════════════════════════════════════════════════════════════
-- migration_meta_transport.sql
--
-- Le troisième transport WhatsApp de Camille, après WAHA puis camille-core.
--
-- ENTIÈREMENT ADDITIVE, et surtout : le défaut de chaque colonne reproduit le
-- comportement actuel. Un agent existant reste 'core' sans qu'on écrive une
-- seule ligne dans sa rangée. Aucun client ne change de chemin, aucune session
-- Baileys n'est touchée — cette migration ne parle même pas à camille-core.
--
-- `ADD COLUMN ... DEFAULT` est instantané sur PostgreSQL 11+ : pas de réécriture
-- de table, donc pas de verrou long sur une base en production.
--
-- Le retour arrière, lui, doit rester d'une requête :
--   UPDATE camille.agents SET transport = 'core' WHERE id = '…';
-- Une bascule qu'on ne peut pas éteindre en dix secondes n'est pas prête à
-- être allumée.
--
--   psql "$DATABASE_URL" -f migration_meta_transport.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Par quel transport cet agent parle-t-il ? ────────────────────────────
-- 'core' = camille-core (Baileys, aujourd'hui) · 'meta' = WhatsApp Cloud API.
-- Le défaut préserve exactement ce qui tourne.
ALTER TABLE camille.agents ADD COLUMN IF NOT EXISTS transport text NOT NULL DEFAULT 'core';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_transport_check') THEN
    ALTER TABLE camille.agents
      ADD CONSTRAINT agents_transport_check CHECK (transport IN ('core', 'meta'));
  END IF;
END $$;

COMMENT ON COLUMN camille.agents.transport IS
  'Transport WhatsApp : core (camille-core/Baileys) ou meta (Cloud API). Bascule et retour arrière par simple UPDATE.';

-- ── 2. L'identité Meta de l'agent ───────────────────────────────────────────
-- Le webhook Cloud API est unique pour toute l'application : c'est le
-- phone_number_id reçu dans la charge utile qui désigne le marchand. Sans
-- cette colonne, un seul agent peut être testé (via META_TEST_AGENT_ID).
ALTER TABLE camille.agents ADD COLUMN IF NOT EXISTS meta_phone_number_id text;
ALTER TABLE camille.agents ADD COLUMN IF NOT EXISTS meta_waba_id         text;
ALTER TABLE camille.agents ADD COLUMN IF NOT EXISTS meta_catalog_id      text;

-- Deux marchands ne peuvent pas partager un numéro : l'unicité évite qu'un
-- message soit attribué au mauvais agent — donc qu'un client reçoive le
-- catalogue de quelqu'un d'autre.
CREATE UNIQUE INDEX IF NOT EXISTS agents_meta_phone_uniq
  ON camille.agents (meta_phone_number_id)
  WHERE meta_phone_number_id IS NOT NULL;

-- ── 3. Le lien entre un produit Camille et sa fiche au catalogue Meta ───────
-- La décision d'architecture qui ne coûte rien aujourd'hui : un seul
-- identifiant de produit partout — catalogue Meta, Pixel, CAPI, commandes.
-- Par défaut on reprendra l'identifiant Camille ; la colonne existe pour les
-- catalogues Meta déjà remplis à la main, dont les retailer_id ne sont pas
-- des UUID.
ALTER TABLE camille.products ADD COLUMN IF NOT EXISTS meta_retailer_id text;

CREATE INDEX IF NOT EXISTS products_meta_retailer_idx
  ON camille.products (agent_id, meta_retailer_id)
  WHERE meta_retailer_id IS NOT NULL;

COMMENT ON COLUMN camille.products.meta_retailer_id IS
  'retailer_id de ce produit au catalogue Meta. NULL = pas encore synchronisé ; le flux lit alors le catalogue Meta directement, donc sans le stock de Camille.';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- Vérification (ne modifie rien) :
--
--   SELECT transport, COUNT(*) FROM camille.agents GROUP BY transport;
--     → tous en 'core' juste après la migration. C'est le résultat attendu.
-- ═══════════════════════════════════════════════════════════════════════════
