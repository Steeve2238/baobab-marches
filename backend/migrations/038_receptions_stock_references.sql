-- ============================================================================
-- Receptions de marchandises, stock et references internes (05/10/2026).
-- Demande de Steeve : la porte d'entree d'un article est la facture du
-- fournisseur (Excel ou saisie) : code fournisseur, designation, quantite, prix
-- unitaire, montant. La validation d'une reception cree/alimente les articles
-- (table produit, migration 037) et leur stock. Chaque article porte NOTRE
-- reference interne : c'est elle (et jamais celle du fournisseur) qui figure
-- sur les devis, factures et bons de livraison. La correspondance
-- reference fournisseur <-> article est conservee ici.
--
-- Independant du module Comptabilite (payant) : lien facultatif vers
-- facture_fournisseur (table de la comptabilite) sans contrainte de module.
-- ============================================================================

CREATE TABLE IF NOT EXISTS reception_marchandise (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    numero                      TEXT NOT NULL,                   -- REC-AAAA-0001
    fournisseur_id              UUID NOT NULL REFERENCES fournisseur(id),
    reference_facture           TEXT,                            -- numero de la facture du fournisseur
    date_facture                DATE,
    date_reception              DATE NOT NULL DEFAULT CURRENT_DATE,
    devise                      TEXT NOT NULL DEFAULT 'XOF',
    cours_devise                NUMERIC(14,6) NOT NULL DEFAULT 1 CHECK (cours_devise > 0),
    incoterm                    TEXT,                            -- EXW, FOB, CIF, DAP, DDP... (couts d'approche : lot suivant)
    statut                      TEXT NOT NULL DEFAULT 'BROUILLON'
                                CHECK (statut IN ('BROUILLON', 'VALIDEE', 'ANNULEE')),
    notes                       TEXT,
    facture_fournisseur_id      UUID REFERENCES facture_fournisseur(id) ON DELETE SET NULL,
    cree_par                    UUID REFERENCES utilisateur(id),
    date_creation               TIMESTAMPTZ NOT NULL DEFAULT now(),
    valide_par                  UUID REFERENCES utilisateur(id),
    date_validation             TIMESTAMPTZ,
    UNIQUE (tenant_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_reception_tenant ON reception_marchandise (tenant_id, date_reception DESC);
CREATE INDEX IF NOT EXISTS idx_reception_fournisseur ON reception_marchandise (tenant_id, fournisseur_id);

CREATE TABLE IF NOT EXISTS reception_ligne (
    id                          UUID PRIMARY KEY,
    reception_id                UUID NOT NULL REFERENCES reception_marchandise(id) ON DELETE CASCADE,
    ordre                       INTEGER NOT NULL DEFAULT 0,
    reference_fournisseur       TEXT,
    designation                 TEXT NOT NULL,
    unite                       TEXT NOT NULL DEFAULT 'U',
    quantite                    NUMERIC(18,3) NOT NULL CHECK (quantite > 0),
    prix_unitaire_devise        NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (prix_unitaire_devise >= 0),
    produit_id                  UUID REFERENCES produit(id) ON DELETE SET NULL,  -- article choisi / cree a la validation
    reference_interne           TEXT                                              -- reference souhaitee pour un nouvel article
);
CREATE INDEX IF NOT EXISTS idx_reception_ligne_reception ON reception_ligne (reception_id, ordre);
CREATE INDEX IF NOT EXISTS idx_reception_ligne_produit ON reception_ligne (produit_id);

-- Correspondance reference du fournisseur -> notre article.
CREATE TABLE IF NOT EXISTS produit_reference_fournisseur (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    produit_id                  UUID NOT NULL REFERENCES produit(id) ON DELETE CASCADE,
    fournisseur_id              UUID NOT NULL REFERENCES fournisseur(id) ON DELETE CASCADE,
    reference_fournisseur       TEXT NOT NULL,
    designation_fournisseur     TEXT,
    date_creation               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_produit_ref_fournisseur
    ON produit_reference_fournisseur (tenant_id, fournisseur_id, lower(reference_fournisseur));
CREATE INDEX IF NOT EXISTS idx_produit_ref_fournisseur_produit ON produit_reference_fournisseur (produit_id);

-- Journal des mouvements de stock : le stock d'un article est la somme de ses
-- mouvements (jamais stocke ailleurs). quantite signee : + entree, - sortie.
CREATE TABLE IF NOT EXISTS mouvement_stock (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    produit_id                  UUID NOT NULL REFERENCES produit(id) ON DELETE CASCADE,
    type_mouvement              TEXT NOT NULL
                                CHECK (type_mouvement IN ('ENTREE', 'SORTIE', 'AJUSTEMENT', 'ANNULATION')),
    quantite                    NUMERIC(18,3) NOT NULL CHECK (quantite <> 0),
    cout_unitaire_xof           NUMERIC(18,2),
    date_mouvement              DATE NOT NULL DEFAULT CURRENT_DATE,
    origine_type                TEXT,                              -- RECEPTION | BL | MANUEL
    origine_id                  UUID,
    libelle                     TEXT,
    cree_par                    UUID REFERENCES utilisateur(id),
    date_creation               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mouvement_stock_produit ON mouvement_stock (tenant_id, produit_id, date_mouvement);
CREATE INDEX IF NOT EXISTS idx_mouvement_stock_origine ON mouvement_stock (origine_type, origine_id);

-- Reference interne et lien article portes par les lignes des documents de
-- vente (copiees de ligne en ligne : devis -> facture -> bon de livraison).
ALTER TABLE devis_ligne ADD COLUMN IF NOT EXISTS reference TEXT;
ALTER TABLE facture_vente_ligne ADD COLUMN IF NOT EXISTS reference TEXT;
ALTER TABLE facture_vente_ligne ADD COLUMN IF NOT EXISTS produit_id UUID REFERENCES produit(id) ON DELETE SET NULL;
ALTER TABLE bon_livraison_ligne ADD COLUMN IF NOT EXISTS reference TEXT;
ALTER TABLE bon_livraison_ligne ADD COLUMN IF NOT EXISTS produit_id UUID REFERENCES produit(id) ON DELETE SET NULL;
