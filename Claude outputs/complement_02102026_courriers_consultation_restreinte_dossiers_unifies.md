# Chantier du 02/10/2026 — Courriers pour les consultations restreintes + fusion de l'interface Dossiers

## Demande de Steeve

Deux demandes liées, formulées en plusieurs messages :

1. « Pour les courriers sur les marchés restreints, il faut clairement le mettre à jour car le client veut avoir la possibilité de faire les courriers comme avec les appels d'offres. »
2. « Donc après, l'interface dossier doit aussi bien faire apparaître les marchés restreints que les appels d'offres. »

Deux choix de conception ont été validés par Steeve avant implémentation :

- **Emplacement** : fusionner dans l'écran « Dossiers » existant (plutôt que créer un écran séparé) — l'écran « Dossiers » devient une liste unique montrant à la fois les dossiers Appel d'Offres et les consultations restreintes, dans la même chronologie, chacun ouvrant sa propre fiche détaillée avec une section Courriers.
- **Historique** : ajouter un historique numéroté des courriers générés (au lieu du rendu à l'écran uniquement, sans trace, qui existait jusqu'ici).

## Ce qui a changé

### 1. Génération de courriers étendue aux consultations restreintes

Jusqu'à ce chantier, la génération de courriers (`POST /api/courriers/dossiers/:dossierId/generer`) ne fonctionnait que pour un dossier Appel d'Offres. Une consultation restreinte n'avait aucun moyen de produire un courrier.

Trois nouvelles routes ont été ajoutées dans `backend/src/routes/courriers.js`, qui **remplacent** ces anciennes routes pour tout nouvel usage (les anciennes routes restent en place, inchangées, pour compatibilité — elles ne sont plus appelées par le frontend) :

- `POST /api/courriers/generer` — génère ET enregistre un courrier, pour un dossier AO (`dossier_type: "AO"`) ou une consultation restreinte (`dossier_type: "CONSULTATION"`).
- `GET /api/courriers/historique` — liste les courriers déjà générés (filtrable par dossier, ou globale).
- `PATCH /api/courriers/generes/:id/statut` — marque un courrier comme envoyé (BROUILLON → ENVOYE).

Le moteur de rendu (`backend/src/services/courrierEngine.js`) gagne une fonction `construireContexteConsultation`, qui réutilise **exactement les mêmes clés** `{{dossier.xxx}}` que celles déjà utilisées pour un dossier AO — ainsi, un modèle de courrier existant fonctionne sans aucune modification, que le dossier soit un AO ou une consultation. Seule la provenance des valeurs change :

- `{{dossier.reference}}` : le numéro du devis le plus récent lié à la consultation (absent si aucun devis n'existe encore, signalé comme variable manquante, comme toute variable absente).
- `{{dossier.maitre_ouvrage}}` : réutilisé pour porter le nom du **client** de la consultation.
- `{{dossier.date_reception}}` : nouvelle clé, propre aux consultations.
- `{{dossier.date_limite_soumission}}` : volontairement absente pour une consultation (n'existe pas dans ce contexte).

### 2. Historique numéroté

Chaque courrier généré est désormais **enregistré** (table `courrier_genere`, qui existait dans le schéma mais n'était jamais utilisée jusqu'ici) avec un numéro de suite au format `COUR-AAAA-NNNN`. **Une seule chronologie de numéros, partagée entre les deux types de dossier** (demande explicite de Steeve : « ça va être la même chronologie ») — même principe que la numérotation des devis (`compteur_numerotation`).

Migration `backend/migrations/027_courrier_dossiers_unifies.sql` :
- Rend `dossier_ao_id` nullable sur `courrier_genere`.
- Ajoute `consultation_id`, `tenant_id`, `numero`, `titre_rendu`, `variables_json`.
- Contrainte CHECK : un courrier appartient à **exactement un** des deux types de dossier (jamais les deux, jamais aucun).

Chaque fiche (dossier AO ou consultation) affiche désormais, sous le formulaire de génération, la liste des courriers déjà générés pour ce dossier précis, avec un bouton « Marquer comme envoyé ».

### 3. Contrôle d'accès par type de dossier

Un utilisateur qui n'a que le module « marches » (ex. un commercial) dans son périmètre doit pouvoir générer des courriers pour une consultation restreinte, mais **pas** pour un dossier Appel d'Offres auquel il n'a par ailleurs aucun accès — et inversement pour un utilisateur n'ayant que « dossiers ». Les 3 nouvelles routes sont ouvertes à quiconque a au moins un des modules « courriers », « dossiers » ou « marches » (sinon un utilisateur n'ayant que l'un des deux serait bloqué), **puis** vérifient que l'utilisateur a bien accès au type précis de dossier concerné (fonction `aAccesTypeDossier`) avant d'autoriser l'action. Un administrateur ou un utilisateur avec le module exact a toujours accès ; sinon 403.

Cette même logique protège l'historique filtré par dossier et le marquage « envoyé » (dont le type est déduit de l'enregistrement lui-même).

### 4. Interface Dossiers fusionnée

- Nouvelle route backend `GET /api/dossiers/unifies` (dans `backend/src/routes/dossiers.js`) : renvoie les dossiers AO et les consultations restreintes du tenant dans une liste unique triée par date, chacune filtrée selon que l'utilisateur a accès au module correspondant (AO nécessite « dossiers » ou le tableau de bord général ; consultation nécessite « marches »).
- `frontend/app/dossiers/page.js` consomme cette nouvelle route : chaque ligne porte un badge « Appel d'offres » (pétrole) ou « Consultation restreinte » (ocre), et ouvre la fiche correspondante (`/dossiers/:id` ou `/marches/consultation-restreinte/consultations/:id`).
- Les 5 tuiles statistiques en haut de l'écran (Total / Ouverts / En cours / Clôturés / Rejetés) gardent **volontairement** leur sens d'origine : elles ne comptent que les dossiers AO, car les statuts d'une consultation restreinte (Reçue, Devis en cours, Convertie, Sans suite) ne correspondent à aucune des 4 catégories historiques et les y mélanger n'aurait pas de sens.

### 5. Composant partagé `CourrierSection`

La section Courriers (choix du modèle, variables personnalisées, génération, copie, impression, historique) vivait en dur dans la fiche dossier AO (`app/dossiers/[id]/page.js`). Elle a été extraite dans un composant réutilisable, `frontend/lib/components/CourrierSection.js`, pris en props `dossierType`, `dossierId`, et consommé à l'identique par :

- la fiche dossier AO (`/dossiers/:id`), avec les suggestions automatiques (heuristiques de chronogramme) conservées — propres aux dossiers AO ;
- la fiche consultation restreinte (`/marches/consultation-restreinte/consultations/:id`), nouvellement équipée d'une section Courriers qu'elle n'avait jamais eue.

## Validation effectuée

Testé en local (serveur Express + PostgreSQL de test) avant livraison :

- Génération d'un courrier sur un dossier AO : succès, numéro `COUR-2026-0001`.
- Génération d'un courrier sur une consultation **sans devis encore lié** : succès, variable `{{dossier.reference}}` correctement signalée comme manquante dans le texte (`[dossier.reference MANQUANT]`), numéro `COUR-2026-0002` — même chronologie que le dossier AO précédent.
- Génération sur la même consultation **après ajout d'un devis** : la référence et le montant se résolvent correctement à partir du devis le plus récent.
- Historique : filtré par dossier, filtré globalement (ne montre que les types auxquels l'utilisateur a accès), tri du plus récent au plus ancien — vérifié.
- Marquage « envoyé » : transition correcte, rejet d'un statut invalide (400).
- Matrice de droits d'accès : administrateur (accès total), utilisateur « marches » uniquement (accès consultation, refus explicite sur un dossier AO — 403), utilisateur sans aucun module pertinent (403 sur tout) — tous vérifiés avec le comportement attendu, y compris après correction d'un trou d'accès initial (voir ci-dessous).
- `GET /api/dossiers/unifies` : administrateur voit les deux types, un utilisateur « marches » uniquement ne voit que les consultations, un utilisateur sans module pertinent reçoit 403.
- `npm run build` du frontend : succès, 62 pages générées sans erreur.

**Point corrigé en cours de test** : la garde initiale des 3 nouvelles routes (`requireModuleAny("courriers","dossiers","marches")`) ouvrait la porte dès qu'un utilisateur avait l'un des trois modules, mais ne vérifiait pas ensuite que le type précis de dossier correspondait à ce module — un utilisateur n'ayant que « marches » aurait pu générer un courrier sur un dossier Appel d'Offres. Corrigé par l'ajout d'une vérification de second niveau (`aAccesTypeDossier`), vérifiée par test avant livraison.

## Fichiers modifiés/créés

- `backend/migrations/027_courrier_dossiers_unifies.sql` (nouveau)
- `backend/src/services/courrierEngine.js`
- `backend/src/routes/courriers.js`
- `backend/src/routes/dossiers.js`
- `backend/src/locales/messages.js`
- `frontend/lib/components/CourrierSection.js` (nouveau)
- `frontend/lib/api.js`
- `frontend/lib/i18n/dictionaries.js`
- `frontend/app/dossiers/page.js`
- `frontend/app/dossiers/[id]/page.js`
- `frontend/app/marches/consultation-restreinte/consultations/[id]/page.js`

## Déploiement

Voir les commandes détaillées données à Steeve dans la conversation (git local + serveur O2switch). Point important : contrairement aux deux chantiers précédents du même jour, **ce chantier nécessite `npm run migrate`** côté serveur (migration 027) et un redémarrage du backend, en plus du rebuild frontend habituel.
