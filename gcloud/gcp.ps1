<#
.SYNOPSIS
    Automates connecting to a Google Compute Engine VM using WinSCP.
.DESCRIPTION
    A professional, dependency-aware script. It automatically detects, prompts for, and
    installs missing requirements (gcloud, WinSCP) before proceeding.
.NOTES
    Version: 2.9
    - UX IMPROVEMENT: The script now runs `gcloud config list` and displays the current
      configuration (project, zone, etc.) to the user before prompting for the
      instance name, providing helpful context.
#>
[CmdletBinding()]
param(
    [string]$InstanceName,
    [string]$SshUser = "beachspainc"
)

# --- Configuration & Globals ---
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -eq 'Desktop') { chcp 6501 | Out-Null }

$resolvedPaths = @{}

# ==============================================================================
# --- 1. REQUIREMENT DEFINITIONS (Configuration Center) ---
# ==============================================================================
$requirements = @(
    @{
        Name = "Google Cloud SDK"
        Executable = "gcloud.cmd"
        DetectionMethods = @(
            @{ Name = 'Find-ViaPath'; Args = @{ Executable = 'gcloud.cmd' } }
        )
        DownloadUrl = "https://dl.google.com/dl/cloudsdk/channels/rapid/GoogleCloudSDKInstaller.exe"
        InstallerArguments = "/S /allusers"
    },
    @{
        Name = "WinSCP"
        Executable = "WinSCP.exe"
        DetectionMethods = @(
            @{ Name = 'Find-ViaPath'; Args = @{ Executable = 'WinSCP.exe' } },
            @{ Name = 'Find-ViaCommonFolders'; Args = @{ Executable = 'WinSCP.exe' } },
            @{ Name = 'Find-ViaRegistry'; Args = @{ DisplayName = 'WinSCP*'; Executable = 'WinSCP.exe' } },
            @{ Name = 'Find-ViaAppxPackage'; Args = @{ Name = '*WinSCP*'; Executable = 'WinSCP.exe' } }
        )
        DownloadUrl = "https://winscp.net/download/WinSCP-latest-Setup.exe"
        InstallerArguments = "/VERYSILENT /ALLUSERS /NORESTART /SUPPRESSMSGBOXES"
    },
    @{
        Name = "PuTTYgen"
        Executable = "puttygen.exe"
        DetectionMethods = @(
            @{ Name = 'Find-ViaRelativePath'; Args = @{ BaseExecutable = 'WinSCP.exe'; RelativePaths = @("PuTTY\puttygen.exe", "puttygen.exe") } }
        )
    }
)

# ==============================================================================
# --- 2. DEPENDENCY RESOLUTION ENGINE ---
# ==============================================================================

# --- Detection "Plugin" Functions ---
function Find-ViaPath {
    param($Executable)
    $command = Get-Command $Executable -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    return $null
}

function Find-ViaCommonFolders {
    param($Executable)
    $progFilesX86 = [System.Environment]::GetFolderPath('ProgramFilesX86')
    $progFiles = [System.Environment]::GetFolderPath('ProgramFiles')
    $baseName = $Executable.Split('.')[0]
    $commonPaths = @(
        (Join-Path (Join-Path $progFilesX86 $baseName) $Executable),
        (Join-Path (Join-Path $progFiles $baseName) $Executable)
    )
    return $commonPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
}

function Find-ViaRegistry {
    param($DisplayName, $Executable)
    $registryPaths = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
    )
    foreach ($regPath in $registryPaths) {
        $entry = @(Get-ItemProperty "$regPath\*" -ErrorAction SilentlyContinue) |
                Where-Object { $_ -and $_.PSObject.Properties.Name -contains 'DisplayName' -and $_.DisplayName -like $DisplayName } |
                Select-Object -First 1

        if ($entry -and $entry.InstallLocation) {
            $foundPath = Join-Path $entry.InstallLocation $Executable
            if (Test-Path $foundPath) {
                return $foundPath
            }
        }
    }
    return $null
}

function Find-ViaAppxPackage {
    param($Name, $Executable)
    try {
        $appx = Get-AppxPackage -Name $Name -ErrorAction Stop
        if ($appx) {
            $foundPath = Join-Path $appx.InstallLocation $Executable
            if (Test-Path $foundPath) { return $foundPath }
        }
    } catch {}
    return $null
}

function Find-ViaRelativePath {
    param($BaseExecutable, $RelativePaths)
    $basePath = $resolvedPaths[$BaseExecutable]
    if (-not $basePath) { return $null }
    $baseDir = Split-Path $basePath -Parent
    foreach ($relPath in $RelativePaths) {
        $fullPath = Join-Path $baseDir $relPath
        if (Test-Path $fullPath) { return $fullPath }
    }
    return $null
}

# --- Installation Functions ---
function Install-Requirement {
    param($Requirement)
    Write-Host "`nAttempting to download and install $($Requirement.Name)..." -ForegroundColor Yellow
    $tempDir = Join-Path $env:TEMP ([Guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Path $tempDir | Out-Null
    $installerPath = Join-Path $tempDir "installer.exe"

    try {
        Write-Host "Downloading from $($Requirement.DownloadUrl)..."
        Invoke-WebRequest -Uri $Requirement.DownloadUrl -OutFile $installerPath
        Write-Host "Download complete. Starting silent installation (this may require administrator privileges)..." -ForegroundColor Green
        Start-Process -FilePath $installerPath -ArgumentList $Requirement.InstallerArguments -Wait -Verb RunAs
        Write-Host "$($Requirement.Name) installation finished." -ForegroundColor Green
        Write-Host "IMPORTANT: Please close and reopen this terminal, then run the script again for changes to take effect." -ForegroundColor Cyan
    }
    catch { Write-Error "An error occurred during installation: $($_.Exception.Message)" }
    finally { if (Test-Path $tempDir) { Remove-Item -Recurse -Force $tempDir } }
}

function Confirm-And-Install {
    param($Requirement)
    Write-Warning "$($Requirement.Name) not found on your system."
    if (-not $Requirement.DownloadUrl) {
        throw "$($Requirement.Name) is missing but no installer is defined for it. It might be a sub-component of another program (like PuTTYgen is to WinSCP)."
    }
    $choice = Read-Host "Would you like to automatically download and install $($Requirement.Name)? (Y/N)"
    if ($choice -eq 'y') {
        Install-Requirement -Requirement $Requirement
    } else {
        Write-Host "Installation skipped."
    }
}

# --- Main Dependency Resolver ---
function Resolve-Dependencies {
    Write-Host "`n--- Step 1: Resolving Dependencies ---" -ForegroundColor Yellow
    foreach ($req in $requirements) {
        Write-Host "Checking for $($req.Name)..."
        $foundPath = $null
        foreach ($method in $req.DetectionMethods) {
            $splatArgs = $method.Args
            $foundPath = & $method.Name @splatArgs
            if ($foundPath) { break }
        }

        if ($foundPath) {
            $resolvedPaths[$req.Executable] = $foundPath
            Write-Host "  [OK] Found at: $foundPath" -ForegroundColor Green
        } else {
            Confirm-And-Install -Requirement $req
            return $false
        }
    }
    return $true
}

# ==============================================================================
# --- 3. MAIN SCRIPT LOGIC ---
# ==============================================================================
Write-Host "`n--- GCE WinSCP Connector ---" -ForegroundColor Yellow

if (-not (Resolve-Dependencies)) {
    Write-Host "`nScript will now exit. Please restart your terminal and run the script again if an installation occurred."
    return
}

try {
    Write-Host "`n--- Step 2: Gathering Instance Details ---" -ForegroundColor Yellow

    # --- NEW: Display current gcloud config before asking for input ---
    Write-Host "Displaying current gcloud configuration for context..." -ForegroundColor Cyan
    $configList = & $resolvedPaths['gcloud.cmd'] config list
    Write-Host "----------------------------------------"
    Write-Host $configList
    Write-Host "----------------------------------------"

    # Get project and zone quietly for later use
    $project = & $resolvedPaths['gcloud.cmd'] config get-value project --quiet
    $zone = & $resolvedPaths['gcloud.cmd'] config get-value compute/zone --quiet

    if ([string]::IsNullOrWhiteSpace($InstanceName)) {
        $InstanceName = Read-Host "Please enter the GCE Instance Name"
    }

    Write-Host "  Fetching IP address for instance '$InstanceName'..."
    $externalIp = & $resolvedPaths['gcloud.cmd'] compute instances describe $InstanceName --project=$project --zone=$zone --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
    if ([string]::IsNullOrWhiteSpace($externalIp)) {
        throw "Could not retrieve an external IP address for instance '$InstanceName'."
    }
    Write-Host "  [OK] Instance IP: $externalIp" -ForegroundColor Green

    Write-Host "`n--- Step 3: Preparing SSH Private Key ---" -ForegroundColor Yellow
    $sshKeyDir = Join-Path $env:USERPROFILE ".ssh"
    $privateKeyPath = Join-Path $sshKeyDir "google_compute_engine"
    $ppkKeyPath = Join-Path $sshKeyDir "google_compute_engine.ppk"

    if (-not (Test-Path $privateKeyPath)) {
        throw "Standard gcloud private key not found at '$privateKeyPath'. Please connect once using 'gcloud compute ssh $InstanceName' to generate it."
    }

    if (-not (Test-Path $ppkKeyPath)) {
        Write-Host "  PPK key not found. Generating '$ppkKeyPath'..."
        $puttygenCommand = "& `"$($resolvedPaths['puttygen.exe'])`" `"$privateKeyPath`" -o `"$ppkKeyPath`" -O private"
        Invoke-Expression $puttygenCommand
        Write-Host "  [OK] PPK key successfully generated." -ForegroundColor Green
    } else {
        Write-Host "  [OK] Found existing PPK key." -ForegroundColor Green
    }

    Write-Host "`n--- Step 4: Launching WinSCP ---" -ForegroundColor Yellow
    $sessionUrl = "sftp://$SshUser@$externalIp/"
    $winscpCommand = "& `"$($resolvedPaths['WinSCP.exe'])`" `"$sessionUrl`" /privatekey=`"$ppkKeyPath`" /newinstance"

    Invoke-Expression $winscpCommand

    Write-Host "`n🚀 WinSCP launched successfully!" -ForegroundColor Magenta
}
catch {
    Write-Error "An error occurred during script execution: $($_.Exception.Message)"
    return
}