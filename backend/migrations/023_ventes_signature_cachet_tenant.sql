-- ============================================================================
-- Migration 023 : signature + cachet du tenant sur les documents imprimes du
-- module Ventes (devis/facture/BL), affiches sous le nom du signataire.
-- Meme demande client que pour les factures Super Admin (migration 022) et
-- meme convention retenue avec Steeve : une seule image scannee (le cachet
-- papier est scanne avec la signature dessus dans l'usage reel, pas deux
-- champs separes). Stockage identique au logo (base64 + type MIME, voir
-- migration 016/018, logo_base64/logo_type_mime sur la meme table tenant).
-- ============================================================================

ALTER TABLE tenant
  ADD COLUMN IF NOT EXISTS signature_cachet_base64    TEXT,
  ADD COLUMN IF NOT EXISTS signature_cachet_type_mime TEXT;
