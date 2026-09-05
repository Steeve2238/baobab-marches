-- Systeme de permissions par role (demande par Steeve le 04-05/09/2026,
-- conversation "on doit construire la veritable architecture de
-- l'organisation de l'entreprise") - Phase 1.
--
-- Jusqu'ici, role.perimetre_json et role.lecture_seule existaient dans le
-- schema depuis l'origine mais n'etaient lus/appliques nulle part (voir
-- resume_reprise_projet.md) : seuls 3 elements de menu etaient reserves a
-- ADMIN en dur, et Marche/Negoce etait le seul module a vraiment restreindre
-- des actions par role (via des codes fixes dans le code, pas via
-- perimetre_json). Cette migration ajoute la piece manquante
-- (validateur_universel) et donne des valeurs de depart sensees aux roles
-- deja crees pour le tenant demo de Steeve - le reste (nouveau middleware
-- requireModule/blockLectureSeule, ecran Roles enrichi) est cote code
-- backend/frontend, pas migration.
--
-- Portee generique : les roles restent libres par tenant (chaque client de
-- la plateforme organise les siens depuis l'ecran Roles, desormais
-- pleinement fonctionnel) - cette migration ne force RIEN sur un tenant qui
-- aurait deja personnalise un role du meme code (voir gardes ci-dessous).

-- Le Directeur General doit pouvoir tout consulter mais ne jamais rien
-- modifier lui-meme, sauf valider (Phase 2) - "validateur universel" marque
-- qu'un role peut valider a la place d'un autre role validateur absent
-- (backup mutuel DG <-> Directeur Financier, demande explicite de Steeve).
ALTER TABLE role
  ADD COLUMN IF NOT EXISTS validateur_universel BOOLEAN NOT NULL DEFAULT false;

-- --------------------------------------------------------------------------
-- Nouveaux roles d'assistanat/technique decrits par Steeve, crees pour
-- chaque tenant existant qui ne les a pas deja (ON CONFLICT sur la
-- contrainte UNIQUE(tenant_id, code) deja en place) - modules/tableau de
-- bord conformes au perimetre qu'il a donne. Un tenant qui prefere une autre
-- organisation peut librement editer/supprimer ces roles depuis l'ecran
-- Roles, comme n'importe quel autre role.
-- --------------------------------------------------------------------------

-- gen_random_uuid()/uuid_generate_v4() indisponibles sur certains serveurs
-- PostgreSQL mutualises (extensions pgcrypto/uuid-ossp absentes, sans acces
-- superutilisateur pour les installer) : on genere un identifiant distinct par
-- ligne (une par tenant existant) avec md5(random()::text ||
-- clock_timestamp()::text)::uuid, qui ne depend que de fonctions du coeur de
-- PostgreSQL et fonctionne sur toute version.
INSERT INTO role (id, tenant_id, code, libelle, perimetre_json, lecture_seule, validateur_universel)
SELECT md5(random()::text || clock_timestamp()::text || t.id::text)::uuid, t.id, 'ADMINISTRATIF', 'Assistant(e) administratif(ve)',
       '{"modules":["marches","parc-auto","logistique","fournisseurs","courriers"],"tableauDeBord":false}'::jsonb,
       false, false
FROM tenant t
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO role (id, tenant_id, code, libelle, perimetre_json, lecture_seule, validateur_universel)
SELECT md5(random()::text || clock_timestamp()::text || t.id::text)::uuid, t.id, 'COMPTABLE', 'Assistant(e) comptable',
       '{"modules":["marches","parc-auto","logistique","fournisseurs","courriers"],"tableauDeBord":false}'::jsonb,
       false, false
FROM tenant t
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO role (id, tenant_id, code, libelle, perimetre_json, lecture_seule, validateur_universel)
SELECT md5(random()::text || clock_timestamp()::text || t.id::text)::uuid, t.id, 'TECHNIQUE', 'Directeur(trice) technique',
       '{"modules":["dossiers","logistique","parc-auto","fournisseurs"],"tableauDeBord":true}'::jsonb,
       false, false
FROM tenant t
ON CONFLICT (tenant_id, code) DO NOTHING;

-- --------------------------------------------------------------------------
-- Roles deja existants (crees via le script de demo, pas via une migration
-- anterieure - voir backend/scripts/seed.js) : on leur donne les valeurs par
-- defaut decrites par Steeve, UNIQUEMENT s'ils sont encore a leur etat
-- d'origine (perimetre_json vide) pour ne jamais ecraser une personnalisation
-- deja faite par un tenant (y compris Steeve lui-meme, s'il a deja ajuste
-- quelque chose entre la conversation et l'execution de cette migration).
-- --------------------------------------------------------------------------

UPDATE role
SET perimetre_json = '{"modules":["financement","logistique","fournisseurs","courriers","parc-auto","marches","dossiers"],"tableauDeBord":true}'::jsonb,
    validateur_universel = true
WHERE code = 'DIRECTION' AND perimetre_json = '{}'::jsonb;

UPDATE role
SET perimetre_json = '{"modules":["financement"],"tableauDeBord":true}'::jsonb,
    validateur_universel = true
WHERE code = 'FINANCIER' AND perimetre_json = '{}'::jsonb;

UPDATE role
SET perimetre_json = '{"modules":["marches"],"tableauDeBord":false}'::jsonb
WHERE code = 'COMMERCIAL' AND perimetre_json = '{}'::jsonb;
