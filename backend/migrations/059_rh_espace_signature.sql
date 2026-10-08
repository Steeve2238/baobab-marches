-- RH lot 3 : espace employe, signature electronique enregistree, code de confirmation, circuit du contrat.

-- Signature enregistree par le salarie (dessinee ou importee) : une seule active par fiche.
CREATE TABLE IF NOT EXISTS rh_signature_employe (
    employe_id            UUID PRIMARY KEY REFERENCES employe(id) ON DELETE CASCADE,
    tenant_id             UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    image_base64          TEXT NOT NULL,
    type_mime             TEXT NOT NULL DEFAULT 'image/png',
    mode                  TEXT NOT NULL DEFAULT 'DESSINEE' CHECK (mode IN ('DESSINEE', 'IMPORTEE')),
    empreinte             TEXT NOT NULL,
    date_enregistrement   TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip                    TEXT,
    user_agent            TEXT
);

-- Codes de confirmation a usage unique envoyes par e-mail (enregistrement de signature, signature d'un contrat).
CREATE TABLE IF NOT EXISTS rh_code_confirmation (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    employe_id      UUID NOT NULL REFERENCES employe(id) ON DELETE CASCADE,
    objet           TEXT NOT NULL CHECK (objet IN ('SIGNATURE', 'CONTRAT')),
    reference_id    UUID,
    code_hash       TEXT NOT NULL,
    expire_le       TIMESTAMPTZ NOT NULL,
    tentatives      INTEGER NOT NULL DEFAULT 0,
    utilise         BOOLEAN NOT NULL DEFAULT FALSE,
    envoye_a        TEXT,
    date_creation   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rh_code_employe ON rh_code_confirmation (employe_id, objet, date_creation DESC);

-- Journal du circuit du contrat (qui, quand, depuis quelle adresse).
CREATE TABLE IF NOT EXISTS rh_contrat_evenement (
    id               UUID PRIMARY KEY,
    tenant_id        UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    contrat_id       UUID NOT NULL REFERENCES rh_contrat(id) ON DELETE CASCADE,
    evenement        TEXT NOT NULL,
    statut_apres     TEXT,
    utilisateur_id   UUID,
    ip               TEXT,
    details          JSONB,
    date_evenement   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rh_contrat_evt ON rh_contrat_evenement (contrat_id, date_evenement);

ALTER TABLE rh_contrat ADD COLUMN IF NOT EXISTS commentaire_inspection TEXT;
