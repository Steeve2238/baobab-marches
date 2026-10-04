-- Module Comptabilite (SYSCOHADA revise, systeme normal) - Phase 1 "socle",
-- chantier du 04/10/2026 (voir architecture_module_comptabilite_v2 et
-- complement_04102026_decisions_compta_ecritures_en_instance).
--
-- Principes : tout est ecriture (partie double stricte, controlee a la
-- validation), inalterabilite des ecritures validees (correction par
-- extourne), numerotation continue par journal et exercice (attribuee a la
-- validation), exercices verrouillables, isolation par tenant_id.
-- Les identifiants sont generes par l'application (uuid v4), comme dans les
-- migrations precedentes (aucune extension PostgreSQL requise).

-- --------------------------------------------------------------------------
-- Parametres comptables par entreprise (1 ligne par tenant)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compta_parametre (
    tenant_id                   UUID PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
    systeme_comptable           TEXT NOT NULL DEFAULT 'NORMAL' CHECK (systeme_comptable IN ('NORMAL')),
    longueur_compte             INTEGER NOT NULL DEFAULT 8 CHECK (longueur_compte BETWEEN 6 AND 10),
    devise                      TEXT NOT NULL DEFAULT 'XOF',
    -- Comptes par defaut (numeros complets) utilises par les ecritures
    -- automatiques des phases suivantes. Modifiables.
    compte_vente_defaut         TEXT NOT NULL DEFAULT '70610000',
    compte_client_collectif     TEXT NOT NULL DEFAULT '41110000',
    compte_fournisseur_collectif TEXT NOT NULL DEFAULT '40110000',
    compte_acompte_client       TEXT NOT NULL DEFAULT '41910000',
    compte_acompte_fournisseur  TEXT NOT NULL DEFAULT '40910000',
    -- Tranches de la balance agee (bornes hautes en jours, tableau JSON)
    tranches_balance_agee       JSONB NOT NULL DEFAULT '[0,30,60,90,180]'::jsonb,
    date_debut_comptabilite     DATE,
    initialisee                 BOOLEAN NOT NULL DEFAULT false,
    date_initialisation         TIMESTAMPTZ,
    date_modification           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Exercices comptables (pas de chevauchement : controle applicatif)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exercice_comptable (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    libelle             TEXT NOT NULL,
    date_debut          DATE NOT NULL,
    date_fin            DATE NOT NULL,
    statut              TEXT NOT NULL DEFAULT 'OUVERT' CHECK (statut IN ('OUVERT', 'CLOTURE')),
    date_cloture        TIMESTAMPTZ,
    cloture_par         UUID REFERENCES utilisateur(id),
    date_creation       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (date_fin > date_debut),
    UNIQUE (tenant_id, libelle)
);
CREATE INDEX IF NOT EXISTS idx_exercice_tenant ON exercice_comptable(tenant_id, date_debut);

-- --------------------------------------------------------------------------
-- Plan comptable : comptes imputables (numeros complets, 8 chiffres par
-- defaut). Les titres de regroupement (classes, comptes principaux) sont
-- deduits des prefixes (voir src/data/planSyscohada.js).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compte_comptable (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    numero              TEXT NOT NULL,
    libelle             TEXT NOT NULL,
    classe              INTEGER NOT NULL CHECK (classe BETWEEN 1 AND 9),
    nature              TEXT NOT NULL DEFAULT 'GENERAL'
                        CHECK (nature IN ('GENERAL', 'COLLECTIF_CLIENT', 'COLLECTIF_FOURNISSEUR', 'TRESORERIE')),
    sens_normal         TEXT CHECK (sens_normal IN ('D', 'C')),
    lettrable           BOOLEAN NOT NULL DEFAULT false,
    tiers_obligatoire   BOOLEAN NOT NULL DEFAULT false,
    analytique          BOOLEAN NOT NULL DEFAULT false,
    actif               BOOLEAN NOT NULL DEFAULT true,
    est_systeme         BOOLEAN NOT NULL DEFAULT false,   -- vient du plan SYSCOHADA fourni
    date_creation       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_compte_tenant_numero ON compte_comptable(tenant_id, numero);

-- --------------------------------------------------------------------------
-- Journaux
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS journal_comptable (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code                TEXT NOT NULL,
    libelle             TEXT NOT NULL,
    type_journal        TEXT NOT NULL
                        CHECK (type_journal IN ('VENTES', 'ACHATS', 'BANQUE', 'CAISSE', 'OPERATIONS_DIVERSES', 'A_NOUVEAUX')),
    compte_tresorerie   TEXT,                              -- numero de compte (banque / caisse)
    actif               BOOLEAN NOT NULL DEFAULT true,
    date_creation       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);

-- --------------------------------------------------------------------------
-- Tiers (clients, fournisseurs) : un code auxiliaire propre (style Sage,
-- ex CA001 / FB007) rattache a un compte collectif (411 / 401). Cree
-- automatiquement a partir des clients commerciaux et des fournisseurs ;
-- non modifiable par l'utilisateur (seul le nom suit la fiche d'origine).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tiers_comptable (
    id                      UUID PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    type_tiers              TEXT NOT NULL CHECK (type_tiers IN ('CLIENT', 'FOURNISSEUR', 'AUTRE')),
    code                    TEXT NOT NULL,
    nom                     TEXT NOT NULL,
    compte_collectif        TEXT NOT NULL,                 -- numero du compte collectif
    client_commercial_id    UUID REFERENCES client_commercial(id) ON DELETE SET NULL,
    fournisseur_id          UUID REFERENCES fournisseur(id) ON DELETE SET NULL,
    delai_reglement_jours   INTEGER NOT NULL DEFAULT 30,
    actif                   BOOLEAN NOT NULL DEFAULT true,
    date_creation           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code),
    UNIQUE (client_commercial_id),
    UNIQUE (fournisseur_id)
);
CREATE INDEX IF NOT EXISTS idx_tiers_tenant_type ON tiers_comptable(tenant_id, type_tiers);

-- --------------------------------------------------------------------------
-- Ecritures (en-tete de piece) et lignes
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ecriture_comptable (
    id                      UUID PRIMARY KEY,
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    exercice_id             UUID NOT NULL REFERENCES exercice_comptable(id),
    journal_id              UUID NOT NULL REFERENCES journal_comptable(id),
    numero_ecriture         INTEGER,                       -- continu par journal et exercice, attribue a la validation
    numero_piece            TEXT,
    date_ecriture           DATE NOT NULL,
    libelle                 TEXT NOT NULL,
    statut                  TEXT NOT NULL DEFAULT 'BROUILLON'
                            CHECK (statut IN ('BROUILLON', 'EN_INSTANCE', 'VALIDEE')),
    origine                 TEXT NOT NULL DEFAULT 'SAISIE',  -- SAISIE | FACTURE_VENTE | ENCAISSEMENT | EXTOURNE | IMPORT_SAGE ...
    origine_id              UUID,
    origine_role            TEXT NOT NULL DEFAULT '',
    extourne_de_id          UUID REFERENCES ecriture_comptable(id),   -- cette ecriture extourne celle-ci
    extournee_par_id        UUID REFERENCES ecriture_comptable(id),   -- cette ecriture a ete extournee par celle-ci
    cree_par                UUID REFERENCES utilisateur(id),
    valide_par              UUID REFERENCES utilisateur(id),
    date_creation           TIMESTAMPTZ NOT NULL DEFAULT now(),
    date_validation         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ecriture_tenant_exercice ON ecriture_comptable(tenant_id, exercice_id, statut);
CREATE INDEX IF NOT EXISTS idx_ecriture_journal ON ecriture_comptable(tenant_id, journal_id, date_ecriture);
-- Numerotation continue sans doublon par journal et exercice
CREATE UNIQUE INDEX IF NOT EXISTS uq_ecriture_numero
    ON ecriture_comptable(tenant_id, exercice_id, journal_id, numero_ecriture)
    WHERE numero_ecriture IS NOT NULL;
-- Une piece d'origine (facture, encaissement...) ne se comptabilise qu'une seule fois par role
CREATE UNIQUE INDEX IF NOT EXISTS uq_ecriture_origine
    ON ecriture_comptable(tenant_id, origine, origine_id, origine_role)
    WHERE origine_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ligne_ecriture (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    ecriture_id         UUID NOT NULL REFERENCES ecriture_comptable(id) ON DELETE CASCADE,
    ordre               INTEGER NOT NULL DEFAULT 0,
    compte_id           UUID NOT NULL REFERENCES compte_comptable(id),
    tiers_id            UUID REFERENCES tiers_comptable(id),
    libelle             TEXT,
    debit               NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit              NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    date_echeance       DATE,
    lettrage            TEXT,
    CHECK (NOT (debit > 0 AND credit > 0))
);
CREATE INDEX IF NOT EXISTS idx_ligne_ecriture ON ligne_ecriture(ecriture_id, ordre);
CREATE INDEX IF NOT EXISTS idx_ligne_compte ON ligne_ecriture(tenant_id, compte_id);
CREATE INDEX IF NOT EXISTS idx_ligne_tiers ON ligne_ecriture(tenant_id, tiers_id) WHERE tiers_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- Journal d'audit des actions sensibles (validation, extourne, plan
-- comptable, parametres, exercices)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compta_audit (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    utilisateur_id      UUID REFERENCES utilisateur(id),
    action              TEXT NOT NULL,
    objet_type          TEXT NOT NULL,
    objet_id            TEXT,
    avant               JSONB,
    apres               JSONB,
    date_action         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_compta_audit_tenant ON compta_audit(tenant_id, date_action DESC);

-- --------------------------------------------------------------------------
-- Droits : deux nouveaux modules dans le perimetre des roles
--   "comptabilite"            : consultation + saisie (brouillons)
--   "comptabilite-validation" : validation, extourne, modification du plan
--                               comptable, parametres, exercices
-- On les AJOUTE (sans rien retirer) aux roles COMPTABLE et FINANCIER deja
-- existants ; chaque entreprise peut ensuite les attribuer a n'importe quel
-- role depuis l'ecran Roles. ADMIN a toujours tout.
-- --------------------------------------------------------------------------
UPDATE role
SET perimetre_json = jsonb_set(
      COALESCE(perimetre_json, '{}'::jsonb),
      '{modules}',
      COALESCE(perimetre_json->'modules', '[]'::jsonb) || '["comptabilite"]'::jsonb
    )
WHERE code = 'COMPTABLE'
  AND NOT COALESCE(perimetre_json->'modules', '[]'::jsonb) ? 'comptabilite';

UPDATE role
SET perimetre_json = jsonb_set(
      COALESCE(perimetre_json, '{}'::jsonb),
      '{modules}',
      COALESCE(perimetre_json->'modules', '[]'::jsonb) || '["comptabilite","comptabilite-validation"]'::jsonb
    )
WHERE code = 'FINANCIER'
  AND NOT COALESCE(perimetre_json->'modules', '[]'::jsonb) ? 'comptabilite';
