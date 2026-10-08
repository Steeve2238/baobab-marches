-- PAIE-3A : validation, cloture, archives verrouillees des periodes de paie.

-- A) Archive : fichiers imprimables figes a la cloture (bulletins, etats, ordre de virement) ------------------------------
CREATE TABLE IF NOT EXISTS paie_archive_fichier (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    periode_id      UUID NOT NULL REFERENCES paie_periode(id) ON DELETE CASCADE,
    type            TEXT NOT NULL CHECK (type IN ('BULLETIN', 'JOURNAL_PAIE', 'ETATS_SOCIAUX_FISCAUX', 'ETATS_EXCEL', 'ORDRE_VIREMENT')),
    employe_id      UUID REFERENCES employe(id) ON DELETE SET NULL,
    nom_fichier     TEXT NOT NULL,
    mime            TEXT NOT NULL,
    taille          INTEGER NOT NULL,
    sha256          TEXT NOT NULL,
    contenu         BYTEA NOT NULL,
    date_creation   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_paie_archive_periode ON paie_archive_fichier (periode_id, type);
CREATE INDEX IF NOT EXISTS idx_paie_archive_employe ON paie_archive_fichier (tenant_id, employe_id) WHERE employe_id IS NOT NULL;

ALTER TABLE paie_periode ADD COLUMN IF NOT EXISTS empreinte_archive TEXT;
ALTER TABLE paie_periode ADD COLUMN IF NOT EXISTS nb_fichiers_archive INTEGER;
ALTER TABLE paie_periode ADD COLUMN IF NOT EXISTS motif_reouverture TEXT;

-- B) Verrouillage : au niveau de la base, pas seulement de l'application ------------------------------------------------------
-- Le tenant n'existe plus pendant la suppression en cascade d'une entreprise : on laisse alors passer.
CREATE OR REPLACE FUNCTION paie_verrou_variable() RETURNS trigger AS $$
DECLARE
    st TEXT;
    pid UUID;
BEGIN
    pid := COALESCE(NEW.periode_id, OLD.periode_id);
    SELECT statut INTO st FROM paie_periode WHERE id = pid;
    IF st IS NOT NULL AND st <> 'OUVERTE' THEN
        RAISE EXCEPTION 'PAIE_PERIODE_FIGEE' USING ERRCODE = 'P0001';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_paie_variable_verrou ON paie_variable;
CREATE TRIGGER trg_paie_variable_verrou BEFORE INSERT OR UPDATE OR DELETE ON paie_variable
    FOR EACH ROW EXECUTE FUNCTION paie_verrou_variable();

CREATE OR REPLACE FUNCTION paie_verrou_bulletin() RETURNS trigger AS $$
DECLARE
    st TEXT;
    pid UUID;
BEGIN
    pid := COALESCE(NEW.periode_id, OLD.periode_id);
    SELECT statut INTO st FROM paie_periode WHERE id = pid;
    IF st = 'CLOTUREE' THEN
        RAISE EXCEPTION 'PAIE_PERIODE_CLOTUREE' USING ERRCODE = 'P0001';
    END IF;
    IF st = 'VALIDEE' THEN
        RAISE EXCEPTION 'PAIE_PERIODE_FIGEE' USING ERRCODE = 'P0001';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_paie_bulletin_verrou ON paie_bulletin;
CREATE TRIGGER trg_paie_bulletin_verrou BEFORE INSERT OR UPDATE OR DELETE ON paie_bulletin
    FOR EACH ROW EXECUTE FUNCTION paie_verrou_bulletin();

CREATE OR REPLACE FUNCTION paie_verrou_archive() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF NOT EXISTS (SELECT 1 FROM tenant WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
        IF NOT EXISTS (SELECT 1 FROM paie_periode WHERE id = OLD.periode_id) THEN RETURN OLD; END IF;
    END IF;
    RAISE EXCEPTION 'PAIE_ARCHIVE_VERROUILLEE' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_paie_archive_verrou ON paie_archive_fichier;
CREATE TRIGGER trg_paie_archive_verrou BEFORE UPDATE OR DELETE ON paie_archive_fichier
    FOR EACH ROW EXECUTE FUNCTION paie_verrou_archive();

-- Une periode cloturee ne change plus (ni statut, ni suppression).
CREATE OR REPLACE FUNCTION paie_verrou_periode() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.statut = 'CLOTUREE' AND EXISTS (SELECT 1 FROM tenant WHERE id = OLD.tenant_id) THEN
            RAISE EXCEPTION 'PAIE_PERIODE_CLOTUREE' USING ERRCODE = 'P0001';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.statut = 'CLOTUREE' THEN
        RAISE EXCEPTION 'PAIE_PERIODE_CLOTUREE' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_paie_periode_verrou ON paie_periode;
CREATE TRIGGER trg_paie_periode_verrou BEFORE UPDATE OR DELETE ON paie_periode
    FOR EACH ROW EXECUTE FUNCTION paie_verrou_periode();
