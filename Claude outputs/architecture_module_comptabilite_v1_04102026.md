# Module Comptabilité Baobab — Architecture proposée (v1, 04/10/2026)

**Référentiel : SYSCOHADA révisé, système normal. Statut : proposition à valider, aucun code écrit.**

## 1. Décisions déjà prises avec Steeve

| Sujet | Décision |
|---|---|
| Système comptable | **Système normal** par défaut. Un paramètre `systeme_comptable` est prévu au niveau de l'entreprise pour accueillir un jour le Système Minimal de Trésorerie, mais il n'est **pas** construit maintenant. |
| Rôle de Baobab | **Outil comptable principal** de l'entreprise : saisie complète (achats, banque, caisse, opérations diverses), pas seulement le reflet des ventes. |
| Point de départ | Depuis le début d'utilisation de Baobab par l'entreprise, avec **reprise des à-nouveaux** possible. |
| Logiciel actuel des clients | **Sage Saari**. Ses exports servent de référence de format. |
| Acomptes | Passent par les comptes d'avances : **4191** (clients, avances et acomptes reçus) et **4091** (fournisseurs, avances et acomptes versés). *(interprétation de la réponse « 41-91 / 40-91 », à confirmer)* |
| TVA | Constatée **à la facturation** (pas à l'encaissement). |
| Balances âgées | Retards par **tranche d'ancienneté**, pour clients et fournisseurs. |
| Analytique | **Ventilation analytique** (par dossier / chantier, voir §7). |

## 2. Ce que les documents fournis m'apprennent

**Exports Sage Saari (Grand livre et Balance générale 2026).** Ils appartiennent à une autre entité que les états financiers (Sen'Burger, un restaurant), ce qui est utile : ça prouve que le format est générique.

- Les comptes ont **8 chiffres** (40110000, 44520000, 57110000, 60210000). La base SYSCOHADA est complétée par des zéros.
- Le grand livre est trié par compte, avec les colonnes : N° COMPTE, DATE, CODE J, N° PIECES, LIBELLE, lettrage, DEBIT, CREDIT, SOLDES. Le solde est cumulé ligne à ligne (débit − crédit).
- Journaux observés : `ACH` (achats) et `CAI` (caisse). Une pièce est identifiée par le couple (journal, N° de pièce) et est toujours équilibrée : 691 pièces testées, 0 déséquilibrée.
- Le lettrage est une **lettre** (A, B… AA, AB…) posée sur le compte de tiers, qui rapproche une facture d'achat et son règlement.
- Schéma d'une pièce d'achat : débit 6xxx (HT) + débit 4452 (TVA récupérable), crédit 4011 (fournisseur). Schéma d'un règlement : débit 4011, crédit 5711 (caisse).
- La balance a trois blocs de colonnes : *Solde au 01/01* (D/C), *Mouvements* (D/C), *Soldes cumulés* (D/C), avec une ligne TOTAUX.

**États financiers (Afrique Pesage Sénégal, exercice 2025).** Bilan, Compte de résultat et Tableau des flux de trésorerie au format officiel SYSCOHADA révisé, avec leurs **codes de lignes** : AD…BZ et CA…DZ pour le bilan, TA…XI pour le résultat, ZA…ZH (FA, FB, T1, T3…) pour les flux, plus la colonne « Notes ». Chaque état a un exercice N et un exercice N-1 ; le bilan actif a en plus les colonnes Brut / Amortissements / Net.

Ces trois états se recoupent : le résultat net du compte de résultat (−331 912 614) est repris au bilan, et la trésorerie nette de fin du tableau de flux (877 306 127) est égale à la trésorerie actif du bilan. Cette cohérence sert de **test de validation** (voir §10).

## 3. Principes directeurs

1. **Tout est écriture.** Les états (grand livre, balances, bilan, résultat, flux) ne sont jamais saisis : ils sont calculés à partir des écritures validées.
2. **Partie double stricte.** Total débit = total crédit pour chaque pièce, contrôlé en base et à l'application.
3. **Inaltérabilité.** Une écriture validée ne se modifie ni ne se supprime. On corrige par une écriture d'**extourne** (contre-passation) liée à l'originale. Une écriture non validée reste en brouillon.
4. **Numérotation continue et chronologique** par journal et par exercice, sans trou (même mécanisme verrouillé que les devis et factures).
5. **Exercices verrouillables.** Un exercice clôturé n'accepte plus aucune écriture.
6. **Traçabilité.** Chaque écriture porte son auteur, sa date de saisie, sa date de validation et, si elle est automatique, la pièce d'origine (facture, règlement...).
7. **Isolation par entreprise** (`tenant_id` partout), comme le reste de la plateforme.

## 4. Modèle de données

Toutes les tables portent `tenant_id`. Les montants sont en `NUMERIC(18,2)`, devise XOF.

- **`compta_parametre`** : système comptable, longueur des numéros de compte (8 par défaut, comme Sage), comptes par défaut (voir §5), tranches de la balance âgée, date de début de comptabilité.
- **`exercice_comptable`** : libellé, date de début, date de fin, durée en mois, statut (`OUVERT` / `CLOTURE`). Pas de chevauchement. Le premier exercice peut avoir une durée différente de 12 mois.
- **`compte_comptable`** : numéro (texte), libellé, classe (1 à 9), nature (général / collectif client / collectif fournisseur / trésorerie), sens normal, lettrable oui/non, tiers obligatoire oui/non, analytique oui/non, actif. **Plan SYSCOHADA révisé chargé automatiquement** à la création de chaque entreprise ; l'entreprise peut ajouter ses propres sous-comptes, jamais en supprimer un utilisé.
- **`tiers`** : type (client / fournisseur / autre), code, compte collectif de rattachement (4111 / 4011 par défaut), compte auxiliaire généré (ex. collectif + séquence), lien vers `client_commercial` ou `fournisseur`. Création automatique pour tout nouveau client commercial ; les fournisseurs existants (table très pauvre aujourd'hui : nom, pays, score) seront enrichis.
- **`journal`** : code (`VTE`, `ACH`, `BQ1`..., `CAI`, `OD`, `AN`), libellé, type (ventes / achats / banque / caisse / opérations diverses / à-nouveaux), compte de trésorerie associé pour banque et caisse.
- **`ecriture`** (en-tête de pièce) : exercice, journal, **numéro d'écriture continu**, numéro de pièce (référence du document d'origine), date comptable, libellé, statut (`BROUILLON` / `VALIDEE`), origine (`FACTURE_VENTE`, `ENCAISSEMENT`, `AVOIR`, `SAISIE`, `IMPORT_SAGE`, `EXTOURNE`...), identifiant de la pièce d'origine, écriture extournée liée. Contrainte d'unicité sur (origine, pièce d'origine, rôle) pour qu'**une facture ne soit jamais comptabilisée deux fois**.
- **`ligne_ecriture`** : compte, tiers (si compte de tiers), libellé, débit, crédit, date d'échéance (pour la balance âgée), code de lettrage.
- **`section_analytique`** et **`ventilation_analytique`** : voir §7.
- **`encaissement`** (nouveau, indispensable) : facture, date, mode, compte de trésorerie, montant, référence. Remplace le simple changement de statut IMPAYÉE → PAYÉE d'aujourd'hui, et autorise les **règlements partiels** et plusieurs règlements par facture.
- **`etat_financier_ligne`** (référentiel) : pour chaque état, chaque code de ligne (AD, AE... TA... FA...), son libellé, sa note, son signe et sa formule (comptes ou plages de comptes, lignes sommées).
- **`immobilisation`** (phase ultérieure) : fiche, valeur d'acquisition, durée, mode d'amortissement, dotations générées en écritures. Nécessaire pour les colonnes Brut / Amortissements du bilan.

## 5. Comptabilisation automatique des ventes

Les écritures sont créées **dans la même transaction** que le document, sur le journal `VTE`. Les comptes viennent de `compta_parametre` (modifiables), avec possibilité de préciser la nature de chaque ligne (marchandise / service / travaux).

| Événement | Écriture |
|---|---|
| **Facture intégrale** | Débit 411 client (TTC) · Crédit 70x (HT **net de remise**) · Crédit 443x (TVA) |
| **Facture d'acompte** | Débit 411 client (net à payer) · Crédit **4191** (HT de l'acompte) · Crédit 443x (TVA de l'acompte) |
| **Facture de solde** | Débit 411 client (net à payer) · Débit **4191** (acomptes HT déjà reçus) · Crédit 70x (HT total net de remise) · Crédit 443x (TVA totale moins TVA déjà constatée sur les acomptes) |
| **Annulation** d'une facture | Écriture d'**extourne** de l'écriture d'origine (jamais de suppression) |
| **Encaissement** | Débit 521 banque / 571 caisse · Crédit 411 client, puis lettrage automatique avec la facture |
| **Avoir** *(nouveau document à créer)* | Inverse de la facture |

Remarques :
- La remise sur facture est déjà déduite avant TVA dans Baobab ; l'écriture se fait donc sur le HT net, sans compte 709.
- Les comptes de ventes (701 marchandises, 705/706 travaux et services) et de TVA (4431 ventes, 4432 prestations, 4433 travaux) dépendent de la nature de l'activité : valeur par défaut au niveau de l'entreprise, avec possibilité de la préciser par ligne. **À faire valider par l'expert-comptable.**
- **Rattrapage** : à l'activation du module, toutes les factures et paiements existants sont comptabilisés en lot, à leur date d'origine, sur l'exercice concerné. L'opération est rejouable sans doublon grâce à la contrainte d'unicité.

## 6. Saisie manuelle, journaux et lettrage

- **Saisie de pièces** pour les achats, la banque, la caisse, les opérations diverses et les à-nouveaux : grille de saisie avec contrôle de l'équilibre en direct, brouillon puis validation.
- **Achats** : à partir de la phase 3, un vrai document « facture fournisseur » (HT, TVA récupérable 4452/4454, TTC, compte de charge, analytique) et ses règlements.
- **Lettrage** : manuel ou automatique par tiers (rapprochement facture / règlement), avec une lettre par groupe, comme dans Sage.
- **Rapprochement bancaire** : hors périmètre initial.

## 7. Analytique

Un **axe « Dossier »** : chaque section analytique correspond à un dossier d'appel d'offres, à une consultation restreinte ou à une affaire libre. Les lignes d'écriture des classes 6 et 7 (et sur demande 2) peuvent être ventilées sur une ou plusieurs sections, en montant ou en pourcentage. Les ventes générées depuis un devis lié à une consultation héritent automatiquement de leur section. États associés : grand livre analytique, balance analytique, **résultat par dossier** (produits − charges). D'autres axes (département, centre de coût) sont possibles si besoin.

## 8. États, balances et exports

| État | Source | Particularités |
|---|---|---|
| **Journaux** | Écritures validées par journal et période | Total débit / crédit par journal |
| **Grand livre** | Par compte et par période | Colonnes identiques à Sage : N° COMPTE, DATE, CODE J, N° PIECES, LIBELLE, lettrage, DEBIT, CREDIT, SOLDES (solde cumulé) |
| **Balance générale** | Par compte | Colonnes identiques à Sage : Solde d'ouverture, Mouvements, Soldes cumulés (débit / crédit), ligne TOTAUX |
| **Balance clients / fournisseurs** | Par tiers | Même présentation |
| **Balance âgée** | Soldes ouverts par tiers | Tranches configurables (proposition : non échu, 0-30, 31-60, 61-90, plus de 90 jours) |
| **Bilan** | Soldes des comptes, exercice N et N-1 | Format officiel : Brut / Amortissements / Net N / Net N-1, codes AD…DZ. Un compte de tiers au solde inversé passe de l'actif au passif (ex. fournisseur débiteur → « Fournisseurs et avances versées »). |
| **Compte de résultat** | Comptes 6, 7 et 8 | Codes TA…XI, colonne signe et soldes intermédiaires (marge, valeur ajoutée, EBE, résultat d'exploitation, financier, AO, HAO, net) |
| **Tableau des flux de trésorerie** | Soldes N et N-1 | Méthode indirecte, codes ZA…ZH. **L'état le plus délicat** : CAFG, variation du BFR, investissements, financement, avec contrôle ZH = trésorerie actif − trésorerie passif du bilan. |

**Exports.** Excel via la librairie déjà présente côté serveur, avec la même disposition de colonnes que Sage. Pour le **PDF** : le navigateur (impression) suffit pour un affichage correct, mais pour une reproduction fidèle des modèles de Steeve je recommande une génération côté serveur par une bibliothèque légère (pdfkit ou pdfmake). Éviter Chromium/Puppeteer : l'hébergement mutualisé O2switch a déjà montré (build Next.js, erreurs EAGAIN) un plafond de processus simultanés.

## 9. Droits d'accès

Nouveau module `comptabilite` dans le système de permissions existant, avec quatre niveaux séparés : **lecture**, **saisie**, **validation**, **clôture d'exercice**. Les rôles lecture seule (Directeur Général) consultent tout sans rien modifier. La clôture et la validation en lot sont réservées à l'administrateur et aux profils comptables habilités. Chaque action sensible (validation, extourne, clôture) est journalisée.

## 10. Validation et reprise

- **Test d'oracle** : à partir de la balance générale réelle de l'entreprise (exercices N et N-1), le module doit retrouver **au franc près** les trois états de l'exemple (Bilan, Compte de résultat, Tableau des flux). C'est le critère de réussite des phases 4 et 5.
- **Reprise Sage** : import des **à-nouveaux** depuis une balance Sage (format déjà reçu) et, en option, import de l'**historique d'écritures** depuis un export de grand livre Sage. Permet à une entreprise en cours d'exercice de basculer sans ressaisie.
- Validation fonctionnelle des règles d'écriture (§5) par un expert-comptable avant mise en production.

## 11. Phasage proposé

Chaque phase est testée sur une vraie base, livrée et documentée comme les chantiers précédents.

1. **Socle** : plan comptable, exercices, journaux, tiers, saisie manuelle avec validation, extourne, numérotation continue, grand livre et balance générale (écran + Excel).
2. **Ventes automatiques** : comptabilisation des factures (intégrale, acompte, solde), encaissements et lettrage, rattrapage de l'existant, avoirs.
3. **Achats, banque, caisse** : factures fournisseurs, règlements, balances clients / fournisseurs, balance âgée, analytique.
4. **États financiers** : bilan et compte de résultat (+ immobilisations et amortissements), exports Excel et PDF fidèles aux modèles.
5. **Tableau des flux, clôture et reprise** : flux de trésorerie, clôture d'exercice avec génération des à-nouveaux, import Sage.

## 12. Points de vigilance

- **Le bilan n'est juste que si tout est enregistré** : stocks, immobilisations, amortissements, charges à payer, capital, emprunts, paie. Les ventes seules ne suffisent pas ; le module doit permettre ces saisies dès la phase 1.
- **Le tableau des flux** demande une correspondance précise entre comptes et lignes, et certains retraitements manuels (cessions, reprises de provisions).
- **Les notes annexes** (colonne « Notes » des états, liasse complète) ne sont pas incluses sauf demande.
- **Fiscalité** : le module produit la comptabilité, pas les déclarations (TVA, IS).

## 13. Questions ouvertes

1. Confirmation de l'interprétation **4191 / 4091** pour les acomptes.
2. **Numéros de compte à 8 chiffres** comme Sage (40110000), avec compte collectif 4111 (clients) / 4011 (fournisseurs) et un compte auxiliaire par tiers ?
3. **Tranches** de la balance âgée : 0-30 / 31-60 / 61-90 / plus de 90 jours convient ?
4. **Analytique** : seulement l'axe « Dossier », ou aussi d'autres axes ?
5. **Compte de produit par défaut** des ventes : 701 (marchandises), 706 (services) ou 705 (travaux) ? Par ligne ou global ?
6. **Notes annexes** : dans ou hors périmètre ?
7. **Import Sage** (à-nouveaux et historique d'écritures) : oui ?

## 14. Documents encore attendus

- La **balance générale réelle d'Afrique Pesage Sénégal, exercices 2025 et 2024**, pour le test d'oracle du §10.
- Les **fichiers Excel d'origine** des trois états s'ils existent (les formules révèlent la correspondance comptes ↔ lignes utilisée par le cabinet).
- Un **export des journaux** (PDF et Excel) tel que Sage les imprime.
- Les **balances auxiliaires** clients et fournisseurs, et la **balance âgée**.
- Les **impressions PDF** du grand livre et de la balance telles que Sage les produit.
