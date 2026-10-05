-- ============================================================================
-- Lot 7 (05/10/2026) : comptabilite reliee aux receptions et aux transitaires.
--  - un transitaire peut avoir son tiers comptable (type FOURNISSEUR) pour
--    recevoir ses factures (fret, transit, douane...) ;
--  - chaque cout d'approche d'une reception garde le lien vers la facture
--    comptable qui l'a enregistre (la facture de marchandises est deja reliee
--    par reception_marchandise.facture_fournisseur_id) ;
--  - les incoterms ont une source unique : les scenarios du module Logistique
--    (incoterm_scenario), alimentes avec les 11 codes standards au premier usage.
-- ============================================================================

ALTER TABLE tiers_comptable
    ADD COLUMN IF NOT EXISTS transitaire_id UUID REFERENCES transitaire(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tiers_transitaire ON tiers_comptable (transitaire_id) WHERE transitaire_id IS NOT NULL;

ALTER TABLE reception_cout_approche
    ADD COLUMN IF NOT EXISTS facture_fournisseur_id UUID REFERENCES facture_fournisseur(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_reception_cout_facture ON reception_cout_approche (facture_fournisseur_id);
