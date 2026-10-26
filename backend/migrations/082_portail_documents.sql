-- Portail de remise tracee des documents commerciaux (offres, contrats) : lien unique + code d'acces, signature electronique du client,
-- journal date de chaque action (envoi, ouverture, consultation, telechargement, signature).
-- Le jeton et le code ne sont jamais stockes en clair (empreinte SHA-256 uniquement).

CREATE TABLE IF NOT EXISTS portail_partage (
    id                    UUID PRIMARY KEY,
    type_document         TEXT NOT NULL CHECK (type_document IN ('OFFRE', 'CONTRAT')),
    document_id           UUID NOT NULL,
    tenant_id             UUID REFERENCES tenant(id) ON DELETE CASCADE,
    numero_document       TEXT NOT NULL,
    token_hash            TEXT NOT NULL UNIQUE,
    code_hash             TEXT NOT NULL,
    destinataire_nom      TEXT,
    destinataire_email    TEXT,
    destinataire_tel      TEXT,
    statut                TEXT NOT NULL DEFAULT 'ACTIF' CHECK (statut IN ('ACTIF', 'SIGNE', 'REVOQUE')),
    expire_le             TIMESTAMPTZ NOT NULL,
    tentatives_echec      INTEGER NOT NULL DEFAULT 0,
    bloque_jusqua         TIMESTAMPTZ,
    snapshot_json         JSONB NOT NULL,          -- document et parametres de l'editeur figes au moment de l'envoi : le client signe exactement ce texte
    empreinte_document    TEXT NOT NULL,
    date_envoi_email      TIMESTAMPTZ,
    envoye_a              TEXT,
    premiere_ouverture    TIMESTAMPTZ,
    dernier_acces         TIMESTAMPTZ,
    date_consultation     TIMESTAMPTZ,
    date_telechargement   TIMESTAMPTZ,
    date_signature        TIMESTAMPTZ,
    cree_par              UUID,
    date_creation         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portail_partage_doc ON portail_partage (type_document, document_id, date_creation DESC);
CREATE INDEX IF NOT EXISTS idx_portail_partage_tenant ON portail_partage (tenant_id, date_creation DESC);

CREATE TABLE IF NOT EXISTS portail_evenement (
    id              UUID PRIMARY KEY,
    partage_id      UUID NOT NULL REFERENCES portail_partage(id) ON DELETE CASCADE,
    evenement       TEXT NOT NULL,
    ip              TEXT,
    user_agent      TEXT,
    details         JSONB,
    date_evenement  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portail_evenement_partage ON portail_evenement (partage_id, date_evenement);

CREATE TABLE IF NOT EXISTS portail_signature (
    id                    UUID PRIMARY KEY,
    partage_id            UUID NOT NULL UNIQUE REFERENCES portail_partage(id) ON DELETE CASCADE,
    nom_signataire        TEXT NOT NULL,
    qualite_signataire    TEXT,
    mode                  TEXT NOT NULL DEFAULT 'DESSINEE' CHECK (mode IN ('DESSINEE', 'IMPORTEE')),
    image_base64          TEXT NOT NULL,
    image_mime            TEXT NOT NULL DEFAULT 'image/png',
    identifiant_masque    TEXT,
    ip                    TEXT,
    user_agent            TEXT,
    date_signature        TIMESTAMPTZ NOT NULL DEFAULT now(),
    empreinte_document    TEXT NOT NULL,
    empreinte_signature   TEXT NOT NULL
);
