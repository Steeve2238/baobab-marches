-- Module 9 - RH (etape 2/5 : moteur de demandes RH + circuit d'approbation)
--
-- Cf. reference/memo_rh_fiches_temps_ogaa.md (projet Claude) pour le detail du
-- systeme OGAA dont ce module s'inspire (14 types de demandes, circuit
-- hierarchique fixe EMPLOYE/RT/RSE/GPA -> RH -> DAFC -> DGA -> DG).
--
-- Adaptation actee avec Steeve : les roles Baobab etant libres par tenant
-- (aucun code de role fixe garanti), le circuit d'approbation OGAA est
-- remplace par une table de regles PARAMETRABLE par tenant
-- (regle_approbation_rh) plutot que code en dur. Repli si aucune regle ne
-- correspond au(x) role(s) du demandeur : validation par un ADMIN.
--
-- Perimetre de cette etape : 4 types de demande pour commencer (CONGE,
-- AVANCE, ORDRE_MISSION, HEURES_SUP) plutot que les 14 d'OGAA - les autres
-- types pourront etre ajoutes plus tard sans nouvelle migration (type_demande
-- est un TEXT libre cote base, valide cote application).
--
-- Le type CONGE, une fois approuve, decremente directement
-- employe.solde_conges (colonne posee a l'etape 1) et journalise le
-- mouvement dans conge_historique - le pendant de rh_conges chez OGAA.

-- Regles d'approbation : pour un role "demandeur" donne, quel role doit
-- valider ses demandes RH. Une seule regle par (tenant, role_demandeur).
-- Le role ADMIN n'a pas besoin de figurer ici : il valide toujours tout
-- (meme convention que requireRole cote backend).
CREATE TABLE IF NOT EXISTS regle_approbation_rh (
    id                      UUID PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    role_demandeur_id       UUID NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    role_approbateur_id     UUID NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    UNIQUE (tenant_id, role_demandeur_id)
);

CREATE TABLE IF NOT EXISTS demande_rh (
    id                      UUID PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    employe_id              UUID NOT NULL REFERENCES employe(id) ON DELETE CASCADE,
    type_demande            TEXT NOT NULL,
                            -- CONGE | AVANCE | ORDRE_MISSION | HEURES_SUP (extensible)
    details                 JSONB NOT NULL DEFAULT '{}',
                            -- champs specifiques au type (dates, montant, motif...)
    statut                  TEXT NOT NULL DEFAULT 'BROUILLON',
                            -- BROUILLON | SOUMISE | APPROUVEE | REJETEE | ANNULEE
    role_approbateur_id     UUID REFERENCES role(id),
                            -- calcule a la soumission (determinerRoleApprobateur) ;
                            -- NULL = repli ADMIN (aucune regle ne correspondait)
    approuve_par_utilisateur_id UUID REFERENCES utilisateur(id),
    motif_rejet             TEXT,
    date_soumission         TIMESTAMPTZ,
    date_decision           TIMESTAMPTZ,
    date_creation           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Historique des mouvements de solde de conges (audit), un mouvement par
-- demande de type CONGE approuvee. Equivalent de rh_conges chez OGAA.
CREATE TABLE IF NOT EXISTS conge_historique (
    id                      UUID PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    employe_id              UUID NOT NULL REFERENCES employe(id) ON DELETE CASCADE,
    demande_rh_id           UUID NOT NULL REFERENCES demande_rh(id) ON DELETE CASCADE,
    nb_jours                NUMERIC(5,1) NOT NULL,
    solde_avant             NUMERIC(5,1) NOT NULL,
    solde_apres             NUMERIC(5,1) NOT NULL,
    date_mouvement          TIMESTAMPTZ NOT NULL DEFAULT now()
);
