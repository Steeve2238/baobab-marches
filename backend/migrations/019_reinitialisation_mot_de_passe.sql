-- Migration 019 : reinitialisation de mot de passe par email ("mot de passe
-- oublie"), pour les utilisateurs clients ET pour le Super Admin - demande
-- explicite de Steeve le 06/09/2026 ("que ce soit le client ou que ce soit
-- moi"). Une seule table partagee entre les deux espaces (discriminee par
-- type_compte) plutot que deux tables quasi-identiques, car la logique de
-- generation/validation du jeton est strictement la meme des deux cotes -
-- voir routes/auth.js (POST /mot-de-passe-oublie, /reinitialiser-mot-de-passe)
-- et routes/superAdmin.js (memes routes, prefixees /super-admin/auth/...).
--
-- Le jeton lui-meme n'est JAMAIS stocke en clair : seul son empreinte SHA-256
-- (jeton_hash) est enregistree, de la meme facon qu'un mot de passe n'est
-- jamais stocke en clair (mot_de_passe_hash) - un vol de la base ne suffit
-- donc pas a reutiliser un lien de reinitialisation intercepte ailleurs.

CREATE TABLE IF NOT EXISTS jeton_reinitialisation_mot_de_passe (
    id                  UUID PRIMARY KEY,
    type_compte         TEXT NOT NULL CHECK (type_compte IN ('UTILISATEUR', 'SUPER_ADMIN')),
    compte_id           UUID NOT NULL,
    jeton_hash          TEXT NOT NULL,
    date_expiration     TIMESTAMPTZ NOT NULL,
    utilise             BOOLEAN NOT NULL DEFAULT false,
    date_creation       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recherche par jeton_hash a chaque tentative de reinitialisation : index
-- necessaire (une table de jetons grossit en continu, contrairement a
-- plateforme_parametres qui reste a une seule ligne).
CREATE INDEX IF NOT EXISTS idx_jeton_reinit_hash ON jeton_reinitialisation_mot_de_passe (jeton_hash);

-- Retrouver/invalider tous les jetons en cours d'un compte (ex : a la
-- reussite d'une reinitialisation, on invalide les autres jetons du meme
-- compte pour eviter qu'un lien plus ancien encore valide traine).
CREATE INDEX IF NOT EXISTS idx_jeton_reinit_compte ON jeton_reinitialisation_mot_de_passe (type_compte, compte_id);
