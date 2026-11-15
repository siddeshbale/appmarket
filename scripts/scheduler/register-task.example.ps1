# EXAMPLE ONLY — review before running. Registers a daily Windows Task Scheduler job for the current user.
# App Market Radar never runs this for you.
#   powershell -ExecutionPolicy Bypass -File scripts\scheduler\register-task.example.ps1
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$repo\scripts\scheduler\run-daily.ps1`""
# 07:30 local time. Apple chart feeds refresh during the US night; pick a time after that for your timezone.
$trigger = New-ScheduledTaskTrigger -Daily -At 7:30am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName 'AppMarketRadar-DailyIngest' -Action $action -Trigger $trigger -Settings $settings -Description 'App Market Radar daily collection'
# Remove later with: Unregister-ScheduledTask -TaskName 'AppMarketRadar-DailyIngest'
