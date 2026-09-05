-- ============================================================================
-- BAOBAB MARCHÉS — SCHEMA DE BASE DE DONNEES (PostgreSQL 15+)
-- Plateforme de pilotage financier et operationnel des appels d'offres (BTP inclus)
-- ============================================================================
-- Principes d'architecture (voir Cahier des Charges section 1.3, 1.4, 20.2, 21.3) :
--   1. MULTI-TENANT : toute table "privee" porte une colonne tenant_id (= client
--      de la plateforme). Les requetes applicatives DOIVENT filtrer par tenant_id
--      (Row Level Security recommande en prod - voir note en fin de fichier).
--   2. SOCLE COMMUN vs COUCHE PRIVEE (Module 16 - PPM) : les tables prefixees
--      ppm_shared_* n'ont PAS de tenant_id (donnee publique mutualisee) ; les
--      tables ppm_private_* ont un tenant_id (score, notes, decision go/no-go).
--      Ces tables sont creees tot dans ce script car referencees par le Module 1.
--   3. MOTEUR DE REGLES PARAMETRABLE (section 21.3) : les formules de calcul
--      (revision de prix, penalites, remboursement d'avance...) ne sont jamais
--      codees en dur. Elles vivent dans regle_formule / regle_parametre et sont
--      interpretees a l'execution. Table creee tot car referencee par plusieurs
--      modules (Incoterms, Execution chantier).
--   4. ANTICIPATION (Module 15) : toute nouvelle fonctionnalite doit alimenter
--      indicateur_valeur / signal_anticipation plutot que produire uniquement
--      un etat brut.
--   5. Les tables sont creees dans un ordre respectant les dependances de cles
--      etrangeres (une table referencee existe toujours avant la table qui la
--      reference) afin que ce script s'execute tel quel sans erreur.
-- ============================================================================


-- ============================================================================
-- 0. TENANTS, UTILISATEURS, ROLES (transverse a tous les modules)
-- ============================================================================

CREATE TABLE tenant (
    id                      UUID PRIMARY KEY,
    raison_sociale          TEXT NOT NULL,
    secteur_activite        TEXT,                      -- ex: BTP, import/export, industriel
    pays                    TEXT DEFAULT 'Senegal',
    date_creation           TIMESTAMPTZ NOT NULL DEFAULT now(),
    actif                   BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE utilisateur (
    id                      UUID PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    nom                     TEXT NOT NULL,
    prenom                  TEXT NOT NULL,
    email                   TEXT NOT NULL UNIQUE,
    mot_de_passe_hash       TEXT NOT NULL,
    mot_de_passe_temporaire BOOLEAN NOT NULL DEFAULT true,
    actif                   BOOLEAN NOT NULL DEFAULT true,
    date_creation           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Roles : librement definis par tenant (section 3 du CDC : pas de liste figee)
CREATE TABLE role (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code                TEXT NOT NULL,               -- ex: COMMERCIAL, FINANCIER, JURIDIQUE, TRANSIT, CONDUCTEUR_TRAVAUX, RH, DIRECTION, ADMIN
    libelle             TEXT NOT NULL,
    perimetre_json      JSONB NOT NULL DEFAULT '{}', -- droits fins (modules, actions)
    lecture_seule       BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (tenant_id, code)
);

-- Multi-roles utilisateur (comme OGAA : un utilisateur peut cumuler plusieurs roles)
CREATE TABLE utilisateur_role (
    utilisateur_id      UUID NOT NULL REFERENCES utilisateur(id) ON DELETE CASCADE,
    role_id             UUID NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    PRIMARY KEY (utilisateur_id, role_id)
);

-- ============================================================================
-- 0.1 MOTEUR DE REGLES PARAMETRABLE (transverse — section 21.3 du CDC)
--     Cree tot car referencee par le Module 3 (Incoterms) et le Module 10
--     (Execution chantier : revision de prix, penalites, remboursement avance).
-- ============================================================================

CREATE TABLE regle_formule (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code                TEXT NOT NULL,                    -- ex: REVISION_PRIX_ACT, PENALITE_RETARD, REMBOURSEMENT_AVANCE, INCOTERM_REPARTITION
    libelle             TEXT NOT NULL,
    expression          TEXT NOT NULL,                    -- expression parametree, ex: "A*(Xn-40)/(80-40)"
    description         TEXT
);

-- ============================================================================
-- 0.2 MODULE 16 (SOCLE COMMUN + COUCHE PRIVEE) — PPM
--     Creees tot car maitre_ouvrage (Module 1) et dossier_ao referencent ce
--     socle des l'origine d'un dossier (dossier issu ou non d'une opportunite PPM).
-- ============================================================================

-- --- SOCLE COMMUN (mutualise entre tous les clients de la plateforme, PAS de tenant_id) ---

CREATE TABLE ppm_shared_entite (
    id                  UUID PRIMARY KEY,
    nom                 TEXT NOT NULL,
    categorie           TEXT,                             -- Etat | Collectivite locale | Etablissement public | Societe nationale | Agence | Service deconcentre | Autre
    identifiant_source  TEXT,                              -- ex: idautorite du portail source
    source_portail      TEXT                               -- ex: "marchespublics.sn"
);

CREATE TABLE ppm_shared_publication (
    id                     UUID PRIMARY KEY,
    ppm_shared_entite_id   UUID NOT NULL REFERENCES ppm_shared_entite(id) ON DELETE CASCADE,
    annee_gestion          INTEGER NOT NULL,
    version_label          TEXT NOT NULL,                  -- ex: "Version 2 du 13/03/2026"
    date_publication       DATE,
    UNIQUE (ppm_shared_entite_id, annee_gestion, version_label)
);

CREATE TABLE ppm_shared_ligne (
    id                          UUID PRIMARY KEY,
    ppm_shared_publication_id  UUID NOT NULL REFERENCES ppm_shared_publication(id) ON DELETE CASCADE,
    reference                   TEXT NOT NULL,              -- ex: "F_DD_298"
    realisation_envisagee       TEXT NOT NULL,
    type_marche                  TEXT,                       -- Prestations Intellectuelles/Consultants | Travaux | Fournitures | Services courants
    mode_passation                TEXT,
    cible                         TEXT,                       -- Communautaire | Internationale
    date_lancement_prevue         DATE,
    date_attribution_prevue       DATE,
    direction_departement          TEXT,
    statut_ligne                   TEXT DEFAULT 'NOUVELLE',   -- NOUVELLE | MODIFIEE | SUPPRIMEE (legende du portail source)
    date_ingestion                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (ppm_shared_publication_id, reference)
);

-- --- COUCHE PRIVEE (strictement cloisonnee par tenant) ---

CREATE TABLE ppm_private_annotation (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    ppm_shared_ligne_id UUID NOT NULL REFERENCES ppm_shared_ligne(id) ON DELETE CASCADE,
    score_opportunite   NUMERIC(5,2),                       -- calcule a partir de l'historique propre au tenant
    decision_go_no_go   TEXT,                                -- A_ETUDIER | GO | NO_GO
    notes_internes      TEXT,
    date_annotation     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, ppm_shared_ligne_id)
);

-- ============================================================================
-- 1. MODULE 1 — LECTURE, EXTRACTION & CHRONOGRAMME D'AO
-- ============================================================================

CREATE TABLE maitre_ouvrage (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    nom                 TEXT NOT NULL,
    categorie           TEXT,                               -- Etat, Collectivite locale, Etablissement public, Societe nationale...
    ppm_entite_id       UUID REFERENCES ppm_shared_entite(id) -- lien vers le referentiel PPM, nullable
);

CREATE TABLE dossier_ao (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    reference_externe           TEXT,                        -- ex: "AO N 39/2021"
    intitule                    TEXT NOT NULL,
    maitre_ouvrage_id           UUID REFERENCES maitre_ouvrage(id),
    secteur                     TEXT,                        -- BTP travaux, fourniture, prestation intellectuelle...
    montant_estime              NUMERIC(18,2),
    devise                      TEXT NOT NULL DEFAULT 'XOF',
    date_limite_soumission      TIMESTAMPTZ,                 -- J0 du chronogramme
    date_notification_attribution TIMESTAMPTZ,
    statut                      TEXT NOT NULL DEFAULT 'ANALYSE',
                                -- ANALYSE | GO | NO_GO | SOUMIS | ATTRIBUE | NON_ATTRIBUE | EN_EXECUTION | RECEPTION | CLOTURE
    origine_ppm_id              UUID REFERENCES ppm_private_annotation(id), -- si le dossier vient d'une opportunite PPM (Module 16)
    fichier_dao_url             TEXT,
    date_creation                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Clauses extraites automatiquement du DAO (garanties, penalites, delais...)
CREATE TABLE clause_extraite (
    id                  UUID PRIMARY KEY,
    dossier_ao_id       UUID NOT NULL REFERENCES dossier_ao(id) ON DELETE CASCADE,
    type_clause         TEXT NOT NULL,
                        -- GARANTIE_SOUMISSION | GARANTIE_BONNE_EXECUTION | RETENUE_GARANTIE | AVANCE_DEMARRAGE
                        -- PENALITE_RETARD | DELAI_EXECUTION | ASSURANCE | REGIME_FISCAL | CRITERE_ORIGINE | JURIDICTION
    libelle             TEXT NOT NULL,
    valeur_numerique    NUMERIC(10,4),                        -- ex: 0.05 pour 5%
    valeur_texte        TEXT,
    article_reference   TEXT,                                 -- ex: "Art. 7.1.1 CCAG"
    niveau_vigilance    TEXT DEFAULT 'STANDARD',               -- STANDARD | A_VERIFIER | RISQUE (Module 7 juridique)
    valide_par_juridique BOOLEAN NOT NULL DEFAULT false,
    valide_par_utilisateur_id UUID REFERENCES utilisateur(id),
    date_extraction     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chronogramme retro-planifie (avant + apres soumission)
CREATE TABLE chronogramme_tache (
    id                  UUID PRIMARY KEY,
    dossier_ao_id       UUID NOT NULL REFERENCES dossier_ao(id) ON DELETE CASCADE,
    phase               TEXT NOT NULL,                        -- AVANT_SOUMISSION | NON_ATTRIBUTION | ATTRIBUTION_EXECUTION
    intitule            TEXT NOT NULL,
    jalon_relatif       TEXT,                                 -- ex: "J-7", "J0", "J+45" (affichage)
    date_echeance       DATE,
    role_porteur_id     UUID REFERENCES role(id),
    document_attendu    TEXT,
    statut              TEXT NOT NULL DEFAULT 'A_FAIRE',      -- A_FAIRE | EN_COURS | FAIT | EN_RETARD
    ordre_affichage     INTEGER NOT NULL DEFAULT 0
);

-- ============================================================================
-- 2. MODULE 2 — FINANCEMENT BANCAIRE & LIGNES DE CREDIT
-- ============================================================================

CREATE TABLE partenaire_financier (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    nom                 TEXT NOT NULL,
    type_partenaire     TEXT NOT NULL,                        -- BANQUE | ASSURANCE
    contact_json        JSONB DEFAULT '{}'
);

-- Grille tarifaire versionnee (statut EN_NEGOCIATION / ACTIVE - section 5.2 / 21.3)
CREATE TABLE grille_tarifaire (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    partenaire_id       UUID NOT NULL REFERENCES partenaire_financier(id) ON DELETE CASCADE,
    version_label       TEXT NOT NULL,                        -- ex: "Proposition 22/07/2026"
    statut              TEXT NOT NULL DEFAULT 'EN_NEGOCIATION', -- EN_NEGOCIATION | ACTIVE | ARCHIVEE
    date_effet          DATE,
    date_creation       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Une ligne = une facilite (LC, aval de traite, credit relais, avance sur marche...)
CREATE TABLE ligne_credit_tarif (
    id                  UUID PRIMARY KEY,
    grille_tarifaire_id UUID NOT NULL REFERENCES grille_tarifaire(id) ON DELETE CASCADE,
    type_facilite       TEXT NOT NULL,
                        -- CREDIT_TRESORERIE | AVAL_TRAITE | AVANCE_MARCHE | LC_INTERNATIONAL | CREDIT_RELAIS | CAUTION_BANCAIRE
    taux_annuel         NUMERIC(7,4),
    commission_pct      NUMERIC(7,4),
    taf_pct             NUMERIC(7,4),                          -- taxe sur activites financieres
    forfait_min_periode NUMERIC(14,2),
    periode_facturation TEXT DEFAULT 'TRIMESTRE',              -- TRIMESTRE | MOIS | AN | UNIQUE (assurance)
    plafond_montant     NUMERIC(18,2)
);

-- Simulation de financement/garantie pour un dossier donne
CREATE TABLE simulation_financement (
    id                  UUID PRIMARY KEY,
    dossier_ao_id       UUID NOT NULL REFERENCES dossier_ao(id) ON DELETE CASCADE,
    type_besoin         TEXT NOT NULL,                        -- CAUTION_SOUMISSION | CAUTION_BONNE_EXECUTION | AVANCE_DEMARRAGE | LC
    montant             NUMERIC(18,2) NOT NULL,
    duree_estimee_jours INTEGER,
    resultat_json       JSONB NOT NULL DEFAULT '{}',          -- classement des options simulees (partenaire -> cout total)
    option_recommandee_id UUID REFERENCES ligne_credit_tarif(id),
    option_retenue_id   UUID REFERENCES ligne_credit_tarif(id),
    date_simulation     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2bis. MODULE 2bis — PLAN DE TRESORERIE PAR MARCHE
-- ============================================================================

CREATE TABLE flux_tresorerie (
    id                  UUID PRIMARY KEY,
    dossier_ao_id       UUID NOT NULL REFERENCES dossier_ao(id) ON DELETE CASCADE,
    sens                TEXT NOT NULL,                        -- ENCAISSEMENT | DECAISSEMENT
    categorie           TEXT NOT NULL,                        -- AVANCE_CLIENT | ACOMPTE | SOLDE | CAUTION | FOURNISSEUR | TRANSIT | COMMISSION_BANCAIRE | REMBOURSEMENT_AVANCE
    montant             NUMERIC(18,2) NOT NULL,
    date_prevue         DATE NOT NULL,
    date_reelle         DATE,                                 -- rempli quand realise -> suivi reel vs previsionnel
    chronogramme_tache_id UUID REFERENCES chronogramme_tache(id), -- rattachement au jalon
    statut              TEXT NOT NULL DEFAULT 'PREVISIONNEL'  -- PREVISIONNEL | REALISE | EN_RETARD
);

-- ============================================================================
-- 3. MODULE 3 — INCOTERMS & SIMULATION LOGISTIQUE
-- ============================================================================

CREATE TABLE incoterm_scenario (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code                TEXT NOT NULL,                        -- EXW, FOB, CIF, DAP, DDP...
    repartition_couts_json JSONB NOT NULL DEFAULT '{}',       -- regle de repartition acheteur/vendeur (parametrable)
    regle_calcul_id     UUID REFERENCES regle_formule(id)
);

CREATE TABLE transitaire (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    nom                 TEXT NOT NULL,
    contact_json        JSONB DEFAULT '{}'
);

CREATE TABLE transitaire_historique (
    id                  UUID PRIMARY KEY,
    transitaire_id      UUID NOT NULL REFERENCES transitaire(id) ON DELETE CASCADE,
    dossier_ao_id       UUID REFERENCES dossier_ao(id),
    delai_jours         INTEGER,
    retard              BOOLEAN NOT NULL DEFAULT false,
    difficulte_type     TEXT,                                 -- ex: RETARD_DEDOUANEMENT | AUTORISATION_MANQUANTE | AUTRE
    date_expedition     DATE,
    date_livraison      DATE
);

CREATE TABLE suivi_logistique (
    id                  UUID PRIMARY KEY,
    dossier_ao_id       UUID NOT NULL REFERENCES dossier_ao(id) ON DELETE CASCADE,
    transitaire_id      UUID REFERENCES transitaire(id),
    incoterm_scenario_id UUID REFERENCES incoterm_scenario(id),
    date_depart         DATE,
    date_arrivee_prevue DATE,
    date_arrivee_reelle DATE,
    montant_ttc         NUMERIC(18,2),
    statut_penalite     TEXT DEFAULT 'AUCUNE'                  -- AUCUNE | RISQUE | ENCOURUE
);

-- ============================================================================
-- 4. MODULE 4 — CONSOLIDATION SOUMISSION (CALCUL DE MARGE)
-- ============================================================================

CREATE TABLE calcul_marge (
    id                  UUID PRIMARY KEY,
    dossier_ao_id       UUID NOT NULL REFERENCES dossier_ao(id) ON DELETE CASCADE,
    prix_achat_devise   NUMERIC(18,4),
    taux_change         NUMERIC(12,6),
    prix_cif            NUMERIC(18,2),
    frais_douane_transit NUMERIC(18,2),
    frais_bancaires     NUMERIC(18,2),
    frais_dao_caution   NUMERIC(18,2),
    redevance_armp      NUMERIC(18,2),
    cout_revient        NUMERIC(18,2),
    marge_pct_visee     NUMERIC(7,4),
    marge_pct_reelle    NUMERIC(7,4),                         -- mis a jour au fil de l'execution -> alimente Module 15
    prix_final_ht_hd    NUMERIC(18,2),
    date_calcul         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 5. MODULE 5 — COMPARATEUR FOURNISSEURS
-- ============================================================================

CREATE TABLE fournisseur (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    nom                 TEXT NOT NULL,
    pays                TEXT,
    score_fiabilite     NUMERIC(5,2)                           -- calcule (Module 15)
);

CREATE TABLE offre_fournisseur (
    id                  UUID PRIMARY KEY,
    dossier_ao_id       UUID NOT NULL REFERENCES dossier_ao(id) ON DELETE CASCADE,
    fournisseur_id      UUID NOT NULL REFERENCES fournisseur(id),
    prix_exw            NUMERIC(18,2),
    delai_jours         INTEGER,
    incoterm_scenario_id UUID REFERENCES incoterm_scenario(id),
    retenue             BOOLEAN NOT NULL DEFAULT false,
    date_reception      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 6. MODULE 6 — BIBLIOTHEQUE DE COURRIERS TYPES
-- ============================================================================

CREATE TABLE modele_courrier (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    type_courrier       TEXT NOT NULL,
                        -- DEMANDE_CLARIFICATION | DEMANDE_FINANCEMENT | DEMANDE_GARANTIE | DEMANDE_MAINLEVEE
                        -- DEMANDE_PROROGATION | RESERVE_ORDRE_SERVICE | RELANCE_PAIEMENT | RECOURS_GRACIEUX
                        -- RECOURS_CONTENTIEUX | NOTIFICATION_SOUS_TRAITANCE
    titre               TEXT NOT NULL,
    corps_template      TEXT NOT NULL,                        -- avec variables {{dossier.reference}}, {{montant}}...
    declencheur_evenement TEXT                                  -- description du declencheur automatique
);

CREATE TABLE courrier_genere (
    id                  UUID PRIMARY KEY,
    dossier_ao_id       UUID NOT NULL REFERENCES dossier_ao(id) ON DELETE CASCADE,
    modele_courrier_id  UUID NOT NULL REFERENCES modele_courrier(id),
    contenu_final       TEXT NOT NULL,
    statut              TEXT NOT NULL DEFAULT 'BROUILLON',    -- BROUILLON | ENVOYE
    date_generation     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 7. MODULE 7 — INTELLIGENCE CONCURRENTIELLE & JURIDIQUE
-- ============================================================================

CREATE TABLE offre_concurrente_historique (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    dossier_ao_reference TEXT,                                -- reference de l'AO observe (peut etre externe/non gagne)
    maitre_ouvrage_id   UUID REFERENCES maitre_ouvrage(id),
    concurrent_nom      TEXT NOT NULL,
    montant_offre       NUMERIC(18,2),
    resultat            TEXT,                                 -- GAGNE | PERDU | INFRUCTUEUX
    motif_echec         TEXT,                                  -- ex: "Depassement budget"
    date_observation    DATE
);

CREATE TABLE clause_risque_bibliotheque (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    maitre_ouvrage_id   UUID REFERENCES maitre_ouvrage(id),
    pattern_description TEXT NOT NULL,                        -- description du pattern (pas de phrase verbatim sensible)
    niveau_risque       TEXT DEFAULT 'MOYEN',                  -- FAIBLE | MOYEN | ELEVE
    occurrences         INTEGER NOT NULL DEFAULT 1
);

-- ============================================================================
-- 8. MODULE 8 — PARC AUTO (vehicules legers)
-- ============================================================================

CREATE TABLE vehicule (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    immatriculation     TEXT NOT NULL,
    marque_modele       TEXT,
    affectation_service  TEXT
);

CREATE TABLE badge_peage (
    id                  UUID PRIMARY KEY,
    vehicule_id         UUID REFERENCES vehicule(id),
    utilisateur_id      UUID REFERENCES utilisateur(id),
    token_id            TEXT NOT NULL
);

CREATE TABLE transaction_peage (
    id                  UUID PRIMARY KEY,
    badge_peage_id      UUID NOT NULL REFERENCES badge_peage(id),
    date_passage        TIMESTAMPTZ NOT NULL,
    gare                TEXT,
    montant             NUMERIC(10,2),
    dossier_ao_id       UUID REFERENCES dossier_ao(id)          -- rattachement cout au dossier si mobilise pour un AO
);

CREATE TABLE carte_carburant (
    id                  UUID PRIMARY KEY,
    vehicule_id         UUID REFERENCES vehicule(id),
    numero_carte        TEXT NOT NULL,
    solde_courant       NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE transaction_carburant (
    id                  UUID PRIMARY KEY,
    carte_carburant_id  UUID NOT NULL REFERENCES carte_carburant(id),
    date_transaction    TIMESTAMPTZ NOT NULL,
    litres              NUMERIC(10,2),
    montant             NUMERIC(12,2),
    dossier_ao_id       UUID REFERENCES dossier_ao(id)
);

-- ============================================================================
-- 9. MODULE 9 — RH & GESTION DES RESSOURCES (socle OGAA)
-- ============================================================================

CREATE TABLE employe (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    utilisateur_id      UUID REFERENCES utilisateur(id),
    poste               TEXT,
    type_contrat        TEXT
);

CREATE TABLE affectation_dossier (
    id                  UUID PRIMARY KEY,
    employe_id          UUID NOT NULL REFERENCES employe(id) ON DELETE CASCADE,
    dossier_ao_id       UUID NOT NULL REFERENCES dossier_ao(id) ON DELETE CASCADE,
    role_sur_dossier    TEXT,
    date_debut          DATE,
    date_fin            DATE
);

CREATE TABLE fiche_temps (
    id                  UUID PRIMARY KEY,
    employe_id          UUID NOT NULL REFERENCES employe(id) ON DELETE CASCADE,
    dossier_ao_id       UUID REFERENCES dossier_ao(id),        -- imputation par dossier (amelioration vs OGAA generique)
    semaine_debut       DATE NOT NULL,
    heures_json         JSONB NOT NULL DEFAULT '{}',           -- {"lundi":8,"mardi":8,...}
    statut_validation   TEXT NOT NULL DEFAULT 'BROUILLON'
);

CREATE TABLE evaluation_post_ao (
    id                  UUID PRIMARY KEY,
    dossier_ao_id       UUID NOT NULL REFERENCES dossier_ao(id) ON DELETE CASCADE,
    resultat            TEXT,                                  -- GAGNE | PERDU
    enseignements       TEXT,
    date_evaluation     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 10. MODULE 10 — EXECUTION PHYSIQUE DU CHANTIER (BTP)
-- ============================================================================

CREATE TABLE chantier (
    id                  UUID PRIMARY KEY,
    dossier_ao_id       UUID NOT NULL REFERENCES dossier_ao(id) ON DELETE CASCADE,
    nom                 TEXT NOT NULL,
    lot                 TEXT,
    date_debut_reelle   DATE,
    date_fin_prevue     DATE
);

-- Bordereau des prix unitaires / detail quantitatif estimatif
CREATE TABLE ligne_bpu_dqe (
    id                  UUID PRIMARY KEY,
    dossier_ao_id       UUID NOT NULL REFERENCES dossier_ao(id) ON DELETE CASCADE,
    designation         TEXT NOT NULL,
    unite               TEXT,
    quantite_prevue     NUMERIC(14,3),
    prix_unitaire       NUMERIC(18,2),
    est_forfaitaire     BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE metre_contradictoire (
    id                  UUID PRIMARY KEY,
    chantier_id         UUID NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
    ligne_bpu_dqe_id    UUID REFERENCES ligne_bpu_dqe(id),
    quantite_executee   NUMERIC(14,3),
    pourcentage_avancement NUMERIC(5,2),
    date_constat        DATE NOT NULL
);

CREATE TABLE decompte (
    id                  UUID PRIMARY KEY,
    chantier_id         UUID NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
    type_decompte       TEXT NOT NULL,                        -- MENSUEL | FINAL | GENERAL_DEFINITIF
    periode             TEXT,
    montant_travaux_entreprise NUMERIC(18,2),
    montant_travaux_regie NUMERIC(18,2),
    montant_approvisionnements NUMERIC(18,2),
    penalites_appliquees NUMERIC(18,2),
    coefficient_revision NUMERIC(9,6),
    statut              TEXT NOT NULL DEFAULT 'PROJET',        -- PROJET | ACCEPTE | CONTESTE
    date_decompte       DATE NOT NULL
);

CREATE TABLE regle_parametre (
    id                  UUID PRIMARY KEY,
    dossier_ao_id       UUID NOT NULL REFERENCES dossier_ao(id) ON DELETE CASCADE,
    regle_formule_id    UUID NOT NULL REFERENCES regle_formule(id),
    parametres_json     JSONB NOT NULL DEFAULT '{}'            -- ex: {"a":0.4,"b":0.3,"c":0.3,"taux_penalite":0.004,"plafond":0.10}
);

-- ============================================================================
-- 11. MODULE 11 — MATERIEL & ENGINS DE CHANTIER (BTP)
-- ============================================================================

CREATE TABLE engin_materiel (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    designation         TEXT NOT NULL,
    type_engin          TEXT,                                 -- GRUE | PELLE | BETONNIERE | COMPACTEUR | ECHAFAUDAGE ...
    statut_propriete    TEXT NOT NULL DEFAULT 'PROPRIETE',     -- PROPRIETE | LOCATION
    cout_horaire        NUMERIC(12,2)
);

CREATE TABLE affectation_engin (
    id                  UUID PRIMARY KEY,
    engin_materiel_id   UUID NOT NULL REFERENCES engin_materiel(id) ON DELETE CASCADE,
    chantier_id         UUID NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
    date_debut          DATE NOT NULL,
    date_fin            DATE,
    taux_utilisation_pct NUMERIC(5,2)
);

-- ============================================================================
-- 12. MODULE 12 — SOUS-TRAITANCE (BTP)
-- ============================================================================

CREATE TABLE sous_traitant (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    nom                 TEXT NOT NULL,
    agree_maitre_ouvrage BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE contrat_sous_traitance (
    id                  UUID PRIMARY KEY,
    dossier_ao_id       UUID NOT NULL REFERENCES dossier_ao(id) ON DELETE CASCADE,
    sous_traitant_id    UUID NOT NULL REFERENCES sous_traitant(id),
    montant_sous_traite NUMERIC(18,2),
    pourcentage_du_marche NUMERIC(5,2),                        -- surveille vs plafond parametrable (regle_parametre)
    paiement_direct     BOOLEAN NOT NULL DEFAULT false,
    statut              TEXT NOT NULL DEFAULT 'DECLARE'        -- DECLARE | ACCEPTE | REFUSE
);

-- ============================================================================
-- 13. MODULE 13 — GARANTIES & RECEPTION TRAVAUX (BTP)
-- ============================================================================

CREATE TABLE garantie_travaux (
    id                  UUID PRIMARY KEY,
    dossier_ao_id       UUID NOT NULL REFERENCES dossier_ao(id) ON DELETE CASCADE,
    type_garantie       TEXT NOT NULL,                        -- BONNE_EXECUTION | TOUS_RISQUES_CHANTIER | DECENNALE | RC_TIERS | HSE
    montant             NUMERIC(18,2),
    pourcentage_reference NUMERIC(6,3),
    date_debut          DATE,
    date_echeance_prevue DATE,                                 -- alimente Module 15 (anticipation mainlevee)
    statut              TEXT NOT NULL DEFAULT 'ACTIVE'          -- A_SOUSCRIRE | ACTIVE | LEVEE
);

CREATE TABLE reception (
    id                  UUID PRIMARY KEY,
    chantier_id         UUID NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
    type_reception      TEXT NOT NULL,                        -- PROVISOIRE | DEFINITIVE
    date_reception      DATE,
    reserves_json       JSONB NOT NULL DEFAULT '[]',
    delai_levee_reserves_jours INTEGER
);

-- ============================================================================
-- 14. MODULE 14 — MAIN D'OEUVRE CHANTIER & MANOEUVRES JOURNALIERS (BTP)
-- ============================================================================

CREATE TABLE manoeuvre_journalier (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    nom                 TEXT NOT NULL,
    piece_identite      TEXT,
    chantier_id         UUID REFERENCES chantier(id),
    taux_journalier     NUMERIC(10,2)
);

CREATE TABLE pointage_journalier (
    id                  UUID PRIMARY KEY,
    manoeuvre_journalier_id UUID NOT NULL REFERENCES manoeuvre_journalier(id) ON DELETE CASCADE,
    chantier_id         UUID NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
    date_jour           DATE NOT NULL,
    present             BOOLEAN NOT NULL DEFAULT true,
    synchronise         BOOLEAN NOT NULL DEFAULT true           -- false si saisi hors-ligne, en attente de sync
);

CREATE TABLE effectif_prevu_chantier (
    id                  UUID PRIMARY KEY,
    chantier_id         UUID NOT NULL REFERENCES chantier(id) ON DELETE CASCADE,
    date_jour           DATE NOT NULL,
    effectif_prevu      INTEGER NOT NULL
);

-- ============================================================================
-- 15. MODULE 15 — INDICATEURS DE PERFORMANCE & ANTICIPATION (transversal)
-- ============================================================================

CREATE TABLE indicateur_definition (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code                TEXT NOT NULL,                        -- ex: ECART_MARGE, RISQUE_PENALITE, ECART_EFFECTIF
    libelle             TEXT NOT NULL,
    domaine             TEXT,                                 -- MARGE | TRESORERIE | DELAI | AVANCEMENT | RH | FOURNISSEUR | COMMERCIAL | JURIDIQUE | GARANTIE
    seuil_alerte_json   JSONB NOT NULL DEFAULT '{}'            -- seuils parametrables par tenant
);

CREATE TABLE indicateur_valeur (
    id                  UUID PRIMARY KEY,
    indicateur_definition_id UUID NOT NULL REFERENCES indicateur_definition(id) ON DELETE CASCADE,
    dossier_ao_id       UUID REFERENCES dossier_ao(id),        -- nullable si indicateur transverse (ex: win rate global)
    valeur              NUMERIC(18,4),
    date_calcul         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE signal_anticipation (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    dossier_ao_id       UUID REFERENCES dossier_ao(id),
    indicateur_definition_id UUID REFERENCES indicateur_definition(id),
    severite            TEXT NOT NULL DEFAULT 'INFO',          -- INFO | ALERTE | CRITIQUE
    message             TEXT NOT NULL,
    date_detection      TIMESTAMPTZ NOT NULL DEFAULT now(),
    accuse_reception    BOOLEAN NOT NULL DEFAULT false,
    accuse_par_utilisateur_id UUID REFERENCES utilisateur(id)
);

-- ============================================================================
-- 16. MODULE 16 — VEILLE & PLANS DE PASSATION (PPM)
--     Le socle commun (ppm_shared_*) et la couche privee (ppm_private_annotation)
--     ont ete crees en section 0.2 car referencees des le Module 1. Voir ce
--     bloc plus haut pour les definitions completes.
-- ============================================================================
-- (tables definies en section 0.2 : ppm_shared_entite, ppm_shared_publication,
--  ppm_shared_ligne, ppm_private_annotation)

-- ============================================================================
-- INDEX RECOMMANDES (extrait — a completer selon les requetes frequentes)
-- ============================================================================

CREATE INDEX idx_dossier_ao_tenant ON dossier_ao(tenant_id);
CREATE INDEX idx_dossier_ao_statut ON dossier_ao(statut);
CREATE INDEX idx_chronogramme_dossier ON chronogramme_tache(dossier_ao_id);
CREATE INDEX idx_flux_tresorerie_dossier_date ON flux_tresorerie(dossier_ao_id, date_prevue);
CREATE INDEX idx_signal_anticipation_tenant_severite ON signal_anticipation(tenant_id, severite, accuse_reception);
CREATE INDEX idx_ppm_shared_ligne_publication ON ppm_shared_ligne(ppm_shared_publication_id);
CREATE INDEX idx_ppm_private_annotation_tenant ON ppm_private_annotation(tenant_id);
CREATE INDEX idx_pointage_journalier_chantier_date ON pointage_journalier(chantier_id, date_jour);

-- ============================================================================
-- NOTE D'IMPLEMENTATION — SECURITE MULTI-TENANT
-- ============================================================================
-- En production, activer Row Level Security (RLS) sur chaque table portant
-- tenant_id, avec une politique du type :
--   ALTER TABLE dossier_ao ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY tenant_isolation ON dossier_ao
--     USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
-- Cela garantit qu'aucune requete applicative ne peut, meme par erreur,
-- exposer les donnees d'un tenant a un autre — essentiel des lors que le
-- Module 16 introduit des tables partagees (ppm_shared_*) a cote des tables
-- cloisonnees (ppm_private_annotation et le reste du schema).
-- ============================================================================
