-- Migration 018 : pied de page des documents imprimables (RCCM, NINEA, site
-- web, coordonnees bancaires) + parametres d'entete/pied de page du Super
-- Admin lui-meme (Steeve / YMS Groupe / Max Consulting), utilises sur les
-- factures d'abonnement generees cote Super Admin (voir routes/superAdmin.js)
-- - demande explicite de Steeve le 05/09/2026 : que les factures, aussi bien
-- cote client (module Ventes) que cote plateforme (facturation Super Admin),
-- ressemblent a de vraies factures imprimees, avec un en-tete ET un pied de
-- page complets (mentions legales).

-- Pied de page : ajoute aux memes tenants qui ont deja l'entete (voir
-- migration 004_entete_structure.sql) - reutilise le meme mecanisme
-- (GET/PATCH /api/parametres/entete), simplement avec 4 champs de plus.
ALTER TABLE tenant
  ADD COLUMN IF NOT EXISTS rccm TEXT,
  ADD COLUMN IF NOT EXISTS ninea TEXT,
  ADD COLUMN IF NOT EXISTS site_web TEXT,
  ADD COLUMN IF NOT EXISTS coordonnees_bancaires TEXT;

-- Table singleton (une seule ligne, toujours) : contrairement a "tenant" (une
-- ligne par entreprise cliente), la plateforme elle-meme n'a qu'un seul
-- proprietaire (Steeve) - une cle primaire booleenne avec CHECK (id) empeche
-- toute deuxieme ligne d'exister, pattern standard pour un singleton
-- Postgres.
CREATE TABLE IF NOT EXISTS plateforme_parametres (
    id                      BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    raison_sociale          TEXT,
    adresse                 TEXT,
    telephone               TEXT,
    email                   TEXT,
    rccm                    TEXT,
    ninea                   TEXT,
    site_web                TEXT,
    coordonnees_bancaires   TEXT,
    logo_base64             TEXT,
    logo_type_mime          TEXT
);

INSERT INTO plateforme_parametres (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;
