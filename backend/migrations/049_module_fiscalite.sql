-- Module Fiscalite (payant) - chantier du 07/10/2026 (cadrage : claude/cadrage_module_fiscalite_07102026).
-- Lot 1 (socle) + Lot 2 (declaration de TVA mensuelle).
--
--   A) Module vendu en option, meme mecanique que la Comptabilite (migration 032) : drapeau par client,
--      prix mensuel, date d'activation + supplement fige sur les factures d'abonnement.
--   B) NINEA des clients et fournisseurs (annexe "deductions par fournisseur" de la TVA).
--   C) Profil fiscal de l'entreprise (une ligne par tenant).
--   D) Traitement fiscal des factures : code d'operation TVA des ventes, precompte, type (local / import) et
--      deductibilite des achats.
--   E) Declarations de TVA (une par mois) : instantane des lignes L5-L120 + suivi depot / paiement.
--   F) Suivi du calendrier fiscal (statut, date de depot, reference) par echeance.

-- A) Module payant ------------------------------------------------------------------------------------------------
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS module_fiscalite_actif BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS module_fiscalite_prix_mensuel_xof NUMERIC(12,0) NOT NULL DEFAULT 0;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS module_fiscalite_date_activation TIMESTAMPTZ;
ALTER TABLE facture_abonnement ADD COLUMN IF NOT EXISTS supplement_fiscalite_xof NUMERIC(12,0) NOT NULL DEFAULT 0;

-- B) Identite fiscale des tiers : NINEA, COFI et regime d'imposition ------------------------------------------------
-- Le COFI (3 caracteres apres le NINEA, ex. 0001462 2G3) : 1er caractere = regime (0 reel non assujetti a la TVA,
-- 1 contribution globale unique, 2 reel assujetti a la TVA), 2e = centre fiscal, 3e = forme juridique.
-- regime_fiscal : CGU (contribution globale unique, art. 134 et s.), REEL (reel sans precision : le COFI ne distingue pas
-- le simplifie du normal), REEL_SIMPLIFIE, REEL_NORMAL, AUTRE (exonere, association...) ou NON_RENSEIGNE. regime_source : SAISIE (saisi a la main), COFI (deduit du COFI
-- par la table data/cofiRegimes.json), ATTESTATION (releve sur une attestation de la DGID).
ALTER TABLE client_commercial ADD COLUMN IF NOT EXISTS ninea TEXT;
ALTER TABLE client_commercial ADD COLUMN IF NOT EXISTS cofi TEXT;
ALTER TABLE client_commercial ADD COLUMN IF NOT EXISTS regime_fiscal TEXT NOT NULL DEFAULT 'NON_RENSEIGNE'
    CHECK (regime_fiscal IN ('NON_RENSEIGNE', 'CGU', 'REEL', 'REEL_SIMPLIFIE', 'REEL_NORMAL', 'AUTRE'));
ALTER TABLE client_commercial ADD COLUMN IF NOT EXISTS assujetti_tva BOOLEAN;   -- NULL = inconnu
ALTER TABLE client_commercial ADD COLUMN IF NOT EXISTS regime_source TEXT
    CHECK (regime_source IS NULL OR regime_source IN ('SAISIE', 'COFI', 'ATTESTATION'));
ALTER TABLE fournisseur ADD COLUMN IF NOT EXISTS ninea TEXT;
ALTER TABLE fournisseur ADD COLUMN IF NOT EXISTS cofi TEXT;
ALTER TABLE fournisseur ADD COLUMN IF NOT EXISTS regime_fiscal TEXT NOT NULL DEFAULT 'NON_RENSEIGNE'
    CHECK (regime_fiscal IN ('NON_RENSEIGNE', 'CGU', 'REEL', 'REEL_SIMPLIFIE', 'REEL_NORMAL', 'AUTRE'));
ALTER TABLE fournisseur ADD COLUMN IF NOT EXISTS assujetti_tva BOOLEAN;         -- NULL = inconnu
ALTER TABLE fournisseur ADD COLUMN IF NOT EXISTS regime_source TEXT
    CHECK (regime_source IS NULL OR regime_source IN ('SAISIE', 'COFI', 'ATTESTATION'));

-- C) Profil fiscal ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fiscalite_profil (
    tenant_id               UUID PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
    assujetti_tva           BOOLEAN NOT NULL DEFAULT TRUE,
    -- FACTURATION : TVA exigible a la facturation (livraisons de biens) ; ENCAISSEMENT : a l'encaissement (services)
    exigibilite_tva         TEXT NOT NULL DEFAULT 'FACTURATION' CHECK (exigibilite_tva IN ('FACTURATION', 'ENCAISSEMENT')),
    -- Prorata de deduction (art. 385) : 100 = toutes les operations ouvrent droit a deduction
    prorata_deduction_pct   NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK (prorata_deduction_pct >= 0 AND prorata_deduction_pct <= 100),
    -- Regime d'imposition declare de l'entreprise elle-meme (compare au regime attendu d'apres son chiffre d'affaires)
    regime_is               TEXT NOT NULL DEFAULT 'REEL_NORMAL' CHECK (regime_is IN ('REEL_NORMAL', 'REEL_SIMPLIFIE', 'CGU')),
    forme_juridique         TEXT NOT NULL DEFAULT 'PERSONNE_MORALE' CHECK (forme_juridique IN ('PERSONNE_MORALE', 'PERSONNE_PHYSIQUE')),
    cofi                    TEXT,                      -- COFI de l'entreprise (son NINEA est dans tenant.ninea)
    -- Chiffre d'affaires TTC des exercices anterieurs a la plateforme, saisi a la main : { "2024": 120000000 }
    ca_historique_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
    centre_fiscal           TEXT,
    cloture_mois            INTEGER NOT NULL DEFAULT 12 CHECK (cloture_mois BETWEEN 1 AND 12),
    -- Taxe de TVA reduite (taux 10 %) : taux parametres plutot que constantes dans le code (loi de finances)
    taux_tva_normal         NUMERIC(5,2) NOT NULL DEFAULT 18,
    taux_tva_reduit         NUMERIC(5,2) NOT NULL DEFAULT 10,
    date_modification       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- D) Traitement fiscal des factures -------------------------------------------------------------------------------
-- Ventes : NULL = determine automatiquement (TVA a 0 -> exoneree, sinon taxable).
ALTER TABLE facture_vente ADD COLUMN IF NOT EXISTS tva_code_operation TEXT
    CHECK (tva_code_operation IS NULL OR tva_code_operation IN ('TAXABLE', 'EXONERE', 'EXPORT', 'SUSPENSION'));
-- Precompte de TVA retenu par le client (Etat, grandes entreprises) : montant retenu, 0 = pas de precompte.
ALTER TABLE facture_vente ADD COLUMN IF NOT EXISTS tva_precompte_montant NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tva_precompte_montant >= 0);

-- Achats : facture locale ou importation (TVA acquittee a la douane), et droit a deduction.
ALTER TABLE facture_fournisseur ADD COLUMN IF NOT EXISTS tva_type_operation TEXT NOT NULL DEFAULT 'LOCAL'
    CHECK (tva_type_operation IN ('LOCAL', 'IMPORT'));
ALTER TABLE facture_fournisseur ADD COLUMN IF NOT EXISTS tva_deductible BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE facture_fournisseur ADD COLUMN IF NOT EXISTS tva_motif_non_deductible TEXT;
-- Importations : base (valeur en douane) et TVA acquittee, quand elles different du HT / TVA de la facture.
ALTER TABLE facture_fournisseur ADD COLUMN IF NOT EXISTS tva_base_importation NUMERIC(18,2);
ALTER TABLE facture_fournisseur ADD COLUMN IF NOT EXISTS tva_montant_douane NUMERIC(18,2);

-- E) Declarations de TVA ------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fiscalite_declaration_tva (
    id                      UUID PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    annee                   INTEGER NOT NULL CHECK (annee BETWEEN 2000 AND 2100),
    mois                    INTEGER NOT NULL CHECK (mois BETWEEN 1 AND 12),
    statut                  TEXT NOT NULL DEFAULT 'PREPAREE' CHECK (statut IN ('PREPAREE', 'DEPOSEE', 'PAYEE')),
    lignes_json             JSONB NOT NULL,            -- instantane des lignes L5..L120 au moment de la preparation
    saisies_json            JSONB NOT NULL DEFAULT '{}'::jsonb,  -- lignes saisies a la main (L30, L75, L95, L120, credit precedent...)
    avertissements_json     JSONB NOT NULL DEFAULT '[]'::jsonb,
    solde_a_payer           NUMERIC(18,2) NOT NULL DEFAULT 0,
    credit_a_reporter       NUMERIC(18,2) NOT NULL DEFAULT 0,
    date_depot              DATE,
    reference_depot         TEXT,
    date_paiement           DATE,
    notes                   TEXT,
    prepare_par             UUID REFERENCES utilisateur(id),
    date_preparation        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, annee, mois)
);

-- F) Suivi du calendrier fiscal -----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fiscalite_suivi (
    id                      UUID PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    cle                     TEXT NOT NULL,             -- ex IS_ACOMPTE_1:2026, CEL:2026, TVA:2026-09 (voir services/fiscaliteCalendrier.js)
    statut                  TEXT NOT NULL DEFAULT 'A_FAIRE' CHECK (statut IN ('A_FAIRE', 'PREPAREE', 'DEPOSEE', 'PAYEE', 'NON_CONCERNE')),
    date_depot              DATE,
    date_paiement           DATE,
    reference               TEXT,
    montant                 NUMERIC(18,2),
    note                    TEXT,
    mis_a_jour_par          UUID REFERENCES utilisateur(id),
    date_modification       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, cle)
);

-- G) Droits : deux nouveaux modules dans le perimetre des roles (meme principe que la migration 028) ---------------
--   "fiscalite"            : consultation + traitement fiscal des factures, NINEA / COFI
--   "fiscalite-validation" : preparer / deposer / payer une declaration, profil fiscal, suivi du calendrier
-- Ajoutes (sans rien retirer) aux roles COMPTABLE et FINANCIER existants ; sans effet tant que le Super Admin n'a pas
-- active le module pour le client. ADMIN a toujours tout (une fois le module active).
UPDATE role
SET perimetre_json = jsonb_set(
      COALESCE(perimetre_json, '{}'::jsonb),
      '{modules}',
      COALESCE(perimetre_json->'modules', '[]'::jsonb) || '["fiscalite"]'::jsonb
    )
WHERE code = 'COMPTABLE'
  AND NOT COALESCE(perimetre_json->'modules', '[]'::jsonb) ? 'fiscalite';

UPDATE role
SET perimetre_json = jsonb_set(
      COALESCE(perimetre_json, '{}'::jsonb),
      '{modules}',
      COALESCE(perimetre_json->'modules', '[]'::jsonb) || '["fiscalite","fiscalite-validation"]'::jsonb
    )
WHERE code = 'FINANCIER'
  AND NOT COALESCE(perimetre_json->'modules', '[]'::jsonb) ? 'fiscalite';
