# Mise à jour en un clic et sauvegardes — Baobab Marchés

Ce dossier contient tout ce qu'il faut pour :

1. **mettre à jour le site depuis votre PC** en double-cliquant sur `deploy\pc\deployer.bat` ;
2. **sauvegarder chaque nuit** la base de données sur le serveur (chiffrée, 14 jours conservés) ;
3. **recopier ces sauvegardes sur votre PC** automatiquement dès qu'il est allumé.

Rien ne se déclenche tout seul à l'envoi sur GitHub : c'est vous qui décidez du moment de la mise à jour.

## Ce qui est protégé, et où

| Élément | Où il est protégé |
|---|---|
| Code de la plateforme | GitHub (dépôt privé) + votre PC |
| Toutes les données des clients, y compris les fichiers téléversés (stockés dans la base) | Sauvegarde de nuit chiffrée sur le serveur **+ copie sur votre PC** |
| Réglages saisis dans cPanel (variables d'environnement : `JWT_SECRET`, SMTP, `DATABASE_URL`…) | **Pas sauvegardés automatiquement** : gardez-en une copie dans votre gestionnaire de mots de passe. Perdre `JWT_SECRET` invalide les sessions et les codes d'accès du portail. |
| Phrase secrète de chiffrement des sauvegardes | **Uniquement chez vous** (gestionnaire de mots de passe + papier). Sans elle, les sauvegardes sont illisibles. |

## Installation (une seule fois, environ 20 minutes)

### A. Côté serveur

1. Envoyez ce dossier sur GitHub (comme d'habitude), puis dans le **Terminal cPanel** :
   ```
   cd ~/baobab-marches && git pull
   bash deploy/serveur/preparer_serveur.sh
   ```
2. Le script vous demande le nom, l'utilisateur et le mot de passe de la base PostgreSQL (les mêmes que dans cPanel), crée la **phrase secrète**, fait une première sauvegarde de test et programme la sauvegarde de **2 h 30 chaque nuit**.
3. **Copiez la phrase secrète affichée** dans votre gestionnaire de mots de passe et sur papier. Elle ne sera plus jamais affichée.
4. Si le script indique que `crontab` n'est pas disponible, ajoutez la commande indiquée dans cPanel > Tâches Cron.
5. Facultatif : créez `~/.baobab_deploy.env` pour régler la mise à jour (adresse du site contrôlée après mise à jour, chemins Node) :
   ```
   SITE_URL=https://adresse-du-site-baobab
   NODEVENV_FRONT=/home/yast2163/nodevenv/baobab-marches/frontend/22/bin/activate
   ```
   (Si le front utilise un autre environnement Node que `.../baobab-marches/frontend/22`, indiquez le bon chemin, visible dans cPanel > Setup Node.js App.)

### B. Côté PC (Windows 10 ou 11)

1. **Accès SSH** (permet au PC de parler au serveur sans mot de passe) :
   - Ouvrez PowerShell et tapez : `ssh-keygen -t ed25519` (Entrée à chaque question : cette clé servira aussi à la copie automatique des sauvegardes).
   - Dans cPanel > **Accès SSH** (SSH Access) > Importer une clé : collez le contenu de `%USERPROFILE%\.ssh\id_ed25519.pub`, puis **Gérer > Autoriser** la clé.
   - Notez le nom du serveur (hôte) affiché dans cPanel. Le port est en principe 22 ; s'il est différent, indiquez-le à l'étape suivante.
   - Test : `ssh yast2163@NOM_DU_SERVEUR` doit vous ouvrir le terminal du serveur.
2. Dans `deploy\pc`, copiez `deploy.config.example.ps1` en **`deploy.config.ps1`** et remplissez : hôte, utilisateur, adresses à contrôler, dossier des sauvegardes sur le PC (par défaut `D:\Sauvegardes_Baobab`). Ce fichier ne part jamais sur GitHub.
3. Double-cliquez sur **`installer_tache_sauvegardes.bat`** : crée la tâche Windows « Baobab - copie des sauvegardes » (chaque jour à 9 h, à l'ouverture de session, et dès que le PC est allumé s'il était éteint).
4. Double-cliquez sur **`sauvegardes_pc.bat`** pour un premier test : les sauvegardes du serveur doivent apparaître dans le dossier choisi.

## Utilisation courante

### Mettre à jour le site

Double-clic sur **`deploy\pc\deployer.bat`**. Le script :

1. vérifie que vous êtes sur la branche `main` et refuse d'envoyer un secret, une archive ou un fichier volumineux (`.zip`, `.env`, sauvegardes…) ;
2. enregistre vos modifications (il vous demande un message), les envoie sur GitHub ;
3. vous demande confirmation, puis sur le serveur : **sauvegarde de sécurité de la base**, récupération du code, migrations, construction de l'interface, redémarrage ;
4. contrôle que l'API et le site répondent.

Garde-fous : si une migration ou la construction échoue, le **code revient automatiquement** à la version précédente et le site reste en ligne. Un journal de chaque mise à jour est conservé sur le serveur dans `~/deploy/logs`.

**Revenir en arrière** après une mise à jour qui s'est bien terminée mais pose problème : double-clic sur **`retour_arriere.bat`** (remet le code précédent). Si la mise à jour avait modifié la base, restaurez aussi la sauvegarde « avant-deploiement » (voir plus bas).

Sans accès SSH, le script envoie quand même le code et affiche **une seule commande à coller dans le Terminal cPanel**.

### Les sauvegardes

- Sur le serveur : `~/sauvegardes/baobab_AAAAMMJJ_HHMMSS.dump.enc` chaque nuit (14 jours, toujours au moins les 3 dernières) et `avant-deploiement_…` avant chaque mise à jour (les 10 dernières).
- Sur le PC : copie automatique (60 dernières nuits). Chaque fichier est vérifié par empreinte. Si la sauvegarde de nuit a plus de 36 heures, une **alerte** s'affiche : la tâche du serveur ne tourne plus.
- Chaque sauvegarde est testée à la création : l'archive doit être lisible et se déchiffrer, sinon elle est rejetée et l'erreur est écrite dans `~/sauvegardes/sauvegarde.log`.

### Restaurer

Dans le Terminal cPanel (la sauvegarde choisie remplace les données actuelles ; une sauvegarde de sécurité est faite juste avant, et vous devez taper `RESTAURER`) :

```
bash ~/baobab-marches/deploy/serveur/restaurer.sh ~/sauvegardes/baobab_AAAAMMJJ_HHMMSS.dump.enc
touch ~/baobab-marches/backend/tmp/restart.txt
```

Pour restaurer une copie qui n'existe plus que sur votre PC : envoyez le fichier `.dump.enc` dans `~/sauvegardes` (gestionnaire de fichiers cPanel ou `scp`), puis même commande. Pour **lire** une sauvegarde sur le PC : `deploy\pc\dechiffrer_sauvegarde.ps1 -Fichier chemin\fichier.dump.enc` (Git pour Windows requis), puis `pg_restore` dans une base PostgreSQL locale.

### Conseil : testez une restauration

Une sauvegarde qu'on n'a jamais restaurée est une hypothèse. Une fois après l'installation, puis chaque trimestre, restaurez la dernière copie dans une base de test (jamais dans la vraie) :

```
bash ~/baobab-marches/deploy/serveur/restaurer.sh ~/sauvegardes/FICHIER.dump.enc --base nom_base_de_test
```

(La base de test doit exister ; sur un hébergement mutualisé, créez-la dans cPanel > Bases de données PostgreSQL.)

## Sécurité : à savoir

- La clé SSH du PC n'a pas de mot de passe (indispensable pour la copie automatique). Activez **BitLocker** sur le PC et verrouillez la session : qui accède au PC accède au serveur. Si le PC est perdu, retirez la clé dans cPanel > Accès SSH.
- Les sauvegardes sont chiffrées en AES-256 (clé dérivée de la phrase secrète). Même si le dossier du PC ou du serveur est copié, le contenu est illisible sans la phrase.
- Rien de sensible ne doit être dans GitHub : `.env`, `deploy.config.ps1` et les sauvegardes sont exclus par `.gitignore`.

## Contenu du dossier

| Fichier | Rôle |
|---|---|
| `pc\deployer.bat` | Mise à jour en un clic (envoi GitHub + serveur) |
| `pc\retour_arriere.bat` | Remet la version précédente du code |
| `pc\sauvegardes_pc.bat` | Copie les sauvegardes du serveur sur le PC maintenant |
| `pc\installer_tache_sauvegardes.bat` | Programme la copie automatique |
| `pc\dechiffrer_sauvegarde.ps1` | Déchiffre une sauvegarde sur le PC |
| `serveur\preparer_serveur.sh` | Installation unique des sauvegardes sur le serveur |
| `serveur\deployer.sh` | Mise à jour du serveur (appelé par le PC) |
| `serveur\sauvegarde.sh` | Sauvegarde chiffrée (appelée chaque nuit et avant chaque mise à jour) |
| `serveur\restaurer.sh` | Restauration |
