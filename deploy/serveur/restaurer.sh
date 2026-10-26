#!/bin/bash
# Restaure la base depuis une sauvegarde chiffree. DANGER : remplace les donnees actuelles.
# Usage : restaurer.sh <fichier.dump.enc>                     (confirmation demandee, sauvegarde de securite faite juste avant)
#         restaurer.sh <fichier.dump.enc> --base ma_base_test  restaure dans une AUTRE base (test), sans toucher a la vraie

main() {
  set -uo pipefail
  local CONF="${BAOBAB_BACKUP_ENV:-$HOME/.baobab_backup.env}"
  [ -f "$CONF" ] && . "$CONF"
  local DB_HOST="${DB_HOST:-localhost}" DB_PORT="${DB_PORT:-5432}"
  local PASS_FILE="${BACKUP_PASSPHRASE_FILE:-$HOME/.baobab_backup_pass}"
  local fichier="${1:-}" autre_base="" sans_conf=""
  shift || true
  while [ $# -gt 0 ]; do
    case "$1" in
      --base) autre_base="${2:-}"; shift ;;
      --sans-confirmation) sans_conf=1 ;;
    esac
    shift
  done
  [ -n "$autre_base" ] && DB_NAME="$autre_base" && sans_conf=1
  [ -f "$fichier" ] || { echo "Fichier introuvable : $fichier"; echo "Usage : restaurer.sh ~/sauvegardes/baobab_AAAAMMJJ_HHMMSS.dump.enc"; return 2; }
  [ -n "${DB_NAME:-}" ] || { echo "DB_NAME manquant ($CONF)"; return 2; }
  local dir; dir="$(dirname "$fichier")"
  if [ -f "$fichier.sha256" ]; then
    ( cd "$dir" && sha256sum -c "$(basename "$fichier").sha256" >/dev/null ) || { echo "ERREUR : empreinte differente, fichier altere."; return 1; }
  fi
  if [ -z "$sans_conf" ]; then
    echo "Vous allez REMPLACER les donnees de la base '$DB_NAME' par celles de $(basename "$fichier")."
    read -r -p "Tapez RESTAURER pour confirmer : " rep
    [ "$rep" = "RESTAURER" ] || { echo "Annule."; return 1; }
    bash "$(dirname "$0")/sauvegarde.sh" --avant-restauration || { echo "Sauvegarde de securite impossible : restauration annulee."; return 1; }
  fi
  local tmp; tmp="$(mktemp)"; trap "rm -f '$tmp'" EXIT
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$PASS_FILE" -in "$fichier" -out "$tmp" || { echo "Dechiffrement impossible (mauvaise phrase secrete ?)."; return 1; }
  PGPASSWORD="$DB_PASSWORD" pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "${DB_USER}" -d "$DB_NAME" --clean --if-exists --no-owner --no-privileges "$tmp"
  local code=$?
  # pg_restore renvoie 1 pour de simples avertissements (objets absents lors du --clean) : on les signale sans echouer.
  [ $code -le 1 ] && echo "Restauration terminee (code $code). Redemarrez l'API : touch ~/baobab-marches/backend/tmp/restart.txt" || echo "Restauration en erreur (code $code)."
  return $code
}
main "$@"; exit $?
