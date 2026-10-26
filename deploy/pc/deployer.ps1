# Mise a jour du site en un clic : envoi du code sur GitHub, puis sauvegarde + mise a jour du serveur.
# Options : -RetourArriere (revient a la version precedente), -SansPush (ne pousse rien), -Force (reconstruit meme sans nouveaute)
param([switch]$RetourArriere, [switch]$SansPush, [switch]$Force)
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "commun.ps1")
$racine = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $racine

if (-not $RetourArriere -and -not $SansPush) {
    Titre "1. Envoi du code sur GitHub"
    $branche = (git rev-parse --abbrev-ref HEAD).Trim()
    if ($branche -ne "main") { Erreur "Vous etes sur la branche '$branche', pas 'main'. Mise a jour annulee."; exit 1 }

    $lignes = @(git status --porcelain)
    if ($lignes.Count -gt 0) {
        Write-Host "Fichiers modifies :"
        $lignes | ForEach-Object { Write-Host "   $_" }
        # Garde-fous : aucun secret, archive ou sauvegarde ne doit partir sur GitHub.
        $suspects = @()
        foreach ($l in $lignes) {
            $chemin = $l.Substring(3).Trim('"')
            if ($chemin -match '(\.zip$|\.env($|\.)|\.dump|\.enc$|\.sql\.gz$|\.pem$|id_rsa|id_ed25519|deploy\.config\.ps1|Claude outputs)') { $suspects += $chemin; continue }
            if (Test-Path -LiteralPath $chemin -PathType Leaf) { if ((Get-Item -LiteralPath $chemin).Length -gt 10MB) { $suspects += $chemin } }
        }
        if ($suspects.Count -gt 0) {
            Erreur "Fichiers qui ne doivent pas partir sur GitHub (secret, archive ou fichier volumineux) :"
            $suspects | ForEach-Object { Erreur "   $_" }
            Erreur "Retirez-les du dossier ou ajoutez-les au fichier .gitignore, puis relancez. Rien n'a ete envoye."
            exit 1
        }
        $message = Read-Host "Message de la mise a jour (ex. Portail factures et devis)"
        if (-not $message.Trim()) { Erreur "Message vide : annule."; exit 1 }
        git add -A
        git commit -m $message
        if ($LASTEXITCODE -ne 0) { Erreur "Le commit a echoue."; exit 1 }
    } else {
        Write-Host "Aucune modification locale a enregistrer."
    }
    git push origin main
    if ($LASTEXITCODE -ne 0) { Erreur "L'envoi sur GitHub a echoue (reseau ?). Relancez dans un instant. Le site n'a pas ete touche."; exit 1 }
    Ok "Code envoye sur GitHub."
}

$optionsServeur = ""
if ($RetourArriere) { $optionsServeur += " --retour-arriere" }
if ($Force) { $optionsServeur += " --force" }

if (-not (Test-SshConfigure)) {
    Titre "2. Mise a jour du serveur"
    Alerte "La connexion SSH n'est pas encore configuree (deploy\pc\deploy.config.ps1)."
    Write-Host "En attendant, ouvrez le Terminal dans cPanel et collez cette commande :"
    Write-Host ""
    Write-Host "   cd $CHEMIN_SERVEUR && git pull --ff-only && bash deploy/serveur/deployer.sh$optionsServeur" -ForegroundColor White
    exit 0
}

$reponse = Read-Host "Mettre a jour le site maintenant ? (O/N)"
if ($reponse -notmatch '^[oOyY]') { Write-Host "Mise a jour du serveur annulee (le code est deja sur GitHub)."; exit 0 }

Titre "2. Mise a jour du serveur (sauvegarde, migrations, construction, redemarrage)"
# Premier lancement : si le script n'existe pas encore sur le serveur, on recupere d'abord le code une fois.
$commande = "cd $CHEMIN_SERVEUR && { [ -f deploy/serveur/deployer.sh ] || git pull --ff-only; } && bash deploy/serveur/deployer.sh$optionsServeur"
$code = Invoke-Ssh $commande
if ($code -ne 0) {
    Erreur "La mise a jour du serveur a signale un probleme (code $code). Lisez les messages ci-dessus."
    Erreur "Le journal complet est sur le serveur dans ~/deploy/logs. Pour revenir a la version precedente : deployer.bat -RetourArriere"
    exit $code
}

Titre "3. Controle depuis ce PC"
foreach ($u in @($URL_API, $URL_SITE)) {
    if (-not $u) { continue }
    try {
        $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 30
        Ok "$u -> $($r.StatusCode)"
    } catch {
        Alerte "$u ne repond pas correctement : $($_.Exception.Message)"
    }
}
Ok "Termine."
