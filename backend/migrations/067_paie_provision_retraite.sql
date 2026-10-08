-- PAIE-3D : provision pour indemnites de depart a la retraite a une date d'arrete.
-- Saisies par salarie (brut 12 mois, nombre de mois, indemnite calculee par le client) et lignes libres (salaries hors paie).
CREATE TABLE IF NOT EXISTS paie_provision_retraite_ligne (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    date_arrete         DATE NOT NULL,
    employe_id          UUID REFERENCES employe(id) ON DELETE CASCADE,   -- NULL = ligne libre
    matricule           TEXT,
    nom                 TEXT,
    date_entree         DATE,
    brut_12m            NUMERIC(16,0),
    nb_mois             NUMERIC(5,2),
    indemnite_client    NUMERIC(16,0),
    note                TEXT,
    modifie_par         UUID,
    date_modification   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_paie_provision_employe ON paie_provision_retraite_ligne (tenant_id, date_arrete, employe_id) WHERE employe_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_paie_provision_arrete ON paie_provision_retraite_ligne (tenant_id, date_arrete);
