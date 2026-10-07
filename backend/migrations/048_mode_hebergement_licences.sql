-- Chantier du 07/10/2026 : cadre "version installable" dans le Super Admin (voir
-- claude/cadrage_futur_version_installee_licence_07102026.md).
--   - Chaque client est soit HEBERGE chez Steeve (abonnement mensuel, comme avant),
--     soit LOCAL (installe chez lui : licence annuelle + frais d'installation).
--   - Chaque formule porte en plus un prix de licence annuelle (client local).
--   - Nouveau type de facture LICENCE (periode = mois de debut de la licence).
--   - Journal des licences emises (cle signee generee depuis le Super Admin). La cle elle-meme est
--     reconstructible depuis ce journal ; la cle PRIVEE de signature n'est jamais en base.

ALTER TABLE tenant ADD COLUMN IF NOT EXISTS mode_hebergement TEXT NOT NULL DEFAULT 'HEBERGE';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_mode_hebergement_check') THEN
    ALTER TABLE tenant ADD CONSTRAINT tenant_mode_hebergement_check CHECK (mode_hebergement IN ('HEBERGE', 'LOCAL'));
  END IF;
END $$;

ALTER TABLE formule_abonnement ADD COLUMN IF NOT EXISTS prix_licence_annuelle_xof NUMERIC(12,0) NOT NULL DEFAULT 0;

-- Type de facture LICENCE
ALTER TABLE facture_abonnement DROP CONSTRAINT IF EXISTS facture_abonnement_type_facture_check;
ALTER TABLE facture_abonnement
  ADD CONSTRAINT facture_abonnement_type_facture_check CHECK (type_facture IN ('ABONNEMENT', 'INSTALLATION', 'LICENCE'));

CREATE TABLE IF NOT EXISTS licence_emise (
    id                UUID PRIMARY KEY,
    tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    numero_serie      TEXT NOT NULL UNIQUE,            -- ex LIC-2026-0001
    date_emission     TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_debut        DATE NOT NULL,
    date_fin          DATE NOT NULL,
    max_utilisateurs  INTEGER,                         -- NULL = illimite
    modules_json      JSONB NOT NULL DEFAULT '{}',
    cle               TEXT NOT NULL,                   -- cle de licence signee (texte)
    facture_id        UUID REFERENCES facture_abonnement(id) ON DELETE SET NULL,
    notes             TEXT
);
CREATE INDEX IF NOT EXISTS idx_licence_emise_tenant ON licence_emise(tenant_id);
