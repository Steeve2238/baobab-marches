-- Module 9 - RH (etape 4/5 : Fiches de temps v2)
--
-- Cf. reference/memo_rh_fiches_temps_ogaa.md (projet Claude), point 8, pour
-- le detail du systeme OGAA d'origine (structure "v2" du 12/08/2026 : un
-- tableau plat de lignes {jour, domaine_type, projet/programme, tache,
-- temps} plutot qu'une ligne par domaine et par semaine). La table
-- fiche_temps existait deja dans le schema d'origine (section 9, migration
-- 001) mais n'etait utilisee par aucune route - elle portait une structure
-- v1 minimale (heures_json + un seul dossier_ao_id pour toute la semaine).
--
-- Adaptations actees pour Baobab (voir resume_reprise_projet.md) :
--   - Imputation par DOSSIER D'APPEL D'OFFRES (deja le cas dans le schema
--     d'origine, contrairement au "programme" generique OGAA) : chaque
--     LIGNE porte son propre dossier_ao_id quand domaine_type = 'DOSSIER'.
--   - Categories "autre" fixees cote application (pas de table de reference
--     dediee - liste courte, modifiable sans migration) : voir TYPES_TEMPS_AUTRE
--     dans routes/rh.js.
--   - Cycle de vie et circuit d'approbation identiques a celui du moteur de
--     demandes RH (etape 2) : BROUILLON -> SOUMISE -> VALIDEE/REJETEE,
--     approbateur determine par la meme table regle_approbation_rh (le role
--     du demandeur, pas le type de la fiche). Une ligne de categorie
--     CONGE_ABSENCE dans une fiche de temps est une note descriptive pour le
--     reporting et le verrou chronologique UNIQUEMENT - elle ne touche PAS
--     employe.solde_conges (deja gere par le moteur de demandes RH, etape 2 -
--     pas de double-decompte).
--   - tenant_id ajoute a fiche_temps (absent du schema d'origine) pour rester
--     coherent avec le reste des tables privees et permettre les requetes
--     "a valider" filtrees par tenant sans repasser par employe a chaque fois.

-- tenant_id : ajoute nullable, retro-rempli depuis employe, puis contraint.
ALTER TABLE fiche_temps ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenant(id) ON DELETE CASCADE;
UPDATE fiche_temps ft SET tenant_id = e.tenant_id
  FROM employe e WHERE ft.employe_id = e.id AND ft.tenant_id IS NULL;
ALTER TABLE fiche_temps ALTER COLUMN tenant_id SET NOT NULL;

-- La structure v1 (un seul dossier pour toute la semaine + heures_json) est
-- remplacee par la table ligne_fiche_temps ci-dessous.
ALTER TABLE fiche_temps DROP COLUMN IF EXISTS dossier_ao_id;
ALTER TABLE fiche_temps DROP COLUMN IF EXISTS heures_json;

-- Circuit d'approbation (memes colonnes que demande_rh, etape 2).
ALTER TABLE fiche_temps ADD COLUMN IF NOT EXISTS role_approbateur_id UUID REFERENCES role(id);
ALTER TABLE fiche_temps ADD COLUMN IF NOT EXISTS approuve_par_utilisateur_id UUID REFERENCES utilisateur(id);
ALTER TABLE fiche_temps ADD COLUMN IF NOT EXISTS motif_rejet TEXT;
ALTER TABLE fiche_temps ADD COLUMN IF NOT EXISTS date_soumission TIMESTAMPTZ;
ALTER TABLE fiche_temps ADD COLUMN IF NOT EXISTS date_decision TIMESTAMPTZ;
ALTER TABLE fiche_temps ADD COLUMN IF NOT EXISTS date_creation TIMESTAMPTZ NOT NULL DEFAULT now();

-- Une seule fiche par employe et par semaine (semaine_debut = lundi de la semaine).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fiche_temps_employe_semaine_unique'
  ) THEN
    ALTER TABLE fiche_temps ADD CONSTRAINT fiche_temps_employe_semaine_unique UNIQUE (employe_id, semaine_debut);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fiche_temps_tenant ON fiche_temps(tenant_id);

-- Lignes de saisie (v2) : plusieurs lignes possibles par jour.
CREATE TABLE IF NOT EXISTS ligne_fiche_temps (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fiche_temps_id      UUID NOT NULL REFERENCES fiche_temps(id) ON DELETE CASCADE,
    jour                DATE NOT NULL,
    domaine_type        TEXT NOT NULL,                 -- DOSSIER | AUTRE
    dossier_ao_id       UUID REFERENCES dossier_ao(id),-- si domaine_type = DOSSIER
    categorie_autre     TEXT,                          -- si domaine_type = AUTRE (liste fixe cote app)
    precision_autre     TEXT,
    tache               TEXT,
    temps               NUMERIC(4,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ligne_fiche_temps_fiche ON ligne_fiche_temps(fiche_temps_id);
