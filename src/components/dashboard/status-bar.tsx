'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Activity, Gauge, Clock, Cpu, Layers, Zap } from 'lucide-react';
import type { VerificationState } from '@/lib/riscv-types';

interface Props {
  state: VerificationState;
}

function fmtPct(r: number | undefined | null): string {
  if (r === null || r === undefined) return '0.0%';
  return (r * 100).toFixed(1) + '%';
}

export function StatusBar({ state }: Props) {
  const r = state.latestReport;
  const lastActivity = state.agentActivities[state.agentActivities.length - 1];
  const formalModulesActive = Object.values(state.formalResults).filter(v => v.summary === undefined && v.properties.length > 0).length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
      <StatCard
        icon={Gauge}
        label="Overall Coverage"
        value={r ? fmtPct(r.overallCoverage) : '—'}
        accent="emerald"
        progress={r?.overallCoverage}
      />
      <StatCard
        icon={Layers}
        label="Instructions"
        value={r ? `${r.instructionCoverage.hit}/${r.instructionCoverage.total}` : '—'}
        accent="cyan"
        progress={r?.instructionCoverage.ratio}
      />
      <StatCard
        icon={Activity}
        label="Functional"
        value={r ? `${r.functionalCoverage.hitCount}/${r.functionalCoverage.total}` : '—'}
        accent="fuchsia"
        progress={r?.functionalCoverage.ratio}
      />
      <StatCard
        icon={Clock}
        label="Cycles (last run)"
        value={r ? r.totalCycles.toString() : '—'}
        accent="amber"
      />
      <StatCard
        icon={Zap}
        label="Hazards (RAW/CTRL)"
        value={r ? `${r.hazardCoverage.rawCount}/${r.hazardCoverage.controlCount}` : '—'}
        accent="rose"
      />
      <StatCard
        icon={Cpu}
        label="Iteration"
        value={state.currentIteration > 0 ? `${state.currentIteration} / ${state.totalIterations}` : '—'}
        accent="slate"
        progress={state.totalIterations > 0 ? state.currentIteration / state.totalIterations : 0}
        subtitle={lastActivity?.agent}
      />
    </div>
  );
}

const COLORS: Record<string, string> = {
  emerald: 'text-emerald-400 border-emerald-500/30',
  cyan: 'text-cyan-400 border-cyan-500/30',
  fuchsia: 'text-fuchsia-400 border-fuchsia-500/30',
  amber: 'text-amber-400 border-amber-500/30',
  rose: 'text-rose-400 border-rose-500/30',
  slate: 'text-slate-300 border-slate-500/30',
};

const BAR_COLORS: Record<string, string> = {
  emerald: 'bg-emerald-500',
  cyan: 'bg-cyan-500',
  fuchsia: 'bg-fuchsia-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  slate: 'bg-slate-400',
};

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
  progress,
  subtitle,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  accent: keyof typeof COLORS;
  progress?: number;
  subtitle?: string;
}) {
  return (
    <Card className={`border ${COLORS[accent]} bg-card/50 backdrop-blur-sm`}>
      <CardContent className="p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className={`text-base font-semibold tabular-nums ${COLORS[accent].split(' ')[0]} truncate`}>{value}</div>
            {subtitle && (
              <div className="text-[9px] text-muted-foreground truncate">{subtitle}</div>
            )}
          </div>
          <Icon className={`h-4 w-4 flex-shrink-0 ${COLORS[accent].split(' ')[0]} opacity-60`} />
        </div>
        {progress !== undefined && progress > 0 && (
          <div className="mt-1.5 h-0.5 rounded-full bg-muted overflow-hidden">
            <div className={`h-full ${BAR_COLORS[accent]} transition-all duration-500`} style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
