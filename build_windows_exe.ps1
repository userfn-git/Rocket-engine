# Rocket League Professional Master Engine - Windows 11 Standalone EXE Builder
# Pure PowerShell packager (replaces legacy .bat scripts and cleans stale build_windows_exe*.bat copies)

[CmdletBinding()]
param(
    [string]$ProjectPath = "",
    [switch]$Quiet = $false,
    [switch]$SkipCleanupBat = $false
)

$script:QuietMode = [bool]$Quiet
$ErrorActionPreference = "Stop"

function Log-Message {
    param(
        [Parameter(Mandatory = $true, Position = 0)]
        [ValidateSet("INFO", "WARN", "ERROR")]
        [string]$Level,
        [Parameter(Mandatory = $true, Position = 1)]
        [AllowEmptyString()]
        [AllowNull()]
        [string]$Message
    )

    $normalizedLevel = if ($Level) { $Level.ToUpperInvariant() } else { "INFO" }
    if ($script:QuietMode -and $normalizedLevel -eq "INFO") {
        return
    }

    $safeMessage = if ([string]::IsNullOrWhiteSpace($Message)) {
        if ($normalizedLevel -eq "ERROR") { "An unspecified build error occurred." } else { return }
    } else {
        $Message.TrimEnd()
    }

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $formatted = "[$timestamp] [$normalizedLevel] $safeMessage"
    $color = switch ($normalizedLevel) {
        "INFO"  { "Cyan" }
        "WARN"  { "Yellow" }
        "ERROR" { "Red" }
    }

    try {
        Write-Host $formatted -ForegroundColor $color
    } catch {
        [Console]::WriteLine($formatted)
    }
}

function Remove-ObsoleteBatchScripts([string[]]$SearchDirs) {
    foreach ($dir in ($SearchDirs | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique)) {
        $staleBats = Get-ChildItem -LiteralPath $dir -Filter "build_windows_exe*.bat" -File -ErrorAction SilentlyContinue
        foreach ($bat in $staleBats) {
            try {
                Remove-Item -LiteralPath $bat.FullName -Force -ErrorAction Stop
                Log-Message "INFO" "Removed obsolete batch script: $($bat.FullName)"
            } catch {
                Log-Message "WARN" "Could not delete obsolete batch file $($bat.FullName)"
            }
        }
    }
}

function Refresh-ToolchainPath([string]$RootDir) {
    $candidates = @(
        "$env:USERPROFILE\.cargo\bin",
        "$env:ProgramFiles\nodejs",
        "$env:LOCALAPPDATA\Programs\nodejs",
        "$env:LOCALAPPDATA\FNProNode",
        "D:\Program Files\nodejs",
        "D:\nodejs",
        (Join-Path $RootDir ".tools\nodejs")
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $merged = @($candidates + ($userPath -split ';') + ($machinePath -split ';') + ($env:Path -split ';')) |
        Where-Object { $_ -and $_.Trim() -ne "" } |
        Select-Object -Unique
    $env:Path = ($merged -join ';')
}

function Resolve-ProjectRoot([string]$Requested) {
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($Requested -and $Requested.Trim() -ne "") { $candidates.Add($Requested.Trim().Trim('"')) }
    if ($PSScriptRoot) { $candidates.Add($PSScriptRoot) }
    $candidates.Add((Get-Location).Path)

    foreach ($scope in @("Process", "User", "Machine")) {
        $envHome = [Environment]::GetEnvironmentVariable("FNPRO_ENGINE_HOME", $scope)
        if ($envHome) { $candidates.Add($envHome.Trim().Trim('"')) }
    }

    foreach ($dir in ($candidates | Select-Object -Unique)) {
        if ($dir -and (Test-Path -LiteralPath $dir)) {
            if ((Test-Path -LiteralPath (Join-Path $dir "package.json")) -and
                (Test-Path -LiteralPath (Join-Path $dir "src-tauri\tauri.conf.json"))) {
                return (Resolve-Path -LiteralPath $dir).Path
            }
        }
    }

    $scanRoots = @(
        $PSScriptRoot,
        "$env:USERPROFILE\Downloads",
        "$env:USERPROFILE\Desktop",
        "$env:USERPROFILE\Documents",
        "$env:USERPROFILE\source\repos"
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

    foreach ($root in $scanRoots) {
        $dirs = Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue
        foreach ($d in $dirs) {
            $p = $d.FullName
            if ((Test-Path -LiteralPath (Join-Path $p "package.json")) -and
                (Test-Path -LiteralPath (Join-Path $p "src-tauri\tauri.conf.json"))) {
                return $p
            }
        }
    }

    if ($PSScriptRoot) {
        $zip = Get-ChildItem -LiteralPath $PSScriptRoot -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like "*Master*Engine*.zip" -or $_.Name -like "*Rocket*engine*.zip" -or $_.Name -like "*FNPro*.zip" } |
            Select-Object -First 1
        if ($zip) {
            $extractDir = Join-Path $PSScriptRoot "FNProMasterEngine"
            Log-Message "INFO" "Extracting archive $($zip.FullName) into $extractDir..."
            Expand-Archive -LiteralPath $zip.FullName -DestinationPath $extractDir -Force
            if ((Test-Path -LiteralPath (Join-Path $extractDir "package.json")) -and
                (Test-Path -LiteralPath (Join-Path $extractDir "src-tauri\tauri.conf.json"))) {
                return $extractDir
            }
            $nested = Get-ChildItem -LiteralPath $extractDir -Directory -ErrorAction SilentlyContinue |
                Where-Object { (Test-Path -LiteralPath (Join-Path $_.FullName "package.json")) -and (Test-Path -LiteralPath (Join-Path $_.FullName "src-tauri\tauri.conf.json")) } |
                Select-Object -First 1
            if ($nested) { return $nested.FullName }
        }
    }

    throw "Could not locate package.json and src-tauri\tauri.conf.json. Extract the full ZIP kit or set FNPRO_ENGINE_HOME via install_dependencies.ps1."
}

try {
    Log-Message "INFO" "Initializing Rocket League Professional Master Engine EXE packager..."

    if (-not $SkipCleanupBat) {
        Remove-ObsoleteBatchScripts @($PSScriptRoot, (Get-Location).Path, "$env:USERPROFILE\Downloads", "$env:USERPROFILE\Desktop")
    }

    $engineRoot = Resolve-ProjectRoot -Requested $ProjectPath
    Set-Location -LiteralPath $engineRoot
    $env:FNPRO_ENGINE_HOME = $engineRoot
    [Environment]::SetEnvironmentVariable("FNPRO_ENGINE_HOME", $engineRoot, "User")
    Log-Message "INFO" "Project root locked: $engineRoot"

    Refresh-ToolchainPath -RootDir $engineRoot
    $env:NODE_ENV = $null

    Log-Message "INFO" "[1/5] Verifying Node.js, npm, Rust, and MSVC toolchains..."
    if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
        throw "Node.js is not in PATH. Run .\install_dependencies.ps1 first."
    }
    if (-not (Get-Command "npm" -ErrorAction SilentlyContinue)) {
        throw "npm is not available in PATH. Run .\install_dependencies.ps1 first."
    }
    if (-not (Get-Command "cargo" -ErrorAction SilentlyContinue)) {
        throw "Rust cargo toolchain is not in PATH. Run .\install_dependencies.ps1 or install from https://rustup.rs."
    }

    if (Get-Command "rustup" -ErrorAction SilentlyContinue) {
        $installedTargets = (& rustup target list --installed) -join [char]10
        if ($installedTargets -notmatch "x86_64-pc-windows-msvc") {
            Log-Message "INFO" "Adding Rust target x86_64-pc-windows-msvc..."
            & rustup target add x86_64-pc-windows-msvc
            if ($LASTEXITCODE -ne 0) { throw "Failed to add Rust target x86_64-pc-windows-msvc." }
        }
    }

    $pf86 = [Environment]::GetFolderPath("ProgramFilesX86")
    $vswhere = Join-Path $pf86 "Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Get-Command "cl" -ErrorAction SilentlyContinue)) {
        if (Test-Path -LiteralPath $vswhere) {
            $vcPath = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
            if (-not $vcPath) {
                throw "Visual Studio C++ Build Tools were not detected. Install C++ Desktop workload first."
            }
        } else {
            Log-Message "WARN" "cl.exe and vswhere.exe not found in default paths; continuing build."
        }
    }

    Log-Message "INFO" "[2/5] Installing Node dependencies (including Tauri CLI and Vite)..."
    $global:LASTEXITCODE = 0
    & npm install --include=dev --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }

    Log-Message "INFO" "[3/5] Running TypeScript lint and frontend Vite build..."
    $global:LASTEXITCODE = 0
    & npm run lint
    if ($LASTEXITCODE -ne 0) { throw "TypeScript lint check failed." }

    $global:LASTEXITCODE = 0
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend Vite build failed." }

    Log-Message "INFO" "[4/5] Compiling native Tauri v2 Windows 11 EXE and installers..."
    if (Test-Path -LiteralPath (Join-Path $engineRoot "node_modules\.bin\tauri.cmd")) {
        $global:LASTEXITCODE = 0
        & npx tauri build --target x86_64-pc-windows-msvc
        if ($LASTEXITCODE -ne 0) { throw "Tauri CLI build failed." }
    } else {
        $global:LASTEXITCODE = 0
        & cargo tauri --version *> $null
        if ($LASTEXITCODE -ne 0) {
            throw "Tauri CLI not found in node_modules or cargo. Run: npm install -D @tauri-apps/cli"
        }
        Push-Location (Join-Path $engineRoot "src-tauri")
        try {
            $global:LASTEXITCODE = 0
            & cargo tauri build
            if ($LASTEXITCODE -ne 0) { throw "cargo tauri build failed with exit code $LASTEXITCODE." }
        } finally {
            Pop-Location
        }
    }

    Log-Message "INFO" "[5/5] Verifying compiled Windows 11 binaries..."
    $outExe = Join-Path $engineRoot "src-tauri\target\release\rl-pro-master-engine.exe"
    if (-not (Test-Path -LiteralPath $outExe)) {
        throw "Expected executable not found at $outExe"
    }

    Log-Message "INFO" "Windows 11 standalone EXE compiled successfully: $outExe"
} catch {
    Log-Message "ERROR" $_.Exception.Message
    exit 1
}
