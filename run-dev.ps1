<#
.SYNOPSIS
Complete development environment manager - Includes cache cleaning, dependency installation, dev server startup, and log monitoring.

.DESCRIPTION
This script provides the following functions:
1. Clean project caches and dependencies
2. Install required dependencies
3. Start development server with detailed logging
4. Real-time log file monitoring

.NOTES
Author: AI Assistant
Version: 1.7
Date: 2025-06-22
#>

param(
    [switch]$Clean,       # Perform cleanup operations
    [switch]$Install,     # Install dependencies
    [switch]$Run,         # Start development server
    [switch]$Monitor,     # Monitor log files
    [switch]$All,         # Perform all operations
    [string]$Port = 8080  # Development server port
)

# Set error handling
$ErrorActionPreference = "Stop"

# Color definitions for console output
$InfoColor = "Cyan"
$SuccessColor = "Green"
$WarningColor = "Yellow"
$ErrorColor = "Red"
$DebugColor = "Magenta"

# Colorized output functions
function Write-Info($message) {
    Write-Host "[INFO] $message" -ForegroundColor $InfoColor
}

function Write-Success($message) {
    Write-Host "[SUCCESS] $message" -ForegroundColor $SuccessColor
}

function Write-Warning($message) {
    Write-Host "[WARNING] $message" -ForegroundColor $WarningColor
}

function Write-Error($message) {
    Write-Host "[ERROR] $message" -ForegroundColor $ErrorColor
}

function Write-Debug($message) {
    Write-Host "[DEBUG] $message" -ForegroundColor $DebugColor
}

# Clean project function
function Invoke-Clean {
    Write-Info "Starting full project cleanup..."

    try {
        # Delete dist directory
        if (Test-Path -Path "dist") {
            Remove-Item -Recurse -Force "dist"
            Write-Success "Deleted dist directory"
        }

        # Delete cache directories
        $cachePaths = @(
            "node_modules\.cache",
            ".cache-loader",
            ".webpack-cache",
            "logs"
        )

        foreach ($cachePath in $cachePaths) {
            if (Test-Path -Path $cachePath) {
                Remove-Item -Recurse -Force $cachePath
                Write-Success "Deleted cache directory $cachePath"
            }
        }

        # Flush DNS cache
        Write-Info "Flushing DNS cache..."
        ipconfig /flushdns | Out-Null
        Write-Success "DNS cache flushed"

        # Clean npm cache
        Write-Info "Cleaning npm cache..."
        npm cache clean --force | Out-Null
        Write-Success "npm cache cleaned"

        # Delete node_modules and package-lock.json
        if (Test-Path -Path "node_modules") {
            Remove-Item -Recurse -Force "node_modules"
            Write-Success "Deleted node_modules"
        }

        if (Test-Path -Path "package-lock.json") {
            Remove-Item -Force "package-lock.json"
            Write-Success "Deleted package-lock.json"
        }

        # 添加安全延迟
        Write-Info "Adding safety delay to ensure file system release..."
        Start-Sleep -Seconds 2
        Write-Success "All caches cleaned successfully with safety delay!"
    } catch {
        Write-Error "Cleanup failed: $($_.Exception.Message)"
        exit 1
    }
}

# Install dependencies function
function Invoke-Install {
    Write-Info "Installing dependencies..."

    try {
        # Create required directories
        if (-not (Test-Path -Path "logs")) {
            New-Item -ItemType Directory -Path "logs" | Out-Null
            Write-Success "Created logs directory"
        }

        if (-not (Test-Path -Path "dist")) {
            New-Item -ItemType Directory -Path "dist" | Out-Null
            Write-Success "Created dist directory"
        }

        # Install npm packages
        npm install

        # Install specific dev dependencies
        $dependencies = @("webpack", "webpack-cli", "webpack-dev-server", "get-port", "chalk", "webpack-userscript")
        foreach ($dep in $dependencies) {
            if (-not (Test-Path -Path "node_modules\$dep")) {
                Write-Info "Installing $dep..."
                npm install $dep --save-dev
                Write-Success "Installed $dep"
            }
        }

        Write-Success "Dependencies installed successfully!"
    } catch {
        Write-Error "Installation failed: $($_.Exception.Message)"
        exit 1
    }
}

# 修复后的开发服务器启动函数
function Start-DevServer {
    param([int]$Port)

    Write-Info "Starting development server on port $Port..."

    try {
        $env:NODE_ENV = "development"
        $env:WEBPACK_PORT = $Port

        # 使用正确的二进制文件路径
        $webpackBin = Join-Path (Get-Location) "node_modules\webpack-dev-server\bin\webpack-dev-server.js"

        if (-not (Test-Path $webpackBin)) {
            throw "webpack-dev-server binary not found: $webpackBin"
        }

        # 启动开发服务器
        $serverProcess = Start-Process -NoNewWindow -PassThru -FilePath "node" `
            -ArgumentList """$webpackBin""", "--config", "webpack.config.js", "--port", $Port

        Write-Success "Development server started (PID: $($serverProcess.Id))"
        Write-Info "Logs are being written to: $((Get-Location).Path)\logs\webpack.log"

        return $serverProcess
    } catch {
        Write-Error "Failed to start dev server: $($_.Exception.Message)"
        Write-Debug "Error details: $($_.Exception.StackTrace)"
        exit 1
    }
}

# Monitor log files function
function Monitor-Logs {
    param(
        [string]$LogFile = "logs\webpack.log"
    )

    if (-not (Test-Path -Path $LogFile)) {
        Write-Warning "Log file $LogFile not found. Waiting for it to be created..."

        # Wait for log file to be created
        $retryCount = 0
        while (-not (Test-Path -Path $LogFile) -and $retryCount -lt 20) {
            Start-Sleep -Seconds 1
            $retryCount++
        }

        if (-not (Test-Path -Path $LogFile)) {
            Write-Error "Log file not created after 20 seconds"
            return
        }
    }

    Write-Info "Starting log monitor. Press Ctrl+C to exit..."
    Write-Host "`n===== LOG TAIL =====`n" -ForegroundColor Cyan

    try {
        # Real-time log monitoring
        Get-Content -Path $LogFile -Wait -Tail 20 | ForEach-Object {
            # Colorize log levels
            if ($_ -match "\[ERROR\]") {
                Write-Host $_ -ForegroundColor $ErrorColor
            } elseif ($_ -match "\[WARN\]") {
                Write-Host $_ -ForegroundColor $WarningColor
            } elseif ($_ -match "\[DEBUG\]") {
                Write-Host $_ -ForegroundColor $DebugColor
            } elseif ($_ -match "\[INFO\]") {
                Write-Host $_ -ForegroundColor $InfoColor
            } else {
                Write-Host $_
            }
        }
    } catch {
        Write-Error "Log monitoring failed: $($_.Exception.Message)"
    }
}

# Main execution logic
if ($Clean -or $All) {
    Invoke-Clean
}

if ($Install -or $All) {
    Invoke-Install
}

if ($Run -or $All) {
    $serverProcess = Start-DevServer -Port $Port
}

if ($Monitor -or $All) {
    Monitor-Logs
}

# Show help if no parameters specified
if (-not ($Clean -or $Install -or $Run -or $Monitor -or $All)) {
    Write-Host "`n===== Development Environment Manager =====" -ForegroundColor Cyan
    Write-Host "Usage: .\run-dev.ps1 [options]`n" -ForegroundColor White
    Write-Host "Options:" -ForegroundColor Yellow
    Write-Host "  -Clean      : Clean project caches and dependencies"
    Write-Host "  -Install    : Install project dependencies"
    Write-Host "  -Run        : Start development server"
    Write-Host "  -Monitor    : Monitor log files in real-time"
    Write-Host "  -All        : Perform all operations (Clean, Install, Run, Monitor)"
    Write-Host "  -Port <num> : Specify development server port (default: 8080)`n"
    Write-Host "Example: .\run-dev.ps1 -All -Port 8081" -ForegroundColor Green
}