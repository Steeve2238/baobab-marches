# Dechiffre une sauvegarde (.dump.enc) en fichier .dump, pour la restaurer avec pg_restore. Necessite Git pour Windows (il contient openssl).
param([Parameter(Mandatory = $true)][string]$Fichier, [string]$FichierPhrase)
$openssl = "C:\Program Files\Git\usr\bin\openssl.exe"
if (-not (Test-Path $openssl)) { Write-Host "openssl introuvable (installez Git pour Windows)." -ForegroundColor Red; exit 1 }
if (-not (Test-Path $Fichier)) { Write-Host "Fichier introuvable : $Fichier" -ForegroundColor Red; exit 1 }
$sortie = $Fichier -replace '\.enc$', ''
if ($FichierPhrase) {
    & $openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$FichierPhrase" -in $Fichier -out $sortie
} else {
    $sec = Read-Host "Phrase secrete de chiffrement" -AsSecureString
    $phrase = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    $env:BAOBAB_PHRASE = $phrase
    & $openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BAOBAB_PHRASE -in $Fichier -out $sortie
    Remove-Item Env:\BAOBAB_PHRASE
}
if ($LASTEXITCODE -eq 0) { Write-Host "Fichier dechiffre : $sortie" -ForegroundColor Green; Write-Host "Restauration : pg_restore --clean --if-exists --no-owner -d NOM_BASE `"$sortie`"" } else { Write-Host "Echec (mauvaise phrase ?)." -ForegroundColor Red; Remove-Item $sortie -ErrorAction SilentlyContinue; exit 1 }
