-- 071 : frais de paiement fournisseur reels (virement, change, SWIFT...) saisis a la reception.
-- Nouveau type de cout d'approche FRAIS_PAIEMENT : il entre dans le cout de revient reel des articles
-- (donc dans le detail du cout de revient du simulateur de remise) et remplace l'estimation du
-- dossier de calcul dans le compte d'exploitation quand il est saisi. Les cotations de transitaire
-- ne l'utilisent pas (contrainte inchangee sur transitaire_cotation_ligne).
ALTER TABLE reception_cout_approche DROP CONSTRAINT IF EXISTS reception_cout_approche_type_cout_check;
ALTER TABLE reception_cout_approche
  ADD CONSTRAINT reception_cout_approche_type_cout_check
  CHECK (type_cout IN ('FRET', 'ASSURANCE', 'DOUANE', 'TRANSIT', 'TRANSPORT_LOCAL', 'FRAIS_PAIEMENT', 'AUTRE'));
