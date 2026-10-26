#!/bin/bash
# Mise a jour du site Baobab Marches sur le serveur (O2switch / cPanel), appelee depuis le PC par deploy/pc/deployer.bat
# ou lancee a la main dans le Terminal cPanel :   bash ~/baobab-marches/deploy/serveur/deployer.sh
#
# Etapes : verrou -> sauvegarde de la base -> recuperation du code (GitHub) -> migrations -> construction du front -> redemarrage -> controle.
# En cas d'echec avant le redemarrage, le code revient automatiquement a la version precedente et le site continue de tourner.
#
# Options : --retour-arriere  revient a la version d'avant la derniere mise a jour (le code seulement ; la base se restaure avec restaurer.sh)
#           --force           reconstruit meme s'il n'y a rien de nouveau
#           --sans-sauvegarde ne fait pas la sauvegarde de securite (deconseille)
# Configuration facultative : ~/.baobab_deploy.env (voir deploy/LISEZ-MOI.md). Tout est dans main() : ce fichier peut etre remplace par le « git pull ».

main() {
  set -uo pipefail
  local CONF="${BAOBAB_DEPLOY_ENV:-$HOME/.baobab_deploy.env}"
  [ -f "$CONF" ] && . "$CONF"
  local REPO="${REPO:-$HOME/baobab-marches}" BRANCH="${BRANCH:-main}"
  local API_DIR="${API_DIR:-$REPO/backend}" FRONT_DIR="${FRONT_DIR:-$REPO/frontend}"
  local NODEVENV_API="${NODEVENV_API:-$HOME/nodevenv/baobab-marches/backend/22/bin/activate}"
  local NODEVENV_FRONT="${NODEVENV_FRONT:-$HOME/nodevenv/baobab-marches/frontend/22/bin/activate}"
  local NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://baobab-api.ymsgroupe.com/api}"
  local API_HEALTH_URL="${API_HEALTH_URL:-https://baobab-api.ymsgroupe.com/api/health}"
  local SITE_URL="${SITE_URL:-}"
  local ETAT="${ETAT_DIR:-$HOME/deploy}"
  local SCRIPTS; SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  mkdir -p "$ETAT/logs"
  local LOG="$ETAT/logs/deploiement_$(date '+%Y%m%d_%H%M%S').log"
  exec > >(tee -a "$LOG") 2>&1

  local retour="" force="" sans_sauv=""
  for a in "$@"; do
    case "$a" in
      --retour-arriere) retour=1 ;;
      --force) force=1 ;;
      --sans-sauvegarde) sans_sauv=1 ;;
    esac
  done
  etape() { echo; echo "=== $* ==="; }
  echec() { echo; echo "XXX ECHEC : $*"; }

  # Verrou : une seule mise a jour a la fois.
  local VERROU="$ETAT/deploiement.verrou"
  if ! mkdir "$VERROU" 2>/dev/null; then
    local age; age=$(( $(date +%s) - $(stat -c %Y "$VERROU" 2>/dev/null || echo 0) ))
    if [ "$age" -gt 1800 ]; then rm -rf "$VERROU"; mkdir "$VERROU" || return 1; else echo "Une mise a jour est deja en cours (verrou $VERROU)."; return 1; fi
  fi
  trap "rm -rf '$VERROU'" EXIT

  activer() { # $1 = script d'activation Node (facultatif)
    if [ -f "$1" ]; then . "$1"; fi
  }
  redemarrer() {
    mkdir -p "$API_DIR/tmp" "$FRONT_DIR/tmp"
    touch "$API_DIR/tmp/restart.txt" "$FRONT_DIR/tmp/restart.txt"
  }
  construire_front() {
    ( activer "$NODEVENV_FRONT"; cd "$FRONT_DIR" || exit 1
      [ "${1:-}" = "install" ] && { npm ci --no-audit --no-fund || exit 1; }
      export NEXT_PUBLIC_API_URL; npm run build ) || return 1
  }
  controle() {
    local ok=""
    for i in $(seq 1 20); do
      if curl -fsS -m 10 "$API_HEALTH_URL" >/dev/null 2>&1; then ok=1; break; fi
      sleep 3
    done
    [ -n "$ok" ] || { echo "L'API ne repond pas sur $API_HEALTH_URL"; return 1; }
    echo "API : OK"
    if [ -n "$SITE_URL" ]; then
      local code; code="$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$SITE_URL/login" || echo 000)"
      [ "$code" = "200" ] || { echo "Le site repond $code sur $SITE_URL/login"; return 1; }
      echo "Site : OK"
    fi
    return 0
  }

  cd "$REPO" || { echec "depot introuvable : $REPO"; return 1; }
  # Les fichiers « package-lock.json » modifies par un npm lance a la main ne doivent pas bloquer la mise a jour : le depot fait foi.
  git checkout -- backend/package-lock.json frontend/package-lock.json 2>/dev/null

  # --- Retour arriere (code) ------------------------------------------------------------------------------------------
  if [ -n "$retour" ]; then
    local prec; prec="$(cat "$ETAT/commit_precedent" 2>/dev/null)"
    [ -n "$prec" ] || { echec "aucune version precedente enregistree"; return 1; }
    etape "Retour a la version $prec"
    git reset --hard "$prec" || return 1
    ( activer "$NODEVENV_API"; cd "$API_DIR" && npm ci --omit=dev --no-audit --no-fund ) || echo "(npm ci backend : avertissement)"
    construire_front install || { echec "construction du front"; return 1; }
    redemarrer; controle || return 1
    echo "Retour arriere termine. ATTENTION : la base n'est pas modifiee ; si une migration a ete appliquee, restaurez la sauvegarde 'avant-deploiement' (restaurer.sh)."
    return 0
  fi

  # --- 1. Etat du depot -------------------------------------------------------------------------------------------------
  etape "1/6 Controle du depot"
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echec "des fichiers du serveur ont ete modifies a la main (voir ci-dessous). Rien n'a ete change."
    git status --short --untracked-files=no
    return 1
  fi
  local AVANT; AVANT="$(git rev-parse HEAD)"
  git fetch origin "$BRANCH" || { echec "GitHub injoignable"; return 1; }
  local APRES; APRES="$(git rev-parse "origin/$BRANCH")"
  if [ "$AVANT" = "$APRES" ] && [ -z "$force" ]; then
    echo "Rien de nouveau : le serveur est deja a jour ($AVANT)."
    controle || return 1
    return 0
  fi
  echo "Version actuelle : ${AVANT:0:8}   ->   nouvelle : ${APRES:0:8}"
  git log --oneline "$AVANT..$APRES" 2>/dev/null | head -15
  local CHANGES; CHANGES="$(git diff --name-only "$AVANT" "$APRES" 2>/dev/null)"

  # --- 2. Sauvegarde ----------------------------------------------------------------------------------------------------
  if [ -z "$sans_sauv" ]; then
    etape "2/6 Sauvegarde de la base avant mise a jour"
    bash "$SCRIPTS/sauvegarde.sh" --avant-deploiement || { echec "sauvegarde impossible : mise a jour annulee, rien n'a ete change."; return 1; }
  else
    etape "2/6 Sauvegarde ignoree (--sans-sauvegarde)"
  fi

  # --- 3. Code ----------------------------------------------------------------------------------------------------------
  etape "3/6 Recuperation du code"
  echo "$AVANT" > "$ETAT/commit_precedent"
  git merge --ff-only "origin/$BRANCH" || { echec "fusion impossible (historique different)."; return 1; }
  retour_code() { git reset --hard "$AVANT" >/dev/null 2>&1; echo "Code remis a la version ${AVANT:0:8}."; }

  # --- 4. Backend + migrations ------------------------------------------------------------------------------------------
  etape "4/6 Backend et base de donnees"
  if echo "$CHANGES" | grep -q '^backend/package'; then
    ( activer "$NODEVENV_API"; cd "$API_DIR" && npm ci --omit=dev --no-audit --no-fund ) || { echec "installation des modules du backend"; retour_code; return 1; }
  fi
  ( activer "$NODEVENV_API"; cd "$API_DIR" && npm run migrate ) || {
    echec "migrations. Le site n'a pas ete redemarre et reste sur l'ancienne version du code."
    retour_code
    echo "Si une migration a ete partiellement appliquee, la sauvegarde 'avant-deploiement' la plus recente permet de revenir en arriere (restaurer.sh)."
    return 1
  }

  # --- 5. Front ---------------------------------------------------------------------------------------------------------
  etape "5/6 Construction de l'interface (peut prendre plusieurs minutes)"
  local mode=""; echo "$CHANGES" | grep -q '^frontend/package' && mode="install"
  if ! construire_front "$mode"; then
    echec "construction de l'interface. Retour a la version precedente."
    retour_code
    construire_front install || echo "(reconstruction de l'ancienne version en echec : voir le journal $LOG)"
    redemarrer
    return 1
  fi

  # --- 6. Redemarrage et controle ---------------------------------------------------------------------------------------
  etape "6/6 Redemarrage et controle"
  redemarrer
  if controle; then
    echo; echo "MISE A JOUR TERMINEE : ${APRES:0:8}"
    return 0
  fi
  echec "le site ne repond pas correctement apres la mise a jour. Pour revenir en arriere : bash $SCRIPTS/deployer.sh --retour-arriere"
  return 1
}
main "$@"; c=$?; sleep 1; exit $c
