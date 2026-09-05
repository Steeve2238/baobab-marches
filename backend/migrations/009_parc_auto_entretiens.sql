-- ============================================================================
-- Migration 009 : entretiens vehicules + echeances (assurance, visite
-- technique) - Module 8, Parc auto, etape 2/3.
-- ============================================================================
-- Adapte de la note de reference OGAA (section "Les entretiens" et
-- "Alertes et tableau de bord"). Le rattachement a une ligne budgetaire PTA
-- decrit chez OGAA n'a pas d'equivalent dans Baobab et n'est PAS repris ici.
--
-- Cycle de vie du vehicule (statut) etendu a l'etape 1 :
-- un entretien passe a EN_COURS -> le vehicule passe EN_ENTRETIEN ; un
-- entretien passe a TERMINE alors que le vehicule est EN_ENTRETIEN -> le
-- vehicule repasse DISPONIBLE. Gere par les routes, pas par un trigger SQL.
-- ============================================================================

ALTER TABLE vehicule
    ADD COLUMN date_expiration_assurance DATE,
    ADD COLUMN date_expiration_visite_technique DATE,
    ADD COLUMN prochain_entretien_date DATE,
    ADD COLUMN prochain_entretien_km NUMERIC(10,1);

CREATE TABLE entretien_vehicule (
    id                      UUID PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    vehicule_id             UUID NOT NULL REFERENCES vehicule(id),
    type_entretien          TEXT NOT NULL,   -- VIDANGE | REVISION | PNEUS | FREINS | REPARATION | CARROSSERIE | AUTRE
    date_entretien          DATE NOT NULL DEFAULT CURRENT_DATE,
    kilometrage             NUMERIC(10,1),
    prestataire             TEXT,
    description             TEXT,
    pieces_changees         TEXT,
    cout                    NUMERIC(12,2),
    prochain_entretien_date DATE,
    prochain_entretien_km   NUMERIC(10,1),
    statut                  TEXT NOT NULL DEFAULT 'PLANIFIE'   -- PLANIFIE | EN_COURS | TERMINE
);

CREATE INDEX idx_entretien_vehicule_tenant ON entretien_vehicule(tenant_id);
CREATE INDEX idx_entretien_vehicule_vehicule ON entretien_vehicule(vehicule_id);
CREATE INDEX idx_entretien_vehicule_statut ON entretien_vehicule(statut);
