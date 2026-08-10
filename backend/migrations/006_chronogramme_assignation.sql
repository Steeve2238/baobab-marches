-- ============================================================================
-- Migration 006 : affectation nominative des taches du chronogramme (Module 1)
-- ============================================================================
-- Jusqu'ici une tache n'etait rattachee qu'a un role (role_porteur_id, deja
-- present dans le schema initial). On ajoute la possibilite de l'affecter en
-- plus a une personne precise : si une personne est affectee, elle seule voit
-- la tache dans "Mes taches" ; sinon la tache reste visible par tout
-- utilisateur portant le role responsable (comportement inchange).
-- ============================================================================

ALTER TABLE chronogramme_tache
    ADD COLUMN assigne_utilisateur_id UUID REFERENCES utilisateur(id);

CREATE INDEX idx_chronogramme_tache_assigne ON chronogramme_tache(assigne_utilisateur_id);
CREATE INDEX idx_chronogramme_tache_role_porteur ON chronogramme_tache(role_porteur_id);
