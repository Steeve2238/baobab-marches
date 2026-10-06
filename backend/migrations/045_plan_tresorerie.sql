-- Migration 045 : plan de tresorerie previsionnel par dossier (06/10/2026).
-- Un enregistrement de parametres par dossier (appel d'offres OU consultation restreinte) :
-- date d'engagement T, base TTC/HT, delais des jalons, financement retenu pour le plan,
-- echeanciers modifies pour ce dossier, autres flux. Le plan lui-meme est calcule a la volee.
-- Idempotente.

CREATE TABLE IF NOT EXISTS plan_tresorerie (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    dossier_ao_id               UUID REFERENCES dossier_ao(id) ON DELETE CASCADE,
    consultation_id             UUID REFERENCES consultation(id) ON DELETE CASCADE,
    date_t                      DATE NOT NULL DEFAULT CURRENT_DATE,
    base                        TEXT NOT NULL DEFAULT 'TTC' CHECK (base IN ('TTC', 'HT')),
    hors_douane                 BOOLEAN NOT NULL DEFAULT false,
    apport_xof                  NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (apport_xof >= 0),
    pas                         TEXT NOT NULL DEFAULT 'AUTO' CHECK (pas IN ('AUTO', 'JOUR', 'SEMAINE', 'MOIS')),
    marge_jours                 INTEGER NOT NULL DEFAULT 15 CHECK (marge_jours >= 0 AND marge_jours <= 365),
    jalons_json                 JSONB NOT NULL DEFAULT '{}',
    avec_financement            BOOLEAN NOT NULL DEFAULT true,
    simulation_id               UUID REFERENCES financement_simulation(id) ON DELETE SET NULL,
    condition_id                UUID REFERENCES financement_condition(id) ON DELETE SET NULL,
    echeancier_client_json      JSONB,
    echeanciers_fournisseurs_json JSONB NOT NULL DEFAULT '{}',
    autres_flux_json            JSONB NOT NULL DEFAULT '[]',
    date_maj                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    cree_par                    UUID REFERENCES utilisateur(id),
    CONSTRAINT plan_tresorerie_un_dossier CHECK ((dossier_ao_id IS NOT NULL)::int + (consultation_id IS NOT NULL)::int = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_tresorerie_ao ON plan_tresorerie(dossier_ao_id) WHERE dossier_ao_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_tresorerie_consultation ON plan_tresorerie(consultation_id) WHERE consultation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_plan_tresorerie_tenant ON plan_tresorerie(tenant_id);
