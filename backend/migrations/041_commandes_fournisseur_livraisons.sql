-- ============================================================================
-- Commandes fournisseur, reception rattachee et livraison de dossier d'AO
-- (05/10/2026) - Lot 5.
-- Decisions de Steeve : la commande fournisseur est OBLIGATOIRE avant toute
-- reception ; la marchandise livree sur un dossier d'appel d'offres sort du
-- stock. Une commande est rattachee a un dossier (AO ou consultation) ou, a
-- defaut, au stock general ; la reception reprend ses lignes, prix et
-- conditions et permet de comparer estime / engage / reel par dossier.
-- ============================================================================

CREATE TABLE IF NOT EXISTS commande_fournisseur (
    id                      UUID PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    numero                  TEXT NOT NULL,                   -- CMD-AAAA-0001
    fournisseur_id          UUID NOT NULL REFERENCES fournisseur(id),
    dossier_ao_id           UUID REFERENCES dossier_ao(id) ON DELETE SET NULL,
    consultation_id         UUID REFERENCES consultation(id) ON DELETE SET NULL,
    dossier_calcul_id       UUID REFERENCES dossier_calcul(id) ON DELETE SET NULL,
    devise                  TEXT NOT NULL DEFAULT 'XOF',
    cours_devise            NUMERIC(14,6) NOT NULL DEFAULT 1 CHECK (cours_devise > 0),
    incoterm                TEXT,
    transitaire_id          UUID REFERENCES transitaire(id) ON DELETE SET NULL,
    cotation_id             UUID REFERENCES transitaire_cotation(id) ON DELETE SET NULL,
    date_commande           DATE NOT NULL DEFAULT CURRENT_DATE,
    date_livraison_prevue   DATE,
    statut                  TEXT NOT NULL DEFAULT 'BROUILLON' CHECK (statut IN ('BROUILLON', 'CONFIRMEE', 'ANNULEE')),
    notes                   TEXT,
    cree_par                UUID REFERENCES utilisateur(id),
    date_creation           TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_confirmation       TIMESTAMPTZ,
    UNIQUE (tenant_id, numero),
    CONSTRAINT commande_un_seul_dossier CHECK ((dossier_ao_id IS NOT NULL)::int + (consultation_id IS NOT NULL)::int <= 1)
);
CREATE INDEX IF NOT EXISTS idx_commande_tenant ON commande_fournisseur (tenant_id, date_commande DESC);
CREATE INDEX IF NOT EXISTS idx_commande_fournisseur ON commande_fournisseur (tenant_id, fournisseur_id);
CREATE INDEX IF NOT EXISTS idx_commande_dossier_ao ON commande_fournisseur (dossier_ao_id);
CREATE INDEX IF NOT EXISTS idx_commande_consultation ON commande_fournisseur (consultation_id);

CREATE TABLE IF NOT EXISTS commande_fournisseur_ligne (
    id                      UUID PRIMARY KEY,
    commande_id             UUID NOT NULL REFERENCES commande_fournisseur(id) ON DELETE CASCADE,
    ordre                   INTEGER NOT NULL DEFAULT 0,
    reference_fournisseur   TEXT,
    designation             TEXT NOT NULL,
    unite                   TEXT NOT NULL DEFAULT 'U',
    quantite                NUMERIC(18,3) NOT NULL CHECK (quantite > 0),
    prix_unitaire_devise    NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (prix_unitaire_devise >= 0),
    produit_id              UUID REFERENCES produit(id) ON DELETE SET NULL,
    calcul_offre_id         UUID REFERENCES calcul_offre(id) ON DELETE SET NULL    -- offre retenue d'origine
);
CREATE INDEX IF NOT EXISTS idx_commande_ligne_commande ON commande_fournisseur_ligne (commande_id, ordre);

-- Reception : rattachee a UNE commande (obligatoire pour toute nouvelle reception,
-- controle cote API ; les receptions anterieures restent sans commande).
ALTER TABLE reception_marchandise ADD COLUMN IF NOT EXISTS commande_id UUID REFERENCES commande_fournisseur(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_reception_commande ON reception_marchandise (commande_id);
ALTER TABLE reception_ligne ADD COLUMN IF NOT EXISTS commande_ligne_id UUID REFERENCES commande_fournisseur_ligne(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_reception_ligne_commande ON reception_ligne (commande_ligne_id);

-- Livraison d'un dossier d'appel d'offres : fait sortir du stock la marchandise
-- livree au maitre d'ouvrage (les consultations restreintes passent, elles, par
-- devis -> facture -> bon de livraison, qui sortent deja du stock).
CREATE TABLE IF NOT EXISTS livraison_dossier (
    id                      UUID PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    numero                  TEXT NOT NULL,                   -- LIV-AAAA-0001
    dossier_ao_id           UUID NOT NULL REFERENCES dossier_ao(id),
    date_livraison          DATE NOT NULL DEFAULT CURRENT_DATE,
    statut                  TEXT NOT NULL DEFAULT 'BROUILLON' CHECK (statut IN ('BROUILLON', 'LIVREE', 'ANNULEE')),
    notes                   TEXT,
    cree_par                UUID REFERENCES utilisateur(id),
    date_creation           TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_validation         TIMESTAMPTZ,
    UNIQUE (tenant_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_livraison_dossier_tenant ON livraison_dossier (tenant_id, date_livraison DESC);
CREATE INDEX IF NOT EXISTS idx_livraison_dossier_ao ON livraison_dossier (dossier_ao_id);

CREATE TABLE IF NOT EXISTS livraison_dossier_ligne (
    id                      UUID PRIMARY KEY,
    livraison_id            UUID NOT NULL REFERENCES livraison_dossier(id) ON DELETE CASCADE,
    ordre                   INTEGER NOT NULL DEFAULT 0,
    produit_id              UUID NOT NULL REFERENCES produit(id),
    designation             TEXT NOT NULL,
    reference               TEXT,
    unite                   TEXT NOT NULL DEFAULT 'U',
    quantite                NUMERIC(18,3) NOT NULL CHECK (quantite > 0),
    cout_unitaire_xof       NUMERIC(18,2)                    -- fige a la validation (dernier cout de l'article)
);
CREATE INDEX IF NOT EXISTS idx_livraison_ligne ON livraison_dossier_ligne (livraison_id, ordre);
