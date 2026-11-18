import { GameProfile, KeyBinding, MacroTimingConfig, PhysicsConfig } from '../types/engine';
import {
  INITIAL_GAME_PROFILES,
  INITIAL_KEYBINDINGS,
  INITIAL_MACRO_TIMINGS,
  INITIAL_PHYSICS_CONFIG,
} from '../data/initialData';
import { generateTAInputIni, generatePowerShellInstaller } from '../utils/iniGenerator';
import { generateLuaScript } from '../utils/luaGenerator';
import { generatePythonQtScript } from '../utils/pythonQtGenerator';
import { generateStandalonePackagingBundle } from './tauriLocalBridge';
import { getMandatoryGHubScriptDir } from '../utils/ghubDirectoryConfig';
import { saveNativeConfig } from './gemini';
import {
  compileDynamicZoneBundle,
  generateLiveSyncedDualAxisLua,
  generateLiveSyncedMacroBridgeLua,
} from './autonomousPipelineEngine';

export const UNIFIED_MASTER_PROFILE_STORAGE_KEY = 'fnpro_unified_master_profile_v4';
export const UNIFIED_ARM_SCHEMA_VERSION = '4.2.0-unified-arm';

export interface UnifiedCompiledArtifacts {
  taInputIni: string;
  ghubLuaScript: string;
  pythonQtEngine: string;
  powershellInstaller: string;
  buildWindowsExePs1: string;
  zoneMomentumHpp: string;
  zoneMomentumLua: string;
  activeZoneInputJson: string;
  dualAxisVectorLua: string;
  macroBridgeLua: string;
}

export interface UnifiedMasterProfileArm {
  schemaVersion: string;
  updatedAt: string;
  activeProfile: GameProfile;
  physicsConfig: PhysicsConfig;
  keybindings: KeyBinding[];
  macroTimings: MacroTimingConfig;
  hardware: {
    pollingHz: number;
    ghubScriptsDir: string;
    autoMuteControllers: boolean;
  };
  compiledArtifacts: UnifiedCompiledArtifacts;
}

/**
 * Synchronizes the active GameProfile's override fields and customBindings
 * with live PhysicsConfig and KeyBinding[] so the entire app shares a single profile arm.
 */
export function syncProfilesWithPhysicsAndBindings(
  profiles: GameProfile[],
  activeProfileId: string,
  physicsConfig: PhysicsConfig,
  keybindings: KeyBinding[]
): GameProfile[] {
  const sourceList = profiles.length > 0 ? profiles : INITIAL_GAME_PROFILES;
  const customBindingsMap: Record<string, string> = {};
  for (const kb of keybindings) {
    if (kb.layer === 0) {
      customBindingsMap[kb.id] = kb.key;
    }
  }

  return sourceList.map((profile, idx) => {
    const isTarget = profile.id === activeProfileId || (!sourceList.some((p) => p.id === activeProfileId) && idx === 0);
    if (!isTarget) return profile;

    return {
      ...profile,
      deadzoneOverride: physicsConfig.internalDeadzone,
      aerialSenseOverride: physicsConfig.aerialSense,
      customBindings: customBindingsMap,
    };
  });
}

/**
 * Builds the complete, dynamically compiled Unified Master Profile Arm
 * binding physics, Layer 0 keybindings, macro timings, hardware paths, and all generated files.
 */
export function buildUnifiedMasterProfileSnapshot(params: {
  profiles?: GameProfile[];
  activeProfileId?: string;
  physicsConfig?: PhysicsConfig;
  keybindings?: KeyBinding[];
  macroTimings?: MacroTimingConfig;
  ghubScriptsDir?: string;
  autoMuteControllers?: boolean;
}): UnifiedMasterProfileArm {
  const profiles = params.profiles && params.profiles.length > 0 ? params.profiles : INITIAL_GAME_PROFILES;
  const activeProfileId = params.activeProfileId || profiles[0]?.id || 'my_unified_profile';
  const physicsConfig = params.physicsConfig || INITIAL_PHYSICS_CONFIG;
  const keybindings = params.keybindings && params.keybindings.length > 0 ? params.keybindings : INITIAL_KEYBINDINGS;
  const macroTimings = params.macroTimings || INITIAL_MACRO_TIMINGS;

  const syncedProfiles = syncProfilesWithPhysicsAndBindings(
    profiles,
    activeProfileId,
    physicsConfig,
    keybindings
  );
  const activeProfile =
    syncedProfiles.find((p) => p.id === activeProfileId) || syncedProfiles[0];

  const taInputIni = generateTAInputIni(activeProfile, physicsConfig, keybindings);
  const ghubLuaScript = generateLuaScript(physicsConfig, keybindings, macroTimings);
  const pythonQtEngine = generatePythonQtScript(physicsConfig, keybindings, macroTimings);
  const powershellInstaller = generatePowerShellInstaller(activeProfile, taInputIni);
  const buildWindowsExePs1 = generateStandalonePackagingBundle().buildPs1;
  const compiledZone = compileDynamicZoneBundle(physicsConfig);
  const dualAxisVectorLua = generateLiveSyncedDualAxisLua(physicsConfig);
  const macroBridgeLua = generateLiveSyncedMacroBridgeLua(macroTimings);

  let ghubScriptsDir = params.ghubScriptsDir || '';
  if (!ghubScriptsDir) {
    try {
      ghubScriptsDir = getMandatoryGHubScriptDir();
    } catch {
      ghubScriptsDir = '%LOCALAPPDATA%\\LGHUB\\scripts';
    }
  }

  let autoMuteControllers = params.autoMuteControllers ?? true;
  if (params.autoMuteControllers === undefined && typeof window !== 'undefined' && window.localStorage) {
    try {
      autoMuteControllers = localStorage.getItem('fnpro_auto_mute_controllers') !== 'false';
    } catch {}
  }

  return {
    schemaVersion: UNIFIED_ARM_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    activeProfile,
    physicsConfig,
    keybindings,
    macroTimings,
    hardware: {
      pollingHz: physicsConfig.pollingRateAdj <= 1 ? 1000 : Math.round(1000 / physicsConfig.pollingRateAdj),
      ghubScriptsDir,
      autoMuteControllers,
    },
    compiledArtifacts: {
      taInputIni,
      ghubLuaScript,
      pythonQtEngine,
      powershellInstaller,
      buildWindowsExePs1,
      zoneMomentumHpp: compiledZone.zoneMomentumHpp,
      zoneMomentumLua: compiledZone.zoneMomentumLua,
      activeZoneInputJson: compiledZone.activeZoneInputJson,
      dualAxisVectorLua,
      macroBridgeLua,
    },
  };
}

/**
 * Loads the persisted Unified Master Profile Arm from browser storage when valid.
 */
export function loadUnifiedMasterProfileSnapshot(): Partial<UnifiedMasterProfileArm> | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = localStorage.getItem(UNIFIED_MASTER_PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UnifiedMasterProfileArm>;
    if (
      parsed &&
      parsed.physicsConfig &&
      typeof parsed.physicsConfig.curveExponent === 'number' &&
      Array.isArray(parsed.keybindings) &&
      parsed.macroTimings?.fastAerial
    ) {
      return parsed;
    }
  } catch {
    // Ignore malformed storage snapshot
  }
  return null;
}

let pendingSyncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Persists the Unified Master Profile Arm atomically across local storage,
 * Tauri native %APPDATA% storage, and localhost server /api/profile/unified.
 */
export function persistUnifiedMasterProfileArm(arm: UnifiedMasterProfileArm): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      localStorage.setItem(UNIFIED_MASTER_PROFILE_STORAGE_KEY, JSON.stringify(arm));
    } catch {}
  }

  saveNativeConfig(
    JSON.stringify({
      schemaVersion: arm.schemaVersion,
      activeProfile: arm.activeProfile,
      physicsConfig: arm.physicsConfig,
      keybindings: arm.keybindings,
      macroTimings: arm.macroTimings,
      hardware: arm.hardware,
      updatedAt: arm.updatedAt,
    })
  ).catch(() => {});

  if (typeof window !== 'undefined') {
    if (pendingSyncTimer) clearTimeout(pendingSyncTimer);
    pendingSyncTimer = setTimeout(() => {
      fetch('/api/profile/unified', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: arm.schemaVersion,
          updatedAt: arm.updatedAt,
          activeProfile: arm.activeProfile,
          physicsConfig: arm.physicsConfig,
          keybindings: arm.keybindings,
          macroTimings: arm.macroTimings,
          hardware: arm.hardware,
        }),
      }).catch(() => {});
    }, 250);
  }
}
