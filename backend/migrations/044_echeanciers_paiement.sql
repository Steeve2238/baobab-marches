-- Migration 044 : echeanciers de paiement (06/10/2026).
-- Conditions de paiement structurees (liste de lignes pourcentage + evenement + jours)
-- portees par les fiches client et fournisseur (valeur par defaut), puis copiees sur
-- les devis, factures de vente et commandes fournisseur (modifiables document par
-- document). Alimente le plan de tresorerie par dossier.
-- Idempotente : ADD COLUMN IF NOT EXISTS.

ALTER TABLE client_commercial   ADD COLUMN IF NOT EXISTS echeancier_json JSONB;
ALTER TABLE fournisseur         ADD COLUMN IF NOT EXISTS echeancier_json JSONB;
ALTER TABLE devis               ADD COLUMN IF NOT EXISTS echeancier_json JSONB;
ALTER TABLE facture_vente       ADD COLUMN IF NOT EXISTS echeancier_json JSONB;
ALTER TABLE commande_fournisseur ADD COLUMN IF NOT EXISTS echeancier_json JSONB;
