-- Chantier E, phase 2 (04/10/2026) : ecritures automatiques des ventes et
-- ecran "Ecritures en instance".
--
-- * compta_parametre.compte_tva_collectee : compte de TVA facturee sur ventes.
-- * ligne_ecriture.compte_modifiable : marque les lignes dont le compte peut
--   etre change par le comptable avant validation ('PRODUIT' = compte de vente
--   classe 7 ; 'TRESORERIE' = banque / caisse classe 5). Le 411, la TVA et le
--   4191 ne sont jamais modifiables (ils viennent de la facture).
-- * compta_regle_compte_vente : memorise "pour ce client / cette designation,
--   utiliser ce compte de vente" afin de corriger une fois pour toutes.

ALTER TABLE compta_parametre
    ADD COLUMN IF NOT EXISTS compte_tva_collectee TEXT NOT NULL DEFAULT '44310000';

ALTER TABLE ligne_ecriture
    ADD COLUMN IF NOT EXISTS compte_modifiable TEXT
    CHECK (compte_modifiable IS NULL OR compte_modifiable IN ('PRODUIT', 'TRESORERIE'));

CREATE TABLE IF NOT EXISTS compta_regle_compte_vente (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    critere         TEXT NOT NULL CHECK (critere IN ('CLIENT', 'DESIGNATION')),
    valeur          TEXT NOT NULL,          -- id du client commercial, ou designation en minuscules
    libelle_valeur  TEXT,                   -- nom du client / designation d'origine (affichage)
    compte_numero   TEXT NOT NULL,
    cree_par        UUID REFERENCES utilisateur(id),
    date_creation   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, critere, valeur)
);

-- Recherche des ecritures en instance et des pieces d'origine
CREATE INDEX IF NOT EXISTS idx_ecriture_instance ON ecriture_comptable(tenant_id, statut)
    WHERE statut = 'EN_INSTANCE';

-- Comptes de TVA des entreprises deja initialisees : alignes sur la longueur de compte choisie
UPDATE compta_parametre SET compte_tva_collectee = rpad('4431', longueur_compte, '0');
