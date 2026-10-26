# Copiez ce fichier sous le nom deploy.config.ps1 (meme dossier) et remplissez-le. deploy.config.ps1 n'est jamais envoye sur GitHub.

# Connexion SSH au serveur O2switch (cPanel > Acces SSH). L'hote est indique dans votre espace O2switch.
$SSH_HOST = "REMPLACER.o2switch.net"
$SSH_USER = "yast2163"
$SSH_PORT = 22
# Cle privee SSH (voir deploy\LISEZ-MOI.md). Laissez vide pour utiliser la cle par defaut de Windows.
$SSH_KEY = "$env:USERPROFILE\.ssh\id_ed25519"

# Dossier du depot sur le serveur
$CHEMIN_SERVEUR = "~/baobab-marches"

# Adresses controlees apres la mise a jour
$URL_API = "https://baobab-api.ymsgroupe.com/api/health"
$URL_SITE = ""

# Copie des sauvegardes sur ce PC
$DOSSIER_SAUVEGARDES = "D:\Sauvegardes_Baobab"
$GARDER_LOCAL = 60
