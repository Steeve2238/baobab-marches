# Module Comptabilité — Décisions du 04/10/2026 (complément à l'architecture v2)

Réponses de Steeve aux questions ouvertes de la v2. Aucun code écrit à ce stade.

## Décisions confirmées

| Sujet | Décision |
|---|---|
| Acomptes | **4191 (clients) et 4091 (fournisseurs), obligatoire.** |
| Comptes collectifs | **411 (clients) et 401 (fournisseurs)** sur les balances générales. Le **détail par tiers** n'apparaît que sur les **balances tiers**. Codes tiers au style Sage (CA001, FB007). |
| Balance âgée | Modèle de la v2 approuvé : non échu, 1-30, 31-60, 61-90, 91-180, plus de 180 jours, calcul sur la date d'échéance. |
| Analytique | **Axe Dossier uniquement.** |
| Import Sage | **Oui** (à-nouveaux, et historique en option). |
| Balance APS 2025 équilibrée | Steeve cherche une version complète et équilibrée, et reviendra. En attente : le test d'oracle du passif et des flux. |

## Compte de vente : écritures préparées, le comptable tranche

Baobab ne peut pas deviner si une facture est une prestation, une vente de marchandises ou des travaux. Décision : **le système génère toutes les écritures automatiquement, avec un compte par défaut, et le comptable ou le directeur financier corrige et valide le lendemain matin.**

**Statuts d'une écriture** : `EN_INSTANCE` (générée automatiquement, en attente) → `VALIDEE`. Une écriture saisie à la main garde en plus le statut `BROUILLON`.

**Écran « Écritures en instance »** (le premier écran du comptable) :
- liste des écritures générées depuis les factures, acomptes, soldes, encaissements et annulations, avec la pièce d'origine (lien vers la facture) ;
- pour chaque ligne de produit : un bouton **« Changer le compte »** (recherche dans le plan comptable, par numéro ou libellé) ;
- boutons **« Valider »** (une écriture), **« Valider la sélection »** et **« Tout valider »** ;
- la correction ne touche **que le compte** : les montants, le client, la TVA et le 411 sont verrouillés (ils viennent de la facture). Cela évite de casser l'équilibre ;
- option **« Appliquer ce compte aux écritures similaires »** (même client ou même type), pour corriger une fois et non facture par facture ;
- chaque changement de compte est **journalisé** (ancien compte, nouveau compte, utilisateur, date).

**Règles associées :**
- Le **compte par défaut** est un paramètre de l'entreprise (proposé : 706 prestations de services, modifiable : 701, 705…). Une facture d'acompte va toujours en 4191, sans choix.
- **Numérotation continue des écritures attribuée à la validation** (pas à la génération), pour qu'aucun trou n'apparaisse si une écriture en instance est corrigée.
- Une facture **annulée** alors que son écriture est encore en instance : l'écriture en instance est **supprimée** (rien n'a été validé). Si elle était déjà validée : **extourne**.
- **Les états officiels** (grand livre, balance, bilan, résultat, flux) ne comptent que les écritures **validées**. Un interrupteur « inclure les écritures en instance » permet un aperçu, avec un bandeau indiquant leur nombre.
- Le **compte client 411** et la TVA ne dépendent pas du choix du compte de vente : la balance clients et la balance âgée peuvent donc être consultées avec les écritures en instance incluses, sans risque de faux montants.
- **Permissions** : générer ne demande rien (c'est automatique) ; **valider** et **changer le compte** relèvent du niveau « validation » du module `comptabilite`.

## Prochaine étape

Phase 1 (socle) dès confirmation : plan comptable SYSCOHADA préchargé, exercices, journaux, tiers (codes Sage), saisie manuelle, statuts, extourne, numérotation, grand livre et balance générale (écran, Excel, PDF au modèle Sage). L'écran des écritures en instance arrive en phase 2 avec les ventes automatiques.
