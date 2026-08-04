-- ============================================================================
-- Module i18n — préférence de langue de l'interface (FR / EN)
-- ============================================================================

ALTER TABLE utilisateur
  ADD COLUMN IF NOT EXISTS langue_preferee TEXT NOT NULL DEFAULT 'fr';

-- Contrainte simple pour éviter des valeurs incohérentes
ALTER TABLE utilisateur
  DROP CONSTRAINT IF EXISTS utilisateur_langue_preferee_check;

ALTER TABLE utilisateur
  ADD CONSTRAINT utilisateur_langue_preferee_check
  CHECK (langue_preferee IN ('fr', 'en'));
