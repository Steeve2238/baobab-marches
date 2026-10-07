-- Module Fiscalite, lot 5 : contribution economique locale (CEL), taxe speciale sur les voitures particulieres des
-- personnes morales (art. 550 a 554 du CGI), dossiers annuels (preparation / depot / paiement).
-- Sans effet tant que le Super Admin n'a pas active le module Fiscalite (migration 049).

-- Locaux professionnels soumis a la contribution sur la valeur locative (art. 329 a 334).
CREATE TABLE IF NOT EXISTS fiscalite_cel_local (
    id                       UUID PRIMARY KEY,
    tenant_id                UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    libelle                  TEXT NOT NULL,
    commune                  TEXT,
    nature                   TEXT NOT NULL DEFAULT 'LOUE' CHECK (nature IN ('LOUE', 'ACTIF', 'GRATUIT', 'DISPOSITION')),
    loyer_annuel             NUMERIC(18,0) NOT NULL DEFAULT 0 CHECK (loyer_annuel >= 0),
    prix_revient             NUMERIC(18,0) NOT NULL DEFAULT 0 CHECK (prix_revient >= 0),
    valeur_locative_reelle   NUMERIC(18,0) NOT NULL DEFAULT 0 CHECK (valeur_locative_reelle >= 0),
    regime                   TEXT NOT NULL DEFAULT 'NORMAL' CHECK (regime IN ('NORMAL', 'HOTEL', 'SPI')),
    part_professionnelle_pct NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK (part_professionnelle_pct BETWEEN 0 AND 100),
    donne_en_location        BOOLEAN NOT NULL DEFAULT FALSE,
    exonere                  BOOLEAN NOT NULL DEFAULT FALSE,
    motif_exoneration        TEXT,
    date_debut               DATE,
    date_fin                 DATE,
    note                     TEXT,
    actif                    BOOLEAN NOT NULL DEFAULT TRUE,
    date_creation            TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_modification        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fisc_cel_local_tenant ON fiscalite_cel_local (tenant_id);

-- Vehicules a prendre en compte pour la taxe speciale (voitures particulieres des personnes morales).
-- parc_vehicule_id : lien facultatif avec le module Parc auto (vehicule) ; la puissance fiscale et la categorie
-- sont portees ici car le Parc auto ne les enregistre pas.
CREATE TABLE IF NOT EXISTS fiscalite_vehicule (
    id                 UUID PRIMARY KEY,
    tenant_id          UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    parc_vehicule_id   UUID REFERENCES vehicule(id) ON DELETE SET NULL,
    immatriculation    TEXT NOT NULL,
    marque_modele      TEXT,
    puissance_cv       INTEGER CHECK (puissance_cv IS NULL OR puissance_cv BETWEEN 1 AND 99),
    categorie          TEXT NOT NULL DEFAULT 'VP' CHECK (categorie IN ('VP', 'AUTRE')),
    mode_detention     TEXT NOT NULL DEFAULT 'PROPRIETE' CHECK (mode_detention IN ('PROPRIETE', 'LOCATION', 'AUTRE')),
    date_debut         DATE,
    date_fin           DATE,
    exoneration        TEXT CHECK (exoneration IS NULL OR exoneration IN ('NEGOCIANT', 'TRANSPORT_PUBLIC', 'AUTO_ECOLE', 'COMPETITION', 'LOCATION_SANS_CHAUFFEUR')),
    note               TEXT,
    actif              BOOLEAN NOT NULL DEFAULT TRUE,
    date_creation      TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_modification  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fisc_vehicule_tenant ON fiscalite_vehicule (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fisc_vehicule_parc ON fiscalite_vehicule (tenant_id, parc_vehicule_id) WHERE parc_vehicule_id IS NOT NULL AND actif;

-- Dossier annuel : un par (type, annee) - preparation, depot, paiement, comme le dossier IS.
CREATE TABLE IF NOT EXISTS fiscalite_dossier_annuel (
    tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    type              TEXT NOT NULL CHECK (type IN ('CEL', 'VEHICULES')),
    annee             INTEGER NOT NULL CHECK (annee BETWEEN 2000 AND 2100),
    statut            TEXT NOT NULL DEFAULT 'BROUILLON' CHECK (statut IN ('BROUILLON', 'PREPAREE', 'DEPOSEE', 'PAYEE')),
    saisies_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
    calcul_json       JSONB,
    montant_du        NUMERIC(18,0),
    date_depot        DATE,
    reference_depot   TEXT,
    date_paiement     DATE,
    prepare_par       UUID REFERENCES utilisateur(id),
    date_preparation  TIMESTAMPTZ,
    date_creation     TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_modification TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, type, annee)
);
