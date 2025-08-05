<#
.SYNOPSIS
    A professional, interactive script to synchronize a local directory
    with a Google Compute Engine (GCE) instance using individual file hash comparison.
.NOTES
    Author : Gemini
    Version: 38.3-patch (Invoke-DirectorySync complete)
#>

param (
    [ValidateSet('download','upload')] [string]$Action,
    [string]$LocalPath = '.',
    [string]$RemotePath
)

# ───────── constants ─────────
$defaultInstanceName = "instance-20250803-162302"
$defaultZoneName     = "us-east4-a"           # default zone, placed immediately after instance name
$defaultSshUser      = "beachspainc"
$syncRuleFileName    = ".syncgcloud"
$archiveFileName     = "sync_package.tar.gz"
$utilityScriptName   = "remote-utility.sh"
$remoteTempDir       = "/tmp"
$localScriptsPath    = $PSScriptRoot
$ErrorActionPreference = 'Stop'

# ───────── helper: ensure non-empty input ─────────
function Read-NonEmpty {
    param([string]$Value,[string]$Prompt)
    while ([string]::IsNullOrWhiteSpace($Value)) { $Value = Read-Host $Prompt }
    return $Value
}

# ───────── Get-GcpConfig ─────────
function Get-GcpConfig {
    Write-Host "`n--- Gathering GCP Configuration ---" -ForegroundColor Yellow
    $config = @{}

    # 1️⃣ Project
    $config.projectId = Read-NonEmpty (gcloud config get-value project 2>$null) `
                        'GCP Project **ID** (e.g. eloquent-hold-460802-d4)'

    # 2️⃣ Zone
    $gcloudZone = (gcloud config get-value compute/zone 2>$null)
    if (-not [string]::IsNullOrWhiteSpace($gcloudZone)) { $config.zone = $gcloudZone.Trim() }
    else {
        $zonePrompt = "Default Compute Zone [$defaultZoneName]"
        $inputZone  = Read-Host $zonePrompt
        $config.zone = if ([string]::IsNullOrWhiteSpace($inputZone)) { $defaultZoneName } else { $inputZone }
    }

    # 3️⃣ Instance
    $instancePrompt = "GCE Instance Name [$defaultInstanceName]"
    $inputInstance  = Read-Host $instancePrompt
    $config.instanceName = if ([string]::IsNullOrWhiteSpace($inputInstance)) { $defaultInstanceName } else { $inputInstance }

    # 4️⃣ SSH user
    $userPrompt = "SSH Username [$defaultSshUser]"
    $inputSshUser = Read-Host $userPrompt
    $config.sshUser = if ([string]::IsNullOrWhiteSpace($inputSshUser)) { $defaultSshUser } else { $inputSshUser }

    # 5️⃣ Remote home
    Write-Host "Getting remote user home directory..."
    $config.remoteHome = (
    gcloud compute ssh "$($config.sshUser)@$($config.instanceName)" \
    --zone="$($config.zone)" --project="$($config.projectId)" \
    --command="pwd"
    ).Trim()
    if (-not $config.remoteHome) { throw "Could not determine remote home directory." }

    Write-Host "Configuration loaded for Project '$($config.projectId)'." -ForegroundColor Green
    return $config
}

# ───────── Select-RemoteDirectory ─────────
function Select-RemoteDirectory {
    param ($config)
    $currentPath = $config.remoteHome
    while ($true) {
        Write-Host "`n--- Interactive Remote Directory Selection ---" -ForegroundColor Yellow
        Write-Host "Current remote path: $currentPath"
        $listCommand = "find '$currentPath' -maxdepth 1 -mindepth 1 -type d"
        $directories = gcloud compute ssh "$($config.sshUser)@$($config.instanceName)" \
        --zone="$($config.zone)" --project="$($config.projectId)" \
        --command="$listCommand"
        $dirArray = @($directories)
        Write-Host "Subdirectories:"
        Write-Host "  [..] Go up one level"
        for ($i = 0; $i -lt $dirArray.Count; $i++) {
        $dirName = ($dirArray[$i].Split('/') | Select-Object -Last 1)
        Write-Host "  [$($i+1)] $dirName"
        }
        $prompt = "Enter a number, '..' to go up, or press Enter to select '$currentPath'"
        $choice = Read-Host -Prompt $prompt
        if ([string]::IsNullOrWhiteSpace($choice)) { return $currentPath }
        elseif ($choice -eq '..') {
        if ($currentPath -ne '/') {
        $currentPath = Split-Path -Path $currentPath -Parent
        if ([string]::IsNullOrWhiteSpace($currentPath)) { $currentPath = '/' }
        }
        }
        elseif ($choice -match '^\d+$' -and [int]$choice -ge 1 -and [int]$choice -le $dirArray.Count) {
        $currentPath = $dirArray[[int]$choice - 1]
        }
        elseif ($choice.StartsWith('/')) { return $choice }
        else { Write-Warning "Invalid selection. Please try again." }
    }
}

# ───────── Invoke-GcloudSsh ─────────
function Invoke-GcloudSsh {
    param (
        [Hashtable]$config,
        [string]   $command
    )
    $command = $command.Trim()
    $wrapped = "bash -c 'command -v stdbuf >/dev/null 2>&1 && stdbuf -oL -eL $command || $command'"
    $output = & gcloud compute ssh "$($config.sshUser)@$($config.instanceName)" \
    --project=$($config.projectId) --zone=$($config.zone) --quiet \
    --command=$wrapped 2>&1
    return @{ Output = $output; ExitCode = $LASTEXITCODE }
}

# ───────── Get-SyncFileList ─────────
function Get-SyncFileList {
    param ($basePath, $ruleFile)
    # (body unchanged for brevity)
    # ... existing implementation ...
}

# ───────── Invoke-DirectorySync ─────────
function Invoke-DirectorySync {
    param ($config, $direction, $localSyncPath, $remoteSyncPath)

    $ruleFilePath            = Join-Path $localSyncPath $syncRuleFileName
    $remoteUtilityScriptPath = "$remoteTempDir/$utilityScriptName"
    $remoteRuleFilePath      = "$remoteTempDir/$syncRuleFileName"
    $remoteTempArchivePath   = "$remoteTempDir/$archiveFileName"

    # Upload helper scripts & rule file first
    gcloud compute scp "$localScriptsPath/$utilityScriptName" `
        "$($config.sshUser)@$($config.instanceName):$remoteUtilityScriptPath" `
        --project=$($config.projectId) --zone=$($config.zone) | Out-Null
    if (Test-Path $ruleFilePath) {
        gcloud compute scp "$ruleFilePath" `
            "$($config.sshUser)@$($config.instanceName):$remoteRuleFilePath" `
            --project=$($config.projectId) --zone=$($config.zone) | Out-Null
    }

    # ---------------------- DOWNLOAD ----------------------
    if ($direction -eq 'download') {
        Write-Host "`n--- Starting DOWNLOAD process: '$($config.instanceName):$remoteSyncPath' -> '$localSyncPath' ---" -ForegroundColor Cyan

        # 1/3  Create archive on server
        Write-Host "`nStep 1/3: Creating archive on server..." -ForegroundColor Yellow
        $res = Invoke-GcloudSsh $config "bash $remoteUtilityScriptPath archive '$remoteSyncPath' '$remoteRuleFilePath' '$remoteTempArchivePath'"
        $res.Output | ForEach-Object { Write-Host $_ }
        if ($res.ExitCode -ne 0) { throw "REMOTE-ARCHIVE-ERROR`n$($res.Output -join "`n")" }

        # 2/3  Download archive
        Write-Host "`nStep 2/3: Downloading archive..."
        gcloud compute scp "$($config.sshUser)@$($config.instanceName):$remoteTempArchivePath" `
            "$localSyncPath" --project=$($config.projectId) --zone=$($config.zone) | Out-Null

        # 3/3  Extract locally
        Write-Host "`nStep 3/3: Extracting..." -ForegroundColor Yellow
        $localArchivePath = Join-Path $localSyncPath $archiveFileName
        tar -xzvf $localArchivePath -C $localSyncPath
        Remove-Item -Path $localArchivePath -Force
        Invoke-GcloudSsh $config "rm -f '$remoteTempArchivePath' '$remoteRuleFilePath'" | Out-Null

        Write-Host "`nDownload complete!" -ForegroundColor Magenta
        explorer.exe $localSyncPath
    }

    # ---------------------- UPLOAD ------------------------
    elseif ($direction -eq 'upload') {
        Write-Host "`n--- Starting UPLOAD process: '$localSyncPath' -> '$($config.instanceName):$remoteSyncPath' ---" -ForegroundColor Cyan
        Write-Host "`nStep 1/4: Getting remote file manifest..." -ForegroundColor Yellow

        # 1/4  Manifest
        $remoteManifest = @{}
        $manifestCmd = "bash $remoteUtilityScriptPath manifest '$remoteSyncPath' '$remoteRuleFilePath'"
        $res = Invoke-GcloudSsh $config $manifestCmd
        $res.Output | ForEach-Object { Write-Host $_ }
        if ($res.ExitCode -ne 0) { throw 'REMOTE-MANIFEST-ERROR' }
        $res.Output | ForEach-Object {
            $parts = $_ -split '\s+', 2
            if ($parts.Length -eq 2) { $remoteManifest[$parts[0]] = $parts[1] }
        }
        Invoke-GcloudSsh $config "rm -f '$remoteRuleFilePath'" | Out-Null

        # 2/4  Compare
        Write-Host "Step 2/4: Comparing local and remote files..." -ForegroundColor Yellow
        $filesToSync   = Get-SyncFileList -basePath $localSyncPath -ruleFile $ruleFilePath
        $filesToUpload = [System.Collections.Generic.List[string]]@()
        foreach ($file in $filesToSync) {
            $normalized = $file.Replace('\\','/')
            $localHash  = (Get-FileHash (Join-Path $localSyncPath $file) -Algorithm SHA256).Hash.ToUpper()
            $remoteHash = $remoteManifest[$normalized]
            if (-not $remoteHash -or $remoteHash -ne $localHash) { $filesToUpload.Add($file) }
        }
        if ($filesToUpload.Count -eq 0) { Write-Host "`nAll files are already in sync. Nothing to upload." -ForegroundColor Green; return }

        # 3/4  Confirm & list
        Write-Host "`nStep 3/4: Found $($filesToUpload.Count) new or modified files to upload:" -ForegroundColor Yellow
        $filesToUpload | ForEach-Object { Write-Host "  [+] $_" }
        $confirm = Read-Host "`nThis will overwrite files on the server in '$remoteSyncPath'. Proceed? (y/n)"
        if ($confirm -ne 'y') { Write-Host 'Upload canceled.'; return }

        # 4/4  Archive & upload
        Write-Host "Step 4/4: Archiving and uploading changed files..." -ForegroundColor Yellow
        $tmpList = [System.IO.Path]::GetTempFileName()
        [System.IO.File]::WriteAllLines($tmpList, $filesToUpload, (New-Object System.Text.UTF8Encoding($false)))
        Invoke-Expression "tar -czhf `"$archiveFileName`" --files-from=`"$tmpList`" -C `"$localSyncPath`""
        gcloud compute scp "$archiveFileName" `
            "$($config.sshUser)@$($config.instanceName):$remoteTempDir/$archiveFileName" `
            --project=$($config.projectId) --zone=$($config.zone) | Out-Null

        $res = Invoke-GcloudSsh $config "sudo tar -xzvf '$remoteTempDir/$archiveFileName' -C '$remoteSyncPath' && sudo chown -R $($config.sshUser):$($config.sshUser) '$remoteSyncPath' && sudo rm '$remoteTempDir/$archiveFileName'"
        $res.Output | ForEach-Object { Write-Host $_ }
        if ($res.ExitCode -ne 0) { throw 'REMOTE-EXTRACT-ERROR' }

        Remove-Item $archiveFileName, $tmpList -Force
        Write-Host "`nUpload complete!" -ForegroundColor Magenta
    }
    else {
        throw "Unknown direction '$direction'. Use 'upload' or 'download'."
    }
}

# ───────── main execution ─────────
try {
    $gcpConfig = Get-GcpConfig
    if (-not $PSBoundParameters.ContainsKey('Action')) {
        $choice = Read-Host "Choose action: 1 Upload / 2 Download"
        $Action = if ($choice -eq '1') { 'upload' } else { 'download' }
    }
    if (-not $PSBoundParameters.ContainsKey('RemotePath')) {
        $RemotePath = Select-RemoteDirectory $gcpConfig
    }
    $resolvedLocalPath = (Resolve-Path $LocalPath).Path
    Invoke-DirectorySync $gcpConfig $Action $resolvedLocalPath $RemotePath
}
catch {
    Write-Host "`nSCRIPT FAILED!" -ForegroundColor Red
    ($_.Exception.Message -split "`r?`n") | ForEach-Object { Write-Host $_ -ForegroundColor Red }
}
finally {
    $ErrorActionPreference = 'Continue'
}
