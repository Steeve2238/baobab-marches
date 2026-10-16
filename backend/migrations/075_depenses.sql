-- 075 : depenses et resultat mensuel (Pack Commerce, lot 5)
--  * categorie_depense : categories parametrables, chacune reliee a un compte de charge
--    (et eventuellement a un compte de TVA recuperable). Les comptes proposes par defaut
--    ne sont que des propositions, modifiables par l'entreprise.
--  * depense : saisie rapide d'une depense reglee via un mode de reglement ; ecriture
--    comptable automatique (en instance) si le module comptabilite est actif.

CREATE TABLE IF NOT EXISTS categorie_depense (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  libelle     TEXT NOT NULL,
  compte_charge TEXT,
  compte_tva  TEXT,
  actif       BOOLEAN NOT NULL DEFAULT true,
  ordre       INTEGER NOT NULL DEFAULT 0,
  date_creation TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS depense (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  numero          TEXT NOT NULL,
  date_depense    DATE NOT NULL DEFAULT CURRENT_DATE,
  categorie_id    UUID NOT NULL REFERENCES categorie_depense(id),
  libelle         TEXT NOT NULL,
  beneficiaire    TEXT,
  montant_ttc     NUMERIC(18,2) NOT NULL CHECK (montant_ttc > 0),
  taux_tva_pourcentage NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (taux_tva_pourcentage >= 0 AND taux_tva_pourcentage <= 100),
  montant_tva     NUMERIC(18,2) NOT NULL DEFAULT 0,
  montant_ht      NUMERIC(18,2) NOT NULL,
  mode_reglement_id UUID REFERENCES mode_reglement(id),
  mode_libelle    TEXT,
  reference       TEXT,
  statut          TEXT NOT NULL DEFAULT 'ENREGISTREE' CHECK (statut IN ('ENREGISTREE', 'ANNULEE')),
  cree_par        UUID REFERENCES utilisateur(id),
  date_creation   TIMESTAMPTZ NOT NULL DEFAULT now(),
  date_annulation TIMESTAMPTZ,
  UNIQUE (tenant_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_depense_tenant_date ON depense (tenant_id, date_depense);
