-- ============================================================================
-- Financement v2 (06/10/2026) : reconstruction complete du module bancaire.
--  - Banques : fiche complete (contact, agence, compte, devise...).
--  - Conditions : une proposition de banque pour UN type de facilite (affacturage,
--    escompte, credit de tresorerie, caution, lettre de credit...), avec toutes
--    les dates (proposition, effet, validite, fin), plafonds, avance, base de
--    jours, jours de valeur, taxe (TOB) et debiteurs agrees.
--  - Lignes de frais : chaque commission / interet / retenue est une ligne
--    parametrable (mode de calcul, base, minimum, maximum, moment de prelevement).
--  - Simulations : comparatif multi-banques fige, choix de la banque, lien dossier.
--  - Controles : comparaison du montant recu avec la simulation.
-- Les anciennes tables (grille tarifaire, lignes de credit, simulations par
-- dossier) sont remplacees : elles ne servaient qu'a un calcul simplifie.
-- ============================================================================

ALTER TABLE partenaire_financier ADD COLUMN IF NOT EXISTS sigle TEXT;
ALTER TABLE partenaire_financier ADD COLUMN IF NOT EXISTS agence TEXT;
ALTER TABLE partenaire_financier ADD COLUMN IF NOT EXISTS interlocuteur TEXT;
ALTER TABLE partenaire_financier ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE partenaire_financier ADD COLUMN IF NOT EXISTS telephone TEXT;
ALTER TABLE partenaire_financier ADD COLUMN IF NOT EXISTS adresse TEXT;
ALTER TABLE partenaire_financier ADD COLUMN IF NOT EXISTS numero_compte TEXT;
ALTER TABLE partenaire_financier ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE partenaire_financier ADD COLUMN IF NOT EXISTS actif BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE partenaire_financier ADD COLUMN IF NOT EXISTS date_creation TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TABLE IF EXISTS simulation_financement CASCADE;
DROP TABLE IF EXISTS ligne_credit_tarif CASCADE;
DROP TABLE IF EXISTS grille_tarifaire CASCADE;

CREATE TABLE IF NOT EXISTS financement_condition (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    partenaire_id               UUID NOT NULL REFERENCES partenaire_financier(id) ON DELETE CASCADE,
    type_facilite               TEXT NOT NULL,
    libelle                     TEXT NOT NULL,
    reference_proposition       TEXT,
    statut                      TEXT NOT NULL DEFAULT 'EN_NEGOCIATION',  -- EN_NEGOCIATION | ACTIVE | ARCHIVEE
    date_proposition            DATE,
    date_effet                  DATE,
    date_validite               DATE,
    date_fin                    DATE,
    plafond_montant             NUMERIC(18,2),
    montant_min                 NUMERIC(18,2),
    duree_min_jours             INTEGER,
    duree_max_jours             INTEGER,
    taux_avance_pct             NUMERIC(7,4) NOT NULL DEFAULT 100,
    retenue_incluse_avance      TEXT NOT NULL DEFAULT 'A_CONFIRMER',     -- INCLUSE | EN_PLUS | A_CONFIRMER
    base_creance                TEXT NOT NULL DEFAULT 'TTC',             -- TTC | HT
    base_jours                  INTEGER NOT NULL DEFAULT 360,            -- 360 | 365
    jours_valeur                INTEGER NOT NULL DEFAULT 0,
    duree_minimale_facturee     INTEGER,
    taxe_libelle                TEXT NOT NULL DEFAULT 'TOB',
    taxe_taux_pct               NUMERIC(7,4) NOT NULL DEFAULT 17,
    recours                     TEXT,                                    -- AVEC_RECOURS_NOTIFIE | AVEC_RECOURS_NON_NOTIFIE | SANS_RECOURS
    domiciliation_exigee        BOOLEAN NOT NULL DEFAULT false,
    restreindre_debiteurs       BOOLEAN NOT NULL DEFAULT false,
    debiteurs_agrees_json       JSONB NOT NULL DEFAULT '[]',
    justificatifs               TEXT,
    conditions_particulieres    TEXT,
    notes                       TEXT,
    cree_par                    UUID REFERENCES utilisateur(id),
    date_creation               TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_maj                    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_condition_tenant ON financement_condition(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fin_condition_partenaire ON financement_condition(partenaire_id);
CREATE INDEX IF NOT EXISTS idx_fin_condition_type ON financement_condition(tenant_id, type_facilite, statut);

CREATE TABLE IF NOT EXISTS financement_condition_frais (
    id                  UUID PRIMARY KEY,
    condition_id        UUID NOT NULL REFERENCES financement_condition(id) ON DELETE CASCADE,
    ordre               INTEGER NOT NULL DEFAULT 0,
    code                TEXT NOT NULL,
    libelle             TEXT NOT NULL,
    nature              TEXT NOT NULL DEFAULT 'COUT',                    -- COUT | RETENUE
    mode_calcul         TEXT NOT NULL DEFAULT 'POURCENT_FLAT',           -- POURCENT_FLAT | POURCENT_ANNUEL | POURCENT_PAR_PERIODE | FORFAIT | FORFAIT_PAR_PERIODE
    base                TEXT NOT NULL DEFAULT 'CREANCE',                 -- CREANCE | AVANCE
    taux_pct            NUMERIC(9,4),
    montant_fixe        NUMERIC(18,2),
    periode             TEXT,                                            -- MOIS | TRIMESTRE | SEMESTRE | AN
    periode_entamee     BOOLEAN NOT NULL DEFAULT true,
    minimum             NUMERIC(18,2),
    maximum             NUMERIC(18,2),
    prelevement         TEXT NOT NULL DEFAULT 'A_LA_MISE_EN_PLACE',      -- A_LA_MISE_EN_PLACE | A_L_ECHEANCE
    soumis_taxe         BOOLEAN NOT NULL DEFAULT true,
    actif               BOOLEAN NOT NULL DEFAULT true,
    observation         TEXT
);
CREATE INDEX IF NOT EXISTS idx_fin_frais_condition ON financement_condition_frais(condition_id);

CREATE TABLE IF NOT EXISTS financement_simulation (
    id                      UUID PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    libelle                 TEXT,
    type_facilite           TEXT NOT NULL,
    montant                 NUMERIC(18,2) NOT NULL,
    montant_ht              NUMERIC(18,2),
    date_prise              DATE,
    date_echeance           DATE,
    duree_jours             INTEGER NOT NULL,
    debiteur                TEXT,
    facture_vente_id        UUID REFERENCES facture_vente(id) ON DELETE SET NULL,
    dossier_ao_id           UUID REFERENCES dossier_ao(id) ON DELETE SET NULL,
    consultation_id         UUID REFERENCES consultation(id) ON DELETE SET NULL,
    resultats_json          JSONB NOT NULL DEFAULT '[]',
    commentaire_json        JSONB NOT NULL DEFAULT '{}',
    statut                  TEXT NOT NULL DEFAULT 'SIMULEE',             -- SIMULEE | RETENUE | CONTROLEE
    condition_retenue_id    UUID REFERENCES financement_condition(id) ON DELETE SET NULL,
    releve_retenu_json      JSONB,
    cout_retenu_xof         NUMERIC(18,2),
    date_retenue            TIMESTAMPTZ,
    cree_par                UUID REFERENCES utilisateur(id),
    date_creation           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_simulation_tenant ON financement_simulation(tenant_id, date_creation DESC);
CREATE INDEX IF NOT EXISTS idx_fin_simulation_dossier ON financement_simulation(dossier_ao_id);
CREATE INDEX IF NOT EXISTS idx_fin_simulation_consultation ON financement_simulation(consultation_id);

CREATE TABLE IF NOT EXISTS financement_controle (
    id                      UUID PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    simulation_id           UUID NOT NULL REFERENCES financement_simulation(id) ON DELETE CASCADE,
    condition_id            UUID REFERENCES financement_condition(id) ON DELETE SET NULL,
    partenaire_nom          TEXT,
    montant_recu            NUMERIC(18,2) NOT NULL,
    date_versement          DATE,
    date_prise_reelle       DATE,
    date_echeance_reelle    DATE,
    lignes_banque_json      JSONB NOT NULL DEFAULT '[]',
    resultat_json           JSONB NOT NULL DEFAULT '{}',
    notes                   TEXT,
    cree_par                UUID REFERENCES utilisateur(id),
    date_creation           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_controle_simulation ON financement_controle(simulation_id);
