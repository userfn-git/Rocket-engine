# FNPro Master Engine - Windows 10/11 Dependency & Build Recovery Setup
# Detects FNPRO_ENGINE_HOME, auto-locates or installs Node.js LTS + npm,
# regenerates clean UTF-8 (no-BOM) package.json & package-lock.json, and builds.
# Author: userfn-git | Email: fnprospace@gmail.com
# Repository: https://github.com/userfn-git/Rocket-engine.git

[CmdletBinding()]
param(
    [string]$ProjectPath = "",
    [switch]$SkipVenv = $false,
    [switch]$ForceAdmin = $false,
    [switch]$CleanInstall = $false,
    [switch]$Quiet = $false
)

$script:QuietMode = [bool]$Quiet
$script:LogFilePath = Join-Path $env:TEMP "FNProMasterEngine\install_dependencies.log"

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
        if ($normalizedLevel -eq "ERROR") { "An unspecified error occurred." } else { return }
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

    if ($script:LogFilePath) {
        try {
            $logDir = Split-Path -Path $script:LogFilePath -Parent
            if ($logDir -and -not (Test-Path -LiteralPath $logDir)) {
                New-Item -ItemType Directory -Path $logDir -Force | Out-Null
            }
            $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
            [System.IO.File]::AppendAllText($script:LogFilePath, ($formatted + [Environment]::NewLine), $utf8NoBom)
        } catch {
            # Non-fatal if log file path is temporarily locked or read-only
        }
    }
}

function Invoke-FnProSetup {
    param(
        [string]$RequestedProjectPath = "",
        [bool]$SkipPythonVenv = $false,
        [bool]$ElevateAdmin = $false,
        [bool]$PurgeNodeModules = $false,
        [bool]$QuietMode = $false
    )

    $script:QuietMode = $QuietMode
    $ErrorActionPreference = "Stop"

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
    } catch {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    }

    function Test-CommandAvailable([string]$Cmd) {
        return (Get-Command $Cmd -ErrorAction SilentlyContinue) -ne $null
    }

    function Write-Utf8NoBom([string]$FilePath, [string]$Content) {
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($FilePath, $Content, $utf8NoBom)
    }

    function Refresh-SessionPath([string]$RootDir) {
        $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
        $userPath    = [Environment]::GetEnvironmentVariable("Path", "User")
        $nvmSymlink  = [Environment]::GetEnvironmentVariable("NVM_SYMLINK", "User")
        if (-not $nvmSymlink) { $nvmSymlink = [Environment]::GetEnvironmentVariable("NVM_SYMLINK", "Machine") }

        $candidateDirs = New-Object System.Collections.Generic.List[string]
        $staticDirs = @(
            "$env:ProgramFiles\nodejs",
            "${env:ProgramFiles(x86)}\nodejs",
            "$env:LOCALAPPDATA\Programs\nodejs",
            "$env:LOCALAPPDATA\FNProNode",
            "$env:APPDATA\npm",
            "$env:USERPROFILE\scoop\apps\nodejs-lts\current",
            "$env:USERPROFILE\scoop\apps\nodejs\current",
            "$env:USERPROFILE\scoop\shims",
            "$env:LOCALAPPDATA\Volta\bin",
            "$env:ProgramData\chocolatey\bin",
            "$env:USERPROFILE\.cargo\bin",
            "C:\Program Files\nodejs",
            "C:\nodejs",
            "D:\nodejs",
            "D:\Program Files\nodejs",
            "E:\nodejs"
        )
        foreach ($d in $staticDirs) {
            if ($d -and $d.Trim() -ne "") { $candidateDirs.Add($d) }
        }
        if ($nvmSymlink) { $candidateDirs.Add($nvmSymlink) }
        if ($RootDir) {
            $candidateDirs.Add((Join-Path $RootDir ".tools\nodejs"))
            $candidateDirs.Add((Join-Path $RootDir "nodejs"))
        }

        $nvmRoot = "$env:APPDATA\nvm"
        if (Test-Path -LiteralPath $nvmRoot) {
            Get-ChildItem -LiteralPath $nvmRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                $candidateDirs.Add($_.FullName)
            }
        }
        $fnmRoot = "$env:LOCALAPPDATA\fnm_multishells"
        if (Test-Path -LiteralPath $fnmRoot) {
            Get-ChildItem -LiteralPath $fnmRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                $candidateDirs.Add($_.FullName)
            }
        }

        $existingDirs = $candidateDirs | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
        $combined = @($existingDirs + ($userPath -split ';') + ($machinePath -split ';') + ($env:Path -split ';')) |
            Where-Object { $_ -and $_.Trim() -ne "" } |
            Select-Object -Unique
        $env:Path = ($combined -join ';')
    }

    function Find-NodeExecutable([string]$RootDir) {
        Refresh-SessionPath -RootDir $RootDir
        $cmd = Get-Command "node.exe" -ErrorAction SilentlyContinue
        if (-not $cmd) { $cmd = Get-Command "node" -ErrorAction SilentlyContinue }
        if ($cmd -and $cmd.Source -and (Test-Path -LiteralPath $cmd.Source)) {
            return $cmd.Source
        }
        return $null
    }

    function Install-PortableNodeLts([string]$InstallBaseDir) {
        $nodeZipUrl = "https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip"
        try {
            $indexJson = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -UseBasicParsing -TimeoutSec 15
            $latestLts = $indexJson | Where-Object { $_.lts -and $_.files -contains "win-x64-zip" } | Select-Object -First 1
            if ($latestLts -and $latestLts.version) {
                $ver = $latestLts.version
                $nodeZipUrl = "https://nodejs.org/dist/$ver/node-$ver-win-x64.zip"
            }
        } catch {
            Log-Message "INFO" "Using verified Node.js v22.14.0 LTS fallback mirror."
        }

        if (-not (Test-Path -LiteralPath $InstallBaseDir)) {
            New-Item -ItemType Directory -Path $InstallBaseDir -Force | Out-Null
        }
        $zipPath    = Join-Path $env:TEMP "fnpro_node_lts_win_x64.zip"
        $extractTmp = Join-Path $env:TEMP "fnpro_node_lts_extract"

        Log-Message "INFO" "Downloading portable Node.js LTS from $nodeZipUrl"
        Invoke-WebRequest -Uri $nodeZipUrl -OutFile $zipPath -UseBasicParsing

        if (Test-Path -LiteralPath $extractTmp) {
            Remove-Item -LiteralPath $extractTmp -Recurse -Force -ErrorAction SilentlyContinue
        }
        Expand-Archive -LiteralPath $zipPath -DestinationPath $extractTmp -Force
        $unpackedDir = Get-ChildItem -LiteralPath $extractTmp -Directory | Select-Object -First 1
        if (-not $unpackedDir) {
            throw "Failed to unpack Node.js LTS archive from $nodeZipUrl"
        }

        Copy-Item -Path (Join-Path $unpackedDir.FullName "*") -Destination $InstallBaseDir -Recurse -Force
        Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $extractTmp -Recurse -Force -ErrorAction SilentlyContinue

        $nodeExePath = Join-Path $InstallBaseDir "node.exe"
        if (-not (Test-Path -LiteralPath $nodeExePath)) {
            throw "Portable Node.js extraction completed, but node.exe was not found in $InstallBaseDir"
        }

        $curUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($curUserPath -notlike "*$InstallBaseDir*") {
            $nextPath = if ($curUserPath) { "$InstallBaseDir;$curUserPath" } else { $InstallBaseDir }
            [Environment]::SetEnvironmentVariable("Path", $nextPath, "User")
        }
        $env:Path = "$InstallBaseDir;$env:Path"
        return $nodeExePath
    }

    function Resolve-FnProEngineHome([string]$RequestedPath) {
        $candidates = New-Object System.Collections.Generic.List[string]

        if ($RequestedPath -and $RequestedPath.Trim() -ne "") {
            $candidates.Add($RequestedPath.Trim().Trim('"'))
        }
        if ($script:PSScriptRoot -and $script:PSScriptRoot.Trim() -ne "") {
            $candidates.Add($script:PSScriptRoot.Trim())
        }
        $candidates.Add((Get-Location).Path)

        foreach ($scope in @("Process", "User", "Machine")) {
            $envVal = [Environment]::GetEnvironmentVariable("FNPRO_ENGINE_HOME", $scope)
            if ($envVal -and $envVal.Trim() -ne "") {
                $candidates.Add($envVal.Trim().Trim('"'))
            }
        }

        foreach ($dir in ($candidates | Select-Object -Unique)) {
            if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { continue }
            $hasTauri  = Test-Path -LiteralPath (Join-Path $dir "src-tauri\tauri.conf.json")
            $hasApp    = Test-Path -LiteralPath (Join-Path $dir "src\App.tsx")
            $hasServer = Test-Path -LiteralPath (Join-Path $dir "server.ts")
            $hasPkg    = Test-Path -LiteralPath (Join-Path $dir "package.json")
            if ($hasTauri -or $hasApp -or $hasServer -or $hasPkg) {
                return (Resolve-Path -LiteralPath $dir).Path
            }
        }

        $searchRoots = @(
            "$env:USERPROFILE\Downloads",
            "$env:USERPROFILE\Desktop",
            "$env:USERPROFILE\Documents",
            "$env:USERPROFILE\source\repos",
            "$env:USERPROFILE",
            "C:\",
            "D:\",
            "E:\"
        ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

        foreach ($root in $searchRoots) {
            $subdirs = Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue
            foreach ($sub in $subdirs) {
                $p = $sub.FullName
                if ((Test-Path -LiteralPath (Join-Path $p "src-tauri\tauri.conf.json")) -or
                    (Test-Path -LiteralPath (Join-Path $p "src\App.tsx"))) {
                    return $p
                }
            }
        }

        $cwd = (Get-Location).Path
        if ($cwd -match "\\Windows\\System32") {
            $fallback = Join-Path $env:USERPROFILE "FNProMasterEngine"
            New-Item -ItemType Directory -Path $fallback -Force | Out-Null
            return $fallback
        }
        return $cwd
    }

    try {
        Log-Message "INFO" "Starting FNPro Master Engine dependency and build recovery..."

        $engineRoot = Resolve-FnProEngineHome -RequestedPath $RequestedProjectPath
        Refresh-SessionPath -RootDir $engineRoot

        $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        if (-not $isAdmin -and $ElevateAdmin -and $MyInvocation.MyCommand.Path) {
            Log-Message "WARN" "Re-launching with Administrator privileges in $engineRoot"
            $scriptFile = $MyInvocation.MyCommand.Path
            $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$scriptFile`"", "-ProjectPath", "`"$engineRoot`"")
            if ($SkipPythonVenv)   { $argList += "-SkipVenv" }
            if ($PurgeNodeModules) { $argList += "-CleanInstall" }
            if ($QuietMode)        { $argList += "-Quiet" }
            Start-Process powershell.exe -WorkingDirectory $engineRoot -ArgumentList $argList -Verb RunAs
            return
        }

        Set-Location -LiteralPath $engineRoot

        # 1. Detect & Register FNPRO_ENGINE_HOME Environment Variables
        Log-Message "INFO" "[1/6] Registering FNPRO_ENGINE_HOME environment paths..."

        $appDataDir = "$env:APPDATA\FNProMasterEngine"
        $tempDir    = "$env:TEMP\FNProMasterEngine"
        $demoDir    = "$env:USERPROFILE\Documents\My Games\Rocket League\TAGame\Demos"

        New-Item -ItemType Directory -Path $appDataDir -Force | Out-Null
        New-Item -ItemType Directory -Path "$tempDir\buffers" -Force | Out-Null
        New-Item -ItemType Directory -Path "$tempDir\scratch" -Force | Out-Null

        $env:FNPRO_ENGINE_HOME = $engineRoot
        [Environment]::SetEnvironmentVariable("FNPRO_ENGINE_HOME", $engineRoot, "User")
        [Environment]::SetEnvironmentVariable("FNPRO_APPDATA", $appDataDir, "User")
        [Environment]::SetEnvironmentVariable("FNPRO_TEMP", $tempDir, "User")
        [Environment]::SetEnvironmentVariable("RL_DEMO_PATH", $demoDir, "User")

        $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($currentUserPath -notlike "*$engineRoot*") {
            $newUserPath = if ($currentUserPath) { "$currentUserPath;$engineRoot" } else { $engineRoot }
            [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
            $env:Path = "$env:Path;$engineRoot"
        }

        Log-Message "INFO" "FNPRO_ENGINE_HOME=$engineRoot | FNPRO_APPDATA=$appDataDir"

        # 2. Validate Node.js & npm Availability (Auto-Install Fallback Included)
        Log-Message "INFO" "[2/6] Validating Node.js and npm toolchain..."

        $nodeExe = Find-NodeExecutable -RootDir $engineRoot

        if (-not $nodeExe -and (Test-CommandAvailable "winget")) {
            Log-Message "WARN" "Node.js missing from PATH; attempting winget OpenJS.NodeJS.LTS install"
            $global:LASTEXITCODE = 0
            try {
                & winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements | Out-Null
            } catch {
                Log-Message "WARN" "winget install incomplete; switching to portable LTS fallback"
            }
            $nodeExe = Find-NodeExecutable -RootDir $engineRoot
        }

        if (-not $nodeExe) {
            Log-Message "WARN" "Provisioning portable official Node.js LTS runtime"
            $portableDir = Join-Path $engineRoot ".tools\nodejs"
            $nodeExe = Install-PortableNodeLts -InstallBaseDir $portableDir
        }

        if (-not $nodeExe -or -not (Test-Path -LiteralPath $nodeExe)) {
            throw "Node.js installation failed. Install Node.js LTS from https://nodejs.org and verify node.exe is accessible."
        }

        $nodeDir = Split-Path -Parent $nodeExe
        if ($env:Path -notlike "*$nodeDir*") {
            $env:Path = "$nodeDir;$env:Path"
        }

        $global:LASTEXITCODE = 0
        $nodeVersionRaw = (& $nodeExe -v).Trim()
        if ($LASTEXITCODE -ne 0 -or -not $nodeVersionRaw) {
            throw "Failed to execute $nodeExe -v"
        }
        $nodeMajor = 0
        if ($nodeVersionRaw -match '^v(\d+)') {
            $nodeMajor = [int]$Matches[1]
        }
        if ($nodeMajor -lt 18) {
            throw "Detected Node.js $nodeVersionRaw below minimum supported v18+."
        }

        $npmCmdPath = Join-Path $nodeDir "npm.cmd"
        if (-not (Test-Path -LiteralPath $npmCmdPath)) {
            $npmLookup = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
            if (-not $npmLookup) { $npmLookup = Get-Command "npm" -ErrorAction SilentlyContinue }
            if ($npmLookup) { $npmCmdPath = $npmLookup.Source }
        }
        if (-not $npmCmdPath -or -not (Test-Path -LiteralPath $npmCmdPath)) {
            throw "npm.cmd was not found alongside $nodeExe."
        }

        $global:LASTEXITCODE = 0
        $npmVersion = (& $npmCmdPath -v).Trim()
        if ($LASTEXITCODE -ne 0 -or -not $npmVersion) {
            throw "Failed to execute $npmCmdPath -v"
        }
        Log-Message "INFO" "Toolchain ready: Node.js $nodeVersionRaw ($nodeExe) | npm v$npmVersion"

        # 3. Regenerate Clean UTF-8 (No-BOM) package.json
        Log-Message "INFO" "[3/6] Writing clean UTF-8 (no-BOM) package.json manifest..."

        $packageJsonPath = Join-Path $engineRoot "package.json"
        $packageLockPath = Join-Path $engineRoot "package-lock.json"

        if (Test-Path -LiteralPath $packageJsonPath) {
            $backupName = "package.json.bak." + (Get-Date -Format "yyyyMMdd_HHmmss")
            Copy-Item -LiteralPath $packageJsonPath -Destination (Join-Path $engineRoot $backupName) -Force
            Log-Message "INFO" "Backed up existing package.json -> $backupName"
        }

        $cleanPackageJson = @'
{
  "name": "rocket-league-master-engine",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx server.ts",
    "start": "node server.ts",
    "build": "vite build",
    "preview": "vite preview",
    "clean": "rm -rf dist server.js",
    "lint": "tsc --noEmit",
    "tauri": "tauri"
  },
  "dependencies": {
    "@google/genai": "^2.32.0",
    "@tailwindcss/vite": "^4.3.3",
    "@tauri-apps/api": "^2.12.4",
    "@types/d3": "^7.4.3",
    "@types/jszip": "^3.4.0",
    "@vitejs/plugin-react": "^6.1.1",
    "d3": "^7.9.0",
    "dotenv": "^17.2.3",
    "express": "^4.21.2",
    "jszip": "^3.10.2",
    "lucide-react": "^0.546.0",
    "motion": "^12.23.24",
    "react": "^19.0.1",
    "react-dom": "^19.0.1",
    "recharts": "^3.10.1",
    "vite": "^8.3.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.12.4",
    "@types/express": "^4.17.21",
    "@types/node": "^22.14.0",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "autoprefixer": "^10.4.21",
    "esbuild": "^0.25.0",
    "tailwindcss": "^4.3.3",
    "tsx": "^4.21.0",
    "typescript": "^7.0.2"
  }
}
'@

        Write-Utf8NoBom -FilePath $packageJsonPath -Content ($cleanPackageJson.TrimEnd() + "`n")

        $global:LASTEXITCODE = 0
        & $nodeExe -e "JSON.parse(require('fs').readFileSync('package.json','utf8'));"
        if ($LASTEXITCODE -ne 0) {
            throw "Generated package.json failed strict JSON validation."
        }
        Log-Message "INFO" "Validated package.json (UTF-8 no-BOM)"

        # 4. Regenerate Clean package-lock.json & Install Node Modules
        Log-Message "INFO" "[4/6] Installing Node dependencies and regenerating package-lock.json..."

        $env:NODE_ENV = $null

        if (Test-Path -LiteralPath $packageLockPath) {
            Remove-Item -LiteralPath $packageLockPath -Force -ErrorAction SilentlyContinue
        }
        if ($PurgeNodeModules -and (Test-Path -LiteralPath (Join-Path $engineRoot "node_modules"))) {
            Log-Message "INFO" "CleanInstall active: pruning existing node_modules"
            Remove-Item -LiteralPath (Join-Path $engineRoot "node_modules") -Recurse -Force -ErrorAction SilentlyContinue
        }

        $installSuccess = $false
        $global:LASTEXITCODE = 0
        & $npmCmdPath install --include=dev --no-audit --no-fund --loglevel=error
        if ($LASTEXITCODE -eq 0) {
            $installSuccess = $true
        } else {
            Log-Message "WARN" "Initial npm install failed; clearing npm cache and retrying"
            & $npmCmdPath cache clean --force | Out-Null
            if (Test-Path -LiteralPath $packageLockPath) {
                Remove-Item -LiteralPath $packageLockPath -Force -ErrorAction SilentlyContinue
            }
            $global:LASTEXITCODE = 0
            & $npmCmdPath install --include=dev --no-audit --no-fund --loglevel=error
            if ($LASTEXITCODE -eq 0) {
                $installSuccess = $true
            }
        }

        if (-not $installSuccess) {
            throw "npm install failed after cache clean retry. Verify connectivity and permissions."
        }

        if (-not (Test-Path -LiteralPath $packageLockPath)) {
            Log-Message "INFO" "Writing standalone package-lock.json manifest"
            $global:LASTEXITCODE = 0
            & $npmCmdPath install --package-lock-only --include=dev --no-audit --no-fund --loglevel=error
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to generate package-lock.json manifest."
            }
        }

        if (-not (Test-Path -LiteralPath $packageLockPath)) {
            throw "package-lock.json was not generated."
        }

        $global:LASTEXITCODE = 0
        & $nodeExe -e "JSON.parse(require('fs').readFileSync('package-lock.json','utf8'));"
        if ($LASTEXITCODE -ne 0) {
            throw "Generated package-lock.json failed strict JSON validation."
        }
        Log-Message "INFO" "Validated package-lock.json and node_modules"

        # 5. Native Windows Toolchains (Rust/MSVC, Python .venv, PowerShell Module)
        Log-Message "INFO" "[5/6] Checking native Windows toolchains (Rust / MSVC / Python)..."

        if ((-not (Test-CommandAvailable "cargo") -or -not (Test-CommandAvailable "rustup")) -and (Test-CommandAvailable "winget")) {
            Log-Message "INFO" "Installing Rustup via winget (optional for EXE packaging)"
            try {
                & winget install --id Rustlang.Rustup -e --silent --accept-source-agreements --accept-package-agreements | Out-Null
                Refresh-SessionPath -RootDir $engineRoot
            } catch {
                Log-Message "WARN" "Winget Rust install skipped; continuing setup"
            }
        }

        if (Test-CommandAvailable "rustup") {
            try {
                & rustup target add x86_64-pc-windows-msvc 2>$null | Out-Null
                & rustup default stable-x86_64-pc-windows-msvc 2>$null | Out-Null
                Log-Message "INFO" "Rust MSVC target ready (stable-x86_64-pc-windows-msvc)"
            } catch {
                Log-Message "WARN" "Could not set rustup default target; continuing"
            }
        }

        $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
        $hasVCTools = $false
        if (Test-Path -LiteralPath $vswhere) {
            $vcInst = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
            if ($vcInst) { $hasVCTools = $true }
        }
        if ($hasVCTools) {
            Log-Message "INFO" "Visual Studio C++ MSVC Build Tools verified"
        } else {
            Log-Message "WARN" "MSVC Build Tools not detected (only required when compiling Tauri .exe)"
        }

        $pyCmd = if (Test-CommandAvailable "py") { "py" } elseif (Test-CommandAvailable "python") { "python" } else { $null }
        if ($pyCmd -and -not $SkipPythonVenv) {
            $venvDir = Join-Path $engineRoot ".venv"
            if (-not (Test-Path -LiteralPath $venvDir)) {
                try {
                    if ($pyCmd -eq "py") { & py -3 -m venv $venvDir } else { & python -m venv $venvDir }
                } catch {
                    Log-Message "WARN" "Python .venv creation skipped"
                }
            }
            $venvPip = Join-Path $venvDir "Scripts\pip.exe"
            if (Test-Path -LiteralPath $venvPip) {
                & $venvPip install --quiet --upgrade pip 2>$null
                & $venvPip install --quiet sqlite-utils numpy pandas 2>$null
                Log-Message "INFO" "Python .venv telemetry libraries verified"
            }
        }

        $psm1Source = Join-Path $engineRoot "FNProEngine.psm1"
        if (Test-Path -LiteralPath $psm1Source) {
            $profileDir = Split-Path -Path $PROFILE -Parent
            if ($profileDir -and -not (Test-Path -LiteralPath $profileDir)) {
                New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
            }
            if ($profileDir) {
                $moduleDest = Join-Path $profileDir "FNProEngine.psm1"
                Copy-Item -LiteralPath $psm1Source -Destination $moduleDest -Force
                Log-Message "INFO" "Registered FNProEngine.psm1 -> $moduleDest"
            }
        }

        # 6. Final Build Verification Check
        Log-Message "INFO" "[6/6] Running TypeScript lint and Vite production build..."

        $global:LASTEXITCODE = 0
        & $npmCmdPath run lint
        if ($LASTEXITCODE -ne 0) {
            throw "TypeScript lint check (npm run lint) failed."
        }

        $global:LASTEXITCODE = 0
        & $npmCmdPath run build
        if ($LASTEXITCODE -ne 0) {
            throw "Production build (npm run build) failed."
        }

        Log-Message "INFO" "Setup and build verified in $engineRoot ($nodeVersionRaw). Run 'npm run dev' or '.\build_windows_exe.ps1'."
    } catch {
        Log-Message "ERROR" $_.Exception.Message
        exit 1
    }
}

Invoke-FnProSetup `
    -RequestedProjectPath $ProjectPath `
    -SkipPythonVenv ([bool]$SkipVenv) `
    -ElevateAdmin ([bool]$ForceAdmin) `
    -PurgeNodeModules ([bool]$CleanInstall) `
    -QuietMode ([bool]$Quiet)
