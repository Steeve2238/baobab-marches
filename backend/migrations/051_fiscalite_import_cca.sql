-- Module Fiscalite, lot 3b : fiscalite utilisable SANS le module Comptabilite + interets de comptes courants d'associes.
--
-- * fiscalite_import_jeu     : un jeu de donnees importe (balance generale ou grand livre, exercice N ou N-1) pour une annee de cloture.
--                              Un seul jeu ACTIF par (annee, nature, role) : un nouvel import remplace le precedent (l'ancien reste archive).
-- * fiscalite_import_balance : lignes de la balance (soldes d'ouverture, mouvements, soldes cumules, en francs).
-- * fiscalite_import_ligne   : lignes du grand livre (date, journal, piece, compte, debit, credit) - sert au solde moyen des comptes courants.
-- * fiscalite_interets_report: fraction d'interets d'associes non deduite (art. 11-2 d, reportable 5 ans - art. 11-2 j).
-- Sans effet tant que le Super Admin n'a pas active le module Fiscalite (migration 049).

CREATE TABLE IF NOT EXISTS fiscalite_import_jeu (
    id               UUID PRIMARY KEY,
    tenant_id        UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    annee            INTEGER NOT NULL CHECK (annee BETWEEN 2000 AND 2100),
    nature           TEXT NOT NULL CHECK (nature IN ('BALANCE', 'GRAND_LIVRE')),
    role             TEXT NOT NULL DEFAULT 'EXERCICE' CHECK (role IN ('EXERCICE', 'PRECEDENT')),
    nom_fichier      TEXT,
    empreinte        TEXT,
    date_debut       DATE NOT NULL,
    date_fin         DATE NOT NULL,
    nb_lignes        INTEGER NOT NULL DEFAULT 0,
    total_debit      NUMERIC(20,2) NOT NULL DEFAULT 0,
    total_credit     NUMERIC(20,2) NOT NULL DEFAULT 0,
    avertissements   JSONB NOT NULL DEFAULT '[]'::jsonb,
    actif            BOOLEAN NOT NULL DEFAULT TRUE,
    cree_par         UUID REFERENCES utilisateur(id),
    date_creation    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fisc_import_actif ON fiscalite_import_jeu (tenant_id, annee, nature, role) WHERE actif;
CREATE INDEX IF NOT EXISTS idx_fisc_import_tenant ON fiscalite_import_jeu (tenant_id, annee);

CREATE TABLE IF NOT EXISTS fiscalite_import_balance (
    jeu_id       UUID NOT NULL REFERENCES fiscalite_import_jeu(id) ON DELETE CASCADE,
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    compte       TEXT NOT NULL,
    libelle      TEXT,
    an_net       NUMERIC(20,2) NOT NULL DEFAULT 0,   -- solde d'ouverture (debit - credit)
    mvt_debit    NUMERIC(20,2) NOT NULL DEFAULT 0,
    mvt_credit   NUMERIC(20,2) NOT NULL DEFAULT 0,
    solde_net    NUMERIC(20,2) NOT NULL DEFAULT 0,   -- solde cumule (debit - credit)
    PRIMARY KEY (jeu_id, compte)
);

CREATE TABLE IF NOT EXISTS fiscalite_import_ligne (
    id           BIGSERIAL PRIMARY KEY,
    jeu_id       UUID NOT NULL REFERENCES fiscalite_import_jeu(id) ON DELETE CASCADE,
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    compte       TEXT NOT NULL,
    date_ecriture DATE NOT NULL,
    journal      TEXT,
    piece        TEXT,
    libelle      TEXT,
    debit        NUMERIC(20,2) NOT NULL DEFAULT 0,
    credit       NUMERIC(20,2) NOT NULL DEFAULT 0,
    tiers        TEXT
);
CREATE INDEX IF NOT EXISTS idx_fisc_import_ligne ON fiscalite_import_ligne (jeu_id, compte, date_ecriture);

CREATE TABLE IF NOT EXISTS fiscalite_interets_report (
    id               UUID PRIMARY KEY,
    tenant_id        UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    annee_origine    INTEGER NOT NULL CHECK (annee_origine BETWEEN 2000 AND 2100),
    montant_initial  NUMERIC(18,0) NOT NULL CHECK (montant_initial >= 0),
    source           TEXT NOT NULL DEFAULT 'MANUEL' CHECK (source IN ('MANUEL', 'DECLARATION')),
    note             TEXT,
    date_creation    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, annee_origine)
);
