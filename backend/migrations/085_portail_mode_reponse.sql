-- Portail de remise tracee : le client peut ACCEPTER (bouton « J'accepte », sans signature dessinee), SIGNER (signature manuscrite) ou seulement CONSULTER.
--  - offre / devis : acceptation par defaut ; contrat : signature ; facture : consultation (acceptation = accuse de reception) ;
--  - mode_reponse sur chaque partage ; signature_requise reste vrai tant qu'une reponse est demandee (acceptation ou signature) ;
--  - portail_signature : l'image devient facultative (une acceptation n'a pas de dessin), mode ACCEPTATION.
ALTER TABLE portail_partage ADD COLUMN IF NOT EXISTS mode_reponse TEXT NOT NULL DEFAULT 'SIGNATURE';
ALTER TABLE portail_partage DROP CONSTRAINT IF EXISTS portail_partage_mode_reponse_check;
ALTER TABLE portail_partage ADD CONSTRAINT portail_partage_mode_reponse_check CHECK (mode_reponse IN ('SIGNATURE', 'ACCEPTATION', 'CONSULTATION'));
UPDATE portail_partage SET mode_reponse = 'CONSULTATION' WHERE signature_requise = false AND mode_reponse = 'SIGNATURE';
ALTER TABLE portail_signature ALTER COLUMN image_base64 DROP NOT NULL;
ALTER TABLE portail_signature DROP CONSTRAINT IF EXISTS portail_signature_mode_check;
ALTER TABLE portail_signature ADD CONSTRAINT portail_signature_mode_check CHECK (mode IN ('DESSINEE', 'IMPORTEE', 'ACCEPTATION'));
