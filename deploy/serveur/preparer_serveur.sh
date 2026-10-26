#!/bin/bash
# Preparation UNIQUE du serveur : configuration des sauvegardes (acces a la base, phrase secrete de chiffrement, tache de nuit) et d'un fichier de reglages de mise a jour.
# A lancer une seule fois dans le Terminal cPanel :   bash ~/baobab-marches/deploy/serveur/preparer_serveur.sh
main() {
  set -uo pipefail
  local ICI; ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local ENVF="${BAOBAB_BACKUP_ENV:-$HOME/.baobab_backup.env}"
  local PASSF="${BACKUP_PASSPHRASE_FILE:-$HOME/.baobab_backup_pass}"
  echo "=== Preparation du serveur Baobab Marches ==="
  command -v pg_dump >/dev/null || { echo "pg_dump introuvable : impossible de sauvegarder."; return 1; }
  command -v openssl >/dev/null || { echo "openssl introuvable : impossible de chiffrer."; return 1; }
  echo "pg_dump : $(pg_dump --version)"
  if ! echo test | openssl enc -aes-256-cbc -pbkdf2 -pass pass:x >/dev/null 2>&1; then echo "Cet openssl ne gere pas -pbkdf2 : contactez O2switch ou demandez une adaptation du script."; return 1; fi

  if [ -f "$ENVF" ]; then
    echo "Reglages de la base deja presents ($ENVF) : conserves."
  else
    echo
    echo "Acces a la base PostgreSQL (les memes valeurs que celles de l'application dans cPanel)."
    read -r -p "Nom de la base [yast2163_baobab] : " db; db="${db:-yast2163_baobab}"
    read -r -p "Utilisateur [yast2163_baobab_user] : " usr; usr="${usr:-yast2163_baobab_user}"
    read -r -s -p "Mot de passe de la base (non affiche) : " pwd; echo
    [ -n "$pwd" ] || { echo "Mot de passe vide : annule."; return 1; }
    ( umask 077; printf 'DB_NAME=%q\nDB_USER=%q\nDB_PASSWORD=%q\nDB_HOST=localhost\nDB_PORT=5432\n' "$db" "$usr" "$pwd" > "$ENVF" )
    echo "Reglages enregistres (lecture reservee a votre compte)."
  fi

  if [ -s "$PASSF" ]; then
    echo "Phrase secrete deja presente : conservee."
  else
    ( umask 077; openssl rand -base64 33 > "$PASSF" )
    echo
    echo "################################################################################"
    echo " PHRASE SECRETE DE CHIFFREMENT - A COPIER MAINTENANT dans votre gestionnaire de"
    echo " mots de passe ET sur papier, dans un endroit sur, HORS de ce serveur :"
    echo
    echo "     $(cat "$PASSF")"
    echo
    echo " Sans elle, les sauvegardes sont ILLISIBLES (meme pour nous). Elle ne sera plus affichee."
    echo "################################################################################"
    read -r -p "Appuyez sur Entree quand c'est fait... " _
  fi

  echo
  echo "Premiere sauvegarde de test..."
  bash "$ICI/sauvegarde.sh" || { echo "La sauvegarde de test a echoue : voir le message ci-dessus."; return 1; }

  if [ -z "${SKIP_CRON:-}" ]; then
    local ligne="30 2 * * * /bin/bash $ICI/sauvegarde.sh >> $HOME/sauvegardes/cron.log 2>&1"
    if command -v crontab >/dev/null; then
      if crontab -l 2>/dev/null | grep -q 'deploy/serveur/sauvegarde.sh'; then
        echo "Tache de nuit deja presente."
      else
        ( crontab -l 2>/dev/null; echo "$ligne" ) | crontab - && echo "Tache de nuit creee : sauvegarde tous les jours a 2 h 30."
      fi
    else
      echo "Commande crontab indisponible. Dans cPanel > Taches Cron, ajoutez cette commande, tous les jours a 2 h 30 :"
      echo "   /bin/bash $ICI/sauvegarde.sh >> $HOME/sauvegardes/cron.log 2>&1"
    fi
  fi
  echo
  echo "Termine. Sauvegardes dans : $HOME/sauvegardes"
  return 0
}
main "$@"; c=$?; exit $c
