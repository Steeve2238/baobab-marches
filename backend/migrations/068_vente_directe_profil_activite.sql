-- Vente directe (negoce / commerce) et profil d'activite du client (08/10/2026).
--  - consultation.type : CONSULTATION (demande de prix recue, circuit actuel) ou VENTE (vente directe, sans
--    phase de reponse ni chronogramme). Defaut CONSULTATION : les donnees existantes ne changent pas.
--  - tenant.profil_activite : MARCHES (marches publics / consultations), NEGOCE (commerce : le menu parle
--    de « Ventes » et masque Appel d'offres et Dossiers) ou LES_DEUX (comportement actuel, defaut).
ALTER TABLE consultation ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'CONSULTATION';
ALTER TABLE consultation DROP CONSTRAINT IF EXISTS chk_consultation_type;
ALTER TABLE consultation ADD CONSTRAINT chk_consultation_type CHECK (type IN ('CONSULTATION', 'VENTE'));
CREATE INDEX IF NOT EXISTS idx_consultation_type ON consultation(tenant_id, type);

ALTER TABLE tenant ADD COLUMN IF NOT EXISTS profil_activite TEXT NOT NULL DEFAULT 'LES_DEUX';
ALTER TABLE tenant DROP CONSTRAINT IF EXISTS chk_tenant_profil_activite;
ALTER TABLE tenant ADD CONSTRAINT chk_tenant_profil_activite CHECK (profil_activite IN ('MARCHES', 'NEGOCE', 'LES_DEUX'));
