# Rocket Engine

A native Windows engineering utility for Rocket League input analysis and telemetry, built with React, TypeScript, Vite, Tauri 2, and Rust.

**Repository:** [userfn-git/Rocket-engine](https://github.com/userfn-git/Rocket-engine)  
**Platform:** Windows 11 (64-bit)  
**Author:** fnprod (`fnprospace@gmail.com`)  
**Status:** Active development

---

## Overview

Rocket Engine provides visualization and analysis tools for steering, pitch, roll, and mechanics timing. The application combines a React interface with native Windows and Tauri components for low-level input inspection and local telemetry storage.

## Features

- Continuous normalized steering, pitch, and roll values
- Symmetric deadzone and exponent curves
- Supersonic and steering-state analysis
- Polar input visualization and cross-axis torque tracking
- Local Rocket League mechanics codex with frame timing
- Logitech G-HUB Lua script generation and syntax validation
- Windows hardware identity extraction
- Local SQLite telemetry storage with WAL mode
- Source archiving and PowerShell setup/build utilities

See [ARCHITECTURE.md](ARCHITECTURE.md) for implementation details.

---

## Technology Stack

- React 19 and TypeScript
- Vite and Tailwind CSS
- Tauri 2 and Rust
- Node.js and npm
- PowerShell
- SQLite
- Lua
- C/C++ native components

---

## Prerequisites

- Windows 11 64-bit
- Node.js 18 or newer
- npm
- Rust and Cargo (for native/Tauri builds)
- Microsoft Visual C++ Build Tools (for compiling Tauri and native components)
- PowerShell 5.1 or newer
- Windows administrator privileges for system-level setup

> The setup script can locate or install Node.js, but Rust and Microsoft Visual C++ Build Tools are needed for native builds.

---

## Quick Start

From an elevated PowerShell prompt in the repository root:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\install_dependencies.ps1
```

The setup script:

1. Resolves and registers `FNPRO_ENGINE_HOME`
2. Checks or provisions Node.js LTS
3. Validates and regenerates npm manifests
4. Installs npm dependencies
5. Checks Rust, MSVC, Python, and PowerShell tooling
6. Runs `npm run lint` and `npm run build`

To rerun without preserving existing `node_modules`:

```powershell
.\install_dependencies.ps1 -CleanInstall
```

For additional script options:

```powershell
Get-Help .\install_dependencies.ps1 -Detailed
```

---

## Development

```powershell
npm install
npm run dev
```

Before opening a pull request:

```powershell
npm run lint
npm run build
```

Build the native Windows executable with:

```powershell
.\build_windows_exe.ps1
```

Preview a production web build:

```powershell
npm run preview
```

---

## Available npm Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the local development server |
| `npm run build` | Create a Vite production build |
| `npm run preview` | Preview the production build |
| `npm run lint` | Run TypeScript checking |
| `npm run tauri` | Run Tauri CLI commands |
| `npm start` | Start the application server |

---

## Local Paths

| Purpose | Path |
|---|---|
| Project environment | `FNPRO_ENGINE_HOME` |
| Application data | `%APPDATA%\FNProMasterEngine` |
| Temporary buffers | `%TEMP%\FNProMasterEngine` |
| Telemetry database | `%APPDATA%\FNProMasterEngine\fnpro_telemetry.db` |
| G-HUB Lua scripts | `%LOCALAPPDATA%\LGHUB\scripts\{UUID}\script.lua` |
| Rocket League demos | `%USERPROFILE%\Documents\My Games\Rocket League\TAGame\Demos` |

Do not commit credentials, generated vault files, local databases, or hardware identifiers.

---

## Security

Local credentials and hardware-derived identifiers are sensitive. Do not share them or use public issue reports to publish generated data.

Review [SECURITY.md](SECURITY.md) before reporting or testing security behavior. Use the repository’s private vulnerability-reporting channel when available.

---

## Project Structure

```text
src/          React and TypeScript application code
src-tauri/    Tauri and Rust native integration
public/       Static web assets
server.ts     Local development server
package.json  npm scripts and dependencies
```

Additional documentation:

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [SECURITY.md](SECURITY.md)

---

## Troubleshooting

### PowerShell execution policy

Use the process-scoped policy shown in Quick Start, or review your organization’s execution-policy settings:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### Node.js not detected

Install Node.js from <https://nodejs.org/> and reopen PowerShell so the updated `PATH` is loaded. The setup script also has a portable Node.js fallback.

### Native build tools missing

Install Visual Studio with the **Desktop development with C++** workload or the equivalent Microsoft Visual C++ Build Tools. Then verify Rust:

```powershell
rustc --version
cargo --version
```

### G-HUB script not appearing

Confirm that Logitech G-HUB is installed and running, then use the application’s Lua syntax validation before deployment.

---

## Contributing

1. Create a dedicated branch.
2. Make focused changes.
3. Run `npm run lint` and `npm run build`.
4. Test native changes on Windows when applicable.
5. Open a pull request with setup or behavior changes clearly documented.

## License

No license file is currently published in this repository. All rights remain with the repository owner until a license is added.
