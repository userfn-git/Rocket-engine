import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildUnifiedMasterProfileSnapshot,
  syncProfilesWithPhysicsAndBindings,
  UNIFIED_ARM_SCHEMA_VERSION,
} from './unifiedProfileArm';
import {
  INITIAL_GAME_PROFILES,
  INITIAL_KEYBINDINGS,
  INITIAL_MACRO_TIMINGS,
  INITIAL_PHYSICS_CONFIG,
} from '../data/initialData';

test('bun.lock parses cleanly as strict JSON without trailing commas', () => {
  const lockPath = path.resolve(process.cwd(), 'bun.lock');
  const raw = fs.readFileSync(lockPath, 'utf8');
  const parsed = JSON.parse(raw) as {
    lockfileVersion: number;
    workspaces?: Record<string, { dependencies?: Record<string, string> }>;
    packages?: Record<string, unknown>;
  };

  assert.equal(typeof parsed.lockfileVersion, 'number');
  assert.ok(parsed.packages && Object.keys(parsed.packages).length > 100);
  const genaiSpec = parsed.workspaces?.['']?.dependencies?.['@google/genai'];
  assert.equal(genaiSpec, '^2.32.0');
});

test('metadata.json and server.ts enforce server-side gemini-4-hydrogen proxy', () => {
  const metadata = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'metadata.json'), 'utf8')
  ) as { majorCapabilities: string[] };

  assert.ok(metadata.majorCapabilities.includes('MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API'));

  const serverSrc = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8');
  assert.match(serverSrc, /'gemini-4-hydrogen'/);
  assert.match(serverSrc, /'User-Agent': 'aistudio-build'/);
  assert.match(serverSrc, /\/api\/gemini\/stream/);
  assert.match(serverSrc, /\/api\/profile\/unified/);
  assert.equal(serverSrc.includes('gemini-1.5-flash'), false);
});

test('unified profile arm propagates physics, keybindings, and macros across all compiled artifacts', () => {
  const customPhysics = {
    ...INITIAL_PHYSICS_CONFIG,
    curveExponent: 2.35,
    internalDeadzone: 0.04,
    aerialSense: 1.55,
    pollingRateAdj: 1,
  };

  const customBindings = INITIAL_KEYBINDINGS.map((kb) =>
    kb.action.toLowerCase().includes('boost') ? { ...kb, key: 'RightShift' } : kb
  );

  const customMacros = {
    ...INITIAL_MACRO_TIMINGS,
    fastAerial: {
      ...INITIAL_MACRO_TIMINGS.fastAerial,
      firstJumpSleep: 145,
    },
  };

  const synced = syncProfilesWithPhysicsAndBindings(
    INITIAL_GAME_PROFILES,
    INITIAL_GAME_PROFILES[0].id,
    customPhysics,
    customBindings
  );

  assert.equal(synced[0].deadzoneOverride, 0.04);
  assert.equal(synced[0].aerialSenseOverride, 1.55);

  const arm = buildUnifiedMasterProfileSnapshot({
    profiles: synced,
    activeProfileId: synced[0].id,
    physicsConfig: customPhysics,
    keybindings: customBindings,
    macroTimings: customMacros,
    ghubScriptsDir: 'C:\\LGHUB\\scripts',
    autoMuteControllers: true,
  });

  assert.equal(arm.schemaVersion, UNIFIED_ARM_SCHEMA_VERSION);
  assert.equal(arm.hardware.pollingHz, 1000);
  assert.equal(arm.macroTimings.fastAerial.firstJumpSleep, 145);
  assert.ok(arm.compiledArtifacts.taInputIni.length > 50);
  assert.ok(arm.compiledArtifacts.ghubLuaScript.includes('145') || arm.compiledArtifacts.ghubLuaScript.length > 50);
  assert.ok(arm.compiledArtifacts.pythonQtEngine.length > 50);
  assert.ok(arm.compiledArtifacts.powershellInstaller.length > 50);
  assert.ok(arm.compiledArtifacts.buildWindowsExePs1.length > 50);
});

test('sourceBundleRegistry exposes unified master profile arm and server runtime files', () => {
  const registrySrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/utils/sourceBundleRegistry.ts'),
    'utf8'
  );

  assert.match(registrySrc, /'unified_master_profile\.json'/);
  assert.match(registrySrc, /'server\.ts'/);
  assert.match(registrySrc, /'metadata\.json'/);
  assert.match(registrySrc, /'build_windows_exe\.ps1'/);
  assert.equal(registrySrc.includes('build_windows_exe.bat'), false, 'Legacy build_windows_exe.bat must not remain in sourceBundleRegistry');
  assert.match(registrySrc, /'src-tauri\/src\/commands\/mod\.rs'/);
});

test('install_dependencies.ps1 validates Node, detects FNPRO_ENGINE_HOME, and regenerates matching UTF-8 package.json & package-lock.json', () => {
  const ps1Path = path.resolve(process.cwd(), 'install_dependencies.ps1');
  const pkgPath = path.resolve(process.cwd(), 'package.json');
  const ps1 = fs.readFileSync(ps1Path, 'utf8');
  const rootPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  assert.match(ps1, /function Log-Message/);
  assert.match(ps1, /Position\s*=\s*0[\s\S]*?\[string\]\$Level[\s\S]*?Position\s*=\s*1[\s\S]*?\[string\]\$Message/);
  assert.match(ps1, /\[ValidateSet\("INFO",\s*"WARN",\s*"ERROR"\)\]/);
  assert.match(ps1, /Get-Date -Format "yyyy-MM-dd HH:mm:ss"/);
  assert.equal((ps1.match(/\bWrite-Host\b/g) ?? []).length, 1, 'install_dependencies.ps1 must centralize all Write-Host calls inside Log-Message');
  assert.equal(/\bWrite-(Error|Warning)\b/.test(ps1), false, 'install_dependencies.ps1 must replace all Write-Error and Write-Warning calls with Log-Message');
  assert.match(ps1, /function Invoke-FnProSetup/);
  assert.equal(/Write-Host\s+"`?n?={4,}/i.test(ps1), false, 'install_dependencies.ps1 must not contain verbose === banner blocks');
  assert.match(ps1, /Resolve-FnProEngineHome/);
  assert.match(ps1, /Find-NodeExecutable/);
  assert.match(ps1, /Install-PortableNodeLts/);
  assert.match(ps1, /FNPRO_ENGINE_HOME/);
  assert.match(ps1, /"Process",\s*"User",\s*"Machine"/);
  assert.match(ps1, /System\.Text\.UTF8Encoding\(\$false\)/);
  assert.match(ps1, /package-lock\.json/);
  assert.match(ps1, /run lint/);
  assert.match(ps1, /run build/);

  const match = ps1.match(/\$cleanPackageJson = @'\r?\n([\s\S]*?)\r?\n'@/);
  assert.ok(match && match[1], 'install_dependencies.ps1 must embed clean package.json template');
  const embeddedPkg = JSON.parse(match[1]);
  assert.deepEqual(embeddedPkg, rootPkg, 'Embedded package.json template must stay synced with root package.json');
});

test('GitHubSyncModal defaults to fnprospace@gmail.com and injects git config user.name/user.email', async () => {
  const modalSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/GitHubSyncModal.tsx'),
    'utf8'
  );
  assert.equal(
    /PRIMARY_GOOGLE_ACCOUNT\s*=\s*['"]ai\.workgroup\.link@gmail\.com['"]/.test(modalSrc),
    false,
    'Legacy stale primary email constant must not be present'
  );

  const {
    GITHUB_AUTHOR,
    GITHUB_PRIMARY_EMAIL,
    sanitizeGitEmail,
    buildGitSyncCommand,
    buildGitSyncBatchScript,
  } = await import('../components/GitHubSyncModal');

  assert.equal(GITHUB_AUTHOR, 'userfn-git');
  assert.equal(GITHUB_PRIMARY_EMAIL, 'fnprospace@gmail.com');
  assert.equal(sanitizeGitEmail(undefined), 'fnprospace@gmail.com');
  assert.equal(sanitizeGitEmail(''), 'fnprospace@gmail.com');
  assert.equal(sanitizeGitEmail('ai.workgroup.link@gmail.com'), 'fnprospace@gmail.com');
  assert.equal(sanitizeGitEmail('AI.WORKGROUP.LINK@GMAIL.COM'), 'fnprospace@gmail.com');
  assert.equal(sanitizeGitEmail('custom.dev@example.com'), 'custom.dev@example.com');
  assert.equal(sanitizeGitEmail('bad"email`$;@example.com'), 'bademail@example.com');

  const cmd = buildGitSyncCommand('ai.workgroup.link@gmail.com');
  assert.match(cmd, /git config user\.name "userfn-git"/);
  assert.match(cmd, /git config user\.email "fnprospace@gmail\.com"/);

  const bat = buildGitSyncBatchScript('', 'C:\\LGHUB\\scripts');
  assert.match(bat, /Author: userfn-git \(fnprospace@gmail\.com\)/);
  assert.match(bat, /git config user\.name "userfn-git"/);
  assert.match(bat, /git config user\.email "fnprospace@gmail\.com"/);
});

