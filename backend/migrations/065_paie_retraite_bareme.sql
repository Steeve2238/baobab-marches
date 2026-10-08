-- PAIE-3C : bareme de l'indemnite de depart a la retraite, parametrable (convention collective, accord d'entreprise).
-- Aucun taux n'est impose par la plateforme : l'entreprise saisit les tranches de sa convention.
-- tranches_json : [{ de_annees, a_annees (null = sans limite), pourcentage_par_an }] - pourcentage du salaire mensuel de reference
-- par annee d'anciennete comprise dans la tranche. plafond_mois : plafond de l'indemnite en mois de salaire de reference (optionnel).
CREATE TABLE IF NOT EXISTS paie_retraite_bareme (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    convention_id   UUID REFERENCES paie_convention(id) ON DELETE SET NULL,
    libelle         TEXT NOT NULL,
    date_effet      DATE NOT NULL,
    tranches_json   JSONB NOT NULL,
    plafond_mois    NUMERIC(6,2),
    note            TEXT,
    date_creation   TIMESTAMPTZ NOT NULL DEFAULT now(),
    cree_par        UUID
);
CREATE INDEX IF NOT EXISTS idx_paie_retraite_bareme_tenant ON paie_retraite_bareme (tenant_id, date_effet DESC);
