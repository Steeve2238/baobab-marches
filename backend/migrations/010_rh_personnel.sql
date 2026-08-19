-- Module 9 - RH (etape 1/5 : Dossiers du personnel)
--
-- Point de depart du chantier RH, cadre a partir du memo OGAA envoye par
-- Steeve (controllers rhController.js / tempsTravailController.js + 8 pages
-- frontend). Ce memo decrit un systeme riche (14 types de demandes RH,
-- circuit d'approbation hierarchique fixe, conges avec solde, fiches de
-- temps hebdomadaires v2, planning annuel, statistiques, "temps de travail
-- par projet" pour rapport bailleur) alors que le schema Baobab actuel
-- (section 9) ne contient que 4 tables minimales.
--
-- Decisions d'adaptation (voir note dans resume_reprise_projet.md) :
--   - OGAA route les demandes selon une hierarchie de CODES de role fixes
--     (EMPLOYE/RT/RSE/GPA -> RH -> DAFC -> DGA -> DG). Chez Baobab les roles
--     sont libres par tenant (section 3 du CDC) : aucun de ces codes n'est
--     garanti exister. Le circuit d'approbation sera donc PARAMETRABLE par
--     tenant (table dediee, etape 2), pas calque sur la hierarchie OGAA.
--   - Donnee personnelle (contact urgence, solde conges) plus sensible que
--     les donnees de reference deja ouvertes a tous (vehicule, fournisseur...) :
--     par defaut, seul ADMIN gere la liste complete ; chacun voit/modifie
--     son propre dossier. A affiner plus tard via perimetre_json (non
--     encore branche dans le code - cf role.perimetre_json, stocke mais pas
--     encore lu par aucune route).
--
-- Cette etape enrichit uniquement la fiche employe existante (identite RH
-- de base). Les etapes suivantes ajouteront : moteur de demandes RH +
-- circuit d'approbation (2), conges/solde/planning (3), fiches de temps v2
-- (4), temps de travail par dossier pour rapport bailleur (5).

ALTER TABLE employe ADD COLUMN IF NOT EXISTS date_embauche DATE;
ALTER TABLE employe ADD COLUMN IF NOT EXISTS date_fin_contrat DATE;
ALTER TABLE employe ADD COLUMN IF NOT EXISTS telephone TEXT;
ALTER TABLE employe ADD COLUMN IF NOT EXISTS contact_urgence_nom TEXT;
ALTER TABLE employe ADD COLUMN IF NOT EXISTS contact_urgence_telephone TEXT;

-- Solde de conges en jours (peut etre demi-journee -> une decimale).
-- Alimente et decremente par le moteur de demandes RH a l'etape 3 ; ici on
-- pose seulement la colonne + une valeur initiale saisissable a la creation
-- de la fiche.
ALTER TABLE employe ADD COLUMN IF NOT EXISTS solde_conges NUMERIC(5,1) NOT NULL DEFAULT 0;

-- ACTIF | INACTIF (depart, fin de contrat...) - une fiche INACTIF est
-- conservee (historique des affectations/fiches de temps passees) mais
-- masquee des listes actives par defaut.
ALTER TABLE employe ADD COLUMN IF NOT EXISTS statut TEXT NOT NULL DEFAULT 'ACTIF';

-- Une fiche employe par utilisateur au maximum.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employe_utilisateur_id_unique'
  ) THEN
    ALTER TABLE employe ADD CONSTRAINT employe_utilisateur_id_unique UNIQUE (utilisateur_id);
  END IF;
END $$;
