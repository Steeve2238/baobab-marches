# Complément du 04/10/2026 — Comptabilité : import Sage (grand livre et balance)

Livraison : `baobab_comptabilite_import_sage.zip` (10 fichiers, à extraire à la racine du dépôt en écrasant). Migration à appliquer : **030**. Aucune nouvelle dépendance (la librairie `xlsx` et `multer` sont déjà présentes).

## Demande de Steeve
Pouvoir reprendre en cours d'exercice les écritures d'une structure (activité 2026 déjà démarrée) à partir de ses exports Sage, « exactement comme ça » : grand livre de l'année en cours et balance, avec un modèle d'import et un bouton Importer. Les écritures d'ouverture (à-nouveaux) passent par la même voie.

## Où on trouve quoi (précisions demandées)
- **Import** : Comptabilité → onglet **Importer** (réservé au niveau validation).
- **Écritures d'ouverture** : import de la **balance générale**, bloc « À-nouveaux (solde au 01/01) », journal AN. Saisie manuelle possible aussi dans le journal AN.
- **Bilan, compte de résultat, tableau des flux de trésorerie** : pas encore construits. Prévus en phase 4 (bilan, résultat, immobilisations) et phase 5 (TFT, clôture, à-nouveaux automatiques). Ils se calculeront sur les écritures validées, donc l'historique importé est directement exploitable.

## Formats acceptés (ceux des exports Sage fournis : GL_2026.xls, BALANCE_GENERALE_2026.xls, balances ANAM, balances tiers)
- **Grand livre** : N° COMPTE, DATE, CODE J, N° PIECES, LIBELLE, (lettrage, colonne sans titre), DEBIT, CREDIT, SOLDES ; colonnes facultatives TIERS et NOM TIERS. Reconnaissance par les titres de colonnes (accents et majuscules sans importance). Dates : dates Excel, jj/mm/aaaa, aaaa-mm-jj, JJMMAA.
- **Balance générale** : compte, libellé, puis 3 blocs Débit/Crédit (Solde au 01/01, Mouvements, Soldes cumulés). On choisit le bloc, la date et le journal (AN par défaut, OD pour les mouvements). Numéros de compte à 6 chiffres complétés à droite par des zéros (format ANAM).
- **Balances auxiliaires clients / fournisseurs** (facultatives) : code, nom, mêmes 6 colonnes ; elles détaillent les comptes 411 / 401 par tiers.
- Fichiers .xls et .xlsx, 20 Mo maximum. Modèles Excel téléchargeables (bouton « Télécharger le modèle »).

## Fonctionnement
1. **Aperçu** : tout l'import est exécuté dans une transaction annulée à la fin, le rapport est donc identique à l'import réel (écritures, lignes, totaux, période, détail par journal, comptes / journaux / exercices / tiers qui seront créés, avertissements, erreurs).
2. **Import** : bloqué tant qu'il y a une erreur (pièce déséquilibrée, compte / journal / exercice inconnu sans autorisation de création, exercice clôturé, date ou montant illisible, balance non équilibrée). Sinon les écritures sont créées **validées** (numérotation continue par journal, ordre chronologique, numéro de pièce d'origine conservé, lettrage conservé) ou **en instance** si la case est cochée.
3. **Lots** : chaque import forme un lot (fichier, période, nombre d'écritures, totaux). Un même fichier ne peut pas être importé deux fois tant que le lot est actif. **Annulation d'un lot** possible si l'exercice est ouvert, si aucune écriture du lot n'a été extournée et si ses numéros sont les derniers de leur journal (pas de trou) ; les compteurs sont alors rendus.
4. Pièces déjà présentes (même journal, pièce, date, montant) ignorées avec avertissement. Avertissement si des écritures validées plus récentes existent déjà dans les mêmes journaux (les numéros importés viendront après).

## Tiers
- Lignes 411 / 401 **avec** code tiers (colonne TIERS du grand livre ou balances auxiliaires) : le tiers est retrouvé par code (et nom), sinon par nom, sinon créé avec son code Sage s'il est libre (sinon code généré, avec avertissement de conflit).
- Lignes 411 / 401 **sans** code tiers (cas du GL_2026 de Sen'Burger, où le grand livre ne porte que le compte collectif) : rattachées à un tiers de reprise (`CREPRISE` / `FREPRISE`), avec avertissement. Les balances tiers viendront avec la phase 3.

## Tests réalisés (base PostgreSQL réelle + navigateur)
- GL_2026.xls (Sen'Burger) : 691 pièces, 1 422 lignes, total 16 338 962 au débit = au crédit ; journaux ACH 346 / CAI 345 ; **19 comptes réconciliés au centime avec la balance générale 2026** ; numérotation 1..346 sans trou ; 690 lignes avec lettrage conservé.
- Rejeu du même fichier : refusé (409). Annulation du lot : 691 écritures supprimées, compteurs rendus ; réimport identique. Import en instance : 691 écritures en instance, puis annulées.
- Balance ANAM (xlsx, comptes à 6 chiffres) : à-nouveaux 43 814 759 423 équilibrés, exercice 2024 créé à la volée, avec balances tiers (écarts signalés car fichiers d'entités différentes dans ce test) ; aperçu SOLDES et MOUVEMENTS ; balance Sen'Burger en mouvements ; permissions (saisie refusée 403) ; fichier du mauvais type refusé avec message clair ; modèles Excel générés et relus par l'import.
- Interface : aperçu, import, liste et annulation de lots testés dans un navigateur.

## Limites et précautions
- Importer **avant** de saisir ou de générer des écritures de ventes sur la même période, pour que la numérotation soit chronologique ; si les ventes Baobab couvrent déjà la période importée, utiliser l'option « Depuis le » du rattrapage (écran En instance) pour ne pas compter les ventes deux fois.
- Les comptes absents du plan sont créés avec le libellé « Compte N (import) » (le grand livre ne porte pas les intitulés de comptes) : à renommer dans le plan comptable ; la balance générale apporte les vrais intitulés.
- Une balance non équilibrée est refusée (pas d'écriture d'attente automatique).
- Le plan comptable reste à faire relire par l'expert-comptable.
