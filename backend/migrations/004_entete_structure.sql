-- ============================================================================
-- Module 6 (Courriers) — informations d'entete de structure et signataire,
-- utilisees pour generer des courriers prets a imprimer/signer.
-- ============================================================================

ALTER TABLE tenant
  ADD COLUMN IF NOT EXISTS adresse TEXT,
  ADD COLUMN IF NOT EXISTS telephone TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS signataire_nom TEXT,
  ADD COLUMN IF NOT EXISTS signataire_titre TEXT;
