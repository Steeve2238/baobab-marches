-- Module Fiscalite, lot 4 : retenues a la source (prestataires personnes physiques art. 200, loyers art. 201,
-- non-residents art. 202, revenus de capitaux mobiliers art. 173 / 203). Calcul et etats seulement : aucune ecriture comptable
-- n'est generee et les reglements fournisseurs ne sont pas modifies.
-- Sans effet tant que le Super Admin n'a pas active le module Fiscalite (migration 049).

CREATE TABLE IF NOT EXISTS fiscalite_retenue (
    id                      UUID PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    type                    TEXT NOT NULL CHECK (type IN ('PRESTATION_PP', 'LOYER', 'NON_RESIDENT', 'IRVM_DIVIDENDES', 'IRVM_CREANCES', 'IRVM_OBLIGATIONS', 'IRVM_OBLIGATIONS_LONGUES')),
    date_operation          DATE NOT NULL,
    beneficiaire_nom        TEXT NOT NULL,
    beneficiaire_ninea      TEXT,
    beneficiaire_adresse    TEXT,
    beneficiaire_profession TEXT,
    beneficiaire_piece      TEXT,
    beneficiaire_statut     TEXT NOT NULL DEFAULT 'PP_SANS_REEL' CHECK (beneficiaire_statut IN ('PP_SANS_REEL', 'PP_REEL', 'SOCIETE_IS', 'NON_RESIDENT', 'AUTRE')),
    reference               TEXT,
    libelle                 TEXT,
    montant_brut            NUMERIC(18,0) NOT NULL CHECK (montant_brut >= 0),
    montant_facture         NUMERIC(18,0) CHECK (montant_facture IS NULL OR montant_facture >= 0),
    loyer_mensuel           NUMERIC(18,0) CHECK (loyer_mensuel IS NULL OR loyer_mensuel >= 0),
    taux_applique           NUMERIC(6,2) CHECK (taux_applique IS NULL OR (taux_applique >= 0 AND taux_applique <= 100)),
    retenue_effectuee       NUMERIC(18,0) CHECK (retenue_effectuee IS NULL OR retenue_effectuee >= 0),
    statut                  TEXT NOT NULL DEFAULT 'CONFIRMEE' CHECK (statut IN ('PROPOSEE', 'CONFIRMEE', 'EXCLUE')),
    motif_exclusion         TEXT,
    source                  TEXT NOT NULL DEFAULT 'MANUEL' CHECK (source IN ('PLATEFORME', 'MANUEL', 'IMPORT', 'CCA')),
    source_ref              TEXT,
    cree_par                UUID,
    date_creation           TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_modification       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fisc_retenue_periode ON fiscalite_retenue (tenant_id, date_operation);
-- Une proposition issue de la plateforme (reglement + facture) ou du CCA ne peut etre enregistree qu'une fois.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fisc_retenue_source ON fiscalite_retenue (tenant_id, source, source_ref) WHERE source_ref IS NOT NULL;

-- Declaration mensuelle des retenues : preparation, depot, paiement (meme logique que TVA / IS).
CREATE TABLE IF NOT EXISTS fiscalite_retenue_periode (
    tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    annee             INTEGER NOT NULL CHECK (annee BETWEEN 2000 AND 2100),
    mois              INTEGER NOT NULL CHECK (mois BETWEEN 1 AND 12),
    statut            TEXT NOT NULL DEFAULT 'BROUILLON' CHECK (statut IN ('BROUILLON', 'PREPAREE', 'DEPOSEE', 'PAYEE')),
    calcul_json       JSONB,
    montant_du        NUMERIC(18,0),
    date_depot        DATE,
    reference_depot   TEXT,
    date_paiement     DATE,
    prepare_par       UUID,
    date_preparation  TIMESTAMPTZ,
    date_modification TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, annee, mois)
);
