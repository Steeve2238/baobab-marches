-- RH lot 4 : courriers RH (attestations, lettres disciplinaires, solde de tout compte...) et ordres de virement.

CREATE TABLE IF NOT EXISTS rh_modele_courrier (
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    type                TEXT NOT NULL,
    objet               TEXT NOT NULL,
    paragraphes_json    JSONB NOT NULL,
    date_modification   TIMESTAMPTZ NOT NULL DEFAULT now(),
    modifie_par         UUID,
    PRIMARY KEY (tenant_id, type)
);

CREATE TABLE IF NOT EXISTS rh_courrier (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    employe_id          UUID NOT NULL REFERENCES employe(id) ON DELETE CASCADE,
    numero              TEXT NOT NULL,
    type                TEXT NOT NULL,
    statut              TEXT NOT NULL DEFAULT 'BROUILLON' CHECK (statut IN ('BROUILLON', 'EMIS', 'ANNULE')),
    date_courrier       DATE NOT NULL DEFAULT CURRENT_DATE,
    lieu                TEXT,
    champs_json         JSONB NOT NULL DEFAULT '{}',          -- champs propres au type (faits, dates, motif...)
    lignes_json         JSONB NOT NULL DEFAULT '[]',          -- lignes de montant (solde de tout compte, attestation de salaire)
    contenu_json        JSONB,                                -- texte fige a l'emission
    empreinte           TEXT,
    date_emission       TIMESTAMPTZ,
    emis_par            UUID,
    -- Remise au salarie
    visible_employe     BOOLEAN NOT NULL DEFAULT FALSE,       -- publie dans l'espace employe
    date_publication    TIMESTAMPTZ,
    date_lecture        TIMESTAMPTZ,
    date_accuse         TIMESTAMPTZ,
    ip_accuse           TEXT,
    mode_remise         TEXT CHECK (mode_remise IS NULL OR mode_remise IN ('MAIN_PROPRE', 'ESPACE_EMPLOYE', 'EMAIL', 'COURRIER_RECOMMANDE', 'AUTRE')),
    date_remise         DATE,
    -- Reponse du salarie (demande d'explication)
    reponse_texte       TEXT,
    date_reponse        TIMESTAMPTZ,
    notes               TEXT,
    cree_par            UUID,
    date_creation       TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_modification   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_rh_courrier_employe ON rh_courrier (tenant_id, employe_id, date_creation DESC);

CREATE TABLE IF NOT EXISTS rh_ordre_virement (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    numero              TEXT NOT NULL,
    libelle             TEXT NOT NULL,
    type_paiement       TEXT NOT NULL DEFAULT 'SALAIRE' CHECK (type_paiement IN ('SALAIRE', 'SOLDE_TOUT_COMPTE', 'AUTRE')),
    periode             TEXT,                                  -- AAAA-MM (salaires)
    date_execution      DATE NOT NULL,                         -- jour souhaite pour le paiement
    banque_donneur      TEXT,
    compte_donneur      TEXT,
    statut              TEXT NOT NULL DEFAULT 'BROUILLON' CHECK (statut IN ('BROUILLON', 'VALIDE', 'EXECUTE', 'ANNULE')),
    lignes_json         JSONB NOT NULL DEFAULT '[]',           -- [{employe_id, nom, matricule, banque, numero_compte, montant, motif}]
    total               NUMERIC(16,0) NOT NULL DEFAULT 0,
    source              TEXT NOT NULL DEFAULT 'MANUEL',        -- MANUEL, puis PAIE quand le module Paie alimentera les montants
    date_validation     TIMESTAMPTZ,
    date_execution_reelle DATE,
    notes               TEXT,
    cree_par            UUID,
    date_creation       TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_modification   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, numero)
);
