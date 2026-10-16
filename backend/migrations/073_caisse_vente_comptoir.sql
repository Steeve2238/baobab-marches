-- 073 : Caisse / vente comptoir (Pack Commerce, lot 2).
-- * client_commercial.est_comptoir : « Client comptoir » (client anonyme cree a la volee, un par entreprise).
-- * devis.origine / facture_vente.origine : MANUEL (circuit habituel) ou CAISSE (vente au comptoir : le devis technique,
--   valide d'office, n'apparait pas dans les listes de devis).
-- * facture_vente.vendeur_id : utilisateur qui a fait la vente (journal des ventes par vendeur).
-- * encaissement_caisse : une ligne par mode de reglement utilise lors d'une vente comptoir (paiement multiple).
ALTER TABLE client_commercial ADD COLUMN IF NOT EXISTS est_comptoir BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_comptoir ON client_commercial (tenant_id) WHERE est_comptoir = true;

ALTER TABLE devis ADD COLUMN IF NOT EXISTS origine TEXT NOT NULL DEFAULT 'MANUEL';
ALTER TABLE devis DROP CONSTRAINT IF EXISTS devis_origine_check;
ALTER TABLE devis ADD CONSTRAINT devis_origine_check CHECK (origine IN ('MANUEL', 'CAISSE'));

ALTER TABLE facture_vente ADD COLUMN IF NOT EXISTS origine TEXT NOT NULL DEFAULT 'MANUEL';
ALTER TABLE facture_vente DROP CONSTRAINT IF EXISTS facture_vente_origine_check;
ALTER TABLE facture_vente ADD CONSTRAINT facture_vente_origine_check CHECK (origine IN ('MANUEL', 'CAISSE'));
ALTER TABLE facture_vente ADD COLUMN IF NOT EXISTS vendeur_id UUID REFERENCES utilisateur(id);
CREATE INDEX IF NOT EXISTS idx_facture_vente_origine ON facture_vente (tenant_id, origine, date_facture);

CREATE TABLE IF NOT EXISTS encaissement_caisse (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    facture_id          UUID NOT NULL REFERENCES facture_vente(id) ON DELETE CASCADE,
    mode_reglement_id   UUID REFERENCES mode_reglement(id) ON DELETE SET NULL,
    mode_libelle        TEXT NOT NULL,
    montant             NUMERIC(18,2) NOT NULL CHECK (montant > 0),   -- montant encaisse (apres rendu de monnaie)
    montant_remis       NUMERIC(18,2),                                 -- montant remis par le client (especes : avant rendu)
    reference           TEXT,
    vendeur_id          UUID REFERENCES utilisateur(id),
    date_encaissement   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_encaissement_caisse_facture ON encaissement_caisse (facture_id);
CREATE INDEX IF NOT EXISTS idx_encaissement_caisse_tenant_date ON encaissement_caisse (tenant_id, date_encaissement);
