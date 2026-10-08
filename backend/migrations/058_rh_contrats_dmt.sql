-- RH lot 2 : modeles de contrats de travail, contrats et declarations de mouvement du travailleur (DMT).
-- Le contrat est redige a partir d'un modele (par defaut dans le code, personnalisable par client), puis FIGE
-- lors de la validation (signature de l'employeur) : une modification ulterieure du modele ou de la fiche
-- ne change jamais un contrat valide.

-- Modeles personnalises par client (a defaut, le modele par defaut de la plateforme s'applique).
CREATE TABLE IF NOT EXISTS rh_modele_contrat (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    type                TEXT NOT NULL CHECK (type IN ('CDI', 'CDD', 'JOURNALIER')),
    articles_json       JSONB NOT NULL,
    date_modification   TIMESTAMPTZ NOT NULL DEFAULT now(),
    modifie_par         UUID,
    UNIQUE (tenant_id, type)
);

-- Numerotation annuelle par client : CT-AAAA-NNNN (contrats), DMT-AAAA-NNNN.
CREATE TABLE IF NOT EXISTS rh_numerotation (
    tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    annee       INTEGER NOT NULL,
    dernier     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, type, annee)
);

CREATE TABLE IF NOT EXISTS rh_contrat (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    employe_id                  UUID NOT NULL REFERENCES employe(id) ON DELETE CASCADE,
    numero                      TEXT NOT NULL,
    type                        TEXT NOT NULL CHECK (type IN ('CDI', 'CDD', 'JOURNALIER')),
    statut                      TEXT NOT NULL DEFAULT 'BROUILLON' CHECK (statut IN
        ('BROUILLON', 'SIGNE_EMPLOYEUR', 'ENVOYE_SALARIE', 'SIGNE_SALARIE', 'TRANSMIS_INSPECTION', 'VISE', 'ANNULE')),
    date_contrat                DATE NOT NULL DEFAULT CURRENT_DATE,
    lieu_signature              TEXT,
    date_effet                  DATE NOT NULL,
    date_fin                    DATE,
    periode_essai_mois          INTEGER CHECK (periode_essai_mois IS NULL OR periode_essai_mois >= 0),
    heures_hebdo                NUMERIC(4,1) NOT NULL DEFAULT 40,
    poste                       TEXT,
    lieu_emploi                 TEXT,
    convention                  TEXT,
    categorie                   TEXT,
    motif                       TEXT,                                  -- CDD : motif / chantier
    elements_json               JSONB NOT NULL DEFAULT '[]',           -- lignes de remuneration [{libelle, montant, essai}]
    contenu_json                JSONB,                                 -- contrat fige a la validation
    empreinte                   TEXT,                                  -- SHA-256 du contenu fige
    notes                       TEXT,
    -- Circuit de signature (suite au lot RH-3)
    date_signature_employeur    TIMESTAMPTZ,
    signe_employeur_par         UUID,
    date_envoi_salarie          TIMESTAMPTZ,
    date_signature_salarie      TIMESTAMPTZ,
    signature_salarie_json      JSONB,                                 -- date/heure, IP, empreinte, code de confirmation
    date_transmission_inspection DATE,
    date_visa                   DATE,
    numero_visa                 TEXT,
    signe_nom_fichier           TEXT,
    signe_type_mime             TEXT,
    signe_base64                TEXT,
    cree_par                    UUID,
    date_creation               TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_modification           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_rh_contrat_employe ON rh_contrat (tenant_id, employe_id, date_creation DESC);

CREATE TABLE IF NOT EXISTS rh_dmt (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    employe_id          UUID NOT NULL REFERENCES employe(id) ON DELETE CASCADE,
    contrat_id          UUID REFERENCES rh_contrat(id) ON DELETE SET NULL,
    numero              TEXT NOT NULL,
    date_dmt            DATE NOT NULL DEFAULT CURRENT_DATE,
    objet               TEXT NOT NULL CHECK (objet IN ('EMBAUCHE', 'LICENCIEMENT_ECONOMIQUE', 'EXPIRATION_CONTRAT', 'DEMISSION',
        'MUTATION', 'CHANGEMENT_CATEGORIE', 'MODIFICATION_CONTRAT', 'CHANGEMENT_SITUATION_FAMILLE', 'CHANGEMENT_RESIDENCE',
        'CHANGEMENT_EMPLOI', 'DECES')),
    statut              TEXT NOT NULL DEFAULT 'BROUILLON' CHECK (statut IN ('BROUILLON', 'SIGNEE', 'DEPOSEE', 'VISEE', 'ANNULEE')),
    donnees_json        JSONB NOT NULL,                                -- toutes les rubriques du formulaire (preremplies puis modifiables)
    date_depot          DATE,
    numero_visa         TEXT,
    date_visa           DATE,
    visa_section_locale TEXT,
    signe_nom_fichier   TEXT,
    signe_type_mime     TEXT,
    signe_base64        TEXT,
    notes               TEXT,
    cree_par            UUID,
    date_creation       TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_modification   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_rh_dmt_employe ON rh_dmt (tenant_id, employe_id, date_creation DESC);
