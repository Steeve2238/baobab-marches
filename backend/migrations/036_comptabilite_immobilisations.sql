-- Comptabilite, phase 4 (05/10/2026) : immobilisations et amortissements.
--
-- * immobilisation : une fiche par bien. Creee depuis une ligne d'ecriture de
--   classe 2 ("A immobiliser") ou saisie en reprise (valeur d'origine et
--   amortissements cumules a la date de situation). Amortissement lineaire
--   calcule au prorata des jours (base 360 : mois de 30 jours) ; un bien non
--   amortissable (terrain, titres) n'a ni duree ni compte d'amortissement.
-- * immobilisation_dotation : dotation passee pour un bien et un exercice
--   (nature EXERCICE = dotation annuelle en lot, SORTIE = complement jusqu'a la
--   date de cession / mise au rebut). Garantit qu'une dotation n'est jamais
--   passee deux fois.
-- * immobilisation_ligne_ignoree : lignes de classe 2 que l'utilisateur ne veut
--   pas immobiliser (disparaissent de l'ecran "A immobiliser").

CREATE TABLE IF NOT EXISTS immobilisation (
    id                    UUID PRIMARY KEY,
    tenant_id             UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code                  TEXT NOT NULL,
    libelle               TEXT NOT NULL,
    compte_immo_id        UUID NOT NULL REFERENCES compte_comptable(id),
    compte_amort_id       UUID REFERENCES compte_comptable(id),
    compte_dotation_id    UUID REFERENCES compte_comptable(id),
    date_acquisition      DATE NOT NULL,
    date_mise_en_service  DATE NOT NULL,
    valeur_origine        NUMERIC(18,2) NOT NULL CHECK (valeur_origine > 0),
    valeur_residuelle     NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (valeur_residuelle >= 0),
    duree_mois            INTEGER CHECK (duree_mois IS NULL OR duree_mois > 0),
    amort_ouverture       NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (amort_ouverture >= 0),
    date_ouverture        DATE,
    ligne_ecriture_id     UUID REFERENCES ligne_ecriture(id) ON DELETE SET NULL,
    date_reprise          DATE,            -- reprise d'a-nouveaux : le bien est du "brut a l'ouverture", pas une acquisition de l'exercice
    statut                TEXT NOT NULL DEFAULT 'EN_SERVICE' CHECK (statut IN ('EN_SERVICE', 'SORTIE')),
    date_sortie           DATE,
    type_sortie           TEXT CHECK (type_sortie IS NULL OR type_sortie IN ('CESSION', 'REBUT')),
    produit_cession       NUMERIC(18,2),
    vnc_sortie            NUMERIC(18,2),
    ecriture_sortie_id    UUID REFERENCES ecriture_comptable(id) ON DELETE SET NULL,
    date_creation         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_immobilisation_ligne ON immobilisation (tenant_id, ligne_ecriture_id) WHERE ligne_ecriture_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_immobilisation_tenant ON immobilisation (tenant_id, statut);

CREATE TABLE IF NOT EXISTS immobilisation_dotation (
    id               UUID PRIMARY KEY,
    tenant_id        UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    immobilisation_id UUID NOT NULL REFERENCES immobilisation(id) ON DELETE CASCADE,
    exercice_id      UUID NOT NULL REFERENCES exercice_comptable(id),
    nature           TEXT NOT NULL DEFAULT 'EXERCICE' CHECK (nature IN ('EXERCICE', 'SORTIE')),
    montant          NUMERIC(18,2) NOT NULL CHECK (montant >= 0),
    ecriture_id      UUID REFERENCES ecriture_comptable(id) ON DELETE SET NULL,
    date_creation    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (immobilisation_id, exercice_id, nature)
);
CREATE INDEX IF NOT EXISTS idx_immo_dotation_exercice ON immobilisation_dotation (tenant_id, exercice_id);

CREATE TABLE IF NOT EXISTS immobilisation_ligne_ignoree (
    tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    ligne_ecriture_id UUID NOT NULL REFERENCES ligne_ecriture(id) ON DELETE CASCADE,
    date_creation     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, ligne_ecriture_id)
);
