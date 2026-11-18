import React, { useEffect, useState } from 'react';
import {
  AUTONOMOUS_PIPELINE_MODULES,
  AutonomousModuleDescriptor,
  PipelineModuleCategory,
  generateLiveSyncedDualAxisLua,
  generateLiveSyncedMacroBridgeLua,
} from '../services/autonomousPipelineEngine';
import {
  TreeEngineTelemetry,
  globalTreeSynchronizer,
} from '../services/treeSynchronizerEngine';
import { Language, MacroTimingConfig, PhysicsConfig } from '../types/engine';
import { INITIAL_MACRO_TIMINGS } from '../data/initialData';
import {
  Activity,
  Check,
  Copy,
  Download,
  FileCode2,
  Gauge,
  RotateCcw,
  Sliders,
} from 'lucide-react';

interface AutonomousDualPipelinePanelProps {
  language: Language;
  telemetry: TreeEngineTelemetry;
  physicsConfig: PhysicsConfig;
  macroTimings?: MacroTimingConfig;
  onDispatchToast?: (message: string) => void;
}

type CompiledOutputView =
  | 'source_asset'
  | 'zone_hpp'
  | 'zone_lua'
  | 'zone_json'
  | 'dual_axis_lua'
  | 'macro_lua';

export const AutonomousDualPipelinePanel: React.FC<AutonomousDualPipelinePanelProps> = ({
  language,
  telemetry,
  physicsConfig,
  macroTimings = INITIAL_MACRO_TIMINGS,
  onDispatchToast,
}) => {
  const isAr = language === 'ar';
  const [selectedCategory, setSelectedCategory] = useState<'all' | PipelineModuleCategory>('all');
  const [selectedModule, setSelectedModule] = useState<AutonomousModuleDescriptor>(
    AUTONOMOUS_PIPELINE_MODULES[0]
  );
  const [compiledView, setCompiledView] = useState<CompiledOutputView>('source_asset');
  const [assetSourceText, setAssetSourceText] = useState<string>('');
  const [assetLoading, setAssetLoading] = useState<boolean>(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);

  const shm = telemetry.autonomousShm;
  const zone = telemetry.proZone;

  const filteredModules =
    selectedCategory === 'all'
      ? AUTONOMOUS_PIPELINE_MODULES
      : AUTONOMOUS_PIPELINE_MODULES.filter((m) => m.category === selectedCategory);

  useEffect(() => {
    let cancelled = false;
    setAssetLoading(true);
    setAssetError(null);
    fetch(selectedModule.assetPath)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) {
          setAssetSourceText(text);
          setAssetLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setAssetError(err instanceof Error ? err.message : String(err));
          setAssetLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedModule]);

  const activeDisplayedCode = (() => {
    switch (compiledView) {
      case 'zone_hpp':
        return zone.zoneMomentumHpp;
      case 'zone_lua':
        return zone.zoneMomentumLua;
      case 'zone_json':
        return zone.activeZoneInputJson;
      case 'dual_axis_lua':
        return generateLiveSyncedDualAxisLua(physicsConfig);
      case 'macro_lua':
        return generateLiveSyncedMacroBridgeLua(macroTimings);
      case 'source_asset':
      default:
        return assetSourceText;
    }
  })();

  const activeDownloadFilename = (() => {
    switch (compiledView) {
      case 'zone_hpp':
        return 'zone_momentum.hpp';
      case 'zone_lua':
        return 'zone_momentum.lua';
      case 'zone_json':
        return 'active_zone_input.json';
      case 'dual_axis_lua':
        return 'rl_dual_axis_vector.lua';
      case 'macro_lua':
        return 'rl_macro_bridge.lua';
      case 'source_asset':
      default:
        return selectedModule.deployPath.split('/').pop() || 'module.txt';
    }
  })();

  const handleCopyActiveCode = () => {
    if (!activeDisplayedCode) return;
    navigator.clipboard.writeText(activeDisplayedCode);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1800);
    onDispatchToast?.(
      isAr ? `✓ تم نسخ ${activeDownloadFilename}` : `✓ Copied ${activeDownloadFilename}`
    );
  };

  const handleDownloadActiveCode = () => {
    if (!activeDisplayedCode) return;
    const blob = new Blob([activeDisplayedCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeDownloadFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onDispatchToast?.(
      isAr ? `✓ تم تحميل ${activeDownloadFilename}` : `✓ Downloaded ${activeDownloadFilename}`
    );
  };

  const handleRunMicroBenchmark = () => {
    const stats = globalTreeSynchronizer.runMicroBenchmark();
    onDispatchToast?.(
      isAr
        ? `✓ اختبار 1000 دورة: أقل زمن ${stats.minUs} µs · متوسط ${stats.avgUs} µs · p99 ${stats.p99Us} µs`
        : `✓ Benchmark N=${stats.samples}: min ${stats.minUs} µs · avg ${stats.avgUs} µs · p99 ${stats.p99Us} µs`
    );
  };

  const handleResetZoneTuning = () => {
    globalTreeSynchronizer.updateZoneParams({
      lightnessMicroGain: 1.26,
      weightMomentumRetention: 0.95,
      fastAerialPitchBias: 1.14,
      airDragCompensation: 1.09,
      stallYawTolerance: 0.085,
    });
    onDispatchToast?.(
      isAr ? '✓ تمت استعادة إعدادات Pro Zone 0.05/0.05' : '✓ Reset Pro Zone curve to 0.05/0.05 defaults'
    );
  };

  // Build polyline coordinates for 256-entry PRO_RADIAL_LUT curve
  const lutPolylinePoints = zone.radialLut256
    .filter((_, idx) => idx % 4 === 0 || idx === 255)
    .map((val, i, arr) => {
      const x = (i / Math.max(arr.length - 1, 1)) * 280;
      const y = 92 - val * 84;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <section
      aria-label={isAr ? 'بايبلاين الشمولية التلقائي المزدوج' : 'Autonomous Dual-Pipeline Subsystem'}
      className="bg-[#040714] border border-slate-800 rounded-2xl p-6 space-y-6"
    >
      {/* Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
            <span>{shm.shmName}</span>
            <span aria-hidden="true">·</span>
            <span>{shm.shmSizeBytes} B Seqlock</span>
            <span aria-hidden="true">·</span>
            <span>Magic {shm.shmMagicHex}</span>
            <span aria-hidden="true">·</span>
            <span>{shm.mmfName}</span>
          </div>
          <h2 className="text-lg font-bold text-white tracking-tight">
            {isAr
              ? 'البايبلاين التلقائي المزدوج والذاكرة المشتركة (Python SHM · C fn_shm.dll · Lua 5.4 · PowerShell)'
              : 'Dynamic Autonomous Dual-Pipeline (Python SHM · C fn_shm.dll · Lua 5.4 · PowerShell)'}
          </h2>
          <p className="text-xs text-slate-400 max-w-3xl leading-relaxed">
            {isAr
              ? 'تشغيل متزامن لجميع الوحدات التسع: تجميع جداول 256-LUT الفورية، قراءة إطارات Seqlock 120Hz، كشف تلامس العجلات الأربع للـ Flip Reset، وإطلاق نبضة ماكرو G502 X تلقائياً.'
              : 'All 9 native modules synced live: 256-entry Pro Zone radial LUT compilation, 120Hz Seqlock shared-memory frames, 4-wheel Flip Reset lock detection, and G502 X auto-stall dispatch.'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={handleRunMicroBenchmark}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Gauge className="w-4 h-4" />
            <span>{isAr ? 'قياس سرعة البايبلاين (1000 دورة)' : 'Run 1000-Iter Benchmark'}</span>
          </button>

          <button
            type="button"
            onClick={handleResetZoneTuning}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{isAr ? 'افتراضي 0.05/0.05' : 'Reset 0.05/0.05'}</span>
          </button>
        </div>
      </div>

      {/* Live SHM Seqlock Telemetry Metrics Row (Flat hairline grid, tabular-nums) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="bg-[#070d1d] border border-slate-800 rounded-xl p-3">
          <div className="text-[11px] text-slate-400">{isAr ? 'عداد Seqlock' : 'Seqlock Seq / Tick'}</div>
          <div className="text-sm font-mono tabular-nums font-bold text-cyan-300 mt-1">
            #{shm.seq} · {shm.tick}
          </div>
        </div>

        <div className="bg-[#070d1d] border border-slate-800 rounded-xl p-3">
          <div className="text-[11px] text-slate-400">{isAr ? 'تلامس العجلات بالكرة' : 'Wheel Ball Contact'}</div>
          <div
            className={`text-sm font-mono tabular-nums font-bold mt-1 ${
              shm.flipResetReady ? 'text-emerald-400' : 'text-slate-200'
            }`}
          >
            {shm.wheelsTouching}/4 {shm.flipResetReady ? (isAr ? 'جاهز' : 'RESET LOCK') : (isAr ? 'تتبع' : 'TRACKING')}
          </div>
        </div>

        <div className="bg-[#070d1d] border border-slate-800 rounded-xl p-3">
          <div className="text-[11px] text-slate-400">{isAr ? 'مجموع Flip Resets' : 'Total Resets Locked'}</div>
          <div className="text-sm font-mono tabular-nums font-bold text-emerald-300 mt-1">
            {shm.totalResetsDetected} · {shm.autoStallDelayMs} ms
          </div>
        </div>

        <div className="bg-[#070d1d] border border-slate-800 rounded-xl p-3">
          <div className="text-[11px] text-slate-400">{isAr ? 'إحداثيات السيارة (uu)' : 'Car Pos (X, Y, Z)'}</div>
          <div className="text-xs font-mono tabular-nums text-slate-200 mt-1 truncate">
            {shm.carPos[0].toFixed(0)}, {shm.carPos[1].toFixed(0)}, {shm.carPos[2].toFixed(0)}
          </div>
        </div>

        <div className="bg-[#070d1d] border border-slate-800 rounded-xl p-3">
          <div className="text-[11px] text-slate-400">{isAr ? 'متجه Speedflip 28°' : '28° Speedflip Vector'}</div>
          <div className="text-xs font-mono tabular-nums text-indigo-300 mt-1 truncate">
            L({shm.speedflipLeft[0].toFixed(2)}, {shm.speedflipLeft[1].toFixed(2)})
          </div>
        </div>

        <div className="bg-[#070d1d] border border-slate-800 rounded-xl p-3">
          <div className="text-[11px] text-slate-400">{isAr ? 'كمون الماكرو (Avg / p99)' : 'Macro Avg / p99'}</div>
          <div className="text-sm font-mono tabular-nums font-bold text-amber-300 mt-1">
            {shm.latencyStatsUs.avgUs} / {shm.latencyStatsUs.p99Us} µs
          </div>
        </div>
      </div>

      {/* Main Split: Pro Zone Curve & Sliders (Left 5 cols) + 9-Module Explorer & Live Compiler Output (Right 7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left: Live 256-Entry Pro Zone Compiler & Hermite Transfer Curve */}
        <div className="lg:col-span-5 bg-[#070d1d] border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-bold text-white">
                  {isAr ? 'مترجم منحنيات Pro Zone 256-LUT' : 'Pro Zone 256-LUT Curve Compiler'}
                </h3>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-slate-400">
                {zone.compileTimeMs} ms
              </span>
            </div>

            {/* SVG Transfer Curve Plot */}
            <div className="bg-[#030611] border border-slate-800 rounded-lg p-3">
              <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400 mb-2">
                <span>{zone.params.profileName}</span>
                <span className="text-cyan-300">
                  Calibrated: [{zone.calibratedVector[0].toFixed(3)}, {zone.calibratedVector[1].toFixed(3)}]
                </span>
              </div>
              <svg viewBox="0 0 280 96" className="w-full h-24 overflow-visible" role="img" aria-label="256-entry Radial LUT transfer curve">
                <line x1="0" y1="92" x2="280" y2="8" stroke="#1e293b" strokeWidth="1" strokeDasharray="3 3" />
                <line x1="0" y1="50" x2="280" y2="50" stroke="#0f172a" strokeWidth="1" />
                <polyline
                  fill="none"
                  stroke="#06b6d4"
                  strokeWidth="2"
                  points={lutPolylinePoints}
                />
              </svg>
              <div className="flex justify-between text-[10px] font-mono tabular-nums text-slate-500 mt-1">
                <span>Deadzone {zone.params.innerDeadzone.toFixed(2)}</span>
                <span>45% Micro-Zone Transition</span>
                <span>Outer {zone.params.outerDeadzone.toFixed(2)}</span>
              </div>
            </div>

            {/* Live Tuning Sliders */}
            <div className="space-y-3 pt-1">
              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>{isAr ? 'استجابة الدقة الصغرى (Lightness Gain)' : 'Lightness Micro Gain'}</span>
                  <span className="font-mono tabular-nums text-cyan-300">{zone.params.lightnessMicroGain.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.90"
                  max="1.60"
                  step="0.01"
                  value={zone.params.lightnessMicroGain}
                  onChange={(e) =>
                    globalTreeSynchronizer.updateZoneParams({ lightnessMicroGain: parseFloat(e.target.value) })
                  }
                  className="w-full accent-cyan-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>{isAr ? 'حفظ زخم الدوران (Weight Retention)' : 'Weight Momentum Retention'}</span>
                  <span className="font-mono tabular-nums text-cyan-300">{zone.params.weightMomentumRetention.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.50"
                  max="1.00"
                  step="0.01"
                  value={zone.params.weightMomentumRetention}
                  onChange={(e) =>
                    globalTreeSynchronizer.updateZoneParams({ weightMomentumRetention: parseFloat(e.target.value) })
                  }
                  className="w-full accent-cyan-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>{isAr ? 'انحياز الطيران السريع (Aerial Pitch Bias)' : 'Fast Aerial Pitch Bias'}</span>
                  <span className="font-mono tabular-nums text-cyan-300">{zone.params.fastAerialPitchBias.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.90"
                  max="1.45"
                  step="0.01"
                  value={zone.params.fastAerialPitchBias}
                  onChange={(e) =>
                    globalTreeSynchronizer.updateZoneParams({ fastAerialPitchBias: parseFloat(e.target.value) })
                  }
                  className="w-full accent-cyan-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>{isAr ? 'سماحية Yaw للـ Stall' : 'Stall Yaw Tolerance'}</span>
                  <span className="font-mono tabular-nums text-cyan-300">{zone.params.stallYawTolerance.toFixed(3)}</span>
                </div>
                <input
                  type="range"
                  min="0.030"
                  max="0.180"
                  step="0.005"
                  value={zone.params.stallYawTolerance}
                  onChange={(e) =>
                    globalTreeSynchronizer.updateZoneParams({ stallYawTolerance: parseFloat(e.target.value) })
                  }
                  className="w-full accent-cyan-500 cursor-pointer"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-3 flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400">
            <span>
              {isAr ? 'ستال G502 X:' : 'G502X Stall:'} Pitch {shm.lastStallPitch} · Yaw {shm.lastStallYaw}
            </span>
            <span className="text-emerald-400">
              {shm.autoStallActive ? (isAr ? 'نبضة نشطة' : 'PULSE FIRED') : (isAr ? 'مراقبة 120Hz' : 'ARMED 120Hz')}
            </span>
          </div>
        </div>

        {/* Right: All 9 Autonomous Pipeline Modules & Live Compiled Artifacts */}
        <div className="lg:col-span-7 bg-[#070d1d] border border-slate-800 rounded-xl p-4 flex flex-col space-y-4">
          {/* Category Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <FileCode2 className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white">
                {isAr ? 'وحدات البايبلاين المدمجة (9 وحدات مترابطة)' : '9 Autonomous Pipeline Modules & Outputs'}
              </h3>
            </div>

            <div className="flex items-center gap-1 p-1 bg-[#030611] border border-slate-800 rounded-lg overflow-x-auto">
              {(
                [
                  ['all', isAr ? 'الكل (9)' : 'All (9)'],
                  ['compiler', isAr ? 'المترجم' : 'Compiler'],
                  ['shm_bridge', isAr ? 'جسور SHM' : 'SHM'],
                  ['native_c', 'C DLL'],
                  ['lua_core', 'Lua 5.4'],
                  ['powershell', 'PowerShell'],
                ] as const
              ).map(([cat, label]) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 9-Module Selection Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {filteredModules.map((mod) => {
              const isSelected = selectedModule.id === mod.id;
              return (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => {
                    setSelectedModule(mod);
                    setCompiledView('source_asset');
                  }}
                  className={`p-2.5 rounded-lg border text-start transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#0b1730] border-cyan-500 text-white'
                      : 'bg-[#030611] border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  <div className="text-[10px] font-mono text-cyan-400 truncate">{mod.deployPath}</div>
                  <div className="text-xs font-semibold truncate mt-0.5">
                    {isAr ? mod.nameAr : mod.name}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected Module Metadata + Compiled Output Switcher */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 border-t border-slate-800 pt-3">
            <span className="truncate max-w-md">
              {isAr ? selectedModule.runtimeRoleAr : selectedModule.runtimeRole}
            </span>
            <span className="font-mono text-slate-500">{selectedModule.assetPath}</span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 flex-wrap bg-[#030611] border border-slate-800 p-1 rounded-lg">
              {(
                [
                  ['source_asset', isAr ? 'المصدر الأصلي' : 'Module Source'],
                  ['zone_hpp', 'zone_momentum.hpp'],
                  ['zone_lua', 'zone_momentum.lua'],
                  ['zone_json', 'active_zone_input.json'],
                  ['dual_axis_lua', 'rl_dual_axis_vector.lua'],
                  ['macro_lua', 'rl_macro_bridge.lua'],
                ] as const
              ).map(([viewId, label]) => (
                <button
                  key={viewId}
                  type="button"
                  onClick={() => setCompiledView(viewId)}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    compiledView === viewId
                      ? 'bg-slate-800 text-cyan-300'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCopyActiveCode}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-mono flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey ? (isAr ? 'تم النسخ' : 'Copied') : (isAr ? 'نسخ' : 'Copy')}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadActiveCode}
                className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-mono flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{activeDownloadFilename}</span>
              </button>
            </div>
          </div>

          {/* Code Previewer */}
          <div
            dir="ltr"
            className="flex-1 min-h-[210px] max-h-64 overflow-y-auto rounded-lg bg-[#030611] border border-slate-800 p-3 text-[11px] font-mono text-slate-300 text-left"
          >
            {compiledView === 'source_asset' && assetLoading ? (
              <div className="text-slate-500 flex items-center gap-2">
                <Activity className="w-4 h-4 animate-spin text-cyan-400" />
                <span>Loading {selectedModule.assetPath}...</span>
              </div>
            ) : compiledView === 'source_asset' && assetError ? (
              <div className="text-amber-400">
                Could not fetch {selectedModule.assetPath} ({assetError})
              </div>
            ) : (
              <pre className="whitespace-pre-wrap">{activeDisplayedCode}</pre>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
