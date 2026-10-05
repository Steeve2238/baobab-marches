-- Comptabilite, phase 3A (05/10/2026) : factures fournisseurs, reglements
-- fournisseurs et tresorerie (banques / caisses).
--
-- * compta_parametre : comptes par defaut de la TVA recuperable (4452) et
--   des achats (6011).
-- * facture_fournisseur / facture_fournisseur_ligne : saisie directe de la
--   facture recue ; elle genere UNE ecriture EN_INSTANCE au journal des achats
--   (Dr 6xx + Dr 4452 / Cr 401 fournisseur).
-- * reglement_fournisseur / reglement_fournisseur_imputation : paiement d'une
--   ou plusieurs factures (Dr 401 / Cr banque ou caisse) ; le reliquat non
--   impute est porte au compte d'avance fournisseur (4091).

ALTER TABLE compta_parametre
    ADD COLUMN IF NOT EXISTS compte_tva_recuperable TEXT NOT NULL DEFAULT '44520000',
    ADD COLUMN IF NOT EXISTS compte_achat_defaut    TEXT NOT NULL DEFAULT '60110000';

UPDATE compta_parametre
SET compte_tva_recuperable = rpad('4452', longueur_compte, '0'),
    compte_achat_defaut    = rpad('6011', longueur_compte, '0');

CREATE TABLE IF NOT EXISTS facture_fournisseur (
    id                      UUID PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    numero                  TEXT NOT NULL,                       -- numero interne continu (ex AF-2026-0001)
    tiers_id                UUID NOT NULL REFERENCES tiers_comptable(id),
    reference_fournisseur   TEXT NOT NULL,                       -- numero porte par la facture recue
    date_facture            DATE NOT NULL,
    date_echeance           DATE NOT NULL,
    libelle                 TEXT,
    montant_ht              NUMERIC(18,2) NOT NULL CHECK (montant_ht >= 0),
    montant_tva             NUMERIC(18,2) NOT NULL CHECK (montant_tva >= 0),
    montant_ttc             NUMERIC(18,2) NOT NULL CHECK (montant_ttc > 0),
    montant_regle           NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (montant_regle >= 0),
    statut                  TEXT NOT NULL DEFAULT 'ENREGISTREE' CHECK (statut IN ('ENREGISTREE', 'ANNULEE')),
    cree_par                UUID REFERENCES utilisateur(id),
    date_creation           TIMESTAMPTZ NOT NULL DEFAULT now(),
    annule_par              UUID REFERENCES utilisateur(id),
    date_annulation         TIMESTAMPTZ,
    UNIQUE (tenant_id, numero)
);
-- Une meme facture fournisseur ne se saisit qu'une fois (hors annulees)
CREATE UNIQUE INDEX IF NOT EXISTS uq_facture_fournisseur_reference
    ON facture_fournisseur (tenant_id, tiers_id, lower(reference_fournisseur))
    WHERE statut = 'ENREGISTREE';
CREATE INDEX IF NOT EXISTS idx_facture_fournisseur_tiers ON facture_fournisseur (tenant_id, tiers_id, date_facture DESC);

CREATE TABLE IF NOT EXISTS facture_fournisseur_ligne (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    facture_id      UUID NOT NULL REFERENCES facture_fournisseur(id) ON DELETE CASCADE,
    ordre           INTEGER NOT NULL DEFAULT 0,
    libelle         TEXT NOT NULL,
    compte_id       UUID NOT NULL REFERENCES compte_comptable(id),
    montant_ht      NUMERIC(18,2) NOT NULL CHECK (montant_ht > 0),
    taux_tva        NUMERIC(5,2) NOT NULL DEFAULT 18 CHECK (taux_tva >= 0 AND taux_tva <= 100),
    montant_tva     NUMERIC(18,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ff_ligne_facture ON facture_fournisseur_ligne (facture_id, ordre);

CREATE TABLE IF NOT EXISTS reglement_fournisseur (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    numero              TEXT NOT NULL,                           -- ex RF-2026-0001
    tiers_id            UUID NOT NULL REFERENCES tiers_comptable(id),
    journal_id          UUID NOT NULL REFERENCES journal_comptable(id),   -- banque ou caisse
    date_reglement      DATE NOT NULL,
    montant             NUMERIC(18,2) NOT NULL CHECK (montant > 0),
    mode_paiement       TEXT,
    reference           TEXT,                                    -- n° de cheque / de virement
    libelle             TEXT,
    statut              TEXT NOT NULL DEFAULT 'ENREGISTRE' CHECK (statut IN ('ENREGISTRE', 'ANNULE')),
    cree_par            UUID REFERENCES utilisateur(id),
    date_creation       TIMESTAMPTZ NOT NULL DEFAULT now(),
    annule_par          UUID REFERENCES utilisateur(id),
    date_annulation     TIMESTAMPTZ,
    UNIQUE (tenant_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_reglement_fournisseur_tiers ON reglement_fournisseur (tenant_id, tiers_id, date_reglement DESC);

CREATE TABLE IF NOT EXISTS reglement_fournisseur_imputation (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    reglement_id    UUID NOT NULL REFERENCES reglement_fournisseur(id) ON DELETE CASCADE,
    facture_id      UUID NOT NULL REFERENCES facture_fournisseur(id),
    montant         NUMERIC(18,2) NOT NULL CHECK (montant > 0),
    UNIQUE (reglement_id, facture_id)
);
CREATE INDEX IF NOT EXISTS idx_imputation_facture ON reglement_fournisseur_imputation (facture_id);
