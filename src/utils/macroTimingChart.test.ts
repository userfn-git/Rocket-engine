import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_MACRO_TIMINGS } from '../data/initialData';
import {
  buildMacroSequenceTracks,
  calculateDraggedDuration,
  updateMacroTimingValue,
  msToPhysicsTicks,
} from './macroTimingChart';

test('buildMacroSequenceTracks constructs contiguous timeline segments for aerial holds and ground recovery', () => {
  const allTracks = buildMacroSequenceTracks(INITIAL_MACRO_TIMINGS, 'all');
  assert.equal(allTracks.length, 6, 'Must include all 6 macro sequences from macroTimings');

  const aerialTracks = buildMacroSequenceTracks(INITIAL_MACRO_TIMINGS, 'aerial_hold');
  assert.equal(aerialTracks.length, 5, 'Must categorize 5 aerial hold sequences');

  const recoveryTracks = buildMacroSequenceTracks(INITIAL_MACRO_TIMINGS, 'ground_recovery');
  assert.equal(recoveryTracks.length, 1, 'Must categorize chainDash as ground recovery sequence');
  assert.equal(recoveryTracks[0].sequenceKey, 'chainDash');
  assert.equal(recoveryTracks[0].totalDurationMs, 170, 'chainDash default 30+60+30+50 should equal 170ms');

  // Verify Fast Aerial cumulative start/end offsets
  const fastAerial = allTracks.find((t) => t.sequenceKey === 'fastAerial');
  assert.ok(fastAerial, 'fastAerial track must exist');
  assert.equal(fastAerial.totalDurationMs, 460, 'fastAerial default total duration should be 460ms');
  assert.equal(fastAerial.segments[0].startMs, 0);
  assert.equal(fastAerial.segments[0].endMs, 200);
  assert.equal(fastAerial.segments[1].startMs, 200);
  assert.equal(fastAerial.segments[1].endMs, 230);
});

test('calculateDraggedDuration converts horizontal pointer drag deltas to clamped milliseconds', () => {
  // 800px track representing 800ms -> 1px = 1ms
  const increased = calculateDraggedDuration(200, 45, 800, 800, 60, 320);
  assert.equal(increased, 245, 'Dragging +45px on 800px/800ms track should add 45ms');

  const decreased = calculateDraggedDuration(200, -50, 800, 800, 60, 320);
  assert.equal(decreased, 150, 'Dragging -50px on 800px/800ms track should subtract 50ms');

  const clampedMax = calculateDraggedDuration(300, 100, 800, 800, 60, 320);
  assert.equal(clampedMax, 320, 'Duration must clamp cleanly at maxMs bound');

  const clampedMin = calculateDraggedDuration(70, -100, 800, 800, 60, 320);
  assert.equal(clampedMin, 60, 'Duration must clamp cleanly at minMs bound');
});

test('updateMacroTimingValue produces an immutable updated MacroTimingConfig with clamped timing', () => {
  const updated = updateMacroTimingValue(INITIAL_MACRO_TIMINGS, 'fastAerial', 'flipCancelHold', 240);
  assert.notEqual(updated, INITIAL_MACRO_TIMINGS, 'Must return a new object reference');
  assert.equal(updated.fastAerial.flipCancelHold, 240);
  assert.equal(INITIAL_MACRO_TIMINGS.fastAerial.flipCancelHold, 180, 'Must not mutate original timings');

  // Test ground recovery adjustment
  const updatedRecovery = updateMacroTimingValue(updated, 'chainDash', 'fallDelay', 95);
  assert.equal(updatedRecovery.chainDash.fallDelay, 95);

  // Check physics ticks conversion
  assert.equal(msToPhysicsTicks(100, 120), 12);
  assert.equal(msToPhysicsTicks(100, 240), 24);
});
