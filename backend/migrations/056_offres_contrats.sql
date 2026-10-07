-- Super Admin : offres commerciales (devis), contrats clients et informations de l'editeur necessaires aux PDF.
-- Parcours : offre (PDF, envoi par e-mail) -> acceptation -> contrat prepare (PDF deja signe cote editeur) -> envoi ->
-- contrat signe par le client, depose et range dans la plateforme.

-- Informations de l'editeur (table singleton plateforme_parametres, deja porteuse de l'en-tete, du logo et de la signature/cachet).
ALTER TABLE plateforme_parametres
  ADD COLUMN IF NOT EXISTS forme_juridique TEXT,
  ADD COLUMN IF NOT EXISTS capital_social TEXT,
  ADD COLUMN IF NOT EXISTS representant_nom TEXT,
  ADD COLUMN IF NOT EXISTS representant_fonction TEXT,
  ADD COLUMN IF NOT EXISTS ville_signature TEXT NOT NULL DEFAULT 'Dakar',
  ADD COLUMN IF NOT EXISTS tribunal_competent TEXT NOT NULL DEFAULT 'Tribunal de Commerce Hors Classe de Dakar',
  ADD COLUMN IF NOT EXISTS penalite_pi_mois INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS mention_propriete_intellectuelle TEXT;

-- Numerotation annuelle OFF-AAAA-NNN / CTR-AAAA-NNN.
CREATE TABLE IF NOT EXISTS numerotation_commerciale (
    type    TEXT NOT NULL,
    annee   INTEGER NOT NULL,
    dernier INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (type, annee)
);

CREATE TABLE IF NOT EXISTS offre_commerciale (
    id                      UUID PRIMARY KEY,
    numero                  TEXT NOT NULL UNIQUE,
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    statut                  TEXT NOT NULL DEFAULT 'BROUILLON' CHECK (statut IN ('BROUILLON', 'ENVOYEE', 'ACCEPTEE', 'REFUSEE', 'ANNULEE')),
    mode_hebergement        TEXT NOT NULL DEFAULT 'HEBERGE' CHECK (mode_hebergement IN ('HEBERGE', 'LOCAL')),
    formule_abonnement_id   UUID REFERENCES formule_abonnement(id),
    formule_nom             TEXT,
    plafond_utilisateurs    INTEGER,
    modules                 TEXT[] NOT NULL DEFAULT '{}',
    duree_mois              INTEGER NOT NULL DEFAULT 12 CHECK (duree_mois BETWEEN 1 AND 120),
    lignes_json             JSONB NOT NULL DEFAULT '[]',
    remise_pct              NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (remise_pct >= 0 AND remise_pct <= 100),
    tva_pct                 NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tva_pct >= 0 AND tva_pct <= 100),
    total_ht_xof            NUMERIC(14,0) NOT NULL DEFAULT 0,
    total_tva_xof           NUMERIC(14,0) NOT NULL DEFAULT 0,
    total_ttc_xof           NUMERIC(14,0) NOT NULL DEFAULT 0,
    date_offre              DATE NOT NULL DEFAULT CURRENT_DATE,
    validite_jours          INTEGER NOT NULL DEFAULT 30 CHECK (validite_jours BETWEEN 1 AND 365),
    conditions_paiement     TEXT,
    notes                   TEXT,
    client_forme_juridique  TEXT,
    client_adresse          TEXT,
    client_ninea            TEXT,
    client_rccm             TEXT,
    representant_nom        TEXT,
    representant_fonction   TEXT,
    destinataire_email      TEXT,
    date_envoi              TIMESTAMPTZ,
    envoye_a                TEXT,
    date_acceptation        DATE,
    note_acceptation        TEXT,
    motif_refus             TEXT,
    cree_par                UUID,
    date_creation           TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_modification       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_offre_tenant ON offre_commerciale (tenant_id, date_creation DESC);

CREATE TABLE IF NOT EXISTS contrat_client (
    id                   UUID PRIMARY KEY,
    numero               TEXT NOT NULL UNIQUE,
    tenant_id            UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    offre_id             UUID NOT NULL UNIQUE REFERENCES offre_commerciale(id) ON DELETE CASCADE,
    statut               TEXT NOT NULL DEFAULT 'PREPARE' CHECK (statut IN ('PREPARE', 'ENVOYE', 'SIGNE', 'RESILIE')),
    variante             TEXT NOT NULL CHECK (variante IN ('HEBERGE', 'LOCAL')),
    date_contrat         DATE NOT NULL DEFAULT CURRENT_DATE,
    date_effet           DATE NOT NULL DEFAULT CURRENT_DATE,
    duree_mois           INTEGER NOT NULL,
    date_fin             DATE NOT NULL,
    contenu_json         JSONB NOT NULL,           -- contrat fige (parties, articles, annexe) : un changement ulterieur du modele ne modifie pas un contrat emis
    avertissements_json  JSONB NOT NULL DEFAULT '[]',
    date_envoi           TIMESTAMPTZ,
    envoye_a             TEXT,
    date_signature_client DATE,
    signe_nom_fichier    TEXT,
    signe_type_mime      TEXT,
    signe_base64         TEXT,
    date_depot_signe     TIMESTAMPTZ,
    notes                TEXT,
    date_creation        TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_modification    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contrat_tenant ON contrat_client (tenant_id, date_creation DESC);
