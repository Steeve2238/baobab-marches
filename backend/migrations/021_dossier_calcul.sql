-- ============================================================================
-- Dossier de calcul (prix de revient et marge) - outil confirme avec Steeve
-- le 07/09/2026 a partir de son propre tableau Excel (dossier CONSULTATION
-- 26000/536/537 DN, prototype approuve "le tableau me convient"). Objectif :
-- comparer plusieurs offres partenaires (fournisseur + transitaire) par
-- article, calculer automatiquement le cout de revient/la marge, et faire
-- remonter l'offre retenue par article dans le devis. Fonctionne aussi bien
-- sur un dossier d'Appel d'Offres (dossier_ao) que sur une Consultation
-- restreinte (consultation) - d'ou les deux FK optionnelles ci-dessous,
-- exactement une des deux doit etre renseignee (contrainte CHECK).
--
-- Reutilise les registres deja existants pour les partenaires (pas de
-- redondance, demande explicite de Steeve) : fournisseur et transitaire
-- (voir migration 001) servent de listes deroulantes, on ne cree PAS de
-- nouvelle table de repertoire partenaires ici.
--
-- Les colonnes calculees du prototype (achat XOF, douane, cout de revient,
-- marge, prix de vente, frais bancaires, marge nette reelle...) ne sont PAS
-- stockees : toujours recalculees cote serveur a la lecture (voir
-- services/calculPrixEngine.js), meme principe que les totaux HT/TVA/TTC
-- du module Ventes/Negoce - on ne stocke que les donnees d'ENTREE.
-- ============================================================================

ALTER TABLE tenant
  ADD COLUMN IF NOT EXISTS parametres_calcul_prix_json JSONB NOT NULL DEFAULT '{
    "tauxDroitDouane": 0.20,
    "tauxRedevanceStatistique": 0.01,
    "tauxPCS": 0.01,
    "tauxPCC": 0.005,
    "tauxCOSEC": 0.004,
    "tauxTvaImport": 0.18,
    "tauxAssuranceFret": 0.0026,
    "margeCibleDefaut": 0.25,
    "pariteEurXof": 655.957,
    "tauxCommissionTTHU": 0.006,
    "tauxCommissionDBS": 0.006,
    "commissionDbsMinimum": 25000,
    "tauxTAF": 0.17,
    "forfaitSwift": 10000,
    "forfaitTimbre": 20000
  }'::jsonb;

CREATE TABLE IF NOT EXISTS dossier_calcul (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    dossier_ao_id       UUID REFERENCES dossier_ao(id) ON DELETE CASCADE,
    consultation_id     UUID REFERENCES consultation(id) ON DELETE CASCADE,
    nom                 TEXT NOT NULL,
    cree_par            UUID REFERENCES utilisateur(id),
    date_creation       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT dossier_calcul_un_seul_rattachement CHECK (
      (dossier_ao_id IS NOT NULL)::int + (consultation_id IS NOT NULL)::int = 1
    )
);

CREATE INDEX IF NOT EXISTS idx_dossier_calcul_dossier_ao ON dossier_calcul(dossier_ao_id);
CREATE INDEX IF NOT EXISTS idx_dossier_calcul_consultation ON dossier_calcul(consultation_id);

CREATE TABLE IF NOT EXISTS calcul_article (
    id                  UUID PRIMARY KEY,
    dossier_calcul_id   UUID NOT NULL REFERENCES dossier_calcul(id) ON DELETE CASCADE,
    libelle             TEXT NOT NULL,
    ordre_affichage     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_calcul_article_dossier ON calcul_article(dossier_calcul_id);

-- Une ligne = une offre recue pour un article (fournisseur + transitaire
-- associe a CETTE offre - un meme fournisseur peut passer par des
-- transitaires differents selon l'offre). Quantite/devise/cours portes par
-- l'offre (pas par l'article) : deux offres pour le meme article peuvent
-- porter sur des quantites ou devises differentes, comme dans le modele
-- Excel de Steeve.
CREATE TABLE IF NOT EXISTS calcul_offre (
    id                      UUID PRIMARY KEY,
    calcul_article_id       UUID NOT NULL REFERENCES calcul_article(id) ON DELETE CASCADE,
    fournisseur_id          UUID NOT NULL REFERENCES fournisseur(id),
    transitaire_id          UUID REFERENCES transitaire(id),
    devise                  TEXT NOT NULL DEFAULT 'XOF',
    prix_unitaire_devise    NUMERIC(18,4) NOT NULL,
    cours_devise            NUMERIC(14,6) NOT NULL DEFAULT 1,
    quantite                NUMERIC(18,3) NOT NULL DEFAULT 1,
    fret_alloue_xof         NUMERIC(18,2) NOT NULL DEFAULT 0,
    frais_transit_xof       NUMERIC(18,2) NOT NULL DEFAULT 0,
    date_reception          DATE,
    marge_cible_pct         NUMERIC(7,4),               -- NULL = utilise le parametre tenant par defaut
    retenue                 BOOLEAN NOT NULL DEFAULT false,
    notes                   TEXT
);

CREATE INDEX IF NOT EXISTS idx_calcul_offre_article ON calcul_offre(calcul_article_id);
CREATE INDEX IF NOT EXISTS idx_calcul_offre_fournisseur ON calcul_offre(fournisseur_id);
CREATE INDEX IF NOT EXISTS idx_calcul_offre_transitaire ON calcul_offre(transitaire_id);
