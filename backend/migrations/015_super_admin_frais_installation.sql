-- Module Super Admin - complement demande par Steeve le 04/09/2026 : en plus
-- de l'abonnement mensuel recurrent, il facture systematiquement des FRAIS
-- D'INSTALLATION/PARAMETRAGE au demarrage de chaque nouveau client
-- ("normalement je le fixe entre 100 000 et 150 000 XOF en fonction des
-- differentes offres"). Ce montant est donc PAR FORMULE (pas un forfait
-- unique global) et facture UNE SEULE FOIS, generalement au moment de la
-- creation du client, pour generer sa toute premiere facture.
--
-- Cf. claude/resume_reprise_projet.md pour l'architecture generale du module
-- (migration 014).

-- Frais d'installation propres a chaque formule - 0 par defaut (formule sans
-- frais configure), modifiable depuis l'ecran Formules comme le reste.
ALTER TABLE formule_abonnement
  ADD COLUMN IF NOT EXISTS frais_installation_xof NUMERIC(12,0) NOT NULL DEFAULT 0;

-- Valeurs de depart proposees a Steeve (dans la fourchette 100 000-150 000
-- XOF qu'il a donnee, croissantes avec le niveau de la formule) - seulement
-- si pas deja configure (idempotent, comme les formules elles-memes en
-- migration 014).
UPDATE formule_abonnement SET frais_installation_xof = 100000
  WHERE nom = 'Essentiel' AND frais_installation_xof = 0;
UPDATE formule_abonnement SET frais_installation_xof = 125000
  WHERE nom = 'Croissance' AND frais_installation_xof = 0;
UPDATE formule_abonnement SET frais_installation_xof = 150000
  WHERE nom = 'Entreprise' AND frais_installation_xof = 0;

-- Une facture peut desormais etre soit l'abonnement mensuel recurrent, soit
-- les frais d'installation ponctuels - meme table (meme cycle de vie
-- IMPAYEE/PAYEE/ANNULEE, meme historique par client), distinguees par ce
-- nouveau type.
ALTER TABLE facture_abonnement
  ADD COLUMN IF NOT EXISTS type_facture TEXT NOT NULL DEFAULT 'ABONNEMENT';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'facture_abonnement_type_facture_check'
  ) THEN
    ALTER TABLE facture_abonnement
      ADD CONSTRAINT facture_abonnement_type_facture_check
      CHECK (type_facture IN ('ABONNEMENT', 'INSTALLATION'));
  END IF;
END $$;

-- L'ancienne contrainte UNIQUE(tenant_id, periode) empechait un client
-- d'avoir sa facture d'installation ET sa premiere facture d'abonnement le
-- meme mois calendaire (cas le plus frequent : les deux sont generees au
-- moment de la creation). Remplacee par une contrainte qui inclut le type.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'facture_abonnement_tenant_id_periode_key'
  ) THEN
    ALTER TABLE facture_abonnement DROP CONSTRAINT facture_abonnement_tenant_id_periode_key;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'facture_abonnement_tenant_periode_type_key'
  ) THEN
    ALTER TABLE facture_abonnement
      ADD CONSTRAINT facture_abonnement_tenant_periode_type_key
      UNIQUE (tenant_id, periode, type_facture);
  END IF;
END $$;
