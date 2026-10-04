# Module Comptabilité Baobab — Architecture v2 (04/10/2026)

**Référentiel : SYSCOHADA révisé, système normal. Statut : proposition à valider, aucun code écrit.**
Cette v2 remplace la v1. Elle intègre l'analyse des documents Afrique Pesage Sénégal (APS) et des exports Sage reçus le 04/10/2026.

## 1. Décisions prises avec Steeve

| Sujet | Décision |
|---|---|
| Système comptable | **Système normal**. Un paramètre `systeme_comptable` est prévu pour un éventuel Système Minimal de Trésorerie, **non construit** maintenant. |
| Rôle de Baobab | **Outil comptable principal** : saisie complète (achats, banque, caisse, OD), pas seulement le reflet des ventes. |
| Point de départ | Depuis le début d'utilisation de Baobab, avec **à-nouveaux** possibles. |
| Logiciel actuel | **Sage Saari / Sage 100**. Ses exports servent de référence de format. |
| Acomptes | Comptes **4191** (clients, avances et acomptes reçus) et **4091** (fournisseurs, avances versées). *À confirmer.* |
| TVA | Constatée **à la facturation**. |
| Analytique | Ventilation analytique (axe Dossier, §7). |
| **Périmètre des états (nouveau)** | **Journaux, grand livre, balance générale, balances tiers, balance âgée, bilan, compte de résultat, tableau des flux de trésorerie.** Les **notes annexes et le reste de la liasse DGID sont hors périmètre** : un comptable les complétera. |

## 2. Ce que montrent les documents d'Afrique Pesage

### 2.1 Test d'oracle sur la balance 2025 (456 comptes, 8 chiffres)

| État | Résultat du test |
|---|---|
| **Compte de résultat** | **Reproduit au franc près**, toutes les lignes (TA à RN). Seule la ligne **RS (impôt sur le résultat, 89 518 601)** manque : la balance est avant impôt. Résultat de la balance −242 394 013 ; moins l'impôt = **−331 912 614**, identique à l'état. |
| **Bilan, actif** | **Reproduit au franc près** : immobilisations (AF, AK, AL, AM, AN, AS) brut et amortissements, BA, BB, BH, BI brut et dépréciation (62 251 460), BJ (2 946 549 750), BQ, BS. |
| **Bilan, passif** | **Non reproductible exactement** : voir §2.2. |
| **TFT** | Formules validées : CAFG (201 419 451), FB, FC, FD, FE, FF, FH, FI, ZG, ZA/ZH. Une ligne (FG) reste ambiguë (§2.3). |

Correspondances comptes → lignes confirmées par le test (à charger dans le référentiel `etat_financier_ligne`) :

- **Immobilisations** : AF = 212–216 (amort. 281) ; AK = 231, 232, 233, 237, 238, **2391** (amort. 2831) ; AL = 234, 235, **2394, 2395** (amort. 2834, 2835) ; AM = 24 hors 245 (amort. 284 hors 2845) ; AN = 245 (amort. 2845) ; AS = 27.
- **Actif circulant** : BA = 485 ; BB = 3x ; BH = 4091, 4093 (avances versées) ; BI = 411–418 brut, dépréciation 491 ; BJ = soldes **débiteurs** des 42, 43, 44, 46, 47 ; BQ = 50 ; BS = soldes débiteurs 52, 55, 57.
- **Passif** : DI = 4191 ; DJ = 401, 402, 408 ; DK = soldes **créditeurs** 43, 44 ; DM = soldes **créditeurs** 42, 46, 47 ; DC = 19 ; CH = 12 (121 + 129) ; CI = résultat calculé depuis 6, 7, 8.
- **Règle clé** : le classement actif/passif d'un compte de tiers dépend du **signe de son solde** à la date du bilan (un compte 44 débiteur va en BJ, créditeur en DK). C'est un calcul ligne à ligne, pas un simple regroupement par numéro.

### 2.2 Anomalies relevées dans les fichiers APS

1. **La balance 2025 « ajustée » n'est pas équilibrée** : il manque **environ 316 millions de crédits** (le total des soldes de classes 1 à 5 ne compense pas le résultat de 6 et 7). Les états de Steeve les contiennent donc dans DJ, DK, DM et DC (environ +40,5 M, +99,8 M dont 89,5 M d'impôt, +226,7 M, +39,1 M ; écart résiduel de 0,45 M non expliqué). Ce sont des écritures d'inventaire/ajustement passées hors de ce fichier. Les trois autres feuilles du classeur (GL 60580000, 63840000, 63840001) sont des analyses de charges, pas ces ajustements.
2. **N-1 incohérent** : la balance 2024 fournie donne un résultat de −358 931 261, alors que la colonne N-1 des états 2025 affiche −366 888 112. La balance 2024 n'est donc probablement pas la version finale.
3. **Impôt 2025 non comptabilisé** dans la balance (compte 441 à zéro).

**Conséquence de conception** : avec un moteur d'écritures en partie double stricte, une balance déséquilibrée **ne peut pas exister** (chaque pièce est équilibrée à la validation). Le module affichera en plus un **contrôle d'équilibre et de cohérence** avant tout état (A = P, ZH = trésorerie du bilan, résultat identique entre états), et l'**impôt sur le résultat** et les écritures d'inventaire devront être saisis (écritures d'OD) avant le bilan définitif.

### 2.3 Tableau des flux : ce qui est calculable

Méthode indirecte, validée sur APS 2025 : CAFG = résultat net + dotations (RL) − reprises (TJ) − produits de cessions (TN) + valeur comptable des cessions ; FB, FC, FD, FE = variations N/N-1 des postes d'actif circulant et de passif circulant ; FF/FH = mouvements débit des comptes 21 et 27 ; FI = produits des cessions ; ZG = ZB + ZC + ZF ; ZA = trésorerie nette d'ouverture (titres de placement inclus) ; ZH = trésorerie actif − trésorerie passif.

**Ligne FG (acquisitions corporelles, −108 974 016)** : les mouvements débit des comptes 22 à 24 donnent 268 211 803. L'écart de 159 237 787 vient d'éléments que **la balance seule ne permet pas d'isoler** (virements de poste à poste, acquisitions non payées, cessions). Avec un moteur d'écritures complet, on calculera FG à partir des **écritures réelles** (débits de classe 2 dont la contrepartie est la trésorerie ou un fournisseur d'immobilisations, hors virements OD). Point à faire valider par l'expert-comptable.

## 3. Modèles Sage à reproduire

### 3.1 Balance des comptes (PDF, A4 paysage)

- **En-tête** : nom de l'entreprise à gauche ; titre centré « Balance des comptes » avec sous-titre « Complète » ; à droite « Période du … au … » et « Tenue de compte : F CFA » ; ligne « Date de tirage … à … » et « Page : n ».
- **Colonnes** : Numéro de compte · Intitulé · **Mouvements au 31/12/N-1** (Débit, Crédit = à-nouveaux) · **Mouvements** (Débit, Crédit) · **Soldes cumulés** (Débit, Crédit).
- **Lignes de total par niveau** : après les comptes d'une même famille, une ligne `*** libellé de la classe` (ex. `21  *** Immobilisations corporelles`), puis `**` pour les sous-niveaux (`213  ** Constructions`) ; total de classe à 1 chiffre.
- Pied de page : ligne **« A reporter »** avec totaux cumulés, reprise en tête de page suivante (**« Report »**). Montants avec espace comme séparateur de milliers, sans décimales.
- Export Excel (déjà reçu : Sen'Burger et APS) : mêmes trois blocs de colonnes, ligne TOTAUX.

### 3.2 Grand livre (PDF, A4 portrait)

- Même en-tête. Colonnes : **Date** (JJMMAA) · **C.j** (code journal) · **N° pièce** · **Libellé écriture** · **Let** (lettrage) · **Mouvement débit** · **Mouvement crédit** · **Solde progressif** (débit − crédit, négatif = crédit).
- Un bloc par compte : `numéro  LIBELLÉ`, lignes d'écritures, puis `Total compte 12900000 du 010122 au 311222`, puis les totaux de regroupement (`Total compte 12`, `Total compte 1`). Les à-nouveaux sont écrits au journal **AN** avec libellé « A.N. au 010122 ». Libellés longs sur 2 lignes.
- Pied « A reporter / Report » comme la balance.
- Excel : colonnes N° COMPTE, DATE, CODE J, N° PIECES, LIBELLE, lettrage, DEBIT, CREDIT, SOLDES.

### 3.3 Balances des tiers (Excel Sage)

Colonnes : **code tiers** (ex. `CA001` clients, `F2001` / `FB001` fournisseurs) · **nom** · **À nouveau débit / crédit** · **Mouvements débit / crédit** · **Soldes débit / crédit**. Vérifié sur APS : report + mouvements = soldes (clients : 220,7 M + 241,0 M − 108,7 M = 353,0 M).

**Conséquence** : le tiers a un **code auxiliaire propre**, alphanumérique, indépendant du numéro de compte. Le compte collectif (4111, 4011…) porte le total ; le tiers porte le détail.

## 4. Principes directeurs

1. **Tout est écriture** : les états sont calculés, jamais saisis.
2. **Partie double stricte**, contrôlée en base et à l'application.
3. **Inaltérabilité** : on corrige par **extourne**, jamais par modification d'une écriture validée.
4. **Numérotation continue** par journal et exercice, sans trou.
5. **Exercices verrouillables.**
6. **Traçabilité** : auteur, dates, pièce d'origine.
7. **Isolation par entreprise** (`tenant_id`).

## 5. Modèle de données

Tables portant toutes `tenant_id`, montants en `NUMERIC(18,2)`, devise XOF.

- **`compta_parametre`** : système comptable, longueur des comptes (8), comptes par défaut, **tranches de la balance âgée**, date de début.
- **`exercice_comptable`** : dates, durée en mois, statut OUVERT/CLOTURE.
- **`compte_comptable`** : numéro, libellé, classe, nature (général, collectif client, collectif fournisseur, trésorerie), sens normal, lettrable, analytique, actif. **Plan SYSCOHADA révisé préchargé**, comptes propres ajoutables.
- **`tiers`** : type, **code auxiliaire** (style Sage), nom, compte collectif, lien vers `client_commercial` / `fournisseur`, conditions de règlement (jours).
- **`journal`** : VTE, ACH, BQn, CAI, OD, AN…
- **`ecriture`** / **`ligne_ecriture`** : en-tête (exercice, journal, numéro continu, n° de pièce, date, statut, origine, extourne liée, unicité (origine, id, rôle)) et lignes (compte, tiers, débit, crédit, **date d'échéance**, lettrage).
- **`section_analytique`** / **`ventilation_analytique`**.
- **`encaissement`** (paiements partiels, plusieurs règlements par facture).
- **`etat_financier_ligne`** : référentiel des trois états (code, libellé, signe, comptes ou formule), **chargé avec les correspondances du §2.1**.
- **`immobilisation`** (phase 4) : alimente les colonnes Brut / Amortissements du bilan et les dotations.

## 6. Comptabilisation automatique des ventes

| Événement | Écriture (journal VTE) |
|---|---|
| Facture intégrale | D 411 TTC · C 70x HT net de remise · C 443x TVA |
| Facture d'acompte | D 411 · C **4191** HT · C 443x TVA de l'acompte |
| Facture de solde | D 411 net à payer · D **4191** acomptes HT · C 70x HT total · C 443x (TVA totale − TVA déjà constatée) |
| Annulation | **Extourne** |
| Encaissement | D 521/571 · C 411 + lettrage |
| Avoir *(nouveau document)* | Inverse de la facture |

Les écritures sont créées dans la **même transaction** que le document. Rattrapage en lot des factures existantes, rejouable sans doublon.

## 7. Analytique

Axe **Dossier** (AO, consultation restreinte, affaire libre), ventilation des lignes de classes 6 et 7 en montant ou %, héritage automatique depuis le devis. États : grand livre analytique, balance analytique, **résultat par dossier**.

## 8. Balance âgée : modèle proposé

**Principe** : on ne vieillit que les **éléments ouverts**, c'est-à-dire les lignes de compte de tiers **non lettrées** (facture non soldée, règlement non imputé), au jour de la date d'arrêté choisie. Un règlement partiel est imputé sur la facture la plus ancienne ou par lettrage manuel.

**Ancienneté** : par défaut calculée à partir de la **date d'échéance** (jours de retard). Option « à partir de la date de facture ». Les tranches sont **configurables** ; par défaut :

| Non échu | 1-30 j | 31-60 j | 61-90 j | 91-180 j | Plus de 180 j | Total |
|---|---|---|---|---|---|---|

**Présentation (écran, Excel, PDF paysage)** :

- Un tableau **Clients** et un tableau **Fournisseurs** (sélecteur, mêmes colonnes).
- Une ligne par tiers : **code · nom · compte collectif · solde total · une colonne par tranche**, triée par solde décroissant (option : par code).
- **Ligne TOTAUX** et **ligne « % du total »** par tranche.
- En-tête de type Sage : entreprise, « Balance âgée clients au JJ/MM/AAAA », mode de calcul (échéance ou facture), date de tirage, page.
- **Détail par tiers** (clic ou option d'impression) : la liste des factures ouvertes avec n° de pièce, date, échéance, montant, **jours de retard** et tranche.
- **Avances et acomptes (4191 / 4091), avoirs et règlements non imputés** : affichés dans une colonne séparée « Non imputé » pour ne pas fausser les tranches.
- **Indicateurs** (haut de page) : encours total, part échue, retard moyen pondéré, part au-delà de 90 jours, 10 plus gros tiers en retard.
- **Contrôle** : le total par colonne « Total » doit égaler le solde de la balance tiers et du compte collectif à la même date. Un écart bloque l'impression.

Lien avec la comptabilité : la **dépréciation des créances** (compte 491, 416 clients douteux) s'appuie sur cette balance (le bilan APS porte 62,3 M de dépréciation).

## 9. États, balances et exports

| État | Source | Particularités |
|---|---|---|
| Journaux | Écritures validées | Par journal et période, total D/C |
| Grand livre | Par compte | Modèle §3.2 |
| Balance générale | Par compte | Modèle §3.1, niveaux `***`/`**` |
| Balances clients / fournisseurs | Par tiers | Modèle §3.3 |
| Balance âgée | Éléments ouverts | Modèle §8 |
| Bilan | Soldes N et N-1 | Format officiel, correspondances §2.1 |
| Compte de résultat | Classes 6, 7, 8 | TA…XI, soldes intermédiaires |
| Flux de trésorerie | N et N-1 | ZA…ZH, contrôle ZH |

**Exports** : Excel avec la librairie déjà présente côté serveur ; PDF par une bibliothèque légère côté serveur (pdfkit/pdfmake) pour reproduire fidèlement les modèles Sage (en-têtes, « A reporter »), sans Chromium/Puppeteer (plafond de processus O2switch). Les exports du bilan, du résultat et des flux reprennent les **mêmes codes de lignes et la même mise en page** que les états et que la liasse DGID, afin de pouvoir les y reporter.

## 10. Droits d'accès

Module `comptabilite` avec quatre niveaux : **lecture, saisie, validation, clôture**. Actions sensibles journalisées. Lecture seule pour le Directeur Général.

## 11. Validation et reprise

- **Oracle** : phases 4 et 5 réussies si le module reproduit les états APS **au franc près** à partir d'écritures (compte de résultat et actif déjà démontrés sur la balance ; passif et flux à confirmer avec une balance **complète et équilibrée**).
- **Reprise Sage** : import des à-nouveaux (balance) et, en option, de l'historique d'écritures (grand livre).
- Validation des règles d'écriture par un **expert-comptable** avant production.

## 12. Phasage

1. **Socle** : plan comptable, exercices, journaux, tiers, saisie, extourne, numérotation, grand livre et balance générale (écran, Excel, PDF).
2. **Ventes automatiques** : factures, encaissements, lettrage, rattrapage, avoirs.
3. **Achats, banque, caisse** : factures fournisseurs, règlements, balances tiers, **balance âgée**, analytique.
4. **Bilan et compte de résultat**, immobilisations et amortissements, exports.
5. **Tableau des flux**, clôture avec à-nouveaux, import Sage.

## 13. Points de vigilance

- Un bilan juste suppose que **tout** soit enregistré : stocks, immobilisations, amortissements, charges à payer, impôt, paie, emprunts.
- Le TFT demande des retraitements validés par un comptable.
- Notes annexes et liasse complète : **hors périmètre**.
- Le module produit la comptabilité, pas les déclarations fiscales.

## 14. Questions encore ouvertes

1. **4191 / 4091** pour les acomptes : confirmé ?
2. **Codes tiers** : reprise du style Sage (CA001, FB007) avec collectifs 4111/4011 : OK ? Génération automatique (initiale + numéro) pour les nouveaux clients ?
3. **Tranches** de la balance âgée du §8 (1-30, 31-60, 61-90, 91-180, >180) : OK ? Calcul sur échéance : OK ?
4. **Compte de produit par défaut** : 701, 705 ou 706 ? global ou par ligne ?
5. **Analytique** : axe Dossier seul ?
6. **Import Sage** (à-nouveaux et historique) : oui ?
7. **Balance APS 2025 complète et équilibrée** (avec ajustements et impôt) et balance 2024 définitive : disponibles ? Elles permettraient de finir l'oracle sur le passif et les flux.
8. **Exports des journaux** (PDF et Excel) tels que Sage les imprime : à fournir pour caler le modèle.
