-- Module Comptabilite vendu en option (05/10/2026, demande de Steeve) :
-- verrouille par defaut pour tous les clients, active uniquement depuis
-- l'espace Super Admin. Tant qu'il est verrouille, aucune route comptable
-- n'est accessible (meme pour un ADMIN du client), aucune ecriture de vente
-- n'est generee, aucun tiers comptable n'est cree. Les donnees deja saisies
-- ne sont JAMAIS supprimees : a la reactivation le client retrouve tout (et
-- l'ecran "En instance" propose le rattrapage des ventes manquantes).
--
-- Facturation : le supplement mensuel du module est fige sur chaque facture
-- d'abonnement au moment de sa generation (colonne dediee, comme le plafond
-- d'utilisateurs - migration 022) ; montant_xof reste le TOTAL facture, ce
-- qui laisse tous les tableaux et totaux existants inchanges.

ALTER TABLE tenant ADD COLUMN IF NOT EXISTS module_comptabilite_actif BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS module_comptabilite_prix_mensuel_xof NUMERIC(12,0) NOT NULL DEFAULT 0;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS module_comptabilite_date_activation TIMESTAMPTZ;

ALTER TABLE facture_abonnement ADD COLUMN IF NOT EXISTS supplement_comptabilite_xof NUMERIC(12,0) NOT NULL DEFAULT 0;
