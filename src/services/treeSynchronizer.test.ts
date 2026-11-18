import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { globalTreeSynchronizer } from './treeSynchronizerEngine';
import { 
  getRuntimeEnvironment, 
  getBridgeDiagnostics, 
  generateStandalonePackagingBundle,
  dispatchHardwareCommand 
} from './tauriLocalBridge';

test('Tree Synchronizer Engine boots autonomously and reports 8 active leaves', () => {
  const snapshot = globalTreeSynchronizer.getSnapshot();
  assert.equal(snapshot.leaves.length, 8, 'Engine must contain exactly 8 interconnected leaves');
  
  const activeLeaves = snapshot.leaves.filter(l => l.status === 'ACTIVE');
  assert.equal(activeLeaves.length, 8, 'All 8 leaves must be active upon boot without button clicks');

  // Verify trunks distribution
  const hardwareTrunk = snapshot.leaves.filter(l => l.trunk === 'input_hardware');
  const esportsTrunk = snapshot.leaves.filter(l => l.trunk === 'physics_esports');
  assert.equal(hardwareTrunk.length, 4, 'Trunk 1 must contain 4 input & hardware leaves');
  assert.equal(esportsTrunk.length, 4, 'Trunk 2 must contain 4 physics & esports leaves');
});

test('Tree Controller Poller outputs bounded analog stick vectors and triggers', () => {
  const snapshot = globalTreeSynchronizer.getSnapshot();
  const ctrl = snapshot.controller;

  assert.ok(typeof ctrl.leftStick.x === 'number', 'Left stick X must be a number');
  assert.ok(typeof ctrl.leftStick.y === 'number', 'Left stick Y must be a number');
  assert.ok(ctrl.leftStick.magnitude <= 1.0, 'Stick magnitude must be clamped to max 1.0');
  assert.ok(ctrl.leftTrigger >= 0.0 && ctrl.leftTrigger <= 1.0, 'Left trigger must be in [0, 1]');
  assert.ok(ctrl.rightTrigger >= 0.0 && ctrl.rightTrigger <= 1.0, 'Right trigger must be in [0, 1]');
  assert.equal(ctrl.pollingHz, 1000, 'DirectInput polling must be 1000Hz');
});

test('Tree Telemetry enforces Rocket League 2300 uu/s supersonic cap and microsecond latency', () => {
  const snapshot = globalTreeSynchronizer.getSnapshot();
  assert.ok(snapshot.currentVelocityUu <= 2300, 'Velocity must not exceed supersonic physics cap of 2300 uu/s');
  assert.ok(snapshot.masterAverageLatencyMs < 1.0, 'Master loop latency must be sub-millisecond (< 1.0 ms)');
  assert.equal(snapshot.masterThroughputHz, 1000, 'Master throughput must operate at 1000 Hz');
});

test('Dual-Stack Localhost Bridge detects environment and provides standalone serverless diagnostics', () => {
  const env = getRuntimeEnvironment();
  assert.ok(['TAURI_DESKTOP_EXE', 'WINDOWS11_STANDALONE_LOCALHOST', 'WEB_CONTAINER'].includes(env));

  const diag = getBridgeDiagnostics();
  assert.equal(diag.isServerlessLocal, true, 'Engine must operate locally with zero remote server dependency');
  assert.equal(diag.pollingHz, 1000, 'Polling rate must be locked to 1000Hz');
  assert.ok(diag.databasePath.length > 0, 'Database path must be reported');
});

test('Standalone Windows 11 EXE Packaging Kit removes legacy .bat and generates synced build_windows_exe.ps1 + AppxManifest', () => {
  const bundle = generateStandalonePackagingBundle();
  assert.equal('buildBat' in bundle, false, 'Legacy buildBat property must be removed');
  assert.ok(bundle.buildPs1.includes('\r\n'), 'build_windows_exe.ps1 must use Windows CRLF line endings');
  assert.ok(bundle.buildPs1.includes('function Log-Message'), 'build_windows_exe.ps1 must use centralized Log-Message logger');
  assert.ok(bundle.buildPs1.includes('Remove-ObsoleteBatchScripts'), 'build_windows_exe.ps1 must remove stale build_windows_exe*.bat duplicates');
  assert.ok(bundle.buildPs1.includes('FNPRO_ENGINE_HOME'), 'build_windows_exe.ps1 must resolve and persist FNPRO_ENGINE_HOME');
  assert.ok(bundle.buildPs1.includes('Expand-Archive'), 'build_windows_exe.ps1 must auto-extract sibling ZIP archives when placed in Downloads');
  assert.ok(bundle.buildPs1.includes('npx tauri build'), 'build_windows_exe.ps1 must invoke local @tauri-apps/cli');
  assert.ok(bundle.buildPs1.includes('cargo tauri build'), 'build_windows_exe.ps1 must keep cargo tauri fallback');
  assert.ok(bundle.msixManifest.includes('RocketLeagueProfessionalMasterEngine'), 'MSIX manifest must contain unified engine title');
  assert.ok(bundle.instructionsAr.includes('ويندوز 11'), 'Arabic instructions must explain Windows 11 packaging');

  // Ensure legacy .bat is deleted and root build_windows_exe.ps1 matches generated bundle
  const rootBatPath = path.resolve(process.cwd(), 'build_windows_exe.bat');
  assert.equal(fs.existsSync(rootBatPath), false, 'Legacy root build_windows_exe.bat must be deleted');

  const rootPs1Path = path.resolve(process.cwd(), 'build_windows_exe.ps1');
  assert.ok(fs.existsSync(rootPs1Path), 'Root build_windows_exe.ps1 must exist on disk');
  const rootPs1Content = fs.readFileSync(rootPs1Path, 'utf8');
  assert.equal(rootPs1Content, bundle.buildPs1, 'Root build_windows_exe.ps1 must stay synced with generateStandalonePackagingBundle().buildPs1');
});

