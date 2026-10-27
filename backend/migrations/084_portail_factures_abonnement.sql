-- Portail de remise tracee : extension aux factures d'abonnement / installation / licence que l'editeur (Super Admin) envoie a ses entreprises clientes.
--  - nouveau type_document FACTURE_ABO (origine EDITEUR, comme les offres et contrats) ;
--  - la signature y est facultative (accuse de reception), comme pour les factures des entreprises.
ALTER TABLE portail_partage DROP CONSTRAINT IF EXISTS portail_partage_type_document_check;
ALTER TABLE portail_partage ADD CONSTRAINT portail_partage_type_document_check CHECK (type_document IN ('OFFRE', 'CONTRAT', 'FACTURE', 'DEVIS', 'FACTURE_ABO'));
