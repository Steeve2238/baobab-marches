-- ============================================================================
-- Migration 008 : cycle de vie des vehicules + sorties/missions
-- (Module 8 - Parc auto, etape 1/3 : vehicules + sorties. Les entretiens,
-- alertes d'echeance et statistiques suivront dans une migration ulterieure,
-- comme convenu avec Steeve pour ne pas livrer tout le module d'un coup.)
-- ============================================================================
-- Adapte du fonctionnement d'OGAA (note de reference "Roles & Parc Auto") :
-- un vehicule passe automatiquement "En sortie" a la creation d'une sortie
-- (et est alors exclu des vehicules proposables pour une nouvelle sortie),
-- puis repasse "Disponible" a la cloture de la sortie, qui met aussi a jour
-- son kilometrage. Le statut "En entretien" existe deja dans l'enumeration
-- pour ne pas avoir a la modifier de nouveau a l'etape suivante du module,
-- mais aucune route ne le positionne encore a ce stade.
-- ============================================================================

ALTER TABLE vehicule
    ADD COLUMN statut TEXT NOT NULL DEFAULT 'DISPONIBLE',
                        -- DISPONIBLE | EN_SORTIE | EN_ENTRETIEN | HORS_SERVICE
    ADD COLUMN kilometrage_actuel NUMERIC(10,1);

CREATE TABLE sortie_vehicule (
    id                      UUID PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    vehicule_id             UUID NOT NULL REFERENCES vehicule(id),
    dossier_ao_id           UUID REFERENCES dossier_ao(id),      -- "activite liee", facultative
    chauffeur_nom           TEXT,
    chef_mission_nom        TEXT,
    passagers               TEXT,                                -- liste libre (noms separes par virgule)
    localite_depart         TEXT,
    destination             TEXT,
    itineraire              TEXT,
    date_depart             TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_retour             TIMESTAMPTZ,
    kilometrage_depart      NUMERIC(10,1) NOT NULL,
    kilometrage_retour      NUMERIC(10,1),
    distance_parcourue      NUMERIC(10,1),                       -- calculee a la cloture
    niveau_carburant_depart TEXT,
    observations            TEXT,
    statut                  TEXT NOT NULL DEFAULT 'EN_COURS'      -- EN_COURS | CLOTUREE
);

CREATE INDEX idx_sortie_vehicule_tenant ON sortie_vehicule(tenant_id);
CREATE INDEX idx_sortie_vehicule_vehicule ON sortie_vehicule(vehicule_id);
CREATE INDEX idx_sortie_vehicule_statut ON sortie_vehicule(statut);
