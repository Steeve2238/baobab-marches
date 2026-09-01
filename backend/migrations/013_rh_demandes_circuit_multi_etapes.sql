-- Module 9 - RH (enrichissement de l'etape 2/5 : circuit d'approbation a
-- plusieurs etapes + nouveaux types de demande)
--
-- Steeve a envoye le 01/09/2026 les 10 modeles de fiches papier reellement
-- utilisees chez ARED/OGAA pour "Mes demandes" (voir
-- reference/modeles_fiches_ogaa_demandes.md, projet Claude). Plusieurs
-- d'entre elles ont un circuit d'approbation A PLUSIEURS ETAPES SUCCESSIVES
-- (ex: Fournitures = 4 etapes, Demande de fonds et Carburant = 3 etapes),
-- alors que le circuit actuel (regle_approbation_rh, etape 2/5 livree) ne
-- gere qu'UN SEUL niveau. Decision actee avec Steeve : construire le
-- circuit multi-etapes maintenant, plutot que de le reporter.
--
-- Approche retenue : un circuit a etapes est CONFIGURE PAR TYPE DE DEMANDE
-- (etape_approbation_rh), pas par role du demandeur comme l'ancien systeme -
-- fidele aux fiches papier ou la chaine de visas est fixe quel que soit qui
-- demande (ex: Fournitures passe toujours par chef de service -> DAFC ->
-- beneficiaire). RETROCOMPATIBILITE totale : un type de demande SANS etape
-- configuree continue de fonctionner exactement comme avant (un seul niveau,
-- route par le role du demandeur via regle_approbation_rh, repli ADMIN) -
-- c'est le cas par defaut pour les 4 types deja en production (CONGE,
-- AVANCE, ORDRE_MISSION, HEURES_SUP) tant que Steeve ne configure pas de
-- chaine dediee pour eux via /rh/circuit-approbation.

CREATE TABLE IF NOT EXISTS etape_approbation_rh (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    type_demande        TEXT NOT NULL,
    ordre               INTEGER NOT NULL,               -- 1, 2, 3... ordre de la chaine
    libelle             TEXT NOT NULL,                  -- ex: "Visa du chef de service", "Approbation DAFC"
    role_approbateur_id UUID REFERENCES role(id)         -- NULL = repli ADMIN pour cette etape
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'etape_approbation_rh_type_ordre_unique'
  ) THEN
    ALTER TABLE etape_approbation_rh
      ADD CONSTRAINT etape_approbation_rh_type_ordre_unique UNIQUE (tenant_id, type_demande, ordre);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_etape_approbation_rh_tenant_type ON etape_approbation_rh(tenant_id, type_demande);

-- Chaine d'approbation FIGEE au moment de la soumission (comme
-- role_approbateur_id l'etait deja pour l'ancien systeme a un seul niveau -
-- un changement de configuration ulterieur n'affecte pas les demandes deja
-- soumises). Tableau JSON : [{ordre, libelle, role_approbateur_id,
-- role_code, role_libelle}]. etape_courante = index 1-based de l'etape en
-- attente de decision (NULL tant que la demande n'est pas SOUMISE).
ALTER TABLE demande_rh ADD COLUMN IF NOT EXISTS chaine_approbation JSONB;
ALTER TABLE demande_rh ADD COLUMN IF NOT EXISTS etape_courante INTEGER;

-- Historique des decisions, une ligne par etape decidee (permet de tracer
-- qui a valide/rejete quelle etape et quand, y compris pour les demandes a
-- une seule etape - remplace desormais le seul enregistrement final sur
-- demande_rh pour les circuits a plusieurs etapes).
CREATE TABLE IF NOT EXISTS decision_etape_demande_rh (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demande_rh_id       UUID NOT NULL REFERENCES demande_rh(id) ON DELETE CASCADE,
    ordre               INTEGER NOT NULL,
    libelle             TEXT NOT NULL,
    role_approbateur_id UUID REFERENCES role(id),
    decideur_utilisateur_id UUID REFERENCES utilisateur(id),
    decision            TEXT NOT NULL,                  -- APPROUVEE | REJETEE
    motif_rejet         TEXT,
    date_decision       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decision_etape_demande_rh_demande ON decision_etape_demande_rh(demande_rh_id);
