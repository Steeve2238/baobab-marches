# Copie sur ce PC les sauvegardes chiffrees du serveur qui ne sont pas encore ici, verifie leur integrite et alerte si la sauvegarde de la nuit manque.
param([switch]$Silencieux)
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "commun.ps1")

New-Item -ItemType Directory -Force -Path $DOSSIER_SAUVEGARDES | Out-Null
$journal = Join-Path $DOSSIER_SAUVEGARDES "recuperation.log"
function Ecrire($texte, $couleur = "Gray") {
    $ligne = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $texte
    Add-Content -Path $journal -Value $ligne
    if (-not $Silencieux) { Write-Host $texte -ForegroundColor $couleur }
}

if (-not (Test-SshConfigure)) { Ecrire "SSH non configure (deploy.config.ps1)." "Red"; exit 1 }

$opts = Get-SshOptions
# scp utilise -P (majuscule) pour le port.
$optsScp = @("-P", "$SSH_PORT")
if ($SSH_KEY -and (Test-Path $SSH_KEY)) { $optsScp += @("-i", $SSH_KEY) }

$liste = & ssh @opts "$SSH_USER@$SSH_HOST" "ls -1 sauvegardes 2>/dev/null"
if ($LASTEXITCODE -ne 0) { Ecrire "Connexion au serveur impossible." "Red"; exit 1 }
$noms = @($liste | Where-Object { $_ -match '\.dump\.enc$' })
if ($noms.Count -eq 0) { Ecrire "Aucune sauvegarde trouvee sur le serveur." "Red"; exit 2 }

$nouveaux = 0
foreach ($nom in $noms) {
    $local = Join-Path $DOSSIER_SAUVEGARDES $nom
    if (Test-Path $local) { continue }
    & scp @optsScp "$SSH_USER@${SSH_HOST}:sauvegardes/$nom" "$local.part"
    if ($LASTEXITCODE -ne 0) { Ecrire "Echec de copie : $nom" "Red"; Remove-Item "$local.part" -ErrorAction SilentlyContinue; continue }
    & scp @optsScp "$SSH_USER@${SSH_HOST}:sauvegardes/$nom.sha256" "$local.sha256"
    $attendu = ""
    if (Test-Path "$local.sha256") { $attendu = ((Get-Content "$local.sha256" -TotalCount 1) -split '\s+')[0] }
    $reel = (Get-FileHash -Algorithm SHA256 "$local.part").Hash.ToLower()
    if ($attendu -and ($attendu.ToLower() -ne $reel)) {
        Ecrire "Empreinte differente, fichier ecarte : $nom" "Red"
        Remove-Item "$local.part", "$local.sha256" -ErrorAction SilentlyContinue
        continue
    }
    Move-Item "$local.part" $local
    $nouveaux++
    Ecrire ("Copie : {0} ({1} Mo)" -f $nom, [math]::Round((Get-Item $local).Length / 1MB, 1)) "Green"
}
if ($nouveaux -eq 0) { Ecrire "Rien de nouveau : toutes les sauvegardes du serveur sont deja sur ce PC." }

# Menage local : on garde les N dernieres sauvegardes de nuit et les 10 dernieres de securite.
$nuit = @(Get-ChildItem $DOSSIER_SAUVEGARDES -Filter "baobab_*.dump.enc" | Sort-Object Name -Descending)
if ($nuit.Count -gt $GARDER_LOCAL) { $nuit | Select-Object -Skip $GARDER_LOCAL | ForEach-Object { Remove-Item $_.FullName, "$($_.FullName).sha256" -ErrorAction SilentlyContinue } }
$secu = @(Get-ChildItem $DOSSIER_SAUVEGARDES -Filter "avant-*.dump.enc" | Sort-Object Name -Descending)
if ($secu.Count -gt 10) { $secu | Select-Object -Skip 10 | ForEach-Object { Remove-Item $_.FullName, "$($_.FullName).sha256" -ErrorAction SilentlyContinue } }

# Alerte : la sauvegarde de la nuit doit avoir moins de 36 heures.
$derniere = ($noms | Where-Object { $_ -match '^baobab_(\d{8})_(\d{6})' } | Sort-Object -Descending | Select-Object -First 1)
if ($derniere -match '^baobab_(\d{8})_(\d{6})') {
    $date = [datetime]::ParseExact("$($Matches[1])$($Matches[2])", "yyyyMMddHHmmss", $null)
    $age = (Get-Date) - $date
    if ($age.TotalHours -gt 36) {
        Ecrire ("ALERTE : la derniere sauvegarde de nuit date de {0:dd/MM/yyyy HH:mm} ({1} h). La sauvegarde automatique du serveur ne tourne plus : verifiez la tache planifiee dans cPanel." -f $date, [math]::Round($age.TotalHours)) "Red"
        if ($Silencieux) { Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show("La sauvegarde automatique de Baobab Marches n'a pas ete faite depuis plus de 36 heures. Verifiez la tache planifiee dans cPanel.", "Baobab - sauvegarde en retard") | Out-Null }
        exit 3
    }
    Ecrire ("Derniere sauvegarde de nuit : {0:dd/MM/yyyy HH:mm}" -f $date) "Green"
}
exit 0
