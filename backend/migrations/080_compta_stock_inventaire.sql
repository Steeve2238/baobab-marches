-- Comptabilisation du stock a l'inventaire (Pack Commerce, lot 9) : comptes parametrables (propositions : 3110.. et 6031..).
ALTER TABLE compta_parametre ADD COLUMN IF NOT EXISTS compte_stock_marchandises TEXT;
ALTER TABLE compta_parametre ADD COLUMN IF NOT EXISTS compte_variation_stock TEXT;
