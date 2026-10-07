-- ═══════════════════════════════════════════════════════════════════════════
-- migration_meta_paniers.sql
--
-- Le panier WhatsApp (Meta) en attente du mode de réception.
--
-- Avant, un panier reçu devenait aussitôt une commande, puis on demandait où
-- livrer. Une commande sans adresse — et sans frais de livraison — partait
-- donc chez le commerçant, et la position, si elle arrivait, se greffait sur
-- « la dernière commande » du client, même ancienne. Sur ordinateur, le bouton
-- de position ne s'affiche même pas : la commande restait sans adresse.
--
-- Désormais le panier attend ici, le temps que le client choisisse livraison
-- ou retrait et donne son adresse (position GPS ou texte). La commande n'est
-- créée qu'avec tout ce qu'il faut pour la préparer.
--
-- ENTIÈREMENT ADDITIVE. Rejouable sans risque.
--   psql "$DATABASE_URL" -f migration_meta_paniers.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS camille.meta_paniers (
  agent_id     uuid        NOT NULL,
  phone        text        NOT NULL,
  -- 'mode' : on attend « livraison » ou « retrait » ; 'adresse' : on attend l'adresse
  etape        text        NOT NULL DEFAULT 'mode',
  items        jsonb       NOT NULL,
  note         text,
  contact_name text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, phone)
);

COMMENT ON TABLE camille.meta_paniers IS
  'Panier WhatsApp reçu, en attente du mode de réception et de l''adresse. Devient une commande camille.orders une fois complet ; expire après 2 h.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_camille') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON camille.meta_paniers TO app_camille;
  END IF;
END $$;
