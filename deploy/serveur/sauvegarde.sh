#!/bin/bash
# Sauvegarde chiffree de la base de donnees Baobab Marches (toutes les donnees, y compris les fichiers televerses : ils sont stockes en base).
#
# Usage :
#   sauvegarde.sh                       sauvegarde de la nuit (rotation : garde 14 jours, et toujours les 3 dernieres)
#   sauvegarde.sh --avant-deploiement   sauvegarde de securite avant une mise a jour (gardee : 10 dernieres)
#   sauvegarde.sh --avant-restauration  idem, avant une restauration
#
# Configuration : fichier ~/.baobab_backup.env (chmod 600), voir deploy/LISEZ-MOI.md
#   DB_NAME, DB_USER, DB_PASSWORD, DB_HOST (defaut localhost), DB_PORT (defaut 5432)
#   BACKUP_PASSPHRASE_FILE (defaut ~/.baobab_backup_pass) : phrase secrete de chiffrement
#   BACKUP_DIR (defaut ~/sauvegardes), RETENTION_JOURS (defaut 14)
# Le tout est entierement dans main() : le script peut etre remplace par un « git pull » pendant son execution sans risque.

main() {
  set -uo pipefail
  local CONF="${BAOBAB_BACKUP_ENV:-$HOME/.baobab_backup.env}"
  [ -f "$CONF" ] && . "$CONF"
  local DB_HOST="${DB_HOST:-localhost}" DB_PORT="${DB_PORT:-5432}"
  local BACKUP_DIR="${BACKUP_DIR:-$HOME/sauvegardes}"
  local PASS_FILE="${BACKUP_PASSPHRASE_FILE:-$HOME/.baobab_backup_pass}"
  local RETENTION="${RETENTION_JOURS:-14}"
  local type="nuit" prefixe="baobab"
  case "${1:-}" in
    --avant-deploiement) type="avant-deploiement"; prefixe="avant-deploiement" ;;
    --avant-restauration) type="avant-restauration"; prefixe="avant-restauration" ;;
  esac
  mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR" 2>/dev/null
  local LOG="$BACKUP_DIR/sauvegarde.log"
  log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [$type] $*" | tee -a "$LOG"; }

  [ -n "${DB_NAME:-}" ] && [ -n "${DB_USER:-}" ] && [ -n "${DB_PASSWORD:-}" ] || { log "ERREUR : DB_NAME, DB_USER ou DB_PASSWORD manquant dans $CONF"; return 2; }
  [ -s "$PASS_FILE" ] || { log "ERREUR : phrase secrete introuvable ($PASS_FILE)"; return 2; }
  command -v pg_dump >/dev/null || { log "ERREUR : pg_dump introuvable"; return 2; }
  command -v openssl >/dev/null || { log "ERREUR : openssl introuvable"; return 2; }

  local horodatage; horodatage="$(date '+%Y%m%d_%H%M%S')"
  local brut
  local final="$BACKUP_DIR/${prefixe}_${horodatage}.dump.enc"
  brut="$BACKUP_DIR/.${prefixe}_${horodatage}.dump.tmp"

  log "Debut de la sauvegarde ($DB_NAME)"
  if ! PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Fc --no-owner --no-privileges -f "$brut" 2>>"$LOG"; then
    log "ERREUR : pg_dump a echoue"; rm -f "$brut"; return 1
  fi
  # Verification : l'archive doit etre lisible et contenir des tables.
  local nb; nb="$(pg_restore -l "$brut" 2>/dev/null | grep -c 'TABLE DATA')"
  if [ "${nb:-0}" -lt 1 ]; then log "ERREUR : archive illisible ou vide"; rm -f "$brut"; return 1; fi
  if ! openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$PASS_FILE" -in "$brut" -out "$final" 2>>"$LOG"; then
    log "ERREUR : chiffrement impossible"; rm -f "$brut" "$final"; return 1
  fi
  rm -f "$brut"
  # Controle : le fichier chiffre doit se dechiffrer.
  local magie
  magie="$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$PASS_FILE" -in "$final" 2>/dev/null | head -c 5)"
  if [ "$magie" != "PGDMP" ]; then
    log "ERREUR : controle de dechiffrement echoue"; rm -f "$final"; return 1
  fi
  ( cd "$BACKUP_DIR" && sha256sum "$(basename "$final")" > "$(basename "$final").sha256" )
  chmod 600 "$final" "$final.sha256" 2>/dev/null
  log "OK : $(basename "$final") ($(du -h "$final" | cut -f1), $nb tables)"

  # Rotation.
  if [ "$type" = "nuit" ]; then
    local anciens
    anciens="$(find "$BACKUP_DIR" -maxdepth 1 -name 'baobab_*.dump.enc' -mtime +"$RETENTION" | sort)"
    local total; total="$(find "$BACKUP_DIR" -maxdepth 1 -name 'baobab_*.dump.enc' | wc -l)"
    for f in $anciens; do
      [ "$total" -le 3 ] && break
      rm -f "$f" "$f.sha256"; total=$((total-1)); log "Ancienne sauvegarde supprimee : $(basename "$f")"
    done
  else
    ls -1t "$BACKUP_DIR"/${prefixe}_*.dump.enc 2>/dev/null | tail -n +11 | while read -r f; do rm -f "$f" "$f.sha256"; done
  fi
  return 0
}
main "$@"; exit $?
