-- Module Fiscalite : comptes comptables lus par les calculs, parametrables par entreprise selon son plan comptable.
-- Une ligne par (entreprise, cle) : liste de prefixes de comptes. Sans ligne, la valeur par defaut du catalogue s'applique
-- (voir services/fiscaliteComptes.js). Retenue a payer : 4478 par defaut.

CREATE TABLE IF NOT EXISTS fiscalite_compte_param (
    tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    cle               TEXT NOT NULL,
    prefixes          TEXT[] NOT NULL,
    date_modification TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, cle)
);

-- Reprise des comptes deja enregistres pour les retenues (migration 054).
INSERT INTO fiscalite_compte_param (tenant_id, cle, prefixes)
SELECT tenant_id, 'RET_PRESTATIONS', comptes_prestations FROM fiscalite_retenue_param
ON CONFLICT DO NOTHING;
INSERT INTO fiscalite_compte_param (tenant_id, cle, prefixes)
SELECT tenant_id, 'RET_LOYERS', comptes_loyers FROM fiscalite_retenue_param
ON CONFLICT DO NOTHING;
INSERT INTO fiscalite_compte_param (tenant_id, cle, prefixes)
SELECT tenant_id, 'RET_A_PAYER', comptes_retenue FROM fiscalite_retenue_param
ON CONFLICT DO NOTHING;
