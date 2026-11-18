import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { MacroTimingConfig, Language } from '../types/engine';
import { INITIAL_MACRO_TIMINGS } from '../data/initialData';
import {
  SequenceCategory,
  MacroTimingSegment,
  MacroTimingSequenceTrack,
  buildMacroSequenceTracks,
  updateMacroTimingValue,
  calculateDraggedDuration,
  clampDuration,
  msToPhysicsTicks,
} from '../utils/macroTimingChart';
import { recordAuditEntry } from '../utils/engineAuditLog';
import {
  BarChart3,
  Play,
  Square,
  RotateCcw,
  GripVertical,
  Sliders,
  Wind,
  Anchor,
  Minus,
  Plus,
  Maximize2,
  AlignJustify,
} from 'lucide-react';

interface MacroTimingVisualizerProps {
  timings?: MacroTimingConfig;
  onChangeTimings?: (newTimings: MacroTimingConfig) => void;
  language: Language;
  onDispatchToast?: (msg: string) => void;
}

interface ActiveDragState {
  segmentId: string;
  sequenceKey: keyof MacroTimingConfig;
  paramKey: string;
  label: string;
  startX: number;
  initialDurationMs: number;
  currentDurationMs: number;
  trackWidthPx: number;
  scaleMaxMs: number;
  minMs: number;
  maxMs: number;
}

export const MacroTimingVisualizer: React.FC<MacroTimingVisualizerProps> = ({
  timings = INITIAL_MACRO_TIMINGS,
  onChangeTimings,
  language,
  onDispatchToast,
}) => {
  const isAr = language === 'ar';

  const [categoryFilter, setCategoryFilter] = useState<'all' | SequenceCategory>('all');
  const [scaleMode, setScaleMode] = useState<'absolute' | 'normalized'>('absolute');
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>('fastAerial.firstJumpSleep');
  const [dragState, setDragState] = useState<ActiveDragState | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playheadMs, setPlayheadMs] = useState<number>(0);

  // Local fallback state if parent didn't pass onChangeTimings
  const [localTimings, setLocalTimings] = useState<MacroTimingConfig>(timings);
  useEffect(() => {
    setLocalTimings(timings);
  }, [timings]);

  const activeTimings = onChangeTimings ? timings : localTimings;

  const commitTimings = useCallback(
    (next: MacroTimingConfig) => {
      setLocalTimings(next);
      onChangeTimings?.(next);
    },
    [onChangeTimings]
  );

  // Refs for measuring track pixel widths accurately during drag
  const trackRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const tracks = useMemo<MacroTimingSequenceTrack[]>(
    () => buildMacroSequenceTracks(activeTimings, categoryFilter),
    [activeTimings, categoryFilter]
  );

  const allTracks = useMemo<MacroTimingSequenceTrack[]>(
    () => buildMacroSequenceTracks(activeTimings, 'all'),
    [activeTimings]
  );

  const globalMaxMs = useMemo(() => {
    const maxTrack = Math.max(...allTracks.map((t) => t.totalDurationMs), 700);
    // Round up cleanly to nearest 100ms step, minimum 800ms
    return Math.max(800, Math.ceil((maxTrack + 40) / 100) * 100);
  }, [allTracks]);

  const rulerTicks = useMemo(() => {
    const step = globalMaxMs > 1000 ? 200 : 100;
    const marks: number[] = [];
    for (let m = 0; m <= globalMaxMs; m += step) {
      marks.push(m);
    }
    return marks;
  }, [globalMaxMs]);

  // Aggregate summary stats across Aerial Holds vs Ground Recovery
  const summaryStats = useMemo(() => {
    const aerialTracks = allTracks.filter((t) => t.category === 'aerial_hold');
    const groundTracks = allTracks.filter((t) => t.category === 'ground_recovery');
    const totalAerialHoldMs = aerialTracks.reduce((sum, t) => sum + t.holdDurationMs, 0);
    const totalGroundRecoveryMs = groundTracks.reduce((sum, t) => sum + t.totalDurationMs, 0);
    const fastestRecovery = groundTracks[0]?.totalDurationMs ?? 0;
    const longestAerial = Math.max(...aerialTracks.map((t) => t.totalDurationMs), 0);

    return {
      aerialCount: aerialTracks.length,
      groundCount: groundTracks.length,
      totalAerialHoldMs,
      totalGroundRecoveryMs,
      fastestRecovery,
      longestAerial,
    };
  }, [allTracks]);

  // Selected segment & track lookup
  const selectedContext = useMemo(() => {
    for (const track of allTracks) {
      const seg = track.segments.find((s) => s.id === selectedSegmentId);
      if (seg) return { track, segment: seg };
    }
    const fallbackTrack = tracks[0] || allTracks[0];
    return {
      track: fallbackTrack,
      segment: fallbackTrack?.segments[0],
    };
  }, [allTracks, tracks, selectedSegmentId]);

  // Handle pointer drag move / up across window so dragging never drops if cursor leaves bar
  useEffect(() => {
    if (!dragState) return;

    const handlePointerMove = (e: PointerEvent) => {
      const deltaPx = e.clientX - dragState.startX;
      const nextMs = calculateDraggedDuration(
        dragState.initialDurationMs,
        deltaPx,
        dragState.trackWidthPx,
        dragState.scaleMaxMs,
        dragState.minMs,
        dragState.maxMs
      );

      if (nextMs !== dragState.currentDurationMs) {
        setDragState((prev) => (prev ? { ...prev, currentDurationMs: nextMs } : null));
        const updated = updateMacroTimingValue(
          activeTimings,
          dragState.sequenceKey,
          dragState.paramKey,
          nextMs
        );
        commitTimings(updated);
      }
    };

    const handlePointerUp = () => {
      if (dragState.currentDurationMs !== dragState.initialDurationMs) {
        recordAuditEntry({
          section: 'macros',
          sectionNameAr: 'مخطط توقيتات الماكرو المرئي',
          sectionNameEn: 'Macro Timing Visualizer',
          paramKey: dragState.segmentId,
          paramLabelAr: `تعديل زمن ${dragState.label}`,
          paramLabelEn: `Drag adjust ${dragState.label}`,
          oldValue: `${dragState.initialDurationMs} ms`,
          newValue: `${dragState.currentDurationMs} ms`,
          changeType: 'macro_inject',
        });
      }
      setDragState(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [dragState, activeTimings, commitTimings]);

  // Real-time Playhead Animation across the timeline
  useEffect(() => {
    if (!isPlaying) return;

    const maxVisibleMs = Math.max(...tracks.map((t) => t.totalDurationMs), 600);
    let animId: number;
    let lastTs = performance.now();

    const stepFrame = (now: number) => {
      const dt = now - lastTs;
      lastTs = now;
      setPlayheadMs((prev) => {
        const next = prev + dt;
        if (next >= maxVisibleMs + 60) {
          setIsPlaying(false);
          return 0;
        }
        return next;
      });
      animId = requestAnimationFrame(stepFrame);
    };

    animId = requestAnimationFrame(stepFrame);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, tracks]);

  const startBarDrag = (
    e: React.PointerEvent,
    track: MacroTimingSequenceTrack,
    segment: MacroTimingSegment
  ) => {
    e.preventDefault();
    e.stopPropagation();

    setSelectedSegmentId(segment.id);
    const trackEl = trackRefs.current[track.sequenceKey];
    const measuredWidth = trackEl?.getBoundingClientRect().width || 640;
    const scaleMaxMs = scaleMode === 'normalized' ? Math.max(track.totalDurationMs, 100) : globalMaxMs;

    setDragState({
      segmentId: segment.id,
      sequenceKey: segment.sequenceKey,
      paramKey: segment.paramKey,
      label: isAr ? segment.labelAr : segment.labelEn,
      startX: e.clientX,
      initialDurationMs: segment.durationMs,
      currentDurationMs: segment.durationMs,
      trackWidthPx: measuredWidth,
      scaleMaxMs,
      minMs: segment.minMs,
      maxMs: segment.maxMs,
    });
  };

  const handleNudgeSegment = (segment: MacroTimingSegment, deltaMs: number) => {
    const nextMs = clampDuration(segment.durationMs + deltaMs, segment.minMs, segment.maxMs);
    if (nextMs === segment.durationMs) return;

    const updated = updateMacroTimingValue(
      activeTimings,
      segment.sequenceKey,
      segment.paramKey,
      nextMs
    );
    commitTimings(updated);

    recordAuditEntry({
      section: 'macros',
      sectionNameAr: 'مخطط توقيتات الماكرو المرئي',
      sectionNameEn: 'Macro Timing Visualizer',
      paramKey: segment.id,
      paramLabelAr: segment.labelAr,
      paramLabelEn: segment.labelEn,
      oldValue: `${segment.durationMs} ms`,
      newValue: `${nextMs} ms`,
      changeType: 'macro_inject',
    });
  };

  const handleSegmentKeyDown = (e: React.KeyboardEvent, segment: MacroTimingSegment) => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      handleNudgeSegment(segment, step);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      handleNudgeSegment(segment, -step);
    }
  };

  const handleResetDefaults = () => {
    commitTimings(INITIAL_MACRO_TIMINGS);
    setPlayheadMs(0);
    setIsPlaying(false);
    recordAuditEntry({
      section: 'macros',
      sectionNameAr: 'مخطط توقيتات الماكرو المرئي',
      sectionNameEn: 'Macro Timing Visualizer',
      paramKey: 'RESET_ALL_TIMINGS',
      paramLabelAr: 'استعادة التوقيتات الافتراضية للمخطط',
      paramLabelEn: 'Reset Macro Timings to Esports Baseline',
      oldValue: 'Custom',
      newValue: 'INITIAL_MACRO_TIMINGS',
      changeType: 'engine_switch',
    });
    onDispatchToast?.(
      isAr
        ? '✓ تم استعادة توقيتات الماكرو القياسية بنجاح'
        : '✓ Macro timings reset to tournament baseline'
    );
  };

  const getRoleSegmentStyles = (role: MacroTimingSegment['role'], isSelected: boolean, isPlayheadInside: boolean) => {
    if (isPlayheadInside) {
      return 'bg-amber-400/90 border-amber-200 text-slate-950 shadow-[0_0_16px_rgba(251,191,36,0.45)]';
    }
    if (role === 'hold') {
      return isSelected
        ? 'bg-cyan-500/35 border-cyan-300 text-white ring-1 ring-cyan-400/60'
        : 'bg-cyan-500/20 border-cyan-500/50 text-cyan-100 hover:bg-cyan-500/30';
    }
    if (role === 'recovery') {
      return isSelected
        ? 'bg-emerald-500/35 border-emerald-300 text-white ring-1 ring-emerald-400/60'
        : 'bg-emerald-500/20 border-emerald-500/50 text-emerald-100 hover:bg-emerald-500/30';
    }
    return isSelected
      ? 'bg-amber-500/35 border-amber-300 text-white ring-1 ring-amber-400/60'
      : 'bg-amber-500/20 border-amber-500/50 text-amber-100 hover:bg-amber-500/30';
  };

  const getRoleTextLabel = (role: MacroTimingSegment['role']) => {
    if (role === 'hold') return isAr ? 'تثبيت جوي / قفز' : 'Aerial / Impulse Hold';
    if (role === 'recovery') return isAr ? 'استعادة أرضية' : 'Ground Recovery';
    return isAr ? 'نافذة تحرير' : 'Transition Window';
  };

  return (
    <div className="space-y-6 select-none">
      {/* Main Chart Container */}
      <section className="bg-[#0b1120] border border-slate-800 rounded-xl p-5 sm:p-6 shadow-2xl space-y-5">
        {/* Header & Quiet Metadata */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <BarChart3 className="w-5 h-5 text-cyan-400 shrink-0" />
              <h2 className="text-lg font-bold text-white tracking-tight">
                {isAr ? 'مخطط ومعدل توقيتات الماكرو المرئي (Macro Timing Visualizer)' : 'Macro Timing Visualizer'}
              </h2>
            </div>
            <p className="text-xs text-slate-400 max-w-3xl leading-relaxed">
              {isAr
                ? 'رسم تفاعلي لعرض فترات التثبيت الجوي (Aerial Holds) وتسلسلات استعادة التوازن الأرضي (Ground Recovery). اسحب حافة أي شريط لليمين أو اليسار لتعديل المدة بالمللي ثانية فورياً.'
                : 'Interactive sequence duration chart comparing aerial holds and ground recovery phases from macroTimings. Drag any bar or right resize handle horizontally to calibrate millisecond durations live.'}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-400 pt-0.5 tabular-nums">
              <span>{summaryStats.aerialCount} {isAr ? 'تسلسلات تثبيت جوي' : 'Aerial Hold Sequences'}</span>
              <span aria-hidden="true">·</span>
              <span>{summaryStats.groundCount} {isAr ? 'تسلسل استعادة أرضية' : 'Ground Recovery Sequence'}</span>
              <span aria-hidden="true">·</span>
              <span>{isAr ? 'دقة 1ms (1000Hz DirectInput)' : '1ms Resolution (120Hz / 240Hz PhysX)'}</span>
            </div>
          </div>

          {/* Primary Actions */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (isPlaying) {
                  setIsPlaying(false);
                  setPlayheadMs(0);
                } else {
                  setPlayheadMs(0);
                  setIsPlaying(true);
                }
              }}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                isPlaying
                  ? 'bg-rose-600 hover:bg-rose-500 text-white'
                  : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
              }`}
            >
              {isPlaying ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>
                {isPlaying
                  ? (isAr ? 'إيقاف التشغيل' : 'Stop Playback')
                  : (isAr ? 'تشغيل المخطط الزمني' : 'Play Sequences')}
              </span>
            </button>

            <button
              type="button"
              onClick={handleResetDefaults}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span>{isAr ? 'استعادة الافتراضي' : 'Reset Defaults'}</span>
            </button>
          </div>
        </div>

        {/* Filter Bar, Scale Mode & KPI Summary Strip */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Category Segmented Filter */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center p-1 bg-slate-950 border border-slate-800 rounded-lg" role="group" aria-label="Sequence Filter">
              {[
                { id: 'all' as const, labelEn: 'All Sequences', labelAr: 'الكل', count: allTracks.length },
                { id: 'aerial_hold' as const, labelEn: 'Aerial Holds', labelAr: 'التثبيت الجوي', count: summaryStats.aerialCount },
                { id: 'ground_recovery' as const, labelEn: 'Ground Recovery', labelAr: 'الاستعادة الأرضية', count: summaryStats.groundCount },
              ].map((tab) => {
                const isActive = categoryFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setCategoryFilter(tab.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                      isActive
                        ? 'bg-slate-800 text-cyan-300'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isAr ? `${tab.labelAr} (${tab.count})` : `${tab.labelEn} (${tab.count})`}
                  </button>
                );
              })}
            </div>

            {/* Scale Mode Toggle */}
            <div className="inline-flex items-center p-1 bg-slate-950 border border-slate-800 rounded-lg" role="group" aria-label="Chart Scale">
              <button
                type="button"
                onClick={() => setScaleMode('absolute')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  scaleMode === 'absolute'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <AlignJustify className="w-3.5 h-3.5 text-cyan-400" />
                <span>{isAr ? 'مقياس زمني موحد (ms)' : 'Absolute Scale (ms)'}</span>
              </button>
              <button
                type="button"
                onClick={() => setScaleMode('normalized')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  scaleMode === 'normalized'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Maximize2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isAr ? 'تكبير كل صف (100%)' : 'Fit Row Width'}</span>
              </button>
            </div>
          </div>

          {/* Unboxed Legend & Quantitative Readouts */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 font-mono tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-cyan-400/80 inline-block" />
              <span>{isAr ? 'تثبيت جوي / قفز' : 'Aerial / Impulse Hold'}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-400/80 inline-block" />
              <span>{isAr ? 'نافذة تأخير' : 'Transition Window'}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400/80 inline-block" />
              <span>{isAr ? 'استعادة أرضية' : 'Ground Recovery'}</span>
            </span>
          </div>
        </div>

        {/* Comparison Summary Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 py-3 border-y border-slate-800/80 text-xs font-mono tabular-nums">
          <div>
            <span className="text-slate-400 block">{isAr ? 'إجمالي تثبيت الطيران (5 حركات)' : 'Total Aerial Hold Time'}</span>
            <span className="text-base font-bold text-cyan-300 mt-0.5 block">
              {summaryStats.totalAerialHoldMs} ms
            </span>
          </div>
          <div>
            <span className="text-slate-400 block">{isAr ? 'مدة استعادة الويف داش' : 'Ground Recovery Cycle'}</span>
            <span className="text-base font-bold text-emerald-400 mt-0.5 block">
              {summaryStats.fastestRecovery} ms ({msToPhysicsTicks(summaryStats.fastestRecovery, 120)} ticks)
            </span>
          </div>
          <div>
            <span className="text-slate-400 block">{isAr ? 'أطول سلسلة جوية' : 'Longest Aerial Sequence'}</span>
            <span className="text-base font-bold text-white mt-0.5 block">
              {summaryStats.longestAerial} ms
            </span>
          </div>
          <div>
            <span className="text-slate-400 block">{isAr ? 'نسبة الأرضي إلى الجوي' : 'Ground-to-Aerial Ratio'}</span>
            <span className="text-base font-bold text-amber-300 mt-0.5 block">
              {summaryStats.longestAerial > 0
                ? `${((summaryStats.fastestRecovery / summaryStats.longestAerial) * 100).toFixed(1)}%`
                : '0%'}
            </span>
          </div>
        </div>

        {/* INTERACTIVE GANTT / BAR CHART CANVAS (Enforced LTR so 0ms -> maxMs drag is always left-to-right) */}
        <div dir="ltr" className="bg-[#060a14] border border-slate-800 rounded-xl p-4 space-y-4 overflow-x-auto">
          <div className="min-w-[680px] space-y-4">
            {/* Millisecond X-Axis Scale Header */}
            <div className="flex items-end justify-between text-[11px] font-mono text-slate-500 border-b border-slate-800/80 pb-2 tabular-nums">
              {scaleMode === 'absolute' ? (
                <div className="w-full flex justify-between relative">
                  {rulerTicks.map((ms) => (
                    <span key={ms} className="text-slate-400">
                      {ms}ms
                    </span>
                  ))}
                </div>
              ) : (
                <div className="w-full flex justify-between">
                  <span>0% (Start)</span>
                  <span>25%</span>
                  <span>50%</span>
                  <span>75%</span>
                  <span>100% (Sequence End)</span>
                </div>
              )}
            </div>

            {/* Sequence Tracks */}
            <div className="space-y-4">
              {tracks.map((track) => {
                const trackScaleMax = scaleMode === 'normalized' ? Math.max(track.totalDurationMs, 1) : globalMaxMs;
                const playheadPct = Math.min(100, Math.max(0, (playheadMs / trackScaleMax) * 100));

                return (
                  <div key={track.sequenceKey} className="space-y-1.5">
                    {/* Track Header */}
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        {track.category === 'aerial_hold' ? (
                          <Wind className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        ) : (
                          <Anchor className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        )}
                        <span className="font-semibold text-white truncate">
                          {isAr ? track.titleAr : track.titleEn}
                        </span>
                        <span className="text-slate-500 hidden sm:inline" aria-hidden="true">·</span>
                        <span className="text-[11px] text-slate-400 hidden sm:inline truncate">
                          {track.category === 'aerial_hold'
                            ? (isAr ? 'تثبيت جوي' : 'Aerial Hold')
                            : (isAr ? 'استعادة أرضية' : 'Ground Recovery')}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400 shrink-0 tabular-nums">
                        <span>
                          {isAr ? 'تثبيت' : 'Hold'}:{' '}
                          <strong className="text-cyan-300">{track.holdDurationMs}ms</strong>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {isAr ? 'الإجمالي' : 'Total'}:{' '}
                          <strong className="text-white">{track.totalDurationMs}ms</strong>
                        </span>
                        <span className="text-slate-500">
                          ({msToPhysicsTicks(track.totalDurationMs, 120)}t)
                        </span>
                      </div>
                    </div>

                    {/* Track Bar Container with Vertical Gridlines */}
                    <div
                      ref={(el) => {
                        trackRefs.current[track.sequenceKey] = el;
                      }}
                      data-testid={`macro-track-${track.sequenceKey}`}
                      className="relative h-12 w-full bg-[#090f1d] border border-slate-800/90 rounded-lg overflow-visible flex items-center"
                    >
                      {/* Background Gridlines */}
                      {scaleMode === 'absolute' &&
                        rulerTicks.slice(1, -1).map((ms) => (
                          <div
                            key={ms}
                            className="absolute top-0 bottom-0 w-px bg-slate-800/60 pointer-events-none"
                            style={{ left: `${(ms / globalMaxMs) * 100}%` }}
                          />
                        ))}

                      {/* Playhead Line */}
                      {isPlaying && (
                        <div
                          className="absolute top-[-4px] bottom-[-4px] w-0.5 bg-amber-400 z-30 pointer-events-none shadow-[0_0_8px_#fbbf24]"
                          style={{ left: `${playheadPct}%` }}
                        />
                      )}

                      {/* Draggable Bar Segments */}
                      <div className="relative z-10 w-full h-full flex items-center px-0.5">
                        {track.segments.map((seg) => {
                          const rawWidthPct = (seg.durationMs / trackScaleMax) * 100;
                          const isDraggingThis = dragState?.segmentId === seg.id;
                          const isSelected = selectedSegmentId === seg.id;
                          const isPlayheadActive =
                            isPlaying && playheadMs >= seg.startMs && playheadMs < seg.endMs;

                          return (
                            <div
                              key={seg.id}
                              data-testid={`macro-bar-${seg.id}`}
                              role="slider"
                              tabIndex={0}
                              aria-label={`${seg.labelEn} duration in milliseconds`}
                              aria-valuemin={seg.minMs}
                              aria-valuemax={seg.maxMs}
                              aria-valuenow={seg.durationMs}
                              onClick={() => setSelectedSegmentId(seg.id)}
                              onKeyDown={(e) => handleSegmentKeyDown(e, seg)}
                              onPointerDown={(e) => startBarDrag(e, track, seg)}
                              style={{
                                width: `${rawWidthPct}%`,
                                minWidth: '28px',
                              }}
                              className={`group relative h-9 mx-[1px] rounded-md border transition-colors cursor-ew-resize touch-none flex items-center justify-between px-2 overflow-visible focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${getRoleSegmentStyles(
                                seg.role,
                                isSelected || isDraggingThis,
                                isPlayheadActive
                              )}`}
                              title={`${seg.labelEn}: ${seg.durationMs}ms (Range: ${seg.minMs}-${seg.maxMs}ms). Drag horizontally to adjust.`}
                            >
                              {/* Floating Live Drag Readout Tooltip */}
                              {isDraggingThis && (
                                <div className="absolute -top-9 right-0 z-40 px-2 py-1 rounded bg-slate-950 border border-cyan-400 text-white text-[11px] font-mono font-bold whitespace-nowrap shadow-lg pointer-events-none tabular-nums">
                                  {dragState.currentDurationMs}ms · {msToPhysicsTicks(dragState.currentDurationMs, 120)}t{' '}
                                  ({dragState.currentDurationMs - dragState.initialDurationMs >= 0 ? '+' : ''}
                                  {dragState.currentDurationMs - dragState.initialDurationMs}ms)
                                </div>
                              )}

                              {/* Label & Duration */}
                              <div className="min-w-0 flex items-center gap-1.5 font-mono text-[11px] leading-none overflow-hidden">
                                <span className="font-bold tabular-nums shrink-0">{seg.durationMs}ms</span>
                                {rawWidthPct > 11 && (
                                  <span className="truncate opacity-85 text-[10px]">
                                    {isAr ? seg.labelAr : seg.labelEn}
                                  </span>
                                )}
                              </div>

                              {/* Right-Edge Tactile Drag Handle */}
                              <div
                                data-testid={`macro-drag-handle-${seg.id}`}
                                className="h-6 w-3 -mr-1 rounded-sm flex items-center justify-center opacity-60 group-hover:opacity-100 hover:bg-white/20 transition-opacity shrink-0"
                              >
                                <GripVertical className="w-3 h-3" />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* SELECTED PHASE INSPECTOR & COMPARATIVE VERTICAL DURATION BARS */}
        {selectedContext.track && selectedContext.segment && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-2 border-t border-slate-800/80">
            {/* Left (7 cols): Zoomed Vertical Bar Chart of Selected Sequence's Phases */}
            <div className="lg:col-span-7 bg-[#060a14] border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                    {isAr
                      ? `مقارنة مراحل: ${selectedContext.track.titleAr}`
                      : `Phase Breakdown: ${selectedContext.track.titleEn}`}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {isAr
                      ? 'انقر على أي شريط للمعاينة أو اسحب منزلق المعايرة أدناه'
                      : 'Click any phase column to inspect or drag the chart bars above'}
                  </p>
                </div>
                <span className="text-xs font-mono font-bold text-cyan-300 tabular-nums">
                  {selectedContext.track.totalDurationMs} ms
                </span>
              </div>

              <div dir="ltr" className="h-44 flex items-end gap-3 pt-4 pb-1 px-2 border-b border-slate-800/80">
                {selectedContext.track.segments.map((seg) => {
                  const maxPhaseMax = Math.max(...selectedContext.track.segments.map((s) => s.maxMs), 100);
                  const heightPct = Math.max(12, (seg.durationMs / maxPhaseMax) * 100);
                  const isSel = seg.id === selectedContext.segment.id;

                  return (
                    <button
                      key={seg.id}
                      type="button"
                      onClick={() => setSelectedSegmentId(seg.id)}
                      className={`flex-1 h-full flex flex-col justify-end items-center group cursor-pointer focus-visible:outline-none`}
                    >
                      <span className="text-[11px] font-mono font-bold text-white mb-1 tabular-nums">
                        {seg.durationMs}ms
                      </span>
                      <div
                        style={{ height: `${heightPct}%` }}
                        className={`w-full max-w-[72px] rounded-t-md border transition-all ${
                          seg.role === 'hold'
                            ? isSel
                              ? 'bg-cyan-400/50 border-cyan-300'
                              : 'bg-cyan-500/25 border-cyan-500/50 group-hover:bg-cyan-500/35'
                            : seg.role === 'recovery'
                            ? isSel
                              ? 'bg-emerald-400/50 border-emerald-300'
                              : 'bg-emerald-500/25 border-emerald-500/50 group-hover:bg-emerald-500/35'
                            : isSel
                            ? 'bg-amber-400/50 border-amber-300'
                            : 'bg-amber-500/25 border-amber-500/50 group-hover:bg-amber-500/35'
                        }`}
                      />
                    </button>
                  );
                })}
              </div>

              <div dir="ltr" className="flex gap-3 px-2 text-center">
                {selectedContext.track.segments.map((seg) => (
                  <div key={seg.id} className="flex-1 min-w-0">
                    <div
                      className={`text-[11px] font-medium truncate ${
                        seg.id === selectedContext.segment.id ? 'text-cyan-300 font-bold' : 'text-slate-400'
                      }`}
                    >
                      {isAr ? seg.labelAr : seg.labelEn}
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 tabular-nums">
                      {seg.minMs}–{seg.maxMs}ms
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right (5 cols): Active Phase Precision Inspector */}
            <div className="lg:col-span-5 bg-[#060a14] border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono text-cyan-400 flex items-center gap-1.5 font-semibold">
                    <Sliders className="w-3.5 h-3.5" />
                    <span>{getRoleTextLabel(selectedContext.segment.role)}</span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    {selectedContext.segment.id}
                  </span>
                </div>

                <div className="flex items-baseline justify-between gap-2">
                  <h4 className="text-base font-bold text-white">
                    {isAr ? selectedContext.segment.labelAr : selectedContext.segment.labelEn}
                  </h4>
                  <span className="text-xl font-black font-mono text-cyan-300 tabular-nums">
                    {selectedContext.segment.durationMs} ms
                  </span>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  {isAr ? selectedContext.segment.descAr : selectedContext.segment.descEn}
                </p>
              </div>

              {/* Fine Adjustment Slider & Stepper Buttons */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 tabular-nums">
                  <span>Min: {selectedContext.segment.minMs} ms</span>
                  <span>
                    {selectedContext.segment.startMs}ms → {selectedContext.segment.endMs}ms
                  </span>
                  <span>Max: {selectedContext.segment.maxMs} ms</span>
                </div>

                <input
                  type="range"
                  aria-label="Selected macro phase duration slider"
                  min={selectedContext.segment.minMs}
                  max={selectedContext.segment.maxMs}
                  step={1}
                  value={selectedContext.segment.durationMs}
                  onChange={(e) =>
                    handleNudgeSegment(
                      selectedContext.segment,
                      Number(e.target.value) - selectedContext.segment.durationMs
                    )
                  }
                  className="w-full accent-cyan-400 h-2 bg-slate-800 rounded-lg cursor-pointer"
                />

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleNudgeSegment(selectedContext.segment, -10)}
                      className="px-2.5 py-1.5 text-xs font-mono bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-md cursor-pointer tabular-nums"
                    >
                      -10ms
                    </button>
                    <button
                      type="button"
                      onClick={() => handleNudgeSegment(selectedContext.segment, -1)}
                      className="px-2.5 py-1.5 text-xs font-mono bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-md cursor-pointer flex items-center gap-1 tabular-nums"
                    >
                      <Minus className="w-3 h-3" />
                      <span>1</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleNudgeSegment(selectedContext.segment, 1)}
                      className="px-2.5 py-1.5 text-xs font-mono bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-md cursor-pointer flex items-center gap-1 tabular-nums"
                    >
                      <Plus className="w-3 h-3" />
                      <span>1</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleNudgeSegment(selectedContext.segment, 10)}
                      className="px-2.5 py-1.5 text-xs font-mono bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-md cursor-pointer tabular-nums"
                    >
                      +10ms
                    </button>
                  </div>
                </div>
              </div>

              {/* Engine Tick Resolution Metrics */}
              <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-800/80 text-xs font-mono tabular-nums">
                <div>
                  <span className="text-[10px] text-slate-500 block">120Hz PhysX</span>
                  <span className="text-slate-200 font-bold">{selectedContext.segment.ticks120Hz} ticks</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">240Hz PhysX</span>
                  <span className="text-slate-200 font-bold">{selectedContext.segment.ticks240Hz} ticks</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">1000Hz HID</span>
                  <span className="text-emerald-400 font-bold">{selectedContext.segment.packets1000Hz} pkt</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
