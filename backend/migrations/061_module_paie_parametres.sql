-- Module Paie (payant) - lot PAIE-1 (08/10/2026) : option payante + parametres + dossier de paie du salarie.
-- Cadrage : claude/cadrage_paie_architecture_08102026. Les baremes officiels IR / TRIMF fournis par l'application sont
-- lus dans backend/data/paie (jeu de reference) ; une entreprise peut importer un bareme plus recent (table paie_bareme).

-- A) Option payante (meme mecanique que Comptabilite et Fiscalite) -----------------------------------------------
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS module_paie_actif BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS module_paie_prix_mensuel_xof NUMERIC(12,0) NOT NULL DEFAULT 0;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS module_paie_date_activation TIMESTAMPTZ;
ALTER TABLE facture_abonnement ADD COLUMN IF NOT EXISTS supplement_paie_xof NUMERIC(12,0) NOT NULL DEFAULT 0;

-- B) Parametres generaux ------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paie_parametres (
    tenant_id               UUID PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
    jours_mois              INTEGER NOT NULL DEFAULT 30 CHECK (jours_mois BETWEEN 28 AND 31),
    heures_mensuelles       NUMERIC(6,2) NOT NULL DEFAULT 173.33 CHECK (heures_mensuelles > 0),
    arrondi_net             INTEGER NOT NULL DEFAULT 1 CHECK (arrondi_net IN (1, 5, 10, 25, 50, 100, 500, 1000)),
    base_taux_horaire       TEXT NOT NULL DEFAULT 'BASE_SURSALAIRE' CHECK (base_taux_horaire IN ('BASE', 'BASE_SURSALAIRE')),
    mode_ir                 TEXT NOT NULL DEFAULT 'BAREME' CHECK (mode_ir IN ('BAREME', 'FORMULE', 'CUMUL')),
    numero_employeur_css    TEXT,
    numero_employeur_ipres  TEXT,
    lieu_signature          TEXT,
    date_modification       TIMESTAMPTZ NOT NULL DEFAULT now(),
    modifie_par             UUID
);

-- C) Cotisations sociales et patronales, versionnees par date d'effet ---------------------------------------------
CREATE TABLE IF NOT EXISTS paie_cotisation (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code                TEXT NOT NULL,
    libelle             TEXT NOT NULL,
    section             TEXT NOT NULL DEFAULT 'SOCIAL',
    taux_salarie        NUMERIC(7,3) NOT NULL DEFAULT 0 CHECK (taux_salarie >= 0),
    taux_patronal       NUMERIC(7,3) NOT NULL DEFAULT 0 CHECK (taux_patronal >= 0),
    plafond_mensuel     NUMERIC(14,0),
    public              TEXT NOT NULL DEFAULT 'TOUS' CHECK (public IN ('TOUS', 'CADRES')),
    date_effet          DATE NOT NULL,
    ordre               INTEGER NOT NULL DEFAULT 0,
    actif               BOOLEAN NOT NULL DEFAULT TRUE,
    note                TEXT,
    date_modification   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code, date_effet)
);

-- D) Formule de l'impot sur le revenu (controle du bareme et repli hors table), versionnee ----------------------------
CREATE TABLE IF NOT EXISTS paie_ir_formule (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    date_effet          DATE NOT NULL,
    formule_json        JSONB NOT NULL,
    note                TEXT,
    date_modification   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, date_effet)
);

-- E) Baremes importes par l'entreprise (en plus des baremes officiels fournis) -----------------------------------------
CREATE TABLE IF NOT EXISTS paie_bareme (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    type                TEXT NOT NULL CHECK (type IN ('IR_MENSUEL', 'TRIMF_ANNUEL')),
    annee               INTEGER NOT NULL CHECK (annee BETWEEN 2000 AND 2100),
    libelle             TEXT,
    source              TEXT,
    nb_lignes           INTEGER NOT NULL DEFAULT 0,
    lignes_json         JSONB NOT NULL,
    date_import         TIMESTAMPTZ NOT NULL DEFAULT now(),
    importe_par         UUID,
    UNIQUE (tenant_id, type, annee)
);

-- F) Conventions collectives, categories (grille de salaires datee), anciennete, majorations des heures supplementaires ---
CREATE TABLE IF NOT EXISTS paie_convention (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code                TEXT NOT NULL,
    libelle             TEXT NOT NULL,
    anciennete_json     JSONB NOT NULL DEFAULT '[]',   -- [{annees, taux}] taux en % du salaire de base categoriel
    majorations_json    JSONB NOT NULL DEFAULT '[]',   -- [{code, libelle, taux}] heures supplementaires
    notes               TEXT,
    ordre               INTEGER NOT NULL DEFAULT 0,
    actif               BOOLEAN NOT NULL DEFAULT TRUE,
    date_modification   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS paie_categorie (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    convention_id       UUID NOT NULL REFERENCES paie_convention(id) ON DELETE CASCADE,
    code                TEXT NOT NULL,
    libelle             TEXT NOT NULL,
    classification      TEXT NOT NULL DEFAULT 'EMPLOYE' CHECK (classification IN ('OUVRIER', 'EMPLOYE', 'AGENT_MAITRISE', 'CADRE')),
    salaire_base        NUMERIC(14,0) NOT NULL CHECK (salaire_base >= 0),
    date_effet          DATE NOT NULL,
    ordre               INTEGER NOT NULL DEFAULT 0,
    date_modification   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (convention_id, code, date_effet)
);
CREATE INDEX IF NOT EXISTS idx_paie_categorie_conv ON paie_categorie (convention_id, code, date_effet);

-- G) Rubriques de paie (primes, indemnites, retenues, remboursements) -------------------------------------------------
CREATE TABLE IF NOT EXISTS paie_rubrique (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code                TEXT NOT NULL,
    libelle             TEXT NOT NULL,
    sens                TEXT NOT NULL DEFAULT 'GAIN' CHECK (sens IN ('GAIN', 'RETENUE', 'REMBOURSEMENT')),
    mode                TEXT NOT NULL DEFAULT 'VARIABLE' CHECK (mode IN ('FIXE', 'VARIABLE', 'QUANTITE')),
    section             TEXT NOT NULL DEFAULT 'INDEMNITES' CHECK (section IN ('SALAIRE', 'INDEMNITES')),
    imposable           BOOLEAN NOT NULL DEFAULT TRUE,
    soumis_cotisations  BOOLEAN NOT NULL DEFAULT TRUE,
    exoneration_plafond NUMERIC(14,0),
    proratisable        BOOLEAN NOT NULL DEFAULT FALSE,
    montant_defaut      NUMERIC(14,0),
    compte_cle          TEXT,                         -- cle de paie_compte_param utilisee pour l'ecriture comptable
    ordre               INTEGER NOT NULL DEFAULT 0,
    systeme             BOOLEAN NOT NULL DEFAULT FALSE,
    actif               BOOLEAN NOT NULL DEFAULT TRUE,
    date_modification   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS paie_type_absence (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code                TEXT NOT NULL,
    libelle             TEXT NOT NULL,
    taux_maintien       NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (taux_maintien BETWEEN 0 AND 100),
    ordre               INTEGER NOT NULL DEFAULT 0,
    systeme             BOOLEAN NOT NULL DEFAULT FALSE,
    actif               BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (tenant_id, code)
);

-- H) Comptes comptables de la paie (ecritures OD apres cloture) -------------------------------------------------------
CREATE TABLE IF NOT EXISTS paie_compte_param (
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    cle                 TEXT NOT NULL,
    compte              TEXT NOT NULL,
    date_modification   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, cle)
);

-- I) Dossier de paie du salarie et elements fixes mensuels ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS paie_dossier (
    employe_id          UUID PRIMARY KEY REFERENCES employe(id) ON DELETE CASCADE,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    convention_id       UUID REFERENCES paie_convention(id) ON DELETE SET NULL,
    categorie_code      TEXT,
    salaire_base_manuel NUMERIC(14,0),                 -- remplace la grille (contrat particulier)
    sursalaire          NUMERIC(14,0) NOT NULL DEFAULT 0,
    regime_rc           BOOLEAN,                       -- NULL = selon la classification de la categorie
    date_anciennete     DATE,                          -- NULL = date d'embauche
    actif_paie          BOOLEAN NOT NULL DEFAULT TRUE,
    notes               TEXT,
    date_modification   TIMESTAMPTZ NOT NULL DEFAULT now(),
    modifie_par         UUID
);
CREATE INDEX IF NOT EXISTS idx_paie_dossier_tenant ON paie_dossier (tenant_id);

CREATE TABLE IF NOT EXISTS paie_element_fixe (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    employe_id          UUID NOT NULL REFERENCES employe(id) ON DELETE CASCADE,
    rubrique_code       TEXT NOT NULL,
    montant             NUMERIC(14,0),
    quantite            NUMERIC(10,2),
    date_debut          DATE NOT NULL DEFAULT CURRENT_DATE,
    date_fin            DATE,
    note                TEXT,
    date_creation       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_paie_element_fixe_emp ON paie_element_fixe (tenant_id, employe_id);

-- J) Droits : "paie" (saisie des variables, consultation) et "paie-validation" (generer, valider, cloturer, parametrer) --
UPDATE role
SET perimetre_json = jsonb_set(COALESCE(perimetre_json, '{}'::jsonb), '{modules}',
      COALESCE(perimetre_json->'modules', '[]'::jsonb) || '["paie"]'::jsonb)
WHERE COALESCE(perimetre_json->'modules', '[]'::jsonb) ? 'rh'
  AND NOT COALESCE(perimetre_json->'modules', '[]'::jsonb) ? 'paie';

UPDATE role
SET perimetre_json = jsonb_set(COALESCE(perimetre_json, '{}'::jsonb), '{modules}',
      COALESCE(perimetre_json->'modules', '[]'::jsonb) || '["paie-validation"]'::jsonb)
WHERE code = 'FINANCIER'
  AND NOT COALESCE(perimetre_json->'modules', '[]'::jsonb) ? 'paie-validation';
