-- Module Ventes/Negoce (cadre avec Steeve le 04/09/2026, voir
-- claude/resume_reprise_projet.md) : flux commercial complet pour une
-- entreprise qui vend/revend des produits a ses propres clients (distincts
-- des "tenants" de la plateforme) - Consultation (demande recue) -> Devis
-- (valide par la Direction) -> Facture -> Bon de livraison.
--
-- Points de conception actes avec Steeve :
--   - Module GENERIQUE, disponible pour n'importe quel tenant (pas reserve
--     a l'usage personnel de Steeve/SIA).
--   - Deux compteurs de numerotation INDEPENDANTS, par tenant et par annee
--     (repartent a 1 chaque nouvelle annee) :
--       * DEVIS  -> format affiche "DEV-AAAA-MM-NNNN"
--       * VENTE  -> partage entre la Facture et son Bon de Livraison : la
--         Facture tire un numero de ce compteur au moment de sa generation,
--         le BL genere depuis cette facture REUTILISE le meme numero (pas de
--         tirage separe) - reproduit exactement la pratique papier actuelle
--         de Steeve (ex: Facture N degre 2026-08-096/PO2357 et BL-2026-08-096
--         portent le meme "096").
--   - Reprise du numero de commande du client (son propre "N degre BC", ex
--     "PO 2357") en reference libre sur la facture, jamais generee par
--     Baobab (c'est une reference externe).
--   - Statuts normalises (au lieu du texte libre actuel dans les tableurs
--     Excel de Steeve, source de doublons/incoherences) :
--       * Consultation : RECUE | DEVIS_EN_COURS | CONVERTIE | SANS_SUITE
--       * Devis        : BROUILLON | ENVOYE | VALIDE | REFUSE | EXPIRE
--       * Facture      : IMPAYEE | PAYEE | ANNULEE (meme pattern que
--         facture_abonnement du Super Admin)
--       * Bon livraison: BROUILLON | LIVRE
--   - Lignes de devis figees en lignes de facture au moment de la
--     generation (meme principe que chaine_approbation/facture_abonnement :
--     modifier un devis apres coup ne change jamais une facture deja
--     emise) ; lignes de facture copiees en lignes de BL, quantites
--     modifiables sur le BL pour permettre une livraison partielle
--     (statut "Livre Partiellement" observe dans le suivi actuel de Steeve).
--   - PAS d'import de l'historique Excel dans cette migration (decision de
--     Steeve : trop de risques d'interference avec des donnees incoherentes
--     - a reconsiderer plus tard si besoin, hors de ce chantier).
--   - Import de l'historique explicitement ecarte par Steeve (source trop
--     incoherente : statuts en texte libre, doublons de numeros de devis
--     releves lors de l'analyse des fichiers envoyes) - nouvelle base,
--     compteurs redemarrent a 1.
--   - Logo et taux de TVA : voir colonnes ajoutees a la table tenant
--     ci-dessous (pas de stockage cloud configure sur cette plateforme,
--     meme contrainte que le reste du code - cf commentaire dans
--     routes/extraction.js - donc logo stocke en base64 directement en
--     base, taille limitee cote applicatif).

-- ============================================================================
-- Parametres tenant : logo (pour les documents imprimes) + taux de TVA
-- (systematique, parametre une fois, applique automatiquement a chaque
-- devis/facture sans ressaisie).
-- ============================================================================
ALTER TABLE tenant
  ADD COLUMN IF NOT EXISTS logo_base64 TEXT,
  ADD COLUMN IF NOT EXISTS logo_type_mime TEXT,
  ADD COLUMN IF NOT EXISTS taux_tva_pourcentage NUMERIC(5,2) NOT NULL DEFAULT 18;

-- ============================================================================
-- Clients commerciaux : les clients DE l'entreprise (ex: SETER, DKM, SEN
-- EAU...), a ne pas confondre avec les "tenants" de la plateforme Baobab.
-- ============================================================================
CREATE TABLE IF NOT EXISTS client_commercial (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    nom                 TEXT NOT NULL,
    adresse             TEXT,
    telephone           TEXT,
    email               TEXT,
    actif               BOOLEAN NOT NULL DEFAULT true,
    date_creation       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_commercial_tenant ON client_commercial(tenant_id);

-- ============================================================================
-- Compteurs de numerotation, par tenant / type / annee. Increment protege
-- par verrou de ligne (SELECT ... FOR UPDATE) dans la transaction qui genere
-- le document, pour eviter deux documents avec le meme numero en cas de
-- generation concurrente.
-- ============================================================================
CREATE TABLE IF NOT EXISTS compteur_numerotation (
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    type_compteur       TEXT NOT NULL,                  -- DEVIS | VENTE
    annee               INTEGER NOT NULL,
    dernier_numero      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, type_compteur, annee)
);

-- ============================================================================
-- Consultation : demande de prix recue d'un client, premiere etape du flux
-- ("consultation d'abord" - Steeve). Le lien vers un devis est facultatif :
-- une demande deja bien formee peut donner lieu directement a un devis sans
-- repasser par une fiche de consultation.
-- ============================================================================
CREATE TABLE IF NOT EXISTS consultation (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    client_commercial_id    UUID NOT NULL REFERENCES client_commercial(id),
    objet                   TEXT NOT NULL,
    date_reception          DATE NOT NULL DEFAULT CURRENT_DATE,
    statut                  TEXT NOT NULL DEFAULT 'RECUE', -- RECUE | DEVIS_EN_COURS | CONVERTIE | SANS_SUITE
    notes                   TEXT,
    cree_par                UUID REFERENCES utilisateur(id),
    date_creation           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consultation_tenant ON consultation(tenant_id);
CREATE INDEX IF NOT EXISTS idx_consultation_statut ON consultation(statut);

-- ============================================================================
-- Devis : prepare par l'assistante administrative (ou tout role autorise),
-- valide par la Direction avant envoi/facturation. Montants recalcules et
-- figes a chaque enregistrement des lignes (voir routes/ventes.js).
-- ============================================================================
CREATE TABLE IF NOT EXISTS devis (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    numero                  TEXT NOT NULL,
    consultation_id         UUID REFERENCES consultation(id),
    client_commercial_id    UUID NOT NULL REFERENCES client_commercial(id),
    objet                   TEXT,
    date_devis              DATE NOT NULL DEFAULT CURRENT_DATE,
    conditions_paiement     TEXT,
    delai_livraison         TEXT,
    validite_offre          TEXT,
    statut                  TEXT NOT NULL DEFAULT 'BROUILLON', -- BROUILLON | ENVOYE | VALIDE | REFUSE | EXPIRE
    valide_par              UUID REFERENCES utilisateur(id),
    date_validation         TIMESTAMPTZ,
    taux_tva_pourcentage    NUMERIC(5,2) NOT NULL,       -- copie du parametre tenant au moment de la creation (fige)
    total_ht                NUMERIC(14,2) NOT NULL DEFAULT 0,
    montant_tva             NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_ttc               NUMERIC(14,2) NOT NULL DEFAULT 0,
    cree_par                UUID REFERENCES utilisateur(id),
    date_creation           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_devis_tenant ON devis(tenant_id);
CREATE INDEX IF NOT EXISTS idx_devis_statut ON devis(statut);
CREATE INDEX IF NOT EXISTS idx_devis_client ON devis(client_commercial_id);

CREATE TABLE IF NOT EXISTS devis_ligne (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    devis_id            UUID NOT NULL REFERENCES devis(id) ON DELETE CASCADE,
    ordre               INTEGER NOT NULL DEFAULT 0,
    designation         TEXT NOT NULL,
    unite               TEXT DEFAULT 'U',
    quantite            NUMERIC(14,2) NOT NULL DEFAULT 1,
    prix_unitaire_ht    NUMERIC(14,2) NOT NULL DEFAULT 0,
    montant_ht          NUMERIC(14,2) NOT NULL DEFAULT 0  -- = quantite * prix_unitaire_ht, calcule cote serveur
);

CREATE INDEX IF NOT EXISTS idx_devis_ligne_devis ON devis_ligne(devis_id);

-- ============================================================================
-- Facture de vente : distincte de facture_abonnement (Super Admin, qui
-- concerne l'abonnement de la plateforme, pas les ventes du tenant).
-- Generee depuis un devis VALIDE ; les lignes sont une copie figee des
-- lignes du devis a cet instant.
-- ============================================================================
CREATE TABLE IF NOT EXISTS facture_vente (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    numero                  TEXT NOT NULL,               -- ex "2026-096" (annee-sequence, sans le mois)
    mois_emission           INTEGER NOT NULL,             -- mois de generation, pour l'affichage "2026-08-096"
    devis_id                UUID REFERENCES devis(id),
    client_commercial_id    UUID NOT NULL REFERENCES client_commercial(id),
    reference_bc_client     TEXT,                          -- reference libre du bon de commande du client (ex "PO 2357")
    date_facture            DATE NOT NULL DEFAULT CURRENT_DATE,
    statut                  TEXT NOT NULL DEFAULT 'IMPAYEE', -- IMPAYEE | PAYEE | ANNULEE
    taux_tva_pourcentage    NUMERIC(5,2) NOT NULL,
    total_ht                NUMERIC(14,2) NOT NULL DEFAULT 0,
    montant_tva             NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_ttc               NUMERIC(14,2) NOT NULL DEFAULT 0,
    date_echeance           DATE,
    date_paiement           TIMESTAMPTZ,
    mode_paiement           TEXT,
    cree_par                UUID REFERENCES utilisateur(id),
    date_creation           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_facture_vente_tenant ON facture_vente(tenant_id);
CREATE INDEX IF NOT EXISTS idx_facture_vente_statut ON facture_vente(statut);
CREATE INDEX IF NOT EXISTS idx_facture_vente_client ON facture_vente(client_commercial_id);

CREATE TABLE IF NOT EXISTS facture_vente_ligne (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facture_vente_id    UUID NOT NULL REFERENCES facture_vente(id) ON DELETE CASCADE,
    ordre               INTEGER NOT NULL DEFAULT 0,
    designation         TEXT NOT NULL,
    unite               TEXT DEFAULT 'U',
    quantite            NUMERIC(14,2) NOT NULL DEFAULT 1,
    prix_unitaire_ht    NUMERIC(14,2) NOT NULL DEFAULT 0,
    montant_ht          NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_facture_vente_ligne_facture ON facture_vente_ligne(facture_vente_id);

-- ============================================================================
-- Bon de livraison : genere depuis une facture, reutilise son numero (voir
-- routes/ventes.js). Quantites livrees modifiables independamment de la
-- facture pour couvrir le cas d'une livraison partielle.
-- ============================================================================
CREATE TABLE IF NOT EXISTS bon_livraison (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    numero                  TEXT NOT NULL,               -- identique au numero de la facture_vente liee
    mois_emission           INTEGER NOT NULL,
    facture_vente_id        UUID NOT NULL REFERENCES facture_vente(id),
    client_commercial_id    UUID NOT NULL REFERENCES client_commercial(id),
    date_bl                 DATE NOT NULL DEFAULT CURRENT_DATE,
    statut                  TEXT NOT NULL DEFAULT 'BROUILLON', -- BROUILLON | LIVRE
    cree_par                UUID REFERENCES utilisateur(id),
    date_creation           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, facture_vente_id)
);

CREATE INDEX IF NOT EXISTS idx_bon_livraison_tenant ON bon_livraison(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bon_livraison_facture ON bon_livraison(facture_vente_id);

CREATE TABLE IF NOT EXISTS bon_livraison_ligne (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bon_livraison_id    UUID NOT NULL REFERENCES bon_livraison(id) ON DELETE CASCADE,
    ordre               INTEGER NOT NULL DEFAULT 0,
    designation         TEXT NOT NULL,
    unite               TEXT DEFAULT 'U',
    quantite_livree     NUMERIC(14,2) NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_bon_livraison_ligne_bl ON bon_livraison_ligne(bon_livraison_id);
