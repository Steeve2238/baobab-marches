-- 072 : modes de reglement parametrables (socle tresorerie, Pack Commerce lot 1).
-- Un mode de reglement (Especes, Virement, Cheque, Carte, Orange Money, Wave...) porte :
--   * son type (ESPECES, VIREMENT, CHEQUE, CARTE, MOBILE_MONEY, AUTRE) ;
--   * le journal de tresorerie (BANQUE/CAISSE) et/ou le compte de tresorerie qu'il alimente ;
--   * un compte d'attente optionnel (ex. cheques a encaisser) ;
--   * une commission optionnelle (pourcentage + compte de charge) ;
--   * le sens (encaissement, decaissement, les deux).
-- Aucun compte n'est impose : tout est parametrable par entreprise. Les colonnes texte
-- mode_paiement existantes restent (historique) ; mode_reglement_id est ajoute en plus.
CREATE TABLE IF NOT EXISTS mode_reglement (
    id               UUID PRIMARY KEY,
    tenant_id        UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code             TEXT NOT NULL,
    libelle          TEXT NOT NULL,
    type_mode        TEXT NOT NULL DEFAULT 'AUTRE'
                     CHECK (type_mode IN ('ESPECES', 'VIREMENT', 'CHEQUE', 'CARTE', 'MOBILE_MONEY', 'AUTRE')),
    journal_id       UUID REFERENCES journal_comptable(id) ON DELETE SET NULL,
    compte_tresorerie TEXT,
    compte_attente   TEXT,
    commission_pct   NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK (commission_pct >= 0 AND commission_pct <= 100),
    compte_commission TEXT,
    sens             TEXT NOT NULL DEFAULT 'LES_DEUX' CHECK (sens IN ('ENCAISSEMENT', 'DECAISSEMENT', 'LES_DEUX')),
    actif            BOOLEAN NOT NULL DEFAULT true,
    par_defaut       BOOLEAN NOT NULL DEFAULT false,
    ordre            INTEGER NOT NULL DEFAULT 0,
    date_creation    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_mode_reglement_tenant ON mode_reglement (tenant_id, actif, ordre);

ALTER TABLE reglement_client      ADD COLUMN IF NOT EXISTS mode_reglement_id UUID REFERENCES mode_reglement(id) ON DELETE SET NULL;
ALTER TABLE reglement_fournisseur ADD COLUMN IF NOT EXISTS mode_reglement_id UUID REFERENCES mode_reglement(id) ON DELETE SET NULL;
ALTER TABLE facture_vente         ADD COLUMN IF NOT EXISTS mode_reglement_id UUID REFERENCES mode_reglement(id) ON DELETE SET NULL;
