import { MacroTimingConfig } from '../types/engine';

export type SequenceCategory = 'aerial_hold' | 'ground_recovery';
export type PhaseRole = 'hold' | 'transition' | 'recovery';

export interface MacroTimingSegment {
  id: string;
  sequenceKey: keyof MacroTimingConfig;
  paramKey: string;
  labelEn: string;
  labelAr: string;
  descEn: string;
  descAr: string;
  durationMs: number;
  startMs: number;
  endMs: number;
  minMs: number;
  maxMs: number;
  role: PhaseRole;
  ticks120Hz: number;
  ticks240Hz: number;
  packets1000Hz: number;
}

export interface MacroTimingSequenceTrack {
  sequenceKey: keyof MacroTimingConfig;
  titleEn: string;
  titleAr: string;
  subtitleEn: string;
  subtitleAr: string;
  category: SequenceCategory;
  totalDurationMs: number;
  holdDurationMs: number;
  transitionDurationMs: number;
  segments: MacroTimingSegment[];
}

export interface PhaseSchemaDef {
  paramKey: string;
  labelEn: string;
  labelAr: string;
  descEn: string;
  descAr: string;
  minMs: number;
  maxMs: number;
  role: PhaseRole;
}

export interface SequenceSchemaDef {
  sequenceKey: keyof MacroTimingConfig;
  titleEn: string;
  titleAr: string;
  subtitleEn: string;
  subtitleAr: string;
  category: SequenceCategory;
  phases: PhaseSchemaDef[];
}

export const MACRO_SEQUENCE_SCHEMAS: SequenceSchemaDef[] = [
  {
    sequenceKey: 'fastAerial',
    titleEn: 'Fast Aerial Hold & Pitch Liftoff',
    titleAr: 'الارتفاع الجوي السريع (Fast Aerial)',
    subtitleEn: 'Vertical impulse holds & pitch inversion',
    subtitleAr: 'فترات تثبيت القفز والرفع الهوائي',
    category: 'aerial_hold',
    phases: [
      {
        paramKey: 'firstJumpSleep',
        labelEn: 'Jump 1 Hold',
        labelAr: 'تثبيت القفزة 1',
        descEn: 'Initial vertical jump hold for maximum liftoff velocity',
        descAr: 'مدة الضغط على القفزة الأولى لأقصى تسارع عمودي',
        minMs: 60,
        maxMs: 320,
        role: 'hold',
      },
      {
        paramKey: 'backReleaseSleep',
        labelEn: 'Back Release',
        labelAr: 'تحرير الميلان',
        descEn: 'Neutral pitch release delay to prevent accidental backflip',
        descAr: 'فترة تحرير المحور لمنع الشقلبة الخلفية بالخطأ',
        minMs: 10,
        maxMs: 100,
        role: 'transition',
      },
      {
        paramKey: 'secondJumpSleep',
        labelEn: 'Jump 2 Hold',
        labelAr: 'تثبيت القفزة 2',
        descEn: 'Secondary jump impulse hold at aerial transition apex',
        descAr: 'مدة القفزة الثانية في قمة الارتفاع الجوي',
        minMs: 10,
        maxMs: 100,
        role: 'hold',
      },
      {
        paramKey: 'forwardFlipDelay',
        labelEn: 'Pitch Delay',
        labelAr: 'تأخير التوجيه',
        descEn: 'Micro-delay before locking aerial trajectory angle',
        descAr: 'تأخير دقيق قبل تثبيت زاوية الصعود الجوي',
        minMs: 10,
        maxMs: 80,
        role: 'transition',
      },
      {
        paramKey: 'flipCancelHold',
        labelEn: 'Aerial Pitch Hold',
        labelAr: 'تثبيت المسار الجوي',
        descEn: 'Sustained supersonic aerial trajectory & nose-up hold',
        descAr: 'تثبيت مستمر للمسار الجوي نحو سرعة السوبر سونيك',
        minMs: 60,
        maxMs: 350,
        role: 'hold',
      },
    ],
  },
  {
    sequenceKey: 'forwardSpeedflip',
    titleEn: 'Forward Speedflip Aerial Cancel',
    titleAr: 'سبيدفليب أمامي 45° (Aerial Cancel)',
    subtitleEn: 'Diagonal dodge & counter-pitch cancel hold',
    subtitleAr: 'تثبيت إلغاء الدوران الجوي بزاوية 45 درجة',
    category: 'aerial_hold',
    phases: [
      {
        paramKey: 'firstJumpSleep',
        labelEn: 'Pre-Hop Hold',
        labelAr: 'قفزة التحضير',
        descEn: 'Short first jump compression before initiating diagonal flip',
        descAr: 'قفزة أولى سريعة لرفع العجلات قبل الدوران القطري',
        minMs: 15,
        maxMs: 100,
        role: 'hold',
      },
      {
        paramKey: 'delayBeforeSecond',
        labelEn: 'Dodge Window',
        labelAr: 'نافذة الدودج',
        descEn: 'Delay window between hop and diagonal speedflip dodge',
        descAr: 'فترة الانتظار بين القفزة الأولى والاندفاع القطري',
        minMs: 15,
        maxMs: 100,
        role: 'transition',
      },
      {
        paramKey: 'cancelHold',
        labelEn: 'Cancel Hold',
        labelAr: 'تثبيت الإلغاء',
        descEn: 'Counter-pitch aerial cancel hold keeping nose flat for boost',
        descAr: 'تثبيت معاكس لإلغاء الشقلبة والحفاظ على البوست الأمامي',
        minMs: 200,
        maxMs: 850,
        role: 'hold',
      },
    ],
  },
  {
    sequenceKey: 'leftSpeedflip',
    titleEn: 'Left DAR Speedflip Hold',
    titleAr: 'سبيدفليب دوران أيسر (DAR Left)',
    subtitleEn: 'Directional Air Roll left hold envelope',
    subtitleAr: 'توقيتات الدوران الجوي الأيسر وتثبيت الإلغاء',
    category: 'aerial_hold',
    phases: [
      {
        paramKey: 'firstJumpSleep',
        labelEn: 'Hop Unload',
        labelAr: 'تفريغ القفزة',
        descEn: 'Suspension unload hold for left DAR kickoff flip',
        descAr: 'مدة تحرير التعليق للقفزة الأولى باتجاه اليسار',
        minMs: 15,
        maxMs: 100,
        role: 'hold',
      },
      {
        paramKey: 'delayBeforeSecond',
        labelEn: 'DAR Window',
        labelAr: 'نافذة الدوران',
        descEn: 'Directional roll alignment delay before second jump',
        descAr: 'نافذة محاذاة الدوران قبل القفزة الثانية',
        minMs: 15,
        maxMs: 100,
        role: 'transition',
      },
      {
        paramKey: 'cancelHold',
        labelEn: 'DAR Cancel Hold',
        labelAr: 'تثبيت DAR الأيسر',
        descEn: 'Sustained counter-pitch & DAR left stabilization hold',
        descAr: 'مدة تثبيت الإلغاء والدوران الأيسر في الهواء',
        minMs: 200,
        maxMs: 850,
        role: 'hold',
      },
    ],
  },
  {
    sequenceKey: 'rightSpeedflip',
    titleEn: 'Right DAR Speedflip Hold',
    titleAr: 'سبيدفليب دوران أيمن (DAR Right)',
    subtitleEn: 'Directional Air Roll right hold envelope',
    subtitleAr: 'توقيتات الدوران الجوي الأيمن وتثبيت الإلغاء',
    category: 'aerial_hold',
    phases: [
      {
        paramKey: 'firstJumpSleep',
        labelEn: 'Hop Unload',
        labelAr: 'تفريغ القفزة',
        descEn: 'Suspension unload hold for right DAR kickoff flip',
        descAr: 'مدة تحرير التعليق للقفزة الأولى باتجاه اليمين',
        minMs: 15,
        maxMs: 100,
        role: 'hold',
      },
      {
        paramKey: 'delayBeforeSecond',
        labelEn: 'DAR Window',
        labelAr: 'نافذة الدوران',
        descEn: 'Directional roll alignment delay before second jump',
        descAr: 'نافذة محاذاة الدوران قبل القفزة الثانية',
        minMs: 15,
        maxMs: 100,
        role: 'transition',
      },
      {
        paramKey: 'cancelHold',
        labelEn: 'DAR Cancel Hold',
        labelAr: 'تثبيت DAR الأيمن',
        descEn: 'Sustained counter-pitch & DAR right stabilization hold',
        descAr: 'مدة تثبيت الإلغاء والدوران الأيمن في الهواء',
        minMs: 200,
        maxMs: 850,
        role: 'hold',
      },
    ],
  },
  {
    sequenceKey: 'mouseSpeedflip',
    titleEn: 'DirectInput Mouse Bipolar Speedflip',
    titleAr: 'سبيدفليب الماوس المتناظر (Mouse Bipolar)',
    subtitleEn: 'Bipolar vector translation & aerial torque hold',
    subtitleAr: 'ترجمة محاور الماوس المباشرة وتثبيت العزم الهوائي',
    category: 'aerial_hold',
    phases: [
      {
        paramKey: 'firstJumpSleep',
        labelEn: 'Impulse Hop',
        labelAr: 'قفزة الدفع',
        descEn: 'DirectInput normalized initial hop hold duration',
        descAr: 'مدة القفزة الأولى المعايرة عبر DirectInput',
        minMs: 15,
        maxMs: 100,
        role: 'hold',
      },
      {
        paramKey: 'delayBeforeSecond',
        labelEn: 'Vector Delay',
        labelAr: 'تأخير المتجه',
        descEn: 'Raw dx/dy vector settle delay prior to dodge trigger',
        descAr: 'فترة استقرار متجه الماوس قبل تنفيذ الدودج',
        minMs: 15,
        maxMs: 120,
        role: 'transition',
      },
      {
        paramKey: 'cancelHold',
        labelEn: 'Torque Hold',
        labelAr: 'تثبيت العزم',
        descEn: 'Counter-torque aerial hold stabilizing chassis heading',
        descAr: 'تثبيت العزم المعاكس لاستقامة المركبة في الجو',
        minMs: 200,
        maxMs: 850,
        role: 'hold',
      },
    ],
  },
  {
    sequenceKey: 'chainDash',
    titleEn: 'Wavedash & Chaindash Ground Recovery',
    titleAr: 'استعادة التوازن الأرضي (Wavedash & Chaindash)',
    subtitleEn: 'Wheel contact delay, dodge slam & powerslide recovery',
    subtitleAr: 'توقيتات ملامسة الإطارات والاندفاع الأرضي والتفحيط',
    category: 'ground_recovery',
    phases: [
      {
        paramKey: 'jump1Sleep',
        labelEn: 'Low Hop',
        labelAr: 'قفزة منخفضة',
        descEn: 'Minimal hop height to keep chassis near ground plane',
        descAr: 'أقصر مدة قفز لإبقاء الهيكل قريباً من الأرض',
        minMs: 15,
        maxMs: 90,
        role: 'hold',
      },
      {
        paramKey: 'fallDelay',
        labelEn: 'Fall & Wheel Delay',
        labelAr: 'تأخير هبوط الإطارات',
        descEn: 'Suspension descent delay waiting for rear wheel contact',
        descAr: 'انتظار ملامسة الإطارات الخلفية للأرض قبل الداش',
        minMs: 20,
        maxMs: 160,
        role: 'recovery',
      },
      {
        paramKey: 'jump2Sleep',
        labelEn: 'Ground Slam',
        labelAr: 'اندفاع الهبوط',
        descEn: 'Secondary dodge firing directly into suspension dampers',
        descAr: 'ضغطة الدودج الأرضي لامتصاص الصدمة وزيادة السرعة',
        minMs: 15,
        maxMs: 90,
        role: 'hold',
      },
      {
        paramKey: 'releaseDelay',
        labelEn: 'Powerslide Recovery',
        labelAr: 'استعادة التفحيط',
        descEn: 'Handbrake drift release window preserving ground momentum',
        descAr: 'نافذة تحرير التفحيط للحفاظ على الزخم الأرضي 2300 uu/s',
        minMs: 15,
        maxMs: 160,
        role: 'recovery',
      },
    ],
  },
];

export function msToPhysicsTicks(ms: number, tickRateHz: number = 120): number {
  return Math.max(1, Math.round(ms / (1000 / tickRateHz)));
}

export function clampDuration(ms: number, minMs: number, maxMs: number): number {
  if (!Number.isFinite(ms)) return minMs;
  return Math.round(Math.min(maxMs, Math.max(minMs, ms)));
}

export function buildMacroSequenceTracks(
  timings: MacroTimingConfig,
  filter: 'all' | SequenceCategory = 'all'
): MacroTimingSequenceTrack[] {
  const filteredSchemas =
    filter === 'all'
      ? MACRO_SEQUENCE_SCHEMAS
      : MACRO_SEQUENCE_SCHEMAS.filter((s) => s.category === filter);

  return filteredSchemas.map((schema) => {
    const seqData = timings[schema.sequenceKey] as Record<string, number>;
    let cursorMs = 0;
    let holdDurationMs = 0;
    let transitionDurationMs = 0;

    const segments: MacroTimingSegment[] = schema.phases.map((phase) => {
      const rawVal = typeof seqData?.[phase.paramKey] === 'number' ? seqData[phase.paramKey] : phase.minMs;
      const durationMs = clampDuration(rawVal, phase.minMs, phase.maxMs);
      const startMs = cursorMs;
      const endMs = startMs + durationMs;
      cursorMs = endMs;

      if (phase.role === 'hold') {
        holdDurationMs += durationMs;
      } else {
        transitionDurationMs += durationMs;
      }

      return {
        id: `${schema.sequenceKey}.${phase.paramKey}`,
        sequenceKey: schema.sequenceKey,
        paramKey: phase.paramKey,
        labelEn: phase.labelEn,
        labelAr: phase.labelAr,
        descEn: phase.descEn,
        descAr: phase.descAr,
        durationMs,
        startMs,
        endMs,
        minMs: phase.minMs,
        maxMs: phase.maxMs,
        role: phase.role,
        ticks120Hz: msToPhysicsTicks(durationMs, 120),
        ticks240Hz: msToPhysicsTicks(durationMs, 240),
        packets1000Hz: durationMs,
      };
    });

    return {
      sequenceKey: schema.sequenceKey,
      titleEn: schema.titleEn,
      titleAr: schema.titleAr,
      subtitleEn: schema.subtitleEn,
      subtitleAr: schema.subtitleAr,
      category: schema.category,
      totalDurationMs: cursorMs,
      holdDurationMs,
      transitionDurationMs,
      segments,
    };
  });
}

export function updateMacroTimingValue(
  timings: MacroTimingConfig,
  sequenceKey: keyof MacroTimingConfig,
  paramKey: string,
  nextMs: number
): MacroTimingConfig {
  const schema = MACRO_SEQUENCE_SCHEMAS.find((s) => s.sequenceKey === sequenceKey);
  const phase = schema?.phases.find((p) => p.paramKey === paramKey);
  const clamped = phase ? clampDuration(nextMs, phase.minMs, phase.maxMs) : Math.max(1, Math.round(nextMs));

  const currentSeq = timings[sequenceKey] as Record<string, number>;
  if (currentSeq && currentSeq[paramKey] === clamped) {
    return timings;
  }

  return {
    ...timings,
    [sequenceKey]: {
      ...currentSeq,
      [paramKey]: clamped,
    },
  };
}

export function calculateDraggedDuration(
  initialDurationMs: number,
  deltaPx: number,
  trackWidthPx: number,
  timelineScaleMaxMs: number,
  minMs: number,
  maxMs: number
): number {
  if (trackWidthPx <= 0 || timelineScaleMaxMs <= 0) {
    return clampDuration(initialDurationMs, minMs, maxMs);
  }
  const msPerPx = timelineScaleMaxMs / trackWidthPx;
  const rawNext = initialDurationMs + deltaPx * msPerPx;
  return clampDuration(rawNext, minMs, maxMs);
}
