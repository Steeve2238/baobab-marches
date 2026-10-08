-- Financement : correctifs issus du rapprochement proposition BNDE / releve reel (08/10/2026).
--  - taxe propre a une ligne (la banque peut appliquer 18 % sur une commission et un autre taux ailleurs)
--  - frequence d'une ligne : par operation ou UNIQUE par contrat (ex. frais d'avenant, de dossier)
--  - points confirmes par la banque (base de la commission, taxe, jours, prelevement des interets...) :
--    tout point non confirme est signale dans les simulations et alimente la liste de questions a la banque.
ALTER TABLE financement_condition_frais ADD COLUMN IF NOT EXISTS taxe_taux_pct NUMERIC(9,4);
ALTER TABLE financement_condition_frais ADD COLUMN IF NOT EXISTS taxe_libelle  TEXT;
ALTER TABLE financement_condition_frais ADD COLUMN IF NOT EXISTS frequence     TEXT NOT NULL DEFAULT 'PAR_OPERATION';
ALTER TABLE financement_condition_frais DROP CONSTRAINT IF EXISTS chk_fin_frais_frequence;
ALTER TABLE financement_condition_frais ADD CONSTRAINT chk_fin_frais_frequence CHECK (frequence IN ('PAR_OPERATION', 'UNIQUE_CONTRAT'));

ALTER TABLE financement_condition ADD COLUMN IF NOT EXISTS points_confirmes_json JSONB NOT NULL DEFAULT '{}'::jsonb;
