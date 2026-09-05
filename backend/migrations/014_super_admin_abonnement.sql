-- Module Super Admin (nouveau chantier, cadre et confirme avec Steeve le
-- 04/09/2026 - voir claude/resume_reprise_projet.md) : Baobab Marches devient
-- une vraie plateforme SaaS multi-clients hebergee par Steeve. Ce fichier
-- cree :
--   1. Un espace "Super Admin" totalement separe des comptes des entreprises
--      clientes (table dediee, PAS de tenant_id - ce n'est pas un role parmi
--      d'autres a l'interieur d'un tenant, c'est au-dessus de tous les
--      tenants). Un seul compte pour l'instant (Steeve), d'autres pourront
--      etre ajoutes plus tard depuis l'espace Super Admin lui-meme.
--   2. Un catalogue de formules d'abonnement (nom, plafond d'utilisateurs,
--      prix mensuel) - modifiable depuis le Super Admin, pas code en dur.
--      Decision actee avec Steeve : les formules ne limitent QUE le tarif et
--      le nombre d'utilisateurs, pas l'acces aux modules (tous les clients
--      ont acces a toute la plateforme).
--   3. Une facturation mensuelle en SUIVI MANUEL (decision actee : pas de
--      passerelle de paiement en ligne dans cette version) - Steeve genere la
--      facture du mois pour un client et la marque payee/impayee lui-meme.
--
-- tenant.actif existait deja depuis le schema d'origine mais n'etait verifie
-- nulle part au moment de la connexion (verifie en relisant auth.js avant de
-- coder) : corrige dans le meme mouvement cote backend (routes/auth.js),
-- cette migration ajoute juste la reference vers la formule d'abonnement.

CREATE TABLE IF NOT EXISTS administrateur_plateforme (
    id                      UUID PRIMARY KEY,
    email                   TEXT NOT NULL UNIQUE,
    nom                     TEXT NOT NULL,
    mot_de_passe_hash       TEXT NOT NULL,
    mot_de_passe_temporaire BOOLEAN NOT NULL DEFAULT true,
    actif                   BOOLEAN NOT NULL DEFAULT true,
    date_creation           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS formule_abonnement (
    id                    UUID PRIMARY KEY,
    nom                   TEXT NOT NULL,
    plafond_utilisateurs  INTEGER,                        -- NULL = illimite
    prix_mensuel_xof      NUMERIC(12,0) NOT NULL,
    ordre_affichage       INTEGER NOT NULL DEFAULT 0,
    actif                 BOOLEAN NOT NULL DEFAULT true   -- false = retiree du catalogue (plus assignable a un nouveau client), conservee pour l'historique des clients qui l'ont deja
);

ALTER TABLE tenant ADD COLUMN IF NOT EXISTS formule_abonnement_id UUID REFERENCES formule_abonnement(id);

-- Une facture = un mois pour un client. formule_nom/montant_xof sont FIGES au
-- moment de la generation (comme chaine_approbation pour les demandes RH) :
-- un changement de prix de la formule apres coup ne doit jamais modifier une
-- facture deja generee.
CREATE TABLE IF NOT EXISTS facture_abonnement (
    id                      UUID PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    formule_abonnement_id   UUID REFERENCES formule_abonnement(id),
    formule_nom             TEXT NOT NULL,
    periode                 TEXT NOT NULL,                -- "AAAA-MM", ex "2026-09"
    montant_xof             NUMERIC(12,0) NOT NULL,
    statut                  TEXT NOT NULL DEFAULT 'IMPAYEE', -- IMPAYEE | PAYEE | ANNULEE
    date_generation         TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_paiement           TIMESTAMPTZ,
    mode_paiement           TEXT,                          -- note libre : virement, mobile money, cheque...
    notes                   TEXT,
    UNIQUE (tenant_id, periode)
);

CREATE INDEX IF NOT EXISTS idx_facture_abonnement_tenant ON facture_abonnement(tenant_id);
CREATE INDEX IF NOT EXISTS idx_facture_abonnement_statut ON facture_abonnement(statut);

-- Formules de depart proposees a Steeve (voir echange du 04/09/2026) -
-- entierement modifiables ensuite depuis le Super Admin, ce ne sont que des
-- valeurs de demarrage.
-- gen_random_uuid()/uuid_generate_v4() indisponibles sur certains serveurs
-- PostgreSQL mutualises (extensions pgcrypto/uuid-ossp absentes, sans acces
-- superutilisateur pour les installer) : on genere l'identifiant avec
-- md5(random()::text || clock_timestamp()::text)::uuid, qui ne depend que de
-- fonctions du coeur de PostgreSQL et fonctionne sur toute version.
INSERT INTO formule_abonnement (id, nom, plafond_utilisateurs, prix_mensuel_xof, ordre_affichage)
SELECT md5(random()::text || clock_timestamp()::text)::uuid, 'Essentiel', 5, 50000, 1
WHERE NOT EXISTS (SELECT 1 FROM formule_abonnement WHERE nom = 'Essentiel');

INSERT INTO formule_abonnement (id, nom, plafond_utilisateurs, prix_mensuel_xof, ordre_affichage)
SELECT md5(random()::text || clock_timestamp()::text)::uuid, 'Croissance', 15, 120000, 2
WHERE NOT EXISTS (SELECT 1 FROM formule_abonnement WHERE nom = 'Croissance');

INSERT INTO formule_abonnement (id, nom, plafond_utilisateurs, prix_mensuel_xof, ordre_affichage)
SELECT md5(random()::text || clock_timestamp()::text)::uuid, 'Entreprise', NULL, 250000, 3
WHERE NOT EXISTS (SELECT 1 FROM formule_abonnement WHERE nom = 'Entreprise');

-- Compte Super Admin de Steeve. Mot de passe temporaire : SuperAdmin@2026
-- (hache bcrypt ci-dessous, cout 10) - a changer a la premiere connexion,
-- comme pour tout nouveau compte utilisateur cree sur la plateforme.
INSERT INTO administrateur_plateforme (id, email, nom, mot_de_passe_hash, mot_de_passe_temporaire)
SELECT md5(random()::text || clock_timestamp()::text)::uuid, 'ymsgroupe@gmail.com', 'Steeve Yana', '$2a$10$93R0Mp3w8UZn2EG4lUzwteP38YJrS38NhRNpw7l4qO97LDRlK/VkO', true
WHERE NOT EXISTS (SELECT 1 FROM administrateur_plateforme WHERE email = 'ymsgroupe@gmail.com');
