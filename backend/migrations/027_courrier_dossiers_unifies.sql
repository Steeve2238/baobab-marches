-- Chantier du 02/10/2026 (demande de Steeve, en suite du complement
-- "courriers_explication") : etendre la generation de courriers, jusque-la
-- reservee aux dossiers Appel d'Offres (dossier_ao), aux dossiers de
-- Consultation restreinte (consultation) - et ajouter un historique numerote
-- des courriers generes. Jusqu'ici courrier_genere existait dans le schema
-- mais n'etait utilisee nulle part dans le code : chaque generation etait
-- purement a la volee (titre/corps rendus et affiches a l'ecran, jamais
-- enregistres). Desormais chaque generation est persistee avec un numero de
-- suite (meme principe que compteur_numerotation/tirerProchainNumero deja
-- utilise pour les devis), partage entre les deux types de dossier - une
-- seule chronologie de courriers, comme demande par Steeve.

ALTER TABLE courrier_genere
  ALTER COLUMN dossier_ao_id DROP NOT NULL;

ALTER TABLE courrier_genere
  ADD COLUMN IF NOT EXISTS consultation_id UUID REFERENCES consultation(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenant(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS numero TEXT,
  ADD COLUMN IF NOT EXISTS titre_rendu TEXT,
  ADD COLUMN IF NOT EXISTS variables_json JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill de tenant_id pour d'eventuelles lignes deja existantes (tres
-- improbable : la route de generation n'a jamais ecrit dans cette table
-- jusqu'ici) avant de poser la contrainte NOT NULL ci-dessous.
UPDATE courrier_genere cg
SET tenant_id = d.tenant_id
FROM dossier_ao d
WHERE cg.dossier_ao_id = d.id AND cg.tenant_id IS NULL;

ALTER TABLE courrier_genere
  ALTER COLUMN tenant_id SET NOT NULL;

-- Association polymorphe : un courrier genere appartient a EXACTEMENT un des
-- deux types de dossier, jamais les deux, jamais aucun.
ALTER TABLE courrier_genere
  DROP CONSTRAINT IF EXISTS courrier_genere_un_seul_dossier;
ALTER TABLE courrier_genere
  ADD CONSTRAINT courrier_genere_un_seul_dossier CHECK (
    ((dossier_ao_id IS NOT NULL)::int + (consultation_id IS NOT NULL)::int) = 1
  );

CREATE INDEX IF NOT EXISTS idx_courrier_genere_tenant ON courrier_genere(tenant_id);
CREATE INDEX IF NOT EXISTS idx_courrier_genere_dossier_ao ON courrier_genere(dossier_ao_id);
CREATE INDEX IF NOT EXISTS idx_courrier_genere_consultation ON courrier_genere(consultation_id);
