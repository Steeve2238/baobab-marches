-- ============================================================================
-- Catalogue "Produits" (base de calcul globale) - demande de Steeve du
-- 05/10/2026 : un seul endroit qui porte, pour chaque produit, son cout de
-- revient et sa marge, afin de proposer les produits dans une liste deroulante
-- lors de la creation d'un devis (prix de vente = cout de revient x (1 + marge),
-- marge modifiable ligne par ligne).
--
-- Un produit peut etre :
--   - saisi directement (cout de revient et marge renseignes a la main), ou
--   - importe depuis l'offre "retenue" d'un article d'un dossier de calcul
--     (AO ou consultation restreinte) : cout de revient unitaire calcule par le
--     moteur (services/calculPrixEngine.js) et marge cible de l'offre. Le lien
--     source_offre_id permet de l'actualiser plus tard ; si l'offre est
--     supprimee, le produit reste (source_offre_id passe a NULL).
--
-- marge_pct est une FRACTION (0.25 = 25 %), comme calcul_offre.marge_cible_pct.
-- Le prix de vente n'est pas stocke : il est recalcule a chaque lecture
-- (cout x (1 + marge), arrondi au multiple de 100 XOF superieur, comme le
-- ROUNDUP(...,-2) du tableau Excel).
-- ============================================================================
CREATE TABLE IF NOT EXISTS produit (
    id                          UUID PRIMARY KEY,
    tenant_id                   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    reference                   TEXT,
    designation                 TEXT NOT NULL,
    unite                       TEXT NOT NULL DEFAULT 'U',
    categorie                   TEXT,
    cout_revient_unitaire_xof   NUMERIC(18,2) NOT NULL DEFAULT 0,
    marge_pct                   NUMERIC(7,4) NOT NULL DEFAULT 0,
    source_offre_id             UUID REFERENCES calcul_offre(id) ON DELETE SET NULL,
    source_libelle              TEXT,
    date_cout                   DATE,
    actif                       BOOLEAN NOT NULL DEFAULT true,
    notes                       TEXT,
    cree_par                    UUID REFERENCES utilisateur(id),
    date_creation               TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_maj                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_produit_tenant ON produit(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_produit_reference
    ON produit(tenant_id, lower(reference)) WHERE reference IS NOT NULL AND reference <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_produit_source_offre
    ON produit(tenant_id, source_offre_id) WHERE source_offre_id IS NOT NULL;

-- Trace, sur la ligne de devis, du produit choisi et du cout de revient
-- unitaire au moment du chiffrage (la marge reelle se deduit : prix / cout - 1).
ALTER TABLE devis_ligne ADD COLUMN IF NOT EXISTS produit_id UUID REFERENCES produit(id) ON DELETE SET NULL;
ALTER TABLE devis_ligne ADD COLUMN IF NOT EXISTS cout_revient_unitaire_ht NUMERIC(18,2);
