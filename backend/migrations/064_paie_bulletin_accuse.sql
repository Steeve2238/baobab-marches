-- PAIE-3B : consultation et accuse de reception electronique des bulletins de paie par le salarie (espace employe).
-- L'accuse (date, heure, adresse IP) est conserve a part : le bulletin archive, lui, reste verrouille.
CREATE TABLE IF NOT EXISTS paie_bulletin_accuse (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    periode_id          UUID NOT NULL REFERENCES paie_periode(id) ON DELETE CASCADE,
    employe_id          UUID NOT NULL REFERENCES employe(id) ON DELETE CASCADE,
    date_consultation   TIMESTAMPTZ,
    date_accuse         TIMESTAMPTZ,
    ip_accuse           TEXT,
    UNIQUE (periode_id, employe_id)
);
CREATE INDEX IF NOT EXISTS idx_paie_bulletin_accuse_employe ON paie_bulletin_accuse (tenant_id, employe_id);
