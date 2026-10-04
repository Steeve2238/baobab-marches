-- Devis : lignes non chiffrees (mention "NC", "Non chiffre", "En attente
-- d'informations"...) - 04/10/2026.
-- Une ligne non chiffree garde prix_unitaire_ht = 0 et montant_ht = 0 en base
-- (les colonnes restent NOT NULL, aucun lecteur existant n'est casse), mais
-- elle est marquee non_chiffre = TRUE et porte la mention saisie dans
-- mention_prix : un "0" saisi volontairement (non_chiffre = FALSE) reste donc
-- distinct d'un prix encore inconnu. Les totaux du devis ne portent que sur les
-- lignes chiffrees ; nb_lignes_non_chiffrees permet de signaler un total partiel.

ALTER TABLE devis_ligne ADD COLUMN IF NOT EXISTS non_chiffre BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE devis_ligne ADD COLUMN IF NOT EXISTS mention_prix TEXT;

ALTER TABLE facture_vente_ligne ADD COLUMN IF NOT EXISTS non_chiffre BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE facture_vente_ligne ADD COLUMN IF NOT EXISTS mention_prix TEXT;

ALTER TABLE devis ADD COLUMN IF NOT EXISTS nb_lignes_non_chiffrees INTEGER NOT NULL DEFAULT 0;
