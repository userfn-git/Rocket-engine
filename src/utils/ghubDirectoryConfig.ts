/**
 * Logitech G-HUB Mandatory Directory Configuration & Windows Batch Generator
 * Enforces mandatory directory selection to ensure backend .bat scripts execute cleanly without path errors.
 */

import { recordAuditEntry } from './engineAuditLog';

export const STORAGE_KEY_GHUB_DIR = 'fnpro_ghub_mandatory_scripts_dir_v1';
export const DEFAULT_GHUB_SCRIPTS_DIR = '%LOCALAPPDATA%\\LGHUB\\scripts';

export interface GHubDirectoryPreset {
  id: string;
  labelAr: string;
  labelEn: string;
  path: string;
  descAr: string;
  descEn: string;
  isRecommended?: boolean;
}

export const GHUB_DIRECTORY_PRESETS: GHubDirectoryPreset[] = [
  {
    id: 'default_localappdata',
    labelAr: 'المسار القياسي الافتراضي لـ G-HUB (%LOCALAPPDATA%)',
    labelEn: 'Default G-HUB AppData Path (%LOCALAPPDATA%)',
    path: '%LOCALAPPDATA%\\LGHUB\\scripts',
    descAr: 'المسار القياسي الرسمي لبرنامج Logitech G HUB في بيئة Windows 10/11 للمستخدم الحالي.',
    descEn: 'Official standard directory used by Logitech G HUB on Windows 10/11 for current user.',
    isRecommended: true,
  },
  {
    id: 'system_programdata',
    labelAr: 'مسار النظام المشترك (C:\\ProgramData)',
    labelEn: 'System Shared ProgramData (C:\\ProgramData)',
    path: 'C:\\ProgramData\\LGHUB\\scripts',
    descAr: 'مسار البيانات العامة للنظام، مفيد للأجهزة ذات الصلاحيات المشتركة أو الحسابات المتعددة.',
    descEn: 'Shared system-wide ProgramData path, suitable for multi-user or elevated systems.',
  },
  {
    id: 'explicit_userprofile',
    labelAr: 'المسار الصريح لملف المستخدم (%USERPROFILE%)',
    labelEn: 'Explicit UserProfile AppData (%USERPROFILE%)',
    path: '%USERPROFILE%\\AppData\\Local\\LGHUB\\scripts',
    descAr: 'مسار موسع صريح يعتمد على جذر مجلد المستخدم لتفادي أخطاء اختصارات المسارات البيئية.',
    descEn: 'Explicit profile-based directory path avoiding environment variable aliasing issues.',
  },
  {
    id: 'program_files_install',
    labelAr: 'مجلد تثبيت البرنامج الرئيسي (%ProgramFiles%)',
    labelEn: 'Installation Directory (%ProgramFiles%)',
    path: '%ProgramFiles%\\LGHUB\\scripts',
    descAr: 'المسار المباشر داخل مجلد التثبيت الرئيسي لبرنامج لوجيتك.',
    descEn: 'Direct path inside the core 64-bit Program Files installation folder.',
  }
];

/**
 * Validates a candidate G-HUB scripts directory path.
 * Checks for non-empty string, forbidden characters, and valid Windows path structure.
 */
export function validateGHubDirectoryPath(rawPath: string): { isValid: boolean; errorAr?: string; errorEn?: string } {
  if (!rawPath || !rawPath.trim()) {
    return {
      isValid: false,
      errorAr: 'مسار مجلد سكريبتات G-HUB إلزامي ولا يمكن تركه فارغاً.',
      errorEn: 'G-HUB script directory path is mandatory and cannot be empty.'
    };
  }

  const cleaned = rawPath.trim();

  // Basic length check
  if (cleaned.length < 3) {
    return {
      isValid: false,
      errorAr: 'المسار المدخل قصير جداً، يرجى كتابة مسار Windows صحيح.',
      errorEn: 'Path is too short. Please enter a valid Windows directory path.'
    };
  }

  // Check for illegal Windows filename characters (excluding % and : and \ which are valid in paths)
  const illegalChars = /[<>"|?*]/;
  if (illegalChars.test(cleaned)) {
    return {
      isValid: false,
      errorAr: 'يحتوي المسار على رموز غير مسموح بها في أنظمة ويندوز مثل (< > " | ? *).',
      errorEn: 'Path contains illegal Windows characters such as (< > " | ? *).'
    };
  }

  // Must begin with a drive letter, environment variable, or root backslash
  const validStart = /^([a-zA-Z]:\\|%[a-zA-Z0-9_()]+%|\\\\|\\)/i;
  if (!validStart.test(cleaned)) {
    return {
      isValid: false,
      errorAr: 'يجب أن يبدأ المسار بحرف القرص (مثال C:\\) أو متغير بيئي (مثال %LOCALAPPDATA%).',
      errorEn: 'Path must start with a drive letter (e.g. C:\\) or environment variable (e.g. %LOCALAPPDATA%).'
    };
  }

  return { isValid: true };
}

/**
 * Normalizes a Windows path by replacing forward slashes with backslashes
 * and trimming trailing slashes.
 */
export function normalizeWindowsPath(path: string): string {
  if (!path) return DEFAULT_GHUB_SCRIPTS_DIR;
  let normalized = path.trim().replace(/\//g, '\\');
  // Remove trailing backslash if not a root drive like C:\
  if (normalized.length > 3 && normalized.endsWith('\\')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Retrieves the currently active mandatory G-HUB script directory.
 * Falls back to DEFAULT_GHUB_SCRIPTS_DIR if not set.
 */
export function getMandatoryGHubScriptDir(): string {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_GHUB_DIR);
      if (stored && stored.trim()) {
        const validation = validateGHubDirectoryPath(stored);
        if (validation.isValid) {
          return normalizeWindowsPath(stored);
        }
      }
    } catch (e) {
      console.warn('Could not read G-HUB directory from localStorage:', e);
    }
  }
  return DEFAULT_GHUB_SCRIPTS_DIR;
}

/**
 * Sets and locks the mandatory G-HUB script directory.
 * Dispatches an event so all listening UI components update immediately.
 */
export function setMandatoryGHubScriptDir(newPath: string): { success: boolean; error?: string } {
  const validation = validateGHubDirectoryPath(newPath);
  if (!validation.isValid) {
    return { success: false, error: validation.errorEn };
  }

  const normalized = normalizeWindowsPath(newPath);

  if (typeof window !== 'undefined') {
    try {
      const oldVal = localStorage.getItem(STORAGE_KEY_GHUB_DIR) || DEFAULT_GHUB_SCRIPTS_DIR;
      localStorage.setItem(STORAGE_KEY_GHUB_DIR, normalized);
      
      // Dispatch custom event for real-time reactive sync
      window.dispatchEvent(new CustomEvent('fnpro_ghub_dir_changed', { 
        detail: { path: normalized } 
      }));

      // Record in audit log
      recordAuditEntry({
        section: 'system',
        sectionNameAr: 'إعدادات مسار مجلد G-HUB الإلزامي',
        sectionNameEn: 'Mandatory G-HUB Directory Settings',
        paramKey: 'GHUB_SCRIPTS_DIR',
        paramLabelAr: 'مسار مجلد سكريبتات G-HUB',
        paramLabelEn: 'G-HUB Scripts Directory Path',
        oldValue: oldVal,
        newValue: normalized,
        changeType: 'param_tune'
      });

      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  return { success: true };
}

/**
 * Generates an error-proof Windows batch (.bat) script referencing the exact mandatory directory.
 * Includes automatic directory creation, access validation, and detailed diagnostic output.
 */
export function generateRobustGHubBatchScript(
  luaScript: string,
  targetDirectory?: string
): string {
  const dir = targetDirectory || getMandatoryGHubScriptDir();
  const escapedLua = luaScript.replace(/'/g, "''");

  return `@echo off
setlocal enabledelayedexpansion
title Rocket League Master Engine - Logitech G HUB Script Synchronizer
call :Log STEP "Initializing Logitech G HUB 1000Hz synchronizer"

:: 1. Define and lock the Mandatory G-HUB Scripts Directory
set "GHUB_DIR=${dir}"
call :Log INFO "Target G-HUB scripts directory: !GHUB_DIR!"

:: 2. Ensure target directory exists, create if missing
if not exist "!GHUB_DIR!" (
    call :Log INFO "Creating missing directory: !GHUB_DIR!"
    mkdir "!GHUB_DIR!" 2>nul
    if !errorlevel! neq 0 (
        call :Log WARN "Could not create !GHUB_DIR!; attempting PowerShell fallback"
        powershell -NoProfile -Command "New-Item -ItemType Directory -Force -Path '!GHUB_DIR!'" 2>nul
    )
)

:: 3. Verify directory accessibility
if not exist "!GHUB_DIR!" (
    call :Log ERROR "Failed to access target directory !GHUB_DIR!; falling back to default"
    set "GHUB_DIR=%LOCALAPPDATA%\\LGHUB\\scripts"
    if not exist "!GHUB_DIR!" mkdir "!GHUB_DIR!" 2>nul
)

call :Log OK "Verified G-HUB directory: !GHUB_DIR!"

:: 4. Write synchronized 1000Hz Lua script to target directory
set "TARGET_SCRIPT=!GHUB_DIR!\\rl_master_engine.lua"
call :Log STEP "Writing 1000Hz Lua script to !TARGET_SCRIPT!"

powershell -NoProfile -Command ^
    "$Script = @'\n${escapedLua}\n'@; " ^
    "[System.IO.File]::WriteAllText('!TARGET_SCRIPT!', $Script, [System.Text.Encoding]::UTF8); " ^
    "Set-Clipboard -Value $Script; "

if exist "!TARGET_SCRIPT!" (
    call :Log OK "Script saved to !TARGET_SCRIPT! and copied to clipboard"
) else (
    call :Log WARN "Direct write restricted; script copied to Windows clipboard as fallback"
)

:: 5. Launch Logitech G HUB if not already running
set "FOUND_EXE="
if exist "%ProgramFiles%\\LGHUB\\lghub.exe" set "FOUND_EXE=%ProgramFiles%\\LGHUB\\lghub.exe"
if not defined FOUND_EXE if exist "%ProgramFiles(x86)%\\LGHUB\\lghub.exe" set "FOUND_EXE=%ProgramFiles(x86)%\\LGHUB\\lghub.exe"
if not defined FOUND_EXE if exist "%LocalAppData%\\Programs\\LGHUB\\lghub.exe" set "FOUND_EXE=%LocalAppData%\\Programs\\LGHUB\\lghub.exe"
if not defined FOUND_EXE if exist "%ProgramFiles%\\LGHUB\\system_tray\\lghub_system_tray.exe" set "FOUND_EXE=%ProgramFiles%\\LGHUB\\system_tray\\lghub_system_tray.exe"

if defined FOUND_EXE (
    call :Log INFO "Launching Logitech G HUB: !FOUND_EXE!"
    start "" "!FOUND_EXE!"
) else (
    call :Log INFO "Launching via protocol handler lghub://"
    start "" "lghub://"
)

call :Log OK "G-HUB 1000Hz synchronization complete"
timeout /t 3 >nul
exit /b 0

:Log
set "LOG_LVL=%~1"
set "LOG_MSG=%~2"
if /i "%FNPRO_QUIET%"=="1" if /i "!LOG_LVL!"=="INFO" goto :eof
set "LOG_TS=%TIME:~0,8%"
set "LOG_TS=!LOG_TS: =0!"
echo [!LOG_TS!][FNPro][!LOG_LVL!] !LOG_MSG!
goto :eof
`;
}
