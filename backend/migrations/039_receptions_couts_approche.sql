-- ============================================================================
-- Couts d'approche des receptions (05/10/2026) - Lot 2.
-- Demande de Steeve : le prix de revient d'un article ne se limite pas au prix
-- de la facture du fournisseur ; il faut y ajouter tous les couts d'approche
-- (transport/fret, assurance, droits et taxes de douane, transit, transport
-- local...) selon l'incoterm (EXW, FOB, CIF, DAP, DDP...). Ces couts sont lies
-- a UNE reception et repartis sur ses lignes (par valeur, par quantite ou par
-- poids, au choix pour chaque cout). Le calcul n'est jamais stocke : seules
-- les donnees saisies le sont (meme principe que le dossier de calcul).
-- ============================================================================

CREATE TABLE IF NOT EXISTS reception_cout_approche (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    reception_id        UUID NOT NULL REFERENCES reception_marchandise(id) ON DELETE CASCADE,
    ordre               INTEGER NOT NULL DEFAULT 0,
    type_cout           TEXT NOT NULL
                        CHECK (type_cout IN ('FRET', 'ASSURANCE', 'DOUANE', 'TRANSIT', 'TRANSPORT_LOCAL', 'AUTRE')),
    libelle             TEXT,
    montant             NUMERIC(18,2) NOT NULL CHECK (montant >= 0),
    -- true : le montant est exprime dans la devise de la facture (converti avec
    -- le cours de la reception) ; false : montant en XOF.
    en_devise_facture   BOOLEAN NOT NULL DEFAULT false,
    repartition         TEXT NOT NULL DEFAULT 'VALEUR' CHECK (repartition IN ('VALEUR', 'QUANTITE', 'POIDS'))
);
CREATE INDEX IF NOT EXISTS idx_reception_cout_reception ON reception_cout_approche (reception_id, ordre);

-- Poids unitaire (kg) facultatif : sert a la repartition "au poids".
ALTER TABLE reception_ligne ADD COLUMN IF NOT EXISTS poids_unitaire_kg NUMERIC(18,4) CHECK (poids_unitaire_kg IS NULL OR poids_unitaire_kg >= 0);

-- Cout de revient unitaire (achat + couts d'approche) fige a la validation :
-- source de l'historique des prix par fournisseur (lot suivant).
ALTER TABLE reception_ligne ADD COLUMN IF NOT EXISTS cout_revient_unitaire_xof NUMERIC(18,2);
