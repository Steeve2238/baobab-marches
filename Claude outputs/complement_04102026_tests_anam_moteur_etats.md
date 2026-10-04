# Module Comptabilité — Tests sur les balances ANAM 2024 et 2025 (04/10/2026)

Complément à l'architecture v2. Aucun code de module écrit : seul un **prototype de calcul des états** (hors Baobab) a servi à tester les règles de correspondance comptes → lignes SYSCOHADA.

## 1. Les balances ANAM

- **Deux balances parfaitement équilibrées** (totaux débit = crédit pour les à-nouveaux, les mouvements et les soldes, et solde = à-nouveau + mouvements pour chaque compte). Elles remplacent la balance APS 2025, déséquilibrée de 316 M, pour les tests structurels.
- **Continuité 2024 → 2025 exacte** : les à-nouveaux de 2025 sont identiques aux soldes de clôture 2024 pour tous les comptes de bilan. Seules différences : les comptes de gestion (6, 7, 8), remis à zéro, et le compte 131 (résultat 2024, 3 804 293 380), affecté au report à nouveau.
- **Limite** : il n'y a pas d'états ANAM de référence. Les tests sont donc des **contrôles de cohérence** (équilibre, recoupement entre états, continuité), pas une comparaison à l'état officiel.

## 2. Résultats du prototype

| Contrôle | 2024 | 2025 |
|---|---|---|
| Résultat net du compte de résultat | 3 804 293 380 | 7 013 320 127 |
| Résultat repris au bilan (identique) | oui | oui |
| Total actif = total passif | 28 125 862 174 (écart 0) | 36 185 845 964 (écart 0) |
| Résultat 2024 retrouvé comme à-nouveau du compte 131 en 2025 | | oui (3 804 293 380) |

**Tableau des flux 2025** (N-1 = balance 2024) : CAFG 7 190 775 753 ; flux d'exploitation (ZB) 6 605 222 618 ; flux d'investissement (ZC) −187 657 798 ; variation de trésorerie 6 417 564 820 ; trésorerie d'ouverture 14 079 810 428 ; **trésorerie de clôture 20 497 375 248 = trésorerie du bilan, écart 0.** Le tableau se **boucle exactement**.

## 3. Ce que ces tests ont corrigé

1. **Numéros de compte de longueurs différentes.** Afrique Pesage utilise 8 chiffres ; ANAM mélange 4, 5 et 6 chiffres (4111, 40110, 121000). **La longueur des comptes est donc un paramètre de l'entreprise, jamais une règle fixe** : les états se calculent par **préfixe** (le plus long préfixe correspondant l'emporte), et l'import accepte n'importe quelle longueur.
2. **Compte générique d'une famille.** Le compte `239000` (bâtiments en cours) ne correspondait à aucune ligne tant que seul le préfixe `2391` était prévu : 521 M manquaient à l'actif. Règle ajoutée : un compte générique reprend la ligne **par défaut de sa famille** (239 → bâtiments, AK ; les sous-comptes 2392-2395 et 2399 → aménagements et installations, AL).
3. **Prêts au personnel (compte 272).** Leur remboursement (−60,9 M) est un flux d'investissement **« cession / remboursement d'immobilisations financières » (FJ)**, calculé sur les mouvements **crédit** des comptes 26 et 27. Sans lui, le tableau était déséquilibré de 60,9 M.
4. **Classement actif / passif selon le signe du solde** (confirmé) : fournisseurs débiteurs (40) en avances versées, clients créditeurs (41) en avances reçues, comptes 42, 43, 44 et 47 vers l'actif ou le passif selon leur solde.

## 4. Correspondances retenues (référentiel `etat_financier_ligne`)

**Actif** — AE : 211 (amort. 2811, dépr. 2911) · AF : 212-214 · AG : 215-216 · AH : 217-219 · AJ : 22 · AK : 231-233, 237, 239 (hors 2392-2395, 2399) · AL : 234, 235, 238, 2392-2395, 2399 · AM : 24 hors 245 · AN : 245 · AP : 25 · AR : 26 · AS : 27 · BA : 485, 486, 488 débiteurs · BB : 31-38 (dépr. 39) · BH : 40 débiteurs · BI : 41 hors 419, débiteurs (dépr. 491) · BJ : 42, 43, 44, 45, 46, 47, 48 débiteurs (hors 478, 485, 486, 488 ; dépr. 492-498) · BQ : 50 · BR : 51 débiteurs · BS : 52-58 débiteurs · BU : 478.

**Passif** — CA : 101-104 · CB : 109 · CD : 105 · CE : 106 · CF : 111-113 · CG : 118 · CH : 12 · CI : résultat calculé sur les classes 6, 7, 8 (+ 13 non affecté) · CL : 14 · CM : 15 · DA : 16 · DB : 17 · DC : 19 · DH : 481, 482, 484, 488 créditeurs · DI : 419 + 41 créditeurs · DJ : 40 créditeurs · DK : 42, 43, 44 créditeurs · DM : 45, 46, 47 créditeurs (hors 478-479) · DN : 499 · DQ : 564, 565 · DR : 52-58 créditeurs (hors 564-565) · DV : 479.

**Compte de résultat** — table des préfixes validée au franc près sur APS 2025 (TA 701 · RA 601 · RB 6031 · TB 702-704 · TC 705-706 · TD 707 · TE 73 · TF 72 · TG 71 · TH 75 · TI 781 · RC 602 · RD 6032 · RE 604, 605, 608 · RF 6033 · RG 61 · RH 62-63 · RI 64 · RJ 65 · RK 66 · TJ 791, 798, 799 · RL 681, 691 · TK 77 · TL 797 · TM 787 · RM 67 · RN 687, 697 · TN 82 · TO 84, 86, 88 · RO 81 · RP 83, 85 · RQ 87 · RS 89).

**Flux** — CAFG = résultat net + dotations (RL, RN) + valeur comptable des cessions (RO) − reprises (TJ, TL) − produits des cessions (TN) ; FB, FC, FD, FE = variations N/N-1 de l'actif circulant HAO, des stocks, des créances et du passif circulant ; FF, FG, FH = mouvements **débit** des comptes 21, 22-24, 26-27 ; FI = TN ; FJ = mouvements **crédit** des comptes 26-27 ; ZA = trésorerie nette N-1 (titres de placement inclus) ; ZH = ZA + ZB + ZC + ZF, **contrôlé** contre la trésorerie du bilan.

## 5. Ce qui reste incertain

- **Ligne FG sur APS** : écart de 159 M non expliqué par la balance seule (voir v2 §2.3). Sur ANAM, aucun écart. Avec les écritures détaillées, FG sera calculée sur les mouvements réels.
- **Notes annexes** : hors périmètre.
- **Tests de comparaison à l'état officiel** : possibles seulement si Steeve retrouve des états signés (bilan, résultat, flux) d'ANAM.

## 6. Réponse sur les comptes de tiers

Chaque client (et chaque fournisseur) reçoit **automatiquement** son compte de tiers à sa création : code auxiliaire généré, rattaché au collectif 411 (clients) ou 401 (fournisseurs). **Il n'est pas modifiable par l'utilisateur** : il est affiché, mais verrouillé. Un client dont la créance devient douteuse se traite par une **écriture** (virement 411 → 416), pas en changeant son compte.
