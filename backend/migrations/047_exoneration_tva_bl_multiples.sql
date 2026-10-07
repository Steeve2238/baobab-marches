-- Chantier du 07/10/2026 (demandes de Steeve) :
--   A) Client exonere de TVA : un client peut etre marque "exonere de TVA" (avec un motif optionnel, ex. convention,
--      ONG, zone franche). Ses devis et factures sont alors a TVA 0 et la TVA n'y apparait plus.
--   B) Livraisons partielles : plusieurs bons de livraison par facture (un par livraison) avec suivi du reste a
--      livrer par ligne de facture. Chaque BL garde un lien vers la ligne de facture qu'il livre.

-- A) Exoneration de TVA ------------------------------------------------------
ALTER TABLE client_commercial ADD COLUMN IF NOT EXISTS exonere_tva BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE client_commercial ADD COLUMN IF NOT EXISTS motif_exoneration_tva TEXT;

-- B) BL multiples ------------------------------------------------------------
-- Avant : un seul BL par facture (UNIQUE tenant_id + facture). Apres : un rang (1, 2, 3...) par facture.
ALTER TABLE bon_livraison DROP CONSTRAINT IF EXISTS bon_livraison_tenant_id_facture_vente_id_key;
ALTER TABLE bon_livraison ADD COLUMN IF NOT EXISTS rang INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bon_livraison_facture_rang ON bon_livraison (facture_vente_id, rang);

ALTER TABLE bon_livraison_ligne
  ADD COLUMN IF NOT EXISTS facture_ligne_id UUID REFERENCES facture_vente_ligne(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bl_ligne_facture_ligne ON bon_livraison_ligne (facture_ligne_id);

-- Reprise des BL existants : rattache chaque ligne de BL a la ligne de facture correspondante (meme ordre, meme designation).
UPDATE bon_livraison_ligne bll
SET facture_ligne_id = fl.id
FROM bon_livraison bl
JOIN facture_vente_ligne fl ON fl.facture_vente_id = bl.facture_vente_id
WHERE bll.bon_livraison_id = bl.id
  AND bll.facture_ligne_id IS NULL
  AND fl.ordre = bll.ordre
  AND fl.designation = bll.designation;
