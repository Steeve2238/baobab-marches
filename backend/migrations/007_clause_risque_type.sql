-- ============================================================================
-- Migration 007 : type de clause sur la bibliotheque de clauses a risque
-- (Module 7 - Intelligence concurrentielle & juridique)
-- ============================================================================
-- clause_risque_bibliotheque existe deja depuis le schema initial mais ne
-- portait qu'une description libre (pattern_description). Pour permettre le
-- raccourci "Signaler comme recurrent" depuis une clause deja extraite
-- (Module 1) et regrouper automatiquement les signalements par type de
-- clause + maitre d'ouvrage, on ajoute une colonne type_clause qui reprend
-- les memes codes que clause_extraite.type_clause (pas de contrainte FK/enum
-- stricte, meme logique que le reste du schema pour les champs de type texte
-- libre catégorisant une clause).
-- ============================================================================

ALTER TABLE clause_risque_bibliotheque
    ADD COLUMN type_clause TEXT;

CREATE INDEX idx_clause_risque_type ON clause_risque_bibliotheque(type_clause);
CREATE INDEX idx_clause_risque_maitre_ouvrage ON clause_risque_bibliotheque(maitre_ouvrage_id);
