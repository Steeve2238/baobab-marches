-- Module Fiscalite, lot 3 : impot sur les societes (IS) et impot minimum forfaitaire (IMF).
--
-- * fiscalite_is_dossier  : un dossier par exercice (annee de cloture) : saisies de l'utilisateur
--                           (retraitements, parametres, credits d'impot...), puis instantane du calcul fige a la
--                           preparation, statut PREPAREE -> DEPOSEE -> PAYEE.
-- * fiscalite_is_deficit  : deficits ordinaires (report sur 3 exercices) et amortissements reputes differes
--                           (report illimite), art. 16 du CGI. Les imputations sont portees par les dossiers deposes.
-- * fiscalite_is_paiement : acomptes, solde et autres versements d'IS / d'IMF, rattaches a l'exercice qu'ils soldent.
-- Sans effet tant que le Super Admin n'a pas active le module (migration 049).

CREATE TABLE IF NOT EXISTS fiscalite_is_dossier (
    tenant_id          UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    annee              INTEGER NOT NULL CHECK (annee BETWEEN 2000 AND 2100),
    exercice_id        UUID REFERENCES exercice_comptable(id) ON DELETE SET NULL,
    statut             TEXT NOT NULL DEFAULT 'BROUILLON' CHECK (statut IN ('BROUILLON', 'PREPAREE', 'DEPOSEE', 'PAYEE')),
    saisies_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
    calcul_json        JSONB,
    impot_du           NUMERIC(18,0),
    solde_a_payer      NUMERIC(18,0),
    date_depot         DATE,
    reference_depot    TEXT,
    date_paiement      DATE,
    prepare_par        UUID REFERENCES utilisateur(id),
    date_preparation   TIMESTAMPTZ,
    date_creation      TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_modification  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, annee)
);

CREATE TABLE IF NOT EXISTS fiscalite_is_deficit (
    id               UUID PRIMARY KEY,
    tenant_id        UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    annee_origine    INTEGER NOT NULL CHECK (annee_origine BETWEEN 2000 AND 2100),
    type             TEXT NOT NULL CHECK (type IN ('ORDINAIRE', 'AMORTISSEMENT_DIFFERE')),
    montant_initial  NUMERIC(18,0) NOT NULL CHECK (montant_initial >= 0),
    source           TEXT NOT NULL DEFAULT 'MANUEL' CHECK (source IN ('MANUEL', 'DECLARATION')),
    note             TEXT,
    date_creation    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, annee_origine, type)
);

CREATE TABLE IF NOT EXISTS fiscalite_is_paiement (
    id               UUID PRIMARY KEY,
    tenant_id        UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    annee_exercice   INTEGER NOT NULL CHECK (annee_exercice BETWEEN 2000 AND 2100),
    nature           TEXT NOT NULL CHECK (nature IN ('ACOMPTE_1', 'ACOMPTE_2', 'SOLDE', 'AUTRE')),
    montant          NUMERIC(18,0) NOT NULL CHECK (montant >= 0),
    date_paiement    DATE NOT NULL,
    reference        TEXT,
    note             TEXT,
    cree_par         UUID REFERENCES utilisateur(id),
    date_creation    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fisc_is_paiement ON fiscalite_is_paiement (tenant_id, annee_exercice);
