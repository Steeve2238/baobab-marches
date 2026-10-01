-- Remise en pourcentage sur devis + numero manuel pour ADMIN (chantier du
-- 01/10/2026, demande ecrite du client transmise par Steeve). Deux sujets
-- distincts regroupes dans une seule migration.
--
-- 1) REMISE EN POURCENTAGE
-- Decision de Steeve : la remise se calcule sur le HT, AVANT la TVA (pratique
-- comptable standard). total_ht reste la somme BRUTE des lignes (inchange) ;
-- montant_remise = total_ht * pourcentage_remise / 100 ; la TVA et le total
-- TTC sont ensuite calcules sur le HT NET de remise (total_ht - montant_remise)
-- - voir calculerLignesEtTotaux() dans routes/ventes.js. Consequence
-- importante : AUCUN changement necessaire ailleurs dans le systeme
-- (acompte/solde, compte client, statistiques...) car tout ce code se base
-- deja sur total_ttc, qui est deja le bon montant net de remise.
-- pourcentage_remise/montant_remise sont aussi ajoutes a facture_vente : ce
-- sont des copies figees au moment de la generation de la facture, comme les
-- lignes (meme principe que le reste de la facturation), pour que le
-- detail de la remise reste visible et coherent sur le document imprime.
ALTER TABLE devis
  ADD COLUMN IF NOT EXISTS pourcentage_remise NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS montant_remise NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE facture_vente
  ADD COLUMN IF NOT EXISTS pourcentage_remise NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS montant_remise NUMERIC(14,2) NOT NULL DEFAULT 0;

-- 2) NUMERO MANUEL (ADMIN uniquement, a la creation seulement)
-- Decisions de Steeve : seul le role ADMIN peut saisir un numero personnalise
-- de devis ou de facture, et uniquement AU MOMENT DE LA CREATION (jamais
-- modifiable ensuite, voir POST /devis et POST /devis/:id/generer-facture).
-- Aucune colonne supplementaire necessaire : le numero manuel est stocke
-- directement dans la colonne "numero" existante (contrainte
-- UNIQUE(tenant_id, numero) deja en place sur devis et facture_vente) et ne
-- touche jamais au compteur de numerotation automatique
-- (compteur_numerotation) - meme principe de coexistence que l'import de
-- devis historiques (migration 025) : un numero manuel peut prendre
-- n'importe quelle forme, le format DEV-AAAA-MM-NNNN / AAAA-NNN genere
-- automatiquement n'est qu'une convention parmi d'autres possibles.
