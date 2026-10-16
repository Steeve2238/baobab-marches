-- 074 : bons de commande (Pack Commerce, lot 4)
--  * BC client : reference + date sur le devis (recopiees sur les factures) + scan archive
--  * BC fournisseur : document imprimable en bonne et due forme (conditions, transmission,
--    confirmation fournisseur) ; aucun nouveau statut (BROUILLON -> CONFIRMEE -> receptions)
--  * piece_jointe : archive generique (scan du BC client, BC fournisseur signe retourne)

ALTER TABLE devis
  ADD COLUMN IF NOT EXISTS reference_bc_client TEXT,
  ADD COLUMN IF NOT EXISTS date_bc_client DATE;

ALTER TABLE commande_fournisseur
  ADD COLUMN IF NOT EXISTS conditions_paiement TEXT,
  ADD COLUMN IF NOT EXISTS lieu_livraison TEXT,
  ADD COLUMN IF NOT EXISTS reference_fournisseur TEXT,
  ADD COLUMN IF NOT EXISTS date_transmission DATE,
  ADD COLUMN IF NOT EXISTS date_confirmation_fournisseur DATE;

CREATE TABLE IF NOT EXISTS piece_jointe (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  entite_type   TEXT NOT NULL CHECK (entite_type IN ('DEVIS_BC_CLIENT', 'COMMANDE_FOURNISSEUR')),
  entite_id     UUID NOT NULL,
  nom_fichier   TEXT NOT NULL,
  type_mime     TEXT NOT NULL,
  taille        INTEGER NOT NULL,
  contenu       BYTEA NOT NULL,
  cree_par      UUID REFERENCES utilisateur(id),
  date_creation TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_piece_jointe_entite ON piece_jointe (tenant_id, entite_type, entite_id);

-- Coordonnees du fournisseur (en-tete du bon de commande imprime)
ALTER TABLE fournisseur
  ADD COLUMN IF NOT EXISTS adresse TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS telephone TEXT,
  ADD COLUMN IF NOT EXISTS contact_nom TEXT;
