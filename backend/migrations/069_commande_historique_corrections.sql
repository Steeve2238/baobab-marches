-- Historique des corrections apportees a une commande fournisseur APRES confirmation (08/10/2026).
-- Demande client : l'administrateur peut corriger un prix unitaire, un Incoterm, une quantite ou supprimer une ligne
-- d'une commande confirmee (erreur de saisie), avec un motif obligatoire et une trace conservee.
-- Les receptions deja validees ne sont jamais modifiees : elles gardent le prix et l'Incoterm saisis a la reception.
CREATE TABLE IF NOT EXISTS commande_fournisseur_historique (
    id               UUID PRIMARY KEY,
    tenant_id        UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    commande_id      UUID NOT NULL REFERENCES commande_fournisseur(id) ON DELETE CASCADE,
    date_correction  TIMESTAMPTZ NOT NULL DEFAULT now(),
    utilisateur_id   UUID REFERENCES utilisateur(id) ON DELETE SET NULL,
    utilisateur_nom  TEXT,
    motif            TEXT NOT NULL,
    modifications    JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{type, ligne_id, designation, champ, avant, apres}]
    total_avant_devise NUMERIC(18,2),
    total_apres_devise NUMERIC(18,2)
);
CREATE INDEX IF NOT EXISTS idx_cmd_historique ON commande_fournisseur_historique (commande_id, date_correction DESC);
