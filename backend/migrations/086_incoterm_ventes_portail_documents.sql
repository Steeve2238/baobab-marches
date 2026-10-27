-- 086 : Incoterm sur les devis et factures de vente + portail de remise etendu aux BL, avoirs et commandes fournisseur.
--  * devis / facture_vente : Incoterm choisi par l'entreprise (code a 3 lettres) et lieu nomme (« FOB Dakar », « DAP Bamako »...) ;
--    la facture reprend ceux du devis a la generation. Le BL les lit sur sa facture.
--  * portail_partage : nouveaux types BON_LIVRAISON, AVOIR (documents des entreprises) et COMMANDE_FOURNISSEUR (envoyee au fournisseur).
ALTER TABLE devis ADD COLUMN IF NOT EXISTS incoterm TEXT;
ALTER TABLE devis ADD COLUMN IF NOT EXISTS incoterm_lieu TEXT;
ALTER TABLE facture_vente ADD COLUMN IF NOT EXISTS incoterm TEXT;
ALTER TABLE facture_vente ADD COLUMN IF NOT EXISTS incoterm_lieu TEXT;

ALTER TABLE portail_partage DROP CONSTRAINT IF EXISTS portail_partage_type_document_check;
ALTER TABLE portail_partage ADD CONSTRAINT portail_partage_type_document_check
  CHECK (type_document IN ('OFFRE', 'CONTRAT', 'FACTURE', 'DEVIS', 'FACTURE_ABO', 'BON_LIVRAISON', 'AVOIR', 'COMMANDE_FOURNISSEUR'));
