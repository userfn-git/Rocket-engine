import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  AUTONOMOUS_PIPELINE_MODULES,
  SHM_MAGIC_U32,
  SHM_SIZE_BYTES,
  compileDynamicZoneBundle,
  computeProZoneCurve,
  createInitialAutonomousShmTelemetry,
  generateLiveSyncedDualAxisLua,
  generateLiveSyncedMacroBridgeLua,
  getSpeedflipVector,
  processCoreDeadzone,
  runDualPipelineMicroBenchmark,
  stepAutonomousSeqlockFrame,
  stepDualAxisVector,
} from './autonomousPipelineEngine';
import { INITIAL_MACRO_TIMINGS, INITIAL_PHYSICS_CONFIG } from '../data/initialData';
import { globalTreeSynchronizer } from './treeSynchronizerEngine';
import { buildUnifiedMasterProfileSnapshot } from './unifiedProfileArm';

test('All 9 uploaded pipeline attachments exist in public/assets/aistudio matching descriptors', () => {
  assert.equal(AUTONOMOUS_PIPELINE_MODULES.length, 9);
  for (const mod of AUTONOMOUS_PIPELINE_MODULES) {
    const diskPath = path.resolve(process.cwd(), 'public', mod.assetPath.replace(/^\//, ''));
    assert.ok(fs.existsSync(diskPath), `Missing attachment asset on disk: ${diskPath}`);
    const content = fs.readFileSync(diskPath, 'utf8');
    assert.ok(content.length > 100, `Expected non-empty attachment content for ${mod.id}`);
  }
});

test('Pro Zone Curve Compiler produces 256-entry LUT, C++ header, Lua module, and active JSON payload', () => {
  assert.equal(computeProZoneCurve(0.05, 0.05, 0.98, 1.26, 0.95, 1.09), 0);
  const mid = computeProZoneCurve(0.5, 0.05, 0.98, 1.26, 0.95, 1.09);
  const full = computeProZoneCurve(1.0, 0.05, 0.98, 1.26, 0.95, 1.09);
  assert.ok(mid > 0.3 && mid < 0.7);
  assert.equal(full, 1.0);

  const compiled = compileDynamicZoneBundle(INITIAL_PHYSICS_CONFIG, {
    lightnessMicroGain: 1.26,
    weightMomentumRetention: 0.95,
    fastAerialPitchBias: 1.14,
    airDragCompensation: 1.09,
  });

  assert.equal(compiled.radialLut256.length, 256);
  assert.match(compiled.zoneMomentumHpp, /constexpr std::array<float, 256> PRO_RADIAL_LUT/);
  assert.match(compiled.zoneMomentumLua, /radial_lut = \{/);
  const jsonPayload = JSON.parse(compiled.activeZoneInputJson) as {
    engine: string;
    radial_lut_256: number[];
    mechanics: { inner_deadzone: number };
  };
  assert.equal(jsonPayload.engine, 'FNEngine-Win64');
  assert.equal(jsonPayload.radial_lut_256.length, 256);
  assert.equal(jsonPayload.mechanics.inner_deadzone, INITIAL_PHYSICS_CONFIG.internalDeadzone);
});

test('Dual-Axis Vector 28-deg Speedflip and Hermite Smoothstep deadzone maintain mathematical symmetry', () => {
  const left = getSpeedflipVector(-1, 0.05);
  const right = getSpeedflipVector(1, 0.05);
  assert.equal(left[0], -right[0]);
  assert.equal(left[1], right[1]);
  assert.ok(left[0] < -0.4 && left[1] < -0.8);

  const stepped = stepDualAxisVector(
    { curX: 0, curY: 0, deadzone: 0.05, maxMagnitude: 1.0, tickMs: 8 },
    0.8,
    -0.6,
    0.35
  );
  assert.ok(stepped.curX > 0 && stepped.curY < 0);

  const dead = processCoreDeadzone(0.02, 0.01, 0, 0, 0.05, 0.35);
  assert.equal(dead.active, false);
  assert.equal(dead.outX, 0);
  assert.equal(dead.outY, 0);

  const live = processCoreDeadzone(0.8, -0.4, 0.5, -0.2, 0.05, 0.35);
  assert.equal(live.active, true);
  assert.ok(live.outX > 0 && live.outY < 0);
});

test('120Hz Seqlock SHM frame advances even sequence numbers, detects 4-wheel resets, and syncs live scripts', () => {
  let state = createInitialAutonomousShmTelemetry(INITIAL_PHYSICS_CONFIG, INITIAL_MACRO_TIMINGS);
  assert.equal(state.shmSizeBytes, SHM_SIZE_BYTES);
  assert.equal(state.shmMagicHex, `0x${SHM_MAGIC_U32.toString(16).toUpperCase()}`);

  for (let i = 0; i < 30; i++) {
    state = stepAutonomousSeqlockFrame(
      state,
      0.5,
      -0.6,
      true,
      INITIAL_PHYSICS_CONFIG,
      INITIAL_MACRO_TIMINGS
    );
    assert.equal(state.seq % 2, 0, 'Committed seqlock sequence must always be even');
  }

  assert.ok(state.totalResetsDetected >= 1, 'Expected at least 1 4-wheel flip reset detected within 30 frames');

  const customMacros = {
    ...INITIAL_MACRO_TIMINGS,
    fastAerial: { ...INITIAL_MACRO_TIMINGS.fastAerial, firstJumpSleep: 18 },
  };
  const dualLua = generateLiveSyncedDualAxisLua({ ...INITIAL_PHYSICS_CONFIG, internalDeadzone: 0.065 });
  const macroLua = generateLiveSyncedMacroBridgeLua(customMacros);
  assert.match(dualLua, /deadzone = 0\.065/);
  assert.match(macroLua, /stall_sleep_ms = 18/);

  const bench = runDualPipelineMicroBenchmark(INITIAL_PHYSICS_CONFIG, INITIAL_MACRO_TIMINGS, 200);
  assert.equal(bench.samples, 200);
  assert.ok(bench.minUs <= bench.avgUs && bench.avgUs <= bench.p99Us);
});

test('TreeSynchronizer & UnifiedMasterProfileArm embed autonomous pipeline telemetry & compiled artifacts', () => {
  const snap = globalTreeSynchronizer.getSnapshot();
  assert.ok(snap.autonomousShm);
  assert.ok(snap.proZone);
  assert.equal(snap.proZone.radialLut256.length, 256);

  const arm = buildUnifiedMasterProfileSnapshot({
    physicsConfig: INITIAL_PHYSICS_CONFIG,
    macroTimings: INITIAL_MACRO_TIMINGS,
  });
  assert.match(arm.compiledArtifacts.zoneMomentumHpp, /PRO_RADIAL_LUT/);
  assert.match(arm.compiledArtifacts.zoneMomentumLua, /radial_lut/);
  assert.match(arm.compiledArtifacts.dualAxisVectorLua, /GetSpeedflipVector/);
  assert.match(arm.compiledArtifacts.macroBridgeLua, /dispatch_auto_stall/);
});
