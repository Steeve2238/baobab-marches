-- ============================================================================
-- Module 2 (Financement) — rattachement des lignes tarifaires au moteur de
-- regles parametrable, pour ne jamais coder en dur le calcul du cout d'une
-- facilite (chaque partenaire financier peut avoir sa propre formule).
-- ============================================================================
 
ALTER TABLE ligne_credit_tarif
  ADD COLUMN IF NOT EXISTS regle_formule_id UUID REFERENCES regle_formule(id);
