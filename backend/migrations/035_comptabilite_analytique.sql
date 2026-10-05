-- Comptabilite, phase 3C (05/10/2026) : analytique par dossier.
--
-- * section_analytique : une section par dossier. Les sections AO et
--   CONSULTATION sont creees automatiquement a partir des dossiers existants
--   (codes AO001, CR001...) ; les sections LIBRE sont des "affaires" creees a
--   la main (AF001 ou code libre).
-- * ventilation_analytique : part d'une ligne d'ecriture (classes 6 et 7, ou
--   tout compte marque analytique) affectee a une section. `montant` est SIGNE
--   comme (debit - credit) de la ligne : une charge ventilee est positive, un
--   produit ventile est negatif. Une ligne peut etre ventilee en totalite, en
--   partie (le reste est "non affecte") ou sur plusieurs sections.
-- * devis.section_analytique_id : dossier choisi sur le devis ; la facture de
--   vente (et son ecriture) en herite. A defaut, la section de la consultation
--   liee au devis.
-- * facture_fournisseur_ligne.section_analytique_id : dossier choisi sur la
--   ligne de la facture fournisseur (pour l'affichage ; la ventilation reelle
--   est portee par la ligne d'ecriture).

CREATE TABLE IF NOT EXISTS section_analytique (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code            TEXT NOT NULL,
    libelle         TEXT NOT NULL,
    type_section    TEXT NOT NULL CHECK (type_section IN ('AO', 'CONSULTATION', 'LIBRE')),
    dossier_ao_id   UUID REFERENCES dossier_ao(id) ON DELETE SET NULL,
    consultation_id UUID REFERENCES consultation(id) ON DELETE SET NULL,
    actif           BOOLEAN NOT NULL DEFAULT true,
    date_creation   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_section_dossier_ao ON section_analytique (tenant_id, dossier_ao_id) WHERE dossier_ao_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_section_consultation ON section_analytique (tenant_id, consultation_id) WHERE consultation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ventilation_analytique (
    id                UUID PRIMARY KEY,
    tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    ligne_ecriture_id UUID NOT NULL REFERENCES ligne_ecriture(id) ON DELETE CASCADE,
    section_id        UUID NOT NULL REFERENCES section_analytique(id),
    montant           NUMERIC(18,2) NOT NULL CHECK (montant <> 0),
    UNIQUE (ligne_ecriture_id, section_id)
);
CREATE INDEX IF NOT EXISTS idx_ventilation_section ON ventilation_analytique (tenant_id, section_id);
CREATE INDEX IF NOT EXISTS idx_ventilation_ligne ON ventilation_analytique (ligne_ecriture_id);

ALTER TABLE devis
    ADD COLUMN IF NOT EXISTS section_analytique_id UUID REFERENCES section_analytique(id) ON DELETE SET NULL;

ALTER TABLE facture_fournisseur_ligne
    ADD COLUMN IF NOT EXISTS section_analytique_id UUID REFERENCES section_analytique(id) ON DELETE SET NULL;
