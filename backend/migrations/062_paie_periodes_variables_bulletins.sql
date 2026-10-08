-- PAIE-2 : periodes de paie (ouverture sequentielle), variables du mois, bulletins (brouillon recalculable).
-- La validation / cloture / archives arrivent au lot PAIE-3 (statuts deja prevus ici).

-- A) Coordonnees du compte de l'entreprise pour l'ordre de virement des salaires ----------------------------------------
ALTER TABLE paie_parametres ADD COLUMN IF NOT EXISTS banque_donneur  TEXT;
ALTER TABLE paie_parametres ADD COLUMN IF NOT EXISTS compte_donneur  TEXT;
ALTER TABLE paie_parametres ADD COLUMN IF NOT EXISTS jour_virement   INTEGER CHECK (jour_virement IS NULL OR jour_virement BETWEEN 1 AND 31);

-- B) Periodes de paie ------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paie_periode (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    annee               INTEGER NOT NULL CHECK (annee BETWEEN 2000 AND 2100),
    mois                INTEGER NOT NULL CHECK (mois BETWEEN 1 AND 12),
    statut              TEXT NOT NULL DEFAULT 'OUVERTE' CHECK (statut IN ('OUVERTE', 'VALIDEE', 'CLOTUREE')),
    date_ouverture      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ouvert_par          UUID,
    date_calcul         TIMESTAMPTZ,
    calcule_par         UUID,
    date_validation     TIMESTAMPTZ,
    valide_par          UUID,
    date_cloture        TIMESTAMPTZ,
    cloture_par         UUID,
    ordre_virement_id   UUID REFERENCES rh_ordre_virement(id) ON DELETE SET NULL,
    notes               TEXT,
    UNIQUE (tenant_id, annee, mois)
);
CREATE INDEX IF NOT EXISTS idx_paie_periode_tenant ON paie_periode (tenant_id, annee DESC, mois DESC);

-- C) Variables du mois saisies cote RH --------------------------------------------------------------------------------------
-- type HS : code = code de majoration de la convention (HS_15...), quantite = heures
-- type ABSENCE : code = type d'absence, quantite = jours
-- type GAIN : code = rubrique, quantite (rubriques a quantite) et/ou montant
-- type RETENUE : code = rubrique, montant
CREATE TABLE IF NOT EXISTS paie_variable (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    periode_id          UUID NOT NULL REFERENCES paie_periode(id) ON DELETE CASCADE,
    employe_id          UUID NOT NULL REFERENCES employe(id) ON DELETE CASCADE,
    type                TEXT NOT NULL CHECK (type IN ('HS', 'ABSENCE', 'GAIN', 'RETENUE')),
    code                TEXT NOT NULL,
    quantite            NUMERIC(10,2),
    montant             NUMERIC(14,0),
    note                TEXT,
    origine             TEXT NOT NULL DEFAULT 'SAISIE' CHECK (origine IN ('SAISIE', 'IMPORT', 'COPIE', 'DEMANDE_RH')),
    saisi_par           UUID,
    date_modification   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (periode_id, employe_id, type, code)
);
CREATE INDEX IF NOT EXISTS idx_paie_variable_periode ON paie_variable (periode_id, employe_id);

-- D) Bulletins de la periode (brouillon recalculable tant que la periode n'est pas validee) -----------------------------------
CREATE TABLE IF NOT EXISTS paie_bulletin (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    periode_id          UUID NOT NULL REFERENCES paie_periode(id) ON DELETE CASCADE,
    employe_id          UUID NOT NULL REFERENCES employe(id) ON DELETE RESTRICT,
    statut              TEXT NOT NULL DEFAULT 'BROUILLON' CHECK (statut IN ('BROUILLON', 'VALIDE')),
    matricule           TEXT,
    nom                 TEXT,
    prenom              TEXT,
    brut                NUMERIC(14,0) NOT NULL DEFAULT 0,
    imposable           NUMERIC(14,0) NOT NULL DEFAULT 0,
    base_cotisable      NUMERIC(14,0) NOT NULL DEFAULT 0,
    total_retenues      NUMERIC(14,0) NOT NULL DEFAULT 0,
    ir                  NUMERIC(14,0) NOT NULL DEFAULT 0,
    trimf               NUMERIC(14,0) NOT NULL DEFAULT 0,
    net_a_payer         NUMERIC(14,0) NOT NULL DEFAULT 0,
    charges_patronales  NUMERIC(14,0) NOT NULL DEFAULT 0,
    calcul_json         JSONB NOT NULL,
    avertissements_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    date_calcul         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (periode_id, employe_id)
);
CREATE INDEX IF NOT EXISTS idx_paie_bulletin_periode ON paie_bulletin (periode_id);
CREATE INDEX IF NOT EXISTS idx_paie_bulletin_employe ON paie_bulletin (tenant_id, employe_id);
