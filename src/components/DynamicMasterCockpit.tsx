import React, { useState, useEffect } from 'react';
import { Language, PhysicsConfig, KeyBinding, MacroTimingConfig } from '../types/engine';
import { 
  TreeEngineTelemetry, 
  globalTreeSynchronizer, 
} from '../services/treeSynchronizerEngine';
import { 
  getBridgeDiagnostics, 
  dispatchHardwareCommand, 
  generateStandalonePackagingBundle,
  BridgeDiagnostics 
} from '../services/tauriLocalBridge';
import JSZip from 'jszip';
import {
  buildUnifiedMasterProfileSnapshot,
  UnifiedMasterProfileArm,
} from '../services/unifiedProfileArm';
import { getAllProjectFiles } from '../utils/sourceBundleRegistry';
import { AUTONOMOUS_PIPELINE_MODULES } from '../services/autonomousPipelineEngine';
import { AutonomousDualPipelinePanel } from './AutonomousDualPipelinePanel';
import { generateEpicTaInputIni } from '../services/epicGamesSdkService';
import { generateLuaScript } from '../utils/luaGenerator';
import { 
  Cpu, 
  Zap, 
  Gamepad2, 
  GitBranch, 
  Activity, 
  Radio, 
  ShieldCheck, 
  Download, 
  FileCode2, 
  Terminal, 
  Package, 
  CheckCircle2, 
  HardDrive, 
  Layers, 
  Clock, 
  Sliders, 
  ExternalLink,
  Flame,
  Gauge
} from 'lucide-react';

interface DynamicMasterCockpitProps {
  language: Language;
  physicsConfig: PhysicsConfig;
  onUpdateConfig: (newConfig: PhysicsConfig) => void;
  keybindings: KeyBinding[];
  macroTimings?: MacroTimingConfig;
  unifiedProfileArm?: UnifiedMasterProfileArm;
  onNavigateTab: (tab: any) => void;
}

export const DynamicMasterCockpit: React.FC<DynamicMasterCockpitProps> = ({
  language,
  physicsConfig,
  onUpdateConfig,
  keybindings,
  macroTimings,
  unifiedProfileArm,
  onNavigateTab,
}) => {
  const isAr = language === 'ar';

  const [telemetry, setTelemetry] = useState<TreeEngineTelemetry>(() => globalTreeSynchronizer.getSnapshot());
  const [diagnostics, setDiagnostics] = useState<BridgeDiagnostics>(() => getBridgeDiagnostics());
  const [activeCodeTab, setActiveCodeTab] = useState<'tainput' | 'lua' | 'unified_arm' | 'packaging'>('tainput');
  const [dispatchToast, setDispatchToast] = useState<string | null>(null);

  // Subscribe to live multi-threaded tree telemetry loop (auto-started on boot)
  useEffect(() => {
    globalTreeSynchronizer.updateConfig(physicsConfig, macroTimings);
    const unsubscribe = globalTreeSynchronizer.subscribe((data) => {
      setTelemetry(data);
    });

    const diagInterval = setInterval(() => {
      setDiagnostics(getBridgeDiagnostics());
    }, 1000);

    return () => {
      unsubscribe();
      clearInterval(diagInterval);
    };
  }, [physicsConfig, macroTimings]);

  const controller = telemetry.controller;
  const packagingBundle = generateStandalonePackagingBundle();
  const activeArm =
    unifiedProfileArm ||
    buildUnifiedMasterProfileSnapshot({
      physicsConfig,
      keybindings,
      macroTimings,
    });

  // Generated code in real-time under the Unified Master Profile Arm
  const liveTaInputContent = generateEpicTaInputIni(physicsConfig, keybindings);
  const liveLuaScript = generateLuaScript(physicsConfig, keybindings, macroTimings);
  const liveUnifiedArmJson = JSON.stringify(
    {
      schemaVersion: activeArm.schemaVersion,
      updatedAt: activeArm.updatedAt,
      activeProfile: activeArm.activeProfile,
      physicsConfig: activeArm.physicsConfig,
      macroTimings: activeArm.macroTimings,
      hardware: activeArm.hardware,
      syncedArtifactSizes: {
        taInputIniBytes: activeArm.compiledArtifacts.taInputIni.length,
        ghubLuaBytes: activeArm.compiledArtifacts.ghubLuaScript.length,
        pythonQtBytes: activeArm.compiledArtifacts.pythonQtEngine.length,
        powershellBytes: activeArm.compiledArtifacts.powershellInstaller.length,
        buildPs1Bytes: activeArm.compiledArtifacts.buildWindowsExePs1.length,
      },
    },
    null,
    2
  );

  const handleApply1000Hz = async () => {
    const res = await dispatchHardwareCommand('APPLY_1000HZ_REGISTRY');
    setDispatchToast(isAr ? `✓ تم التطبيق: ${res.message}` : `✓ Applied: ${res.message}`);
    setTimeout(() => setDispatchToast(null), 3500);
  };

  const handleDeployGHub = async () => {
    const res = await dispatchHardwareCommand('DEPLOY_GHUB_LUA', { script: liveLuaScript });
    setDispatchToast(isAr ? `✓ تم نشر سكريبت G-HUB: ${res.message}` : `✓ Deployed G-HUB: ${res.message}`);
    setTimeout(() => setDispatchToast(null), 3500);
  };

  const handleExportWindowsExeKit = async () => {
    try {
      const zip = new JSZip();
      const projectFiles = getAllProjectFiles(JSON.stringify(activeArm, null, 2));
      for (const [relativePath, content] of Object.entries(projectFiles)) {
        if (relativePath.endsWith('.ico') || relativePath.endsWith('.icns') || relativePath.endsWith('.png')) {
          zip.file(relativePath, content, { base64: true });
        } else {
          zip.file(relativePath, content);
        }
      }
      // Guarantee latest build_windows_exe.ps1 from packagingBundle is included at ZIP root
      zip.file('build_windows_exe.ps1', packagingBundle.buildPs1);

      // Bundle all 9 autonomous dual-pipeline scripts from /assets/aistudio into target Windows paths
      await Promise.all(
        AUTONOMOUS_PIPELINE_MODULES.map(async (mod) => {
          try {
            const resp = await fetch(mod.assetPath);
            if (resp.ok) {
              const rawContent = await resp.text();
              if (!projectFiles[mod.deployPath]) {
                zip.file(mod.deployPath, rawContent);
              }
            }
          } catch {
            // Skip if offline asset unavailable
          }
        })
      );

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'RL_Master_Engine_EXE_Build_Kit.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDispatchToast(
        isAr
          ? '✓ تم تحميل حزمة بناء الـ EXE الكاملة (.zip)! فك الضغط ثم شغّل build_windows_exe.ps1 عبر PowerShell.'
          : '✓ Downloaded complete EXE Build Kit (.zip)! Extract & run build_windows_exe.ps1 in PowerShell.'
      );
      setTimeout(() => setDispatchToast(null), 4500);
    } catch {
      handleDownloadBuildPs1();
    }
  };

  const handleDownloadBuildPs1 = () => {
    const blob = new Blob([packagingBundle.buildPs1], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'build_windows_exe.ps1';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDispatchToast(isAr ? '✓ تم تحميل سكريبت PowerShell لتجميع الـ EXE!' : '✓ build_windows_exe.ps1 downloaded!');
    setTimeout(() => setDispatchToast(null), 3500);
  };

  const handleExportUnifiedArmJson = () => {
    const blob = new Blob([JSON.stringify(activeArm, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `unified_master_profile_${activeArm.activeProfile.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDispatchToast(
      isAr ? '✓ تم تصدير حزمة ذراع البروفايل الرئيسي الموحد بالكامل!' : '✓ Unified Master Profile Arm exported!'
    );
    setTimeout(() => setDispatchToast(null), 3500);
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Top Banner: Master Tree Synchronous Status */}
      <div className="relative overflow-hidden rounded-2xl border-2 border-cyan-500/30 bg-gradient-to-br from-[#040816] via-[#091124] to-[#050b18] p-6 shadow-[0_0_50px_rgba(6,182,212,0.15)]">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none -ml-20 -mb-20"></div>

        <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-black bg-emerald-950/90 text-emerald-300 border border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.3)] animate-pulse">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span>{isAr ? 'حلقة الشجرة المتزامنة نشطة 1000Hz (بدون أزرار)' : 'TREE LOOP ACTIVE 1000Hz (AUTONOMOUS)'}</span>
              </span>

              <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-blue-950/80 text-blue-300 border border-blue-500/40">
                {diagnostics.runtime === 'TAURI_DESKTOP_EXE' 
                  ? 'Tauri Native Desktop IPC' 
                  : (isAr ? 'تشغيل ويندوز 11 محلي (Localhost مستقل)' : 'Windows 11 Standalone Localhost')}
              </span>

              <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-purple-950/80 text-purple-300 border border-purple-500/40">
                {isAr ? 'قاعدة بيانات محلية بدون سيرفرات' : 'Zero-Server Localhost Memory DB'}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-3">
              <Flame className="w-7 h-7 text-cyan-400 animate-pulse" />
              <span>
                {isAr 
                  ? 'غرفة القيادة الديناميكية ومحرك التحكم في الهاردوير' 
                  : 'Dynamic Autonomous Cockpit & Hardware Controller Engine'}
              </span>
            </h1>
            <p className="text-sm text-slate-300 max-w-3xl leading-relaxed">
              {isAr
                ? 'يعمل المحرك مثل الشجرة المتشابكة؛ بمجرد بدء التشغيل تبدأ جميع المترجمات، قارئات الهاردوير، حسابات المنحنيات وجداول LUT، وحلقات DirectInput 1000Hz بالعمل التلقائي المتزامن بأعلى كفاءة لمنافسات الـ Esports الاحترافية.'
                : 'Operates as an autonomous interconnected tree: on launch, all compilers, hardware pollers, curve LUT matrices, and 1000Hz DirectInput loops run concurrently at sub-millisecond precision for esports tournament competition.'}
            </p>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleApply1000Hz}
              className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(6,182,212,0.4)] active:scale-95"
            >
              <Zap className="w-4 h-4" />
              <span>{isAr ? 'تثبيت 1000Hz بالريجستري' : 'Lock 1000Hz Registry'}</span>
            </button>

            <button
              onClick={handleDeployGHub}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(99,102,241,0.4)] active:scale-95"
            >
              <FileCode2 className="w-4 h-4" />
              <span>{isAr ? 'نشر سكريبت G-HUB' : 'Deploy G-HUB Lua'}</span>
            </button>

            <button
              onClick={handleExportWindowsExeKit}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/40 font-bold text-xs flex items-center gap-2 transition-all active:scale-95"
            >
              <Package className="w-4 h-4" />
              <span>{isAr ? 'تصدير حزمة بناء الـ EXE (.zip)' : 'Export Windows EXE Kit (.zip)'}</span>
            </button>
          </div>
        </div>

        {dispatchToast && (
          <div className="mt-4 p-3 bg-emerald-950/90 border border-emerald-500/60 rounded-xl text-xs font-mono font-bold text-emerald-200 flex items-center gap-2 animate-slideDown">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{dispatchToast}</span>
          </div>
        )}
      </div>

      {/* Grid: Live Controller HUD (Left) + Interconnected Tree Matrix (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Real-Time Hardware Controller Visualizer (5 Cols) */}
        <div className="lg:col-span-5 bg-[#040714] border border-cyan-500/30 rounded-2xl p-5 shadow-lg space-y-5">
          <div className="flex items-center justify-between border-b border-cyan-900/50 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-cyan-950 border border-cyan-500/40 rounded-xl text-cyan-400">
                <Gamepad2 className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <h3 className="text-sm font-bold font-mono text-cyan-200 uppercase tracking-wider">
                  {isAr ? 'مستشعر يد التحكم والهاردوير المباشر' : 'Live Hardware Controller Telemetry'}
                </h3>
                <p className="text-xs text-slate-400 truncate max-w-[240px]">
                  {controller.gamepadId}
                </p>
              </div>
            </div>

            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold flex items-center gap-1 ${
              controller.isPhysicalGamepad 
                ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40' 
                : 'bg-cyan-950 text-cyan-300 border border-cyan-500/40'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${controller.isPhysicalGamepad ? 'bg-emerald-400' : 'bg-cyan-400'} animate-ping`}></span>
              <span>{controller.isPhysicalGamepad ? 'PHYSICAL USB' : 'ESPORTS LOOP'}</span>
            </span>
          </div>

          {/* Dual Analog Sticks Visualizer */}
          <div className="grid grid-cols-2 gap-4">
            {/* Left Stick (Steer / Pitch) */}
            <div className="bg-[#070d1d] border border-cyan-900/60 rounded-xl p-3 flex flex-col items-center space-y-2">
              <span className="text-[11px] font-mono font-bold text-slate-300">
                {isAr ? 'العصا اليسرى (توجيه / طيران)' : 'Left Stick (Steer / Pitch)'}
              </span>
              
              {/* Radar Scope Sphere */}
              <div className="relative w-32 h-32 rounded-full border-2 border-cyan-500/40 bg-[#030611] flex items-center justify-center overflow-hidden shadow-[inset_0_0_20px_rgba(6,182,212,0.2)]">
                {/* Crosshairs */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-full h-px bg-cyan-500/20"></div>
                  <div className="absolute h-full w-px bg-cyan-500/20"></div>
                </div>
                {/* Deadzone perimeter circle */}
                <div 
                  className="absolute rounded-full border border-dashed border-red-500/40 pointer-events-none"
                  style={{ width: `${physicsConfig.internalDeadzone * 100}%`, height: `${physicsConfig.internalDeadzone * 100}%` }}
                ></div>
                {/* Dynamic Stick Pip */}
                <div 
                  className="w-5 h-5 rounded-full bg-cyan-400 border-2 border-white shadow-[0_0_12px_#06b6d4] transition-all duration-75"
                  style={{
                    transform: `translate(${controller.leftStick.curvedX * 45}px, ${controller.leftStick.curvedY * 45}px)`
                  }}
                ></div>
              </div>

              <div className="w-full flex justify-between text-[10px] font-mono text-slate-400 px-2">
                <span>X: {controller.leftStick.curvedX.toFixed(2)}</span>
                <span>Y: {controller.leftStick.curvedY.toFixed(2)}</span>
                <span className="text-cyan-300 font-bold">R: {controller.leftStick.magnitude.toFixed(2)}</span>
              </div>
            </div>

            {/* Right Stick (Camera / Free Look) */}
            <div className="bg-[#070d1d] border border-cyan-900/60 rounded-xl p-3 flex flex-col items-center space-y-2">
              <span className="text-[11px] font-mono font-bold text-slate-300">
                {isAr ? 'العصا اليمنى (الكاميرا)' : 'Right Stick (Swivel)'}
              </span>

              <div className="relative w-32 h-32 rounded-full border-2 border-indigo-500/40 bg-[#030611] flex items-center justify-center overflow-hidden shadow-[inset_0_0_20px_rgba(99,102,241,0.2)]">
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-full h-px bg-indigo-500/20"></div>
                  <div className="absolute h-full w-px bg-indigo-500/20"></div>
                </div>
                {/* Dynamic Stick Pip */}
                <div 
                  className="w-5 h-5 rounded-full bg-indigo-400 border-2 border-white shadow-[0_0_12px_#6366f1] transition-all duration-75"
                  style={{
                    transform: `translate(${controller.rightStick.curvedX * 45}px, ${controller.rightStick.curvedY * 45}px)`
                  }}
                ></div>
              </div>

              <div className="w-full flex justify-between text-[10px] font-mono text-slate-400 px-2">
                <span>X: {controller.rightStick.curvedX.toFixed(2)}</span>
                <span>Y: {controller.rightStick.curvedY.toFixed(2)}</span>
                <span className="text-indigo-300 font-bold">R: {controller.rightStick.magnitude.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Analog Triggers (LT & RT) */}
          <div className="space-y-2 bg-[#070d1d] border border-cyan-900/40 rounded-xl p-3">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-300">
              <span>{isAr ? 'المشغلات التناظرية (L2 فرامل / R2 بنزين)' : 'Analog Triggers (L2 Brake / R2 Throttle)'}</span>
              <span className="text-cyan-300">1000Hz Sampled</span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <div className="flex justify-between text-[10px] font-mono text-slate-400 mb-1">
                  <span>LT / L2</span>
                  <span className="text-cyan-300">{(controller.leftTrigger * 100).toFixed(0)}%</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden border border-slate-700">
                  <div 
                    className="bg-cyan-500 h-full rounded-full transition-all duration-75"
                    style={{ width: `${controller.leftTrigger * 100}%` }}
                  ></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[10px] font-mono text-slate-400 mb-1">
                  <span>RT / R2</span>
                  <span className="text-indigo-300">{(controller.rightTrigger * 100).toFixed(0)}%</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden border border-slate-700">
                  <div 
                    className="bg-indigo-500 h-full rounded-full transition-all duration-75"
                    style={{ width: `${controller.rightTrigger * 100}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>

          {/* Button Matrix */}
          <div className="bg-[#070d1d] border border-cyan-900/40 rounded-xl p-3">
            <span className="text-[11px] font-mono font-bold text-slate-300 block mb-2">
              {isAr ? 'مصفوفة الأزرار السريعة (Esports Key Matrix)' : 'High-Speed Action Matrix'}
            </span>
            <div className="grid grid-cols-4 gap-2 text-center text-xs font-mono font-bold">
              <div className={`p-2 rounded-lg border transition-all ${
                controller.buttons.a 
                  ? 'bg-emerald-600 text-white border-emerald-400 shadow-[0_0_10px_#10b981]' 
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}>
                A (Jump)
              </div>
              <div className={`p-2 rounded-lg border transition-all ${
                controller.buttons.b 
                  ? 'bg-amber-600 text-white border-amber-400 shadow-[0_0_10px_#f59e0b]' 
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}>
                B (Boost)
              </div>
              <div className={`p-2 rounded-lg border transition-all ${
                controller.buttons.x 
                  ? 'bg-blue-600 text-white border-blue-400 shadow-[0_0_10px_#3b82f6]' 
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}>
                X (Drift)
              </div>
              <div className={`p-2 rounded-lg border transition-all ${
                controller.buttons.y 
                  ? 'bg-purple-600 text-white border-purple-400 shadow-[0_0_10px_#a855f7]' 
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}>
                Y (BallCam)
              </div>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-[#030611] border border-cyan-900/40 rounded-xl p-2.5">
              <span className="text-[10px] text-slate-400 block">{isAr ? 'السرعة الحالية' : 'Velocity'}</span>
              <span className="text-sm font-black font-mono text-cyan-300">{telemetry.currentVelocityUu} uu/s</span>
            </div>
            <div className="bg-[#030611] border border-cyan-900/40 rounded-xl p-2.5">
              <span className="text-[10px] text-slate-400 block">{isAr ? 'زاوية الانجراف' : 'Slip Angle'}</span>
              <span className="text-sm font-black font-mono text-indigo-300">{telemetry.slipAngleDeg}°</span>
            </div>
            <div className="bg-[#030611] border border-cyan-900/40 rounded-xl p-2.5">
              <span className="text-[10px] text-slate-400 block">{isAr ? 'معدل المعالجة' : 'Throughput'}</span>
              <span className="text-sm font-black font-mono text-emerald-300">1000 Hz</span>
            </div>
          </div>
        </div>

        {/* Right Column: Interconnected Dynamic Tree Matrix (7 Cols) */}
        <div className="lg:col-span-7 bg-[#040714] border border-cyan-500/30 rounded-2xl p-5 shadow-lg space-y-5">
          <div className="flex items-center justify-between border-b border-cyan-900/50 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-indigo-950 border border-indigo-500/40 rounded-xl text-indigo-400">
                <GitBranch className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <h3 className="text-sm font-bold font-mono text-white uppercase tracking-wider">
                  {isAr ? 'مصفوفة الشجرة المتكاملة (8 فروع تعمل بتزامن كامل)' : 'Unified Interconnected Tree Matrix (8 Leaves)'}
                </h3>
                <p className="text-xs text-slate-400">
                  {isAr ? 'تعمل جميع العقد بشكل متزامن فوري وتغذي المحرك بدون تدخل يدوي' : 'All 8 leaves operate in real-time loops feeding the core engine'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-md text-[10px] font-mono font-black bg-emerald-950 text-emerald-300 border border-emerald-500/40">
                CYCLE #{telemetry.cycle}
              </span>
            </div>
          </div>

          {/* 8-Leaf Dynamic Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {telemetry.leaves.map((leaf, idx) => (
              <div 
                key={leaf.id}
                className="bg-[#060c1d] border border-cyan-900/50 hover:border-cyan-500/50 rounded-xl p-3.5 space-y-2 transition-all hover:shadow-[0_0_15px_rgba(6,182,212,0.15)] group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-pulse"></span>
                    <h4 className="text-xs font-bold font-mono text-cyan-200 group-hover:text-white transition-colors">
                      {isAr ? leaf.nameAr : leaf.nameEn}
                    </h4>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700">
                    {leaf.latencyUs} µs
                  </span>
                </div>

                <p className="text-[11px] text-slate-400 leading-tight">
                  {isAr ? leaf.detailAr : leaf.detailEn}
                </p>

                <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 border-t border-slate-800/80 pt-2">
                  <span>{leaf.throughputHz} Hz Rate</span>
                  <span className="text-cyan-400 font-bold">{leaf.ticksCount.toLocaleString()} ticks</span>
                </div>
              </div>
            ))}
          </div>

          {/* Dynamic Code & Packaging Tabs */}
          <div className="border border-cyan-900/60 rounded-xl bg-[#030611] p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-cyan-900/40 pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setActiveCodeTab('tainput')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                    activeCodeTab === 'tainput'
                      ? 'bg-cyan-600 text-white shadow-md'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  TAInput.ini (Real-time)
                </button>
                <button
                  onClick={() => setActiveCodeTab('lua')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                    activeCodeTab === 'lua'
                      ? 'bg-cyan-600 text-white shadow-md'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  Logitech G-HUB Lua
                </button>
                <button
                  onClick={() => setActiveCodeTab('unified_arm')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                    activeCodeTab === 'unified_arm'
                      ? 'bg-emerald-600 text-white shadow-md'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  {isAr ? 'ذراع البروفايل الموحد' : 'Unified Profile Arm'}
                </button>
                <button
                  onClick={() => setActiveCodeTab('packaging')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                    activeCodeTab === 'packaging'
                      ? 'bg-cyan-600 text-white shadow-md'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  {isAr ? 'حزمة بناء الـ EXE' : 'EXE Packaging Kit'}
                </button>
              </div>

              <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>{isAr ? 'تحديث متزامن تلقائي' : 'Auto-Synchronized'}</span>
              </span>
            </div>

            {/* Code Output Viewer */}
            <div dir="ltr" className="max-h-44 overflow-y-auto rounded-lg bg-[#02040a] p-3 border border-slate-800 text-[11px] font-mono text-slate-300 text-left">
              {activeCodeTab === 'tainput' && (
                <pre className="whitespace-pre-wrap">{liveTaInputContent.slice(0, 1200)}...</pre>
              )}
              {activeCodeTab === 'lua' && (
                <pre className="whitespace-pre-wrap">{liveLuaScript.slice(0, 1200)}...</pre>
              )}
              {activeCodeTab === 'unified_arm' && (
                <div className="space-y-2">
                  <p className="text-emerald-300 font-bold" dir={isAr ? 'rtl' : 'ltr'}>
                    {isAr
                      ? `ذراع البروفايل الموحد الديناميكي: ${activeArm.activeProfile.name} (5 ملفات متصلة لحظياً)`
                      : `Unified Master Profile Arm: ${activeArm.activeProfile.name} (5 Live Synced Targets)`}
                  </p>
                  <pre className="whitespace-pre-wrap text-slate-300">{liveUnifiedArmJson}</pre>
                </div>
              )}
              {activeCodeTab === 'packaging' && (
                <div className="space-y-2">
                  <p className="text-cyan-300 font-bold" dir={isAr ? 'rtl' : 'ltr'}>
                    {isAr ? 'ملف التجميع التلقائي لويندوز 11 (build_windows_exe.ps1):' : 'Windows 11 Automated Standalone EXE Builder (PowerShell):'}
                  </p>
                  <pre className="whitespace-pre-wrap text-slate-400">{packagingBundle.buildPs1}</pre>
                </div>
              )}
            </div>

            {/* Bottom Actions for Active Tab */}
            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-slate-400 text-[11px]">
                {isAr ? `البروفايل المتصل: ${activeArm.activeProfile.name}` : `Bound Arm: ${activeArm.activeProfile.name}`}
              </span>

              <div className="flex items-center gap-2">
                {activeCodeTab === 'packaging' ? (
                  <button
                    onClick={handleDownloadBuildPs1}
                    className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-mono font-bold text-xs flex items-center gap-1.5 shadow-md active:scale-95"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{isAr ? 'تحميل build_windows_exe.ps1' : 'Download build_windows_exe.ps1'}</span>
                  </button>
                ) : activeCodeTab === 'unified_arm' ? (
                  <button
                    onClick={handleExportUnifiedArmJson}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold text-xs flex items-center gap-1.5 shadow-md active:scale-95"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{isAr ? 'تصدير ذراع البروفايل (.json)' : 'Export Unified Arm (.json)'}</span>
                  </button>
                ) : (
                  <button
                    onClick={() => onNavigateTab('classic_pro')}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 font-mono font-bold text-xs flex items-center gap-1.5 border border-slate-700"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    <span>{isAr ? 'معايرة الأرقام الدقيقة' : 'Fine-Tune Parameters'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Integrated 9-Module Dynamic Autonomous Dual-Pipeline Subsystem */}
      <AutonomousDualPipelinePanel
        language={language}
        telemetry={telemetry}
        physicsConfig={physicsConfig}
        macroTimings={macroTimings}
        onDispatchToast={(msg) => {
          setDispatchToast(msg);
          setTimeout(() => setDispatchToast(null), 3500);
        }}
      />
    </div>
  );
};
