-- 076 : stock (Pack Commerce, lot 6a/6b)
--  * methode de valorisation du stock choisie par l'entreprise (CMUP / FIFO / dernier cout),
--    avec date d'effet (pas de retroactivite sur les sorties deja enregistrees) et historique des changements ;
--  * seuil d'alerte de stock par produit (a defaut : seuil par defaut de l'application) ;
--  * inventaire physique : comptage, ecarts, validation => ajustements de stock.

ALTER TABLE tenant ADD COLUMN IF NOT EXISTS methode_valorisation_stock TEXT NOT NULL DEFAULT 'DERNIER_COUT';
ALTER TABLE tenant DROP CONSTRAINT IF EXISTS chk_tenant_methode_valorisation;
ALTER TABLE tenant ADD CONSTRAINT chk_tenant_methode_valorisation CHECK (methode_valorisation_stock IN ('DERNIER_COUT', 'CMUP', 'FIFO'));
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS valorisation_date_effet DATE;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS seuil_stock_defaut NUMERIC(14,3) NOT NULL DEFAULT 5;

ALTER TABLE produit ADD COLUMN IF NOT EXISTS seuil_alerte NUMERIC(14,3);

CREATE TABLE IF NOT EXISTS stock_valorisation_historique (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  methode     TEXT NOT NULL CHECK (methode IN ('DERNIER_COUT', 'CMUP', 'FIFO')),
  date_effet  DATE NOT NULL,
  cree_par    UUID REFERENCES utilisateur(id),
  date_creation TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_valo_hist ON stock_valorisation_historique (tenant_id, date_effet DESC);

CREATE TABLE IF NOT EXISTS inventaire (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  numero        TEXT NOT NULL,
  libelle       TEXT,
  date_inventaire DATE NOT NULL DEFAULT CURRENT_DATE,
  categorie     TEXT,
  statut        TEXT NOT NULL DEFAULT 'BROUILLON' CHECK (statut IN ('BROUILLON', 'VALIDE', 'ANNULE')),
  cree_par      UUID REFERENCES utilisateur(id),
  date_creation TIMESTAMPTZ NOT NULL DEFAULT now(),
  valide_par    UUID REFERENCES utilisateur(id),
  date_validation TIMESTAMPTZ,
  UNIQUE (tenant_id, numero)
);

CREATE TABLE IF NOT EXISTS inventaire_ligne (
  id            UUID PRIMARY KEY,
  inventaire_id UUID NOT NULL REFERENCES inventaire(id) ON DELETE CASCADE,
  produit_id    UUID NOT NULL REFERENCES produit(id) ON DELETE CASCADE,
  quantite_theorique NUMERIC(18,3) NOT NULL DEFAULT 0,
  quantite_comptee   NUMERIC(18,3),
  ecart         NUMERIC(18,3),
  cout_unitaire_xof NUMERIC(18,2),
  valeur_ecart_xof  NUMERIC(18,2),
  UNIQUE (inventaire_id, produit_id)
);
CREATE INDEX IF NOT EXISTS idx_inventaire_ligne_inv ON inventaire_ligne (inventaire_id);
