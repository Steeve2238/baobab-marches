-- RH lot 1 : dossier employe complet (donnees reprises par la paie, les contrats et la DMT).
-- La fiche employe devient independante du compte utilisateur : utilisateur_id reste facultatif et unique.
-- Les fiches existantes sont conservees ; nom/prenom sont recopies depuis le compte lie.

ALTER TABLE employe
  -- Identite
  ADD COLUMN IF NOT EXISTS matricule TEXT,
  ADD COLUMN IF NOT EXISTS civilite TEXT CHECK (civilite IS NULL OR civilite IN ('M', 'MME', 'MLLE')),
  ADD COLUMN IF NOT EXISTS nom TEXT,
  ADD COLUMN IF NOT EXISTS prenom TEXT,
  ADD COLUMN IF NOT EXISTS nom_naissance TEXT,
  ADD COLUMN IF NOT EXISTS sexe TEXT CHECK (sexe IS NULL OR sexe IN ('M', 'F')),
  ADD COLUMN IF NOT EXISTS date_naissance DATE,
  ADD COLUMN IF NOT EXISTS lieu_naissance TEXT,
  ADD COLUMN IF NOT EXISTS pays_naissance TEXT,
  ADD COLUMN IF NOT EXISTS nationalite TEXT,
  ADD COLUMN IF NOT EXISTS nationalite_categorie TEXT CHECK (nationalite_categorie IS NULL OR nationalite_categorie IN ('S', 'A', 'F', 'L', 'E')),
  ADD COLUMN IF NOT EXISTS pere_nom TEXT,
  ADD COLUMN IF NOT EXISTS mere_nom TEXT,
  ADD COLUMN IF NOT EXISTS groupe_ethnique TEXT,
  -- Piece d'identite et numeros sociaux
  ADD COLUMN IF NOT EXISTS piece_type TEXT CHECK (piece_type IS NULL OR piece_type IN ('CNI', 'PASSEPORT', 'CARTE_SEJOUR', 'AUTRE')),
  ADD COLUMN IF NOT EXISTS piece_numero TEXT,
  ADD COLUMN IF NOT EXISTS piece_lieu TEXT,
  ADD COLUMN IF NOT EXISTS piece_date DATE,
  ADD COLUMN IF NOT EXISTS numero_css TEXT,
  ADD COLUMN IF NOT EXISTS numero_ipres TEXT,
  -- Coordonnees et residence
  ADD COLUMN IF NOT EXISTS adresse TEXT,
  ADD COLUMN IF NOT EXISTS ville TEXT,
  ADD COLUMN IF NOT EXISTS email_personnel TEXT,
  ADD COLUMN IF NOT EXISTS resident_senegal BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS date_entree_senegal DATE,
  ADD COLUMN IF NOT EXISTS statut_militaire TEXT,
  ADD COLUMN IF NOT EXISTS precedent_employeur TEXT,
  -- Situation de famille (parts IR / TRIMF : CGI art. 174-178)
  ADD COLUMN IF NOT EXISTS situation_familiale TEXT CHECK (situation_familiale IS NULL OR situation_familiale IN ('CELIBATAIRE', 'MARIE', 'DIVORCE', 'VEUF')),
  ADD COLUMN IF NOT EXISTS conjoint_nom TEXT,
  ADD COLUMN IF NOT EXISTS conjoint_prenom TEXT,
  ADD COLUMN IF NOT EXISTS conjoint_date_naissance DATE,
  ADD COLUMN IF NOT EXISTS conjoint_profession TEXT,
  ADD COLUMN IF NOT EXISTS conjoint_a_revenus BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS nombre_epouses INTEGER NOT NULL DEFAULT 0 CHECK (nombre_epouses >= 0),
  ADD COLUMN IF NOT EXISTS titulaire_invalidite_40 BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS enfant_decede BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS parts_ir_manuel NUMERIC(3,1) CHECK (parts_ir_manuel IS NULL OR (parts_ir_manuel >= 1 AND parts_ir_manuel <= 5)),
  ADD COLUMN IF NOT EXISTS parts_trimf_manuel NUMERIC(3,1) CHECK (parts_trimf_manuel IS NULL OR parts_trimf_manuel >= 0),
  -- Emploi
  ADD COLUMN IF NOT EXISTS qualification TEXT,
  ADD COLUMN IF NOT EXISTS service TEXT,
  ADD COLUMN IF NOT EXISTS lieu_travail TEXT,
  ADD COLUMN IF NOT EXISTS convention_collective TEXT,
  ADD COLUMN IF NOT EXISTS categorie TEXT,
  ADD COLUMN IF NOT EXISTS echelon TEXT,
  ADD COLUMN IF NOT EXISTS classification TEXT CHECK (classification IS NULL OR classification IN ('OUVRIER', 'EMPLOYE', 'AGENT_MAITRISE', 'CADRE')),
  ADD COLUMN IF NOT EXISTS periode_essai_mois INTEGER CHECK (periode_essai_mois IS NULL OR periode_essai_mois >= 0),
  ADD COLUMN IF NOT EXISTS heures_hebdo NUMERIC(4,1) NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS numero_declaration_embauche TEXT,
  ADD COLUMN IF NOT EXISTS date_declaration_embauche DATE,
  ADD COLUMN IF NOT EXISTS date_sortie DATE,
  ADD COLUMN IF NOT EXISTS motif_sortie TEXT,
  -- Paiement
  ADD COLUMN IF NOT EXISTS mode_paiement TEXT CHECK (mode_paiement IS NULL OR mode_paiement IN ('VIREMENT', 'ESPECES', 'CHEQUE', 'MOBILE_MONEY')),
  ADD COLUMN IF NOT EXISTS banque TEXT,
  ADD COLUMN IF NOT EXISTS numero_compte TEXT,
  ADD COLUMN IF NOT EXISTS mobile_money_numero TEXT;

-- Recopie du nom/prenom depuis le compte lie pour les fiches deja creees.
UPDATE employe e
SET nom = COALESCE(e.nom, u.nom), prenom = COALESCE(e.prenom, u.prenom)
FROM utilisateur u
WHERE u.id = e.utilisateur_id AND (e.nom IS NULL OR e.prenom IS NULL);

-- Un compte ne peut etre lie qu'a une seule fiche (si l'index n'existe pas deja).
CREATE UNIQUE INDEX IF NOT EXISTS employe_utilisateur_unique_idx ON employe (utilisateur_id) WHERE utilisateur_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS employe_matricule_unique_idx ON employe (tenant_id, matricule) WHERE matricule IS NOT NULL;

-- Enfants (base des parts IR/TRIMF ; situation appreciee au 1er janvier, art. 178).
CREATE TABLE IF NOT EXISTS employe_enfant (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    employe_id      UUID NOT NULL REFERENCES employe(id) ON DELETE CASCADE,
    nom             TEXT,
    prenom          TEXT NOT NULL,
    sexe            TEXT CHECK (sexe IS NULL OR sexe IN ('M', 'F')),
    date_naissance  DATE,
    etudiant        BOOLEAN NOT NULL DEFAULT FALSE,
    infirme         BOOLEAN NOT NULL DEFAULT FALSE,
    revenus_propres BOOLEAN NOT NULL DEFAULT FALSE,
    adopte          BOOLEAN NOT NULL DEFAULT FALSE,
    date_creation   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS employe_enfant_employe_idx ON employe_enfant (employe_id);

-- Historique des changements de situation (famille, emploi, remuneration de reference, paiement).
CREATE TABLE IF NOT EXISTS employe_historique (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    employe_id          UUID NOT NULL REFERENCES employe(id) ON DELETE CASCADE,
    champ               TEXT NOT NULL,
    ancienne_valeur     TEXT,
    nouvelle_valeur     TEXT,
    modifie_par         UUID REFERENCES utilisateur(id),
    date_modification   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS employe_historique_employe_idx ON employe_historique (employe_id, date_modification DESC);
