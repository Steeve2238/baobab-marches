-- Comptabilite, phase 3B (05/10/2026) : encaissements clients partiels
-- imputes sur les factures de vente, et lettrage.
--
-- * facture_vente.montant_encaisse : part deja encaissee par les reglements
--   clients saisis dans la comptabilite. La facture passe "PAYEE" quand le
--   montant encaisse atteint le net a payer ("Marquer payee" dans Ventes reste
--   possible : il encaisse alors le reste).
-- * reglement_client / reglement_client_imputation : encaissement (Dr banque ou
--   caisse / Cr 411 client, reliquat au compte d'avance client 4191).
-- * Index de recherche des lignes lettrees (le champ ligne_ecriture.lettrage
--   existe depuis la migration 028).

ALTER TABLE facture_vente
    ADD COLUMN IF NOT EXISTS montant_encaisse NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (montant_encaisse >= 0);

CREATE TABLE IF NOT EXISTS reglement_client (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    numero              TEXT NOT NULL,                           -- ex RC-2026-0001
    tiers_id            UUID NOT NULL REFERENCES tiers_comptable(id),
    journal_id          UUID NOT NULL REFERENCES journal_comptable(id),   -- banque ou caisse
    date_reglement      DATE NOT NULL,
    montant             NUMERIC(18,2) NOT NULL CHECK (montant > 0),
    mode_paiement       TEXT,
    reference           TEXT,
    libelle             TEXT,
    statut              TEXT NOT NULL DEFAULT 'ENREGISTRE' CHECK (statut IN ('ENREGISTRE', 'ANNULE')),
    cree_par            UUID REFERENCES utilisateur(id),
    date_creation       TIMESTAMPTZ NOT NULL DEFAULT now(),
    annule_par          UUID REFERENCES utilisateur(id),
    date_annulation     TIMESTAMPTZ,
    UNIQUE (tenant_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_reglement_client_tiers ON reglement_client (tenant_id, tiers_id, date_reglement DESC);

CREATE TABLE IF NOT EXISTS reglement_client_imputation (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    reglement_id    UUID NOT NULL REFERENCES reglement_client(id) ON DELETE CASCADE,
    facture_id      UUID NOT NULL REFERENCES facture_vente(id),
    montant         NUMERIC(18,2) NOT NULL CHECK (montant > 0),
    UNIQUE (reglement_id, facture_id)
);
CREATE INDEX IF NOT EXISTS idx_imputation_client_facture ON reglement_client_imputation (facture_id);

CREATE INDEX IF NOT EXISTS idx_ligne_lettrage ON ligne_ecriture (tenant_id, lettrage) WHERE lettrage IS NOT NULL;
