-- ============================================================================
-- Migration 024 : facturation en plusieurs fois (acompte / solde) sur un
-- meme devis. Demande de Steeve (30/09/2026) : apres validation d'un devis,
-- le client peut demander un acompte a facturer (pourcentage variable selon
-- sa demande - 20%, 30%, 50%...) puis, plus tard, le solde - alors qu'avant
-- cette migration, un devis ne pouvait etre facture qu'une seule fois, en
-- totalite (voir POST /devis/:id/generer-facture, routes/ventes.js).
--
-- Principe retenu (valide avec Steeve) : le detail des lignes et les totaux
-- HT/TVA/TTC de la facture restent une copie complete et inchangee du devis
-- (valeur de reference du marche), comme avant cette migration. On ajoute
-- simplement, en bout de facture, le pourcentage d'acompte applique et un
-- "montant net a payer" distinct du total TTC - c'est ce montant net a payer
-- qui represente ce qui est reellement du sur CETTE facture precise (et donc
-- ce qui est marque paye/impaye), pas le total TTC du devis entier.
--
-- Aucune colonne de cumul n'est stockee sur le devis : le "deja facture" et
-- le "reste a facturer" sont toujours recalcules a la volee par une somme
-- sur facture_vente.montant_net_a_payer (hors factures ANNULEEs) - une seule
-- source de verite, jamais de risque de desynchronisation.
-- ============================================================================

ALTER TABLE facture_vente
  ADD COLUMN IF NOT EXISTS type_facturation     TEXT NOT NULL DEFAULT 'INTEGRALE', -- INTEGRALE | ACOMPTE | SOLDE
  ADD COLUMN IF NOT EXISTS pourcentage_acompte  NUMERIC(5,2),                      -- rempli uniquement si type_facturation = ACOMPTE
  ADD COLUMN IF NOT EXISTS montant_net_a_payer  NUMERIC(14,2) NOT NULL DEFAULT 0;  -- montant reellement du sur CETTE facture

-- Backfill des factures deja existantes (toutes INTEGRALE avant cette
-- migration) : leur montant net a payer est leur total TTC en entier.
UPDATE facture_vente SET montant_net_a_payer = total_ttc WHERE montant_net_a_payer = 0;
