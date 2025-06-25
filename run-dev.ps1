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

function Invoke-Clean {
    Write-Info "Starting full project cleanup..."

    try {
        # 0. 预检查：确保没有进程锁定文件
        Write-Info "Checking for processes locking project files..."
        $lockedProcesses = Get-Process | Where-Object {
            $_.Path -like "$(Get-Location)\*" -and
            $_.Name -match "node|webpack|powershell"
        }

        if ($lockedProcesses) {
            Write-Warning ("Found {0} running processes that may lock files:" -f $lockedProcesses.Count)
            $lockedProcesses | Format-Table Id, Name, Path -AutoSize

            $confirm = Read-Host "Force terminate these processes? (y/n)"
            if ($confirm -eq 'y') {
                $lockedProcesses | Stop-Process -Force
                Start-Sleep -Seconds 1
                Write-Success "Terminated locking processes"
            } else {
                Write-Error "Cleanup aborted due to active file locks"
                exit 1
            }
        }

        # 1. 删除dist目录（带智能重试机制）
        $distPath = Join-Path (Get-Location) "dist"
        if (Test-Path -Path $distPath) {
            Write-Info "Deleting dist directory (with smart retry)..."
            $retries = 5
            $cleaned = $false

            while ($retries -gt 0 -and -not $cleaned) {
                try {
                    Remove-Item -Recurse -Force $distPath -ErrorAction Stop
                    Write-Success "Deleted dist directory"
                    $cleaned = $true
                } catch {
                    $retryDelay = (6 - $retries) * 2  # 动态延迟：第一次2秒，最后一次10秒
                    Write-Warning ("Cleanup failed (retries left: {0}). Waiting {1} seconds..." -f $retries, $retryDelay)
                    Start-Sleep -Seconds $retryDelay
                    $retries--
                }
            }

            if (-not $cleaned) {
                Write-Error "彻底清理失败，请手动删除dist目录"
                exit 1
            }
        }

        # 2. 删除缓存目录（按需使用延迟）
        $cachePaths = @(
            "node_modules\.cache",
            ".cache-loader",
            ".webpack-cache",
            "logs"
        )

        foreach ($cachePath in $cachePaths) {
            $fullPath = Join-Path (Get-Location) $cachePath
            if (Test-Path -Path $fullPath) {
                try {
                    # 仅在需要时使用延迟
                    if ($cachePath -eq "node_modules") {
                        Write-Info "Deleting large directory $cachePath, adding safety delay..."
                        Start-Sleep -Seconds 1
                    }

                    Remove-Item -Recurse -Force $fullPath -ErrorAction Stop
                    Write-Success ("Deleted cache directory {0}" -f $cachePath)
                } catch {
                    # 修复的变量引用 - 使用字符串格式化和显式变量
                    Write-Warning ("Failed to delete {0}: {1}" -f $cachePath, $_.Exception.Message)

                    # 仅对重要目录重试
                    if ($cachePath -match "node_modules|dist") {
                        Start-Sleep -Seconds 2
                        Remove-Item -Recurse -Force $fullPath -ErrorAction SilentlyContinue
                    }
                }
            }
        }

        # 3. 系统级清理（无延迟）
        Write-Info "Flushing DNS cache..."
        ipconfig /flushdns | Out-Null
        Write-Success "DNS cache flushed"

        Write-Info "Cleaning npm cache..."
        npm cache clean --force | Out-Null
        Write-Success "npm cache cleaned"

        # 4. 深度清理（使用条件延迟）
        # 4.1 删除node_modules
        $nodeModulesPath = Join-Path (Get-Location) "node_modules"
        if (Test-Path -Path $nodeModulesPath) {
            Write-Info "Deleting node_modules (adding safety delay for large directory)..."
            Start-Sleep -Seconds 1  # 大型目录需要额外时间

            try {
                Remove-Item -Recurse -Force $nodeModulesPath -ErrorAction Stop
                Write-Success "Deleted node_modules"
            } catch {
                Write-Warning ("Failed to delete node_modules: {0}" -f $_.Exception.Message)
                Start-Sleep -Seconds 3
                Remove-Item -Recurse -Force $nodeModulesPath -ErrorAction SilentlyContinue
            }
        }

        # 4.2 删除package-lock.json（无延迟）
        $lockFilePath = Join-Path (Get-Location) "package-lock.json"
        if (Test-Path -Path $lockFilePath) {
            Remove-Item -Force $lockFilePath
            Write-Success "Deleted package-lock.json"
        }

        # 5. 文件系统安全检查（使用最小延迟）
        Write-Info "Performing filesystem health check..."
        Start-Sleep -Milliseconds 500  # 极短延迟确保文件系统状态更新

        # 检查是否仍有残留文件
        $residualFiles = @(
            $distPath,
            $nodeModulesPath,
            $lockFilePath
        ) | Where-Object { Test-Path $_ }

        if ($residualFiles) {
            Write-Warning "Residual files detected after cleanup:"
            $residualFiles | ForEach-Object { Write-Warning ("  - {0}" -f $_) }
        } else {
            Write-Success "No residual files detected"
        }

        # 6. 最终资源释放（使用短延迟）
        Write-Info "Performing final system release..."
        [System.GC]::Collect()
        [System.GC]::WaitForPendingFinalizers()
        Start-Sleep -Milliseconds 300  # 非常短的延迟

        Write-Success "Project cleaned successfully with optimized safety measures!"
    } catch {
        Write-Error ("Cleanup failed: {0}" -f $_.Exception.Message)
        Write-Debug ("Error details: {0}" -f $_.Exception.StackTrace)
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