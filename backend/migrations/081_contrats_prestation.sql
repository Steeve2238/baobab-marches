-- Contrats de prestation (prestataires, consultants, freelances) : contrats de louage de services / d'entreprise passes par
-- l'entreprise avec un prestataire independant. Distinct des contrats de travail (RH) : pas de paie, pas de DMT, pas de Code du
-- travail. Le contrat est redige a partir d'un modele (dans le code), FIGE a la validation, puis le scan signe peut etre joint.
-- Numerotation annuelle CP-AAAA-NNNN via rh_numerotation (type PRESTATION).

CREATE TABLE IF NOT EXISTS contrat_prestation (
    id                      UUID PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    numero                  TEXT NOT NULL,
    statut                  TEXT NOT NULL DEFAULT 'BROUILLON' CHECK (statut IN ('BROUILLON', 'VALIDE', 'SIGNE', 'TERMINE', 'RESILIE', 'ANNULE')),
    fournisseur_id          UUID REFERENCES fournisseur(id) ON DELETE SET NULL,
    -- Prestataire
    forme                   TEXT NOT NULL DEFAULT 'PERSONNE_PHYSIQUE' CHECK (forme IN ('PERSONNE_PHYSIQUE', 'SOCIETE')),
    prestataire_nom         TEXT NOT NULL,
    prestataire_adresse     TEXT,
    prestataire_ninea       TEXT,
    prestataire_rccm        TEXT,
    prestataire_piece       TEXT,                                  -- piece d'identite (personne physique)
    prestataire_qualification TEXT,                                -- profession / specialite
    representant            TEXT,                                  -- societe : representant legal
    qualite_representant    TEXT,
    prestataire_telephone   TEXT,
    prestataire_email       TEXT,
    prestataire_paiement    TEXT,                                  -- coordonnees de paiement (RIB, mobile money)
    -- Mission
    objet                   TEXT NOT NULL,
    missions                TEXT,
    livrables               TEXT,
    lieu_execution          TEXT,
    date_contrat            DATE NOT NULL DEFAULT CURRENT_DATE,
    date_effet              DATE NOT NULL,
    date_fin                DATE,
    tacite_reconduction     BOOLEAN NOT NULL DEFAULT false,
    preavis_jours           INTEGER NOT NULL DEFAULT 30 CHECK (preavis_jours >= 0),
    sous_traitance_autorisee BOOLEAN NOT NULL DEFAULT false,
    propriete_livrables     TEXT NOT NULL DEFAULT 'ENTREPRISE' CHECK (propriete_livrables IN ('ENTREPRISE', 'PRESTATAIRE_LICENCE')),
    -- Honoraires
    mode_honoraires         TEXT NOT NULL DEFAULT 'FORFAIT' CHECK (mode_honoraires IN ('FORFAIT', 'TAUX_JOUR', 'TAUX_HORAIRE', 'MENSUEL')),
    montant                 NUMERIC(18,0) NOT NULL DEFAULT 0 CHECK (montant >= 0),   -- forfait total, taux unitaire ou mensualite
    quantite_estimee        NUMERIC(10,2) CHECK (quantite_estimee IS NULL OR quantite_estimee >= 0), -- jours / heures / mois prevus
    devise                  TEXT NOT NULL DEFAULT 'XOF',
    montants_ttc            BOOLEAN NOT NULL DEFAULT false,         -- honoraires exprimes toutes taxes comprises
    tva_applicable          BOOLEAN NOT NULL DEFAULT false,         -- le prestataire facture la TVA
    retenue_taux            NUMERIC(5,2) CHECK (retenue_taux IS NULL OR (retenue_taux >= 0 AND retenue_taux <= 100)),
    frais_remboursables     BOOLEAN NOT NULL DEFAULT false,
    delai_paiement_jours    INTEGER NOT NULL DEFAULT 30 CHECK (delai_paiement_jours >= 0),
    penalite_retard_pct     NUMERIC(5,2) CHECK (penalite_retard_pct IS NULL OR (penalite_retard_pct >= 0 AND penalite_retard_pct <= 100)),
    echeancier_json         JSONB NOT NULL DEFAULT '[]',           -- [{libelle, date, montant}]
    clauses_particulieres   TEXT,
    juridiction             TEXT,
    lieu_signature          TEXT,
    notes                   TEXT,
    -- Cycle de vie
    contenu_json            JSONB,                                 -- contrat fige a la validation
    empreinte               TEXT,
    date_validation         TIMESTAMPTZ,
    valide_par              UUID,
    date_signature          DATE,
    signe_nom_fichier       TEXT,
    signe_type_mime         TEXT,
    signe_base64            TEXT,
    date_fin_reelle         DATE,
    motif_fin               TEXT,
    cree_par                UUID,
    date_creation           TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_modification       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_contrat_prestation_liste ON contrat_prestation (tenant_id, statut, date_creation DESC);
CREATE INDEX IF NOT EXISTS idx_contrat_prestation_fin ON contrat_prestation (tenant_id, date_fin) WHERE date_fin IS NOT NULL;
