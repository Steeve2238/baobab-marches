-- Import Excel de reprise (lot 7) : historique des imports de produits / stock d'ouverture, clients et fournisseurs.
CREATE TABLE IF NOT EXISTS import_donnees_lot (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    type            TEXT NOT NULL CHECK (type IN ('PRODUITS', 'CLIENTS', 'FOURNISSEURS')),
    nom_fichier     TEXT,
    empreinte       TEXT NOT NULL,
    stats_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
    cree_par        UUID REFERENCES utilisateur(id),
    date_creation   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_import_donnees_lot_tenant ON import_donnees_lot(tenant_id, date_creation DESC);
