-- Portail de remise tracee : extension aux factures et devis que les entreprises clientes envoient a leurs propres clients.
--  - type_document accepte FACTURE et DEVIS ;
--  - origine : EDITEUR (offres/contrats du Super Admin) ou TENANT (documents d'une entreprise ; strictement cloisonnes par tenant_id) ;
--  - signature_requise : pour une facture la signature est facultative (accuse de reception), pour un devis elle vaut acceptation ;
--  - cree_par_email : l'utilisateur qui a envoye le document recoit l'information quand le client signe.
ALTER TABLE portail_partage DROP CONSTRAINT IF EXISTS portail_partage_type_document_check;
ALTER TABLE portail_partage ADD CONSTRAINT portail_partage_type_document_check CHECK (type_document IN ('OFFRE', 'CONTRAT', 'FACTURE', 'DEVIS'));
ALTER TABLE portail_partage ADD COLUMN IF NOT EXISTS origine TEXT NOT NULL DEFAULT 'EDITEUR';
ALTER TABLE portail_partage DROP CONSTRAINT IF EXISTS portail_partage_origine_check;
ALTER TABLE portail_partage ADD CONSTRAINT portail_partage_origine_check CHECK (origine IN ('EDITEUR', 'TENANT'));
ALTER TABLE portail_partage ADD COLUMN IF NOT EXISTS signature_requise BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE portail_partage ADD COLUMN IF NOT EXISTS cree_par_email TEXT;
CREATE INDEX IF NOT EXISTS idx_portail_partage_origine ON portail_partage (origine, tenant_id, date_creation DESC);
