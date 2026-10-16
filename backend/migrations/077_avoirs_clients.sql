-- 077 : avoirs et retours clients (Pack Commerce, lot 6c)
--  * avoir_vente / avoir_vente_ligne : avoir lie a une facture (retour de marchandise, erreur de facturation,
--    remise commerciale), avec remise en stock optionnelle (au cout de sortie d'origine) ;
--  * le reglement de l'avoir se fait par imputation sur le solde de la facture et/ou remboursement (mode de
--    reglement de type decaissement) ;
--  * facture_vente.montant_avoir_impute : part de montant_encaisse qui provient d'avoirs (et non d'un encaissement),
--    pour ne pas la compter comme une entree de tresorerie.

ALTER TABLE facture_vente ADD COLUMN IF NOT EXISTS montant_avoir_impute NUMERIC(18,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS avoir_vente (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  numero          TEXT NOT NULL,
  facture_vente_id UUID NOT NULL REFERENCES facture_vente(id),
  client_commercial_id UUID NOT NULL REFERENCES client_commercial(id),
  date_avoir      DATE NOT NULL DEFAULT CURRENT_DATE,
  motif_type      TEXT NOT NULL CHECK (motif_type IN ('RETOUR_MARCHANDISE', 'ERREUR_FACTURATION', 'REMISE_COMMERCIALE', 'ANNULATION_VENTE', 'AUTRE')),
  motif           TEXT,
  taux_tva_pourcentage NUMERIC(7,4) NOT NULL DEFAULT 0,
  total_ht        NUMERIC(18,2) NOT NULL CHECK (total_ht > 0),
  montant_tva     NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_ttc       NUMERIC(18,2) NOT NULL CHECK (total_ttc > 0),
  montant_impute  NUMERIC(18,2) NOT NULL DEFAULT 0,
  montant_rembourse NUMERIC(18,2) NOT NULL DEFAULT 0,
  mode_reglement_id UUID REFERENCES mode_reglement(id),
  mode_libelle    TEXT,
  reference       TEXT,
  statut          TEXT NOT NULL DEFAULT 'VALIDE' CHECK (statut IN ('VALIDE')),
  cree_par        UUID REFERENCES utilisateur(id),
  date_creation   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_avoir_vente_facture ON avoir_vente (facture_vente_id);
CREATE INDEX IF NOT EXISTS idx_avoir_vente_tenant_date ON avoir_vente (tenant_id, date_avoir);

CREATE TABLE IF NOT EXISTS avoir_vente_ligne (
  id              UUID PRIMARY KEY,
  avoir_id        UUID NOT NULL REFERENCES avoir_vente(id) ON DELETE CASCADE,
  facture_ligne_id UUID REFERENCES facture_vente_ligne(id) ON DELETE SET NULL,
  produit_id      UUID REFERENCES produit(id) ON DELETE SET NULL,
  ordre           INTEGER NOT NULL DEFAULT 0,
  designation     TEXT NOT NULL,
  reference       TEXT,
  unite           TEXT,
  quantite        NUMERIC(14,3) NOT NULL CHECK (quantite > 0),
  prix_unitaire_ht NUMERIC(14,2) NOT NULL DEFAULT 0,
  montant_ht      NUMERIC(18,2) NOT NULL,
  retour_stock    BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_avoir_ligne_avoir ON avoir_vente_ligne (avoir_id);
CREATE INDEX IF NOT EXISTS idx_avoir_ligne_facture_ligne ON avoir_vente_ligne (facture_ligne_id);
