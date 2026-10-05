-- ============================================================================
-- Transitaires : cotations, lien avec les receptions et les couts d'approche
-- (05/10/2026) - Lot 4.
-- Demande de Steeve : tout doit converger vers une seule base. Le transitaire
-- n'est plus un nom isole : ses cotations (offres de transport et de transit)
-- sont enregistrees par trajet et par incoterm, une reception peut en retenir
-- une, et chaque cout d'approche pointe vers le transitaire qui l'a facture.
-- La performance (delais, retards, ecart cotation/reel) est calculee a la
-- lecture a partir des receptions validees et de l'historique des dossiers AO.
-- ============================================================================

ALTER TABLE transitaire ADD COLUMN IF NOT EXISTS email     TEXT;
ALTER TABLE transitaire ADD COLUMN IF NOT EXISTS telephone TEXT;
ALTER TABLE transitaire ADD COLUMN IF NOT EXISTS notes     TEXT;
ALTER TABLE transitaire ADD COLUMN IF NOT EXISTS actif     BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS transitaire_cotation (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    transitaire_id      UUID NOT NULL REFERENCES transitaire(id) ON DELETE CASCADE,
    reference           TEXT,                              -- numero ou intitule de l'offre du transitaire
    origine             TEXT,                              -- ex. Shanghai
    destination         TEXT,                              -- ex. Dakar
    mode_transport      TEXT NOT NULL DEFAULT 'MER'
                        CHECK (mode_transport IN ('MER', 'AIR', 'ROUTE', 'MIXTE', 'AUTRE')),
    incoterm            TEXT,                              -- EXW, FOB, CIF, DAP, DDP...
    devise              TEXT NOT NULL DEFAULT 'XOF',
    cours_devise        NUMERIC(14,6) NOT NULL DEFAULT 1 CHECK (cours_devise > 0),
    date_cotation       DATE NOT NULL DEFAULT CURRENT_DATE,
    date_validite       DATE,
    delai_jours         INTEGER CHECK (delai_jours IS NULL OR delai_jours >= 0),
    statut              TEXT NOT NULL DEFAULT 'RECUE' CHECK (statut IN ('RECUE', 'RETENUE', 'REFUSEE')),
    notes               TEXT,
    date_creation       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cotation_tenant ON transitaire_cotation (tenant_id, date_cotation DESC);
CREATE INDEX IF NOT EXISTS idx_cotation_transitaire ON transitaire_cotation (transitaire_id);

CREATE TABLE IF NOT EXISTS transitaire_cotation_ligne (
    id                  UUID PRIMARY KEY,
    cotation_id         UUID NOT NULL REFERENCES transitaire_cotation(id) ON DELETE CASCADE,
    ordre               INTEGER NOT NULL DEFAULT 0,
    type_cout           TEXT NOT NULL
                        CHECK (type_cout IN ('FRET', 'ASSURANCE', 'DOUANE', 'TRANSIT', 'TRANSPORT_LOCAL', 'AUTRE')),
    libelle             TEXT,
    montant             NUMERIC(18,2) NOT NULL CHECK (montant >= 0),   -- dans la devise de la cotation
    repartition         TEXT NOT NULL DEFAULT 'VALEUR' CHECK (repartition IN ('VALEUR', 'QUANTITE', 'POIDS'))
);
CREATE INDEX IF NOT EXISTS idx_cotation_ligne ON transitaire_cotation_ligne (cotation_id, ordre);

-- Reception : transitaire principal, cotation retenue, dates de transport.
ALTER TABLE reception_marchandise ADD COLUMN IF NOT EXISTS transitaire_id       UUID REFERENCES transitaire(id) ON DELETE SET NULL;
ALTER TABLE reception_marchandise ADD COLUMN IF NOT EXISTS cotation_id          UUID REFERENCES transitaire_cotation(id) ON DELETE SET NULL;
ALTER TABLE reception_marchandise ADD COLUMN IF NOT EXISTS date_expedition      DATE;
ALTER TABLE reception_marchandise ADD COLUMN IF NOT EXISTS date_arrivee_prevue  DATE;
CREATE INDEX IF NOT EXISTS idx_reception_transitaire ON reception_marchandise (transitaire_id);

-- Cout d'approche : transitaire qui l'a facture, reference de sa facture et
-- montant cote (XOF) a l'origine, pour mesurer l'ecart cotation / reel.
ALTER TABLE reception_cout_approche ADD COLUMN IF NOT EXISTS transitaire_id      UUID REFERENCES transitaire(id) ON DELETE SET NULL;
ALTER TABLE reception_cout_approche ADD COLUMN IF NOT EXISTS facture_reference   TEXT;
ALTER TABLE reception_cout_approche ADD COLUMN IF NOT EXISTS montant_cote_xof    NUMERIC(18,2);
CREATE INDEX IF NOT EXISTS idx_reception_cout_transitaire ON reception_cout_approche (transitaire_id);
