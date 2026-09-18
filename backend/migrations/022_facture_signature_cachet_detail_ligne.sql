-- ============================================================================
-- Migration 022 : signature + cachet sur les factures Super Admin, et detail
-- de ligne reellement lisible (formule + plafond d'utilisateurs vendus).
-- Demande de Steeve le 18/09/2026, en deux points :
--   1. "En bas a droite de la facture, la mention 'La Direction' avec en
--      dessous un endroit ou on peut scanner la signature et le cachet."
--   2. "Les factures ne sont pas assez precises : pour la formule Essentiel
--      il faut qu'il soit ecrit clairement de quoi il s'agit (la formule, son
--      plafond d'utilisateurs), avec Quantite, Prix unitaire et Montant total
--      comme sur une vraie facture. Pour l'installation aussi, un vrai
--      descriptif."
--
-- Perimetre STRICT : facturation Super Admin (facture_abonnement /
-- plateforme_parametres). Les factures du module Ventes/Negoce
-- (facture_vente) ont deja leur propre en-tete/pied de page et ne sont pas
-- touchees ici.
-- ============================================================================

-- 1. Signature + cachet du Super Admin : UNE SEULE image (le cachet papier
-- est scanne avec la signature dessus, c'est l'usage reel - pas deux champs
-- separes qu'il faudrait ensuite repositionner l'un par rapport a l'autre).
-- Stockee exactement comme le logo de la plateforme (base64 + type MIME, voir
-- migration 018 et POST /api/super-admin/parametres/entete/logo) : meme
-- table singleton, meme convention de nommage, meme upload multer 2 Mo
-- PNG/JPEG cote backend. TEXT (et non VARCHAR(n)) pour rester homogene avec
-- logo_base64/logo_type_mime sur la meme table.
ALTER TABLE plateforme_parametres
  ADD COLUMN IF NOT EXISTS signature_cachet_base64    TEXT,
  ADD COLUMN IF NOT EXISTS signature_cachet_type_mime TEXT;

-- 2. Plafond d'utilisateurs FIGE sur la facture, au meme titre que
-- formule_nom et montant_xof le sont deja depuis la migration 014. Sans
-- cette colonne, une facture d'un mois passe afficherait le plafond ACTUEL
-- de la formule : si Steeve fait passer un jour "Essentiel" de 5 a 10
-- utilisateurs, toutes les anciennes factures Essentiel afficheraient
-- retroactivement "jusqu'a 10 utilisateurs" alors que ce n'est pas ce qui a
-- ete vendu ce mois-la. Meme convention que
-- formule_abonnement.plafond_utilisateurs : NULL = utilisateurs illimites.
--
-- Les factures deja generees avant cette migration restent donc a NULL : le
-- frontend ne peut pas distinguer "illimite" d'un plafond inconnu sur ces
-- anciennes lignes et affichera "utilisateurs illimites". Aucun UPDATE
-- retroactif n'est fait ici, volontairement : on ne reecrit jamais une
-- facture deja emise (si des factures anciennes existent deja en production
-- et que leur plafond doit y figurer, ce sera une correction manuelle
-- explicite, ligne par ligne, pas un effet de bord de migration).
ALTER TABLE facture_abonnement
  ADD COLUMN IF NOT EXISTS plafond_utilisateurs_facture INTEGER;
