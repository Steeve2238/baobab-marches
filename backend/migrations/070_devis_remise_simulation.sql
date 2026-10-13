-- Simulateur de remise sur devis (09/10/2026) : le client accepte le devis mais demande une remise ;
-- avant de l'appliquer, la fenetre « Negocier une remise » montre la marge avant / apres.
-- 1) Precision de la remise : une remise saisie en montant ou en « net a payer vise » doit redonner EXACTEMENT
--    ce montant a la facturation, ce que 2 decimales sur le pourcentage ne garantissent pas.
ALTER TABLE devis ALTER COLUMN pourcentage_remise TYPE NUMERIC(12,8);
ALTER TABLE facture_vente ALTER COLUMN pourcentage_remise TYPE NUMERIC(12,8);

-- 2) Historique des remises appliquees (trace, marge avant / apres, couverture du calcul).
CREATE TABLE IF NOT EXISTS devis_remise_historique (
    id                UUID PRIMARY KEY,
    tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    devis_id          UUID NOT NULL REFERENCES devis(id) ON DELETE CASCADE,
    date_application  TIMESTAMPTZ NOT NULL DEFAULT now(),
    utilisateur_id    UUID REFERENCES utilisateur(id) ON DELETE SET NULL,
    utilisateur_nom   TEXT,
    mode_saisie       TEXT NOT NULL,                 -- POURCENTAGE | MONTANT | NET_TTC
    valeur_saisie     NUMERIC(18,4),
    remise_avant_pct  NUMERIC(12,8) NOT NULL DEFAULT 0,
    remise_apres_pct  NUMERIC(12,8) NOT NULL DEFAULT 0,
    montant_remise_avant NUMERIC(14,2) NOT NULL DEFAULT 0,
    montant_remise_apres NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_ttc_avant   NUMERIC(14,2),
    total_ttc_apres   NUMERIC(14,2),
    marge_avant       NUMERIC(14,2),                 -- NULL si aucune ligne chiffree avec cout de revient
    marge_apres       NUMERIC(14,2),
    marge_pct_avant   NUMERIC(8,2),
    marge_pct_apres   NUMERIC(8,2),
    lignes_avec_cout  INTEGER,
    lignes_chiffrees  INTEGER,
    motif             TEXT
);
CREATE INDEX IF NOT EXISTS idx_devis_remise_hist ON devis_remise_historique (devis_id, date_application DESC);
