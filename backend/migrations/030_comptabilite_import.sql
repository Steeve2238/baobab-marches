-- Comptabilite - import des donnees Sage (grand livre, balance) - 04/10/2026.
-- Un "lot" regroupe les ecritures creees par un meme import : il peut etre
-- annule tant que les numeros d'ecriture qu'il a consommes sont les derniers
-- de leur journal (pas de trou dans la numerotation continue).

CREATE TABLE IF NOT EXISTS compta_import_lot (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  type_import TEXT NOT NULL CHECK (type_import IN ('GRAND_LIVRE', 'BALANCE')),
  nom_fichier TEXT,
  empreinte TEXT NOT NULL,
  statut_ecritures TEXT NOT NULL DEFAULT 'VALIDEE' CHECK (statut_ecritures IN ('VALIDEE', 'EN_INSTANCE')),
  nb_ecritures INTEGER NOT NULL DEFAULT 0,
  nb_lignes INTEGER NOT NULL DEFAULT 0,
  total_debit NUMERIC(18, 2) NOT NULL DEFAULT 0,
  total_credit NUMERIC(18, 2) NOT NULL DEFAULT 0,
  parametres JSONB,
  rapport JSONB,
  statut TEXT NOT NULL DEFAULT 'ACTIF' CHECK (statut IN ('ACTIF', 'ANNULE')),
  cree_par UUID REFERENCES utilisateur(id),
  date_creation TIMESTAMPTZ NOT NULL DEFAULT now(),
  annule_par UUID REFERENCES utilisateur(id),
  date_annulation TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_import_lot_tenant ON compta_import_lot (tenant_id, date_creation DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_lot_actif
  ON compta_import_lot (tenant_id, type_import, empreinte) WHERE statut = 'ACTIF';

ALTER TABLE ecriture_comptable ADD COLUMN IF NOT EXISTS import_lot_id UUID REFERENCES compta_import_lot(id);
CREATE INDEX IF NOT EXISTS idx_ecriture_import_lot ON ecriture_comptable (import_lot_id) WHERE import_lot_id IS NOT NULL;
