# Fonctions communes aux scripts du PC (ne pas lancer directement).
$script:cfgPath = Join-Path $PSScriptRoot "deploy.config.ps1"
if (-not (Test-Path $script:cfgPath)) {
    Write-Host "Fichier de configuration absent : deploy\pc\deploy.config.ps1" -ForegroundColor Red
    Write-Host "Copiez deploy.config.example.ps1 en deploy.config.ps1 et remplissez-le (voir deploy\LISEZ-MOI.md)."
    exit 1
}
. $script:cfgPath

function Titre($texte) { Write-Host ""; Write-Host "=== $texte ===" -ForegroundColor Cyan }
function Ok($texte) { Write-Host $texte -ForegroundColor Green }
function Alerte($texte) { Write-Host $texte -ForegroundColor Yellow }
function Erreur($texte) { Write-Host $texte -ForegroundColor Red }

function Test-SshConfigure {
    return ($SSH_HOST -and ($SSH_HOST -notlike "REMPLACER*"))
}

function Get-SshOptions {
    $o = @("-p", "$SSH_PORT", "-o", "ServerAliveInterval=30", "-o", "BatchMode=no")
    if ($SSH_KEY -and (Test-Path $SSH_KEY)) { $o += @("-i", $SSH_KEY) }
    return $o
}

function Invoke-Ssh($commande) {
    $opts = Get-SshOptions
    & ssh @opts "$SSH_USER@$SSH_HOST" $commande
    return $LASTEXITCODE
}
