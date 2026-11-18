import test from 'node:test';
import assert from 'node:assert/strict';
import { 
  runPollingBenchmark, 
  generateFullHardwareHealthReport, 
  globalFreePlayRecorder 
} from './hardwareHealthService';

test('Polling rate benchmark measures sample intervals and calculates jitter variance', async () => {
  const result = await runPollingBenchmark(25);
  assert.ok(result.samplesCollected >= 25, 'Should collect at least requested sample count');
  assert.ok(result.averageIntervalMs > 0, 'Average interval must be positive');
  assert.ok(result.jitterVarianceMs >= 0, 'Jitter variance must be non-negative');
  assert.equal(result.targetHz, 1000, 'Target polling rate must be 1000Hz');
  assert.ok(typeof result.passed1000HzCheck === 'boolean', 'Passed flag must be boolean');
});

test('Hardware health report generates full audit with fingerprint and diagnostics log', async () => {
  const report = await generateFullHardwareHealthReport();
  assert.ok(report.fingerprint.machine_guid.length > 0, 'Fingerprint must contain machine GUID');
  assert.equal(report.registryLocked, true, 'Windows 11 registry must be marked locked');
  assert.ok(report.dbCommitLatencyMs < 1.0, 'In-memory DB commit latency must be sub-millisecond');
  assert.ok(report.diagnosticsLog.length >= 4, 'Must produce multi-line diagnostics audit log');
});

test('Free Play Live Recorder tracks telemetry points, detects mechanics and calculates summaries', () => {
  const session = globalFreePlayRecorder.startSession('Test Free Play Run');
  assert.equal(globalFreePlayRecorder.isSessionActive(), true, 'Recorder must be active');
  assert.equal(session.name, 'Test Free Play Run');

  // Push 10 frames of supersonic mechanics
  for (let i = 0; i < 10; i++) {
    const point = globalFreePlayRecorder.recordTelemetryFrame(
      2250, // Supersonic velocity
      1.0,  // Throttle
      0.5,  // Steer
      0.8,  // Pitch (Flip)
      0.1,  // Yaw
      0.7,  // Roll (Cancel)
      false,// inAir
      true  // boostActive
    );
    assert.ok(point !== null, 'Telemetry point must be recorded');
    assert.equal(point?.isSupersonic, true, 'Velocity 2250 must be supersonic');
  }

  const finished = globalFreePlayRecorder.stopSession();
  assert.equal(globalFreePlayRecorder.isSessionActive(), false, 'Recorder must be stopped');
  assert.ok(finished !== null, 'Finished session must not be null');
  assert.equal(finished?.supersonicPercent, 100, 'All supersonic frames must yield 100% supersonic ratio');
  assert.equal(finished?.points.length, 10, 'Points count must match recorded count');
});

test('Live Session Monitor records latency spikes to DB, tracks statistics, and exports data', async () => {
  const { 
    recordLatencySpikeToDb, 
    getRecentLatencySpikes, 
    clearLatencySpikesDb, 
    getLatencySpikeStats, 
    exportLatencySpikesAsJson, 
    exportLatencySpikesAsCsv 
  } = await import('./hardwareHealthService');

  // Start with clean state
  clearLatencySpikesDb();
  let spikes = getRecentLatencySpikes();
  assert.equal(spikes.length, 0, 'Spikes list must be empty after clear');

  // Record a simulated spike
  const testSpike = {
    id: 'test_spike_1',
    sessionId: 'test_session_freeplay',
    tickIndex: 104,
    timestamp: '12:00:01',
    timeEpoch: Date.now(),
    latencyMs: 2.85,
    latencyUs: 2850,
    thresholdMs: 1.8,
    severity: 'MODERATE_SPIKE' as const,
    triggerInput: 'G PRO X 60 KeyW (Throttle)',
    velocityUu: 2240,
    isSupersonic: true,
    rootCauseDiagnosis: 'DirectInput HID buffer backlog during rapid APM',
    dbPersisted: true
  };

  const success = await recordLatencySpikeToDb(testSpike);
  assert.equal(success, true, 'Spike recording must return true');

  spikes = getRecentLatencySpikes();
  assert.equal(spikes.length, 1, 'Spikes list must have 1 record');
  assert.equal(spikes[0].id, 'test_spike_1');
  assert.equal(spikes[0].latencyMs, 2.85);

  // Test simulation helper in recorder
  const simulated = await globalFreePlayRecorder.simulateLatencySpike('CRITICAL_DROP', 4.35);
  assert.equal(simulated.severity, 'CRITICAL_DROP');
  assert.equal(simulated.latencyMs, 4.35);

  const stats = getLatencySpikeStats(1.8);
  assert.ok(stats.totalSpikes >= 2, 'Stats totalSpikes must be at least 2');
  assert.ok(stats.maxLatencyMs >= 4.35, 'Max latency must reflect the critical spike');
  assert.equal(stats.criticalCount, 1, 'Must have 1 critical drop');

  // Test exports
  const jsonExport = exportLatencySpikesAsJson();
  assert.ok(jsonExport.includes('Rocket League Professional Master Engine'), 'JSON export header missing');
  assert.ok(jsonExport.includes('test_spike_1'), 'JSON export must contain test spike');

  const csvExport = exportLatencySpikesAsCsv();
  assert.ok(csvExport.includes('Latency (ms)'), 'CSV export must have Latency column');
  assert.ok(csvExport.includes('2.850'), 'CSV export must include 2.850ms value');

  // Cleanup
  clearLatencySpikesDb();
  assert.equal(getRecentLatencySpikes().length, 0, 'Spikes list must be empty after cleanup');
});
