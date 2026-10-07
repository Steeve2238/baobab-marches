-- Module Fiscalite, lot 4 (suite) : retenues a la source recherchees dans le grand livre (comptabilite de la plateforme ou grand
-- livre importe) : charge au brut (6057, 63...), compte 401 au net, retenue au credit du 447. Rattachement a la date de paiement.

ALTER TABLE fiscalite_retenue DROP CONSTRAINT IF EXISTS fiscalite_retenue_source_check;
ALTER TABLE fiscalite_retenue ADD CONSTRAINT fiscalite_retenue_source_check CHECK (source IN ('PLATEFORME', 'MANUEL', 'IMPORT', 'CCA', 'COMPTA'));
-- Detail du controle comptable de la ligne : situation, brut de la charge, net du 401, retenue comptabilisee, pieces.
ALTER TABLE fiscalite_retenue ADD COLUMN IF NOT EXISTS controle_json JSONB;

-- Comptes analyses (prefixes), modifiables par le client.
CREATE TABLE IF NOT EXISTS fiscalite_retenue_param (
    tenant_id          UUID PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
    comptes_prestations TEXT[] NOT NULL DEFAULT ARRAY['6057', '63'],
    comptes_loyers      TEXT[] NOT NULL DEFAULT ARRAY['622'],
    comptes_retenue     TEXT[] NOT NULL DEFAULT ARRAY['447'],
    date_modification   TIMESTAMPTZ NOT NULL DEFAULT now()
);
