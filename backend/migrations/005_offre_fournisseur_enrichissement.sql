-- ============================================================================
-- Module 5 (Fournisseurs) — enrichissement du comparateur : devise de
-- l'offre, distinction delai de livraison / delai de paiement, et
-- conditions de reglement (necessaires pour determiner le besoin de
-- financement associe, en lien avec le Module 2).
-- ============================================================================

ALTER TABLE offre_fournisseur
  ADD COLUMN IF NOT EXISTS devise TEXT NOT NULL DEFAULT 'XOF',
  ADD COLUMN IF NOT EXISTS delai_paiement_jours INTEGER,
  ADD COLUMN IF NOT EXISTS condition_reglement TEXT,
  ADD COLUMN IF NOT EXISTS pourcentage_acompte NUMERIC(5,2);

-- condition_reglement attendu (verifie cote applicatif, pas de contrainte
-- stricte en base pour rester extensible) :
--   COMPTANT | ACOMPTE_SOLDE | CREDIT_FOURNISSEUR | LC | AVAL_TRAITE | CHEQUE | VIREMENT
