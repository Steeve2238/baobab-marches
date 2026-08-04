# Baobab Marchés — MVP (Phase 1)

L'écosystème complet de pilotage des marchés publics et privés.

Ce dépôt contient le premier incrément fonctionnel du projet, correspondant à la
**Phase 1** de la roadmap du cahier des charges :
- Gestion des utilisateurs, rôles et tenants (multi-clients)
- **Module 1** : dossiers d'AO, clauses extraites, chronogramme, statuts
- **Module 15** (amorce) : Radar d'anticipation (signaux)

Les 13 autres modules du cahier des charges s'appuient sur le même schéma de
base de données (`backend/migrations/001_init_schema.sql`, 55 tables déjà
créées) et seront branchés progressivement, phase par phase.

## Structure du dépôt

```
baobab-marches/
├── backend/           API Node.js / Express / PostgreSQL
│   ├── migrations/    Schéma SQL complet (55 tables, 16 modules)
│   ├── scripts/       migrate.js (exécute les migrations) et seed.js (données de démo)
│   └── src/           Code de l'API (routes, middleware, connexion DB)
└── frontend/          Next.js (App Router) — Radar d'anticipation + dossiers
    ├── app/
    └── lib/
```

## Prérequis

- Node.js 18+
- Une base PostgreSQL 15+ (locale, ou Railway comme pour OGAA)

## 1. Backend

```bash
cd backend
cp .env.example .env
# Éditer .env : renseigner DATABASE_URL (connexion à votre PostgreSQL) et JWT_SECRET

npm install
npm run migrate    # crée les 55 tables
npm run seed       # insère un tenant de démo + un dossier exemple (AO SENELEC 39/2021)
npm run dev         # démarre l'API sur http://localhost:4000
```

Compte de démonstration créé par le seed :
- **Email** : `admin@baobabmarches.sn`
- **Mot de passe** : `Admin@2026`

Endpoints disponibles :
| Méthode | Route | Description |
|---|---|---|
| POST | `/api/auth/login` | Connexion, renvoie un token JWT |
| POST | `/api/auth/changer-mot-de-passe` | Changement de mot de passe (authentifié) |
| GET | `/api/dossiers` | Liste des dossiers du tenant courant |
| GET | `/api/dossiers/:id` | Détail d'un dossier (clauses + chronogramme) |
| POST | `/api/dossiers` | Création d'un dossier |
| PATCH | `/api/dossiers/:id/statut` | Changement de statut (workflow go/no-go...) |
| POST | `/api/chronogramme/:dossierId/taches` | Ajout d'une tâche au chronogramme |
| PATCH | `/api/chronogramme/taches/:id` | Mise à jour du statut d'une tâche |
| GET | `/api/signaux` | Radar d'anticipation (Module 15) |
| PATCH | `/api/signaux/:id/acquitter` | Acquitter un signal |

## 2. Frontend

```bash
cd frontend
npm install
npm run dev   # démarre sur http://localhost:3000
```

Par défaut, le frontend appelle `http://localhost:4000/api`. Pour pointer vers
une autre URL (ex. backend déployé sur Railway), définir la variable
d'environnement `NEXT_PUBLIC_API_URL` dans un fichier `.env.local`.

## 3. Ce qui est déjà validé

- Le schéma SQL (55 tables) a été vérifié : aucune référence de clé étrangère
  ne pointe vers une table non encore créée (script de vérification passé).
- Le code backend a été vérifié syntaxiquement (`node --check` sur chaque
  fichier) et tous les modules se chargent sans erreur.
- Le frontend compile avec succès (`npm run build`) en production.
- **Non testé** : l'exécution de bout en bout contre une vraie base
  PostgreSQL (aucune instance disponible dans l'environnement de génération de
  ce code). À valider en premier lieu une fois connecté à Railway ou à une
  instance locale.

## 4. Prochaines étapes suggérées

1. Connecter une vraie base PostgreSQL (Railway, comme pour OGAA) et valider
   `npm run migrate` + `npm run seed` de bout en bout.
2. Brancher le pipeline d'extraction automatique des dossiers d'AO (upload de
   PDF → extraction des clauses) — actuellement les clauses sont saisies par
   le seed, pas encore extraites automatiquement.
3. Ajouter les écrans de détail dossier (chronogramme visuel, clauses) côté
   frontend — actuellement seule la liste et le Radar sont branchés.
4. Développer le Module 2 (financement bancaire) en s'appuyant sur les tables
   déjà prêtes (`partenaire_financier`, `grille_tarifaire`, `ligne_credit_tarif`,
   `simulation_financement`).
