-- ============================================================================
-- Chronogramme des consultations (Module Ventes/Negoce - Consultation
-- restreinte / Ventes). Confirme avec Steeve le 07/09/2026 : chaque
-- consultation doit avoir son propre chronogramme, calcule a partir de son
-- delai de reponse (J0), avec les etapes : reception de la consultation ->
-- collecte des offres fournisseurs/logistique -> calcul du prix de revient
-- -> validation interne -> envoi du devis (J0).
--
-- Meme principe que chronogramme_tache (dossier_ao, Module 1), mais plus
-- simple : une consultation n'a qu'une seule phase (pas de decoupage
-- AVANT_SOUMISSION / ATTRIBUTION_EXECUTION comme un AO), donc pas de colonne
-- "phase" ici.
-- ============================================================================

ALTER TABLE consultation ADD COLUMN IF NOT EXISTS date_limite_reponse DATE;

CREATE TABLE IF NOT EXISTS consultation_tache (
    id                      UUID PRIMARY KEY,
    consultation_id         UUID NOT NULL REFERENCES consultation(id) ON DELETE CASCADE,
    intitule                TEXT NOT NULL,
    jalon_relatif           TEXT,                                 -- ex: "J-5", "J0" (affichage)
    date_echeance           DATE,
    role_porteur_id         UUID REFERENCES role(id),
    assigne_utilisateur_id  UUID REFERENCES utilisateur(id),
    document_attendu        TEXT,
    statut                  TEXT NOT NULL DEFAULT 'A_FAIRE',      -- A_FAIRE | EN_COURS | FAIT | EN_RETARD
    ordre_affichage         INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_consultation_tache_consultation ON consultation_tache(consultation_id);
CREATE INDEX IF NOT EXISTS idx_consultation_tache_assigne ON consultation_tache(assigne_utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_consultation_tache_role_porteur ON consultation_tache(role_porteur_id);
