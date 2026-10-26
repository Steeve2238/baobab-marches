# Cree la tache Windows qui copie chaque jour les sauvegardes du serveur sur ce PC (a 9 h, a l'ouverture de session, et des que le PC est allume s'il etait eteint).
$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "recuperer_sauvegardes.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Silencieux"
$t1 = New-ScheduledTaskTrigger -Daily -At "09:00"
$t2 = New-ScheduledTaskTrigger -AtLogOn
$reglages = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "Baobab - copie des sauvegardes" -Action $action -Trigger @($t1, $t2) -Settings $reglages -Description "Copie les sauvegardes chiffrees de Baobab Marches du serveur vers ce PC." -Force | Out-Null
Write-Host "Tache creee : Baobab - copie des sauvegardes (9 h, ouverture de session, rattrapage si PC eteint)." -ForegroundColor Green
Write-Host "Test immediat : lancez sauvegardes_pc.bat"
