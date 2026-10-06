-- Autres charges directes d'un dossier (commissions d'apporteur, deplacements,
-- personnel affecte...) : saisie libre, reprise dans le compte d'exploitation.
CREATE TABLE IF NOT EXISTS dossier_charge_directe (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  dossier_ao_id UUID REFERENCES dossier_ao(id) ON DELETE CASCADE,
  consultation_id UUID REFERENCES consultation(id) ON DELETE CASCADE,
  libelle TEXT NOT NULL,
  montant_xof NUMERIC(18,2) NOT NULL CHECK (montant_xof >= 0),
  ordre INTEGER NOT NULL DEFAULT 0,
  cree_par UUID REFERENCES utilisateur(id),
  date_creation TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dossier_charge_directe_un_rattachement CHECK (((dossier_ao_id IS NOT NULL)::integer + (consultation_id IS NOT NULL)::integer) = 1)
);
CREATE INDEX IF NOT EXISTS idx_charge_directe_ao ON dossier_charge_directe (tenant_id, dossier_ao_id);
CREATE INDEX IF NOT EXISTS idx_charge_directe_consultation ON dossier_charge_directe (tenant_id, consultation_id);
