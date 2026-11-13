-- RH : contrat de STAGE (nouveau type de contrat) et champs propres au stage (etablissement, tuteur).
-- Aucune donnee existante n'est modifiee.
ALTER TABLE rh_modele_contrat DROP CONSTRAINT IF EXISTS rh_modele_contrat_type_check;
ALTER TABLE rh_modele_contrat ADD CONSTRAINT rh_modele_contrat_type_check CHECK (type IN ('CDI', 'CDD', 'JOURNALIER', 'STAGE'));

ALTER TABLE rh_contrat DROP CONSTRAINT IF EXISTS rh_contrat_type_check;
ALTER TABLE rh_contrat ADD CONSTRAINT rh_contrat_type_check CHECK (type IN ('CDI', 'CDD', 'JOURNALIER', 'STAGE'));

ALTER TABLE rh_contrat ADD COLUMN IF NOT EXISTS etablissement TEXT;   -- stage : ecole / universite d'origine
ALTER TABLE rh_contrat ADD COLUMN IF NOT EXISTS tuteur        TEXT;   -- stage : tuteur dans l'entreprise
