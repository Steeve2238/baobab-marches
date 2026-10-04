# Complément du 04/10/2026 — Comptabilité, phase 2 : écritures de ventes automatiques et écran « En instance »

Livraison : `baobab_comptabilite_phase2.zip` (cumulatif : contient aussi les fichiers de la phase 1, à extraire à la racine du dépôt en écrasant). Migration à appliquer : **029** (la 028 de la phase 1 doit être appliquée avant).

## 1. Principe
Chaque opération de vente génère automatiquement une écriture au statut **EN_INSTANCE** dans le journal des ventes (VTE), avec le compte de vente par défaut (706…). Le comptable (ou le DF) corrige **uniquement le compte** (produit ou trésorerie) ; montants, client, TVA et compte 411 sont verrouillés ; il valide ; le numéro définitif (sans trou) est attribué à la validation. Seules les écritures VALIDEES comptent dans les états officiels (option « inclure les écritures en instance »).

## 2. Schémas d'écriture
| Opération | Débit | Crédit |
|---|---|---|
| Facture intégrale | 411 (tiers) = TTC net à payer | 70x par ligne (HT net de remise) ; 4431 (TVA) |
| Facture d'acompte | 411 net | 4191 (part HT, tiers rattaché) ; 4431 (reste) |
| Facture de solde | 411 net ; 4191 (HT des acomptes déjà facturés) | 70x (HT total) ; 4431 (TVA totale − TVA déjà sur acomptes) |
| Encaissement (facture payée) | Trésorerie (journal CAI si mode espèces/caisse/liquide, sinon BQ1) | 411 (tiers) |
| Annulation | écriture non validée : supprimée ; écriture validée : écriture inverse EN_INSTANCE (liée par `extourne_de_id`) | |

Résolution du compte de vente : règle DÉSIGNATION → règle CLIENT → `compte_vente_defaut`. L'échéance de la facture est synchronisée sur les lignes 411.

## 3. « Changer le compte »
- Seules les lignes EN_INSTANCE marquées `compte_modifiable` (PRODUIT : classe 7 ; TRESORERIE : compte de nature trésorerie ou classe 5).
- Portée : cette ligne / même désignation / même client / toutes les lignes similaires en instance.
- Option « Retenir pour les prochaines écritures » : mémorise une règle (CLIENT ou DÉSIGNATION), listée et supprimable dans Paramètres.
- Chaque changement est journalisé (`CHANGEMENT_COMPTE_INSTANCE`). Droit requis : niveau validation.

## 4. Rattrapage de l'existant
Sur l'écran En instance, le bandeau propose « Générer les écritures manquantes » (date de départ facultative). Les factures antérieures au premier exercice sont comptées « hors exercice » et non comptabilisées. Idempotent (index unique tenant/origine/origine_id/rôle).

## 5. Technique
- Migration 029 : `compta_parametre.compte_tva_collectee` (défaut 4431…), `ligne_ecriture.compte_modifiable`, table `compta_regle_compte_vente`, index partiel `idx_ecriture_instance`.
- Nouveau service `comptaVentes.js` ; hooks dans `ventes.js` (génération facture, modification, paiement, annulation), silencieux (une erreur comptable ne bloque jamais la vente).
- Routes : `GET /instance`, `GET /instance/resume`, `POST /instance/valider`, `POST /instance/rattrapage`, `PATCH /lignes/:id/compte`, `GET/DELETE /regles-compte-vente`.
- Correctif phase 1 : `GET /ecritures?q=` renvoyait 500 (placeholder `$#` non remplacé).
- Frontend : page `/comptabilite/instance`, onglet « En instance » avec pastille, bandeau d'avertissement sur grand livre/balance, paramètre « TVA collectée », liste des règles mémorisées.

## 6. Limites connues
- Un acompte annulé après génération du solde ne réajuste pas l'écriture du solde.
- La remise est comptabilisée nette dans les lignes de produit.
- Le plan comptable reste à relire par l'expert-comptable.

## 7. Prochaines phases
3 : achats, banque, caisse, balances tiers, balance âgée, analytique Dossier. 4 : bilan, compte de résultat, immobilisations. 5 : TFT, clôture, import Sage.
