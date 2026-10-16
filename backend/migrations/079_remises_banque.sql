-- Remise de cheques en banque (Pack Commerce, lot 1b) : un bordereau regroupe des cheques encaisses (compte d'attente,
-- ex. 513) et les remet en banque (ecriture : debit banque / credit compte d'attente).
CREATE TABLE IF NOT EXISTS remise_banque (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    numero          TEXT NOT NULL,
    date_remise     DATE NOT NULL,
    journal_id      UUID NOT NULL REFERENCES journal_comptable(id),
    compte_banque   TEXT NOT NULL,
    montant         NUMERIC(18,2) NOT NULL CHECK (montant > 0),
    nb_cheques      INTEGER NOT NULL CHECK (nb_cheques > 0),
    reference       TEXT,
    statut          TEXT NOT NULL DEFAULT 'ENREGISTREE' CHECK (statut IN ('ENREGISTREE', 'ANNULEE')),
    ecriture_id     UUID REFERENCES ecriture_comptable(id) ON DELETE SET NULL,
    cree_par        UUID REFERENCES utilisateur(id),
    date_creation   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_remise_banque_tenant ON remise_banque(tenant_id, date_remise DESC);

CREATE TABLE IF NOT EXISTS remise_banque_ligne (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    remise_id           UUID NOT NULL REFERENCES remise_banque(id) ON DELETE CASCADE,
    ligne_ecriture_id   UUID NOT NULL REFERENCES ligne_ecriture(id) ON DELETE CASCADE,
    montant             NUMERIC(18,2) NOT NULL,
    UNIQUE (ligne_ecriture_id)
);
CREATE INDEX IF NOT EXISTS idx_remise_banque_ligne_remise ON remise_banque_ligne(remise_id);
