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

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
      <StatCard
        icon={Gauge}
        label="Overall Coverage"
        value={r ? fmtPct(r.overallCoverage) : '—'}
        progress={r?.overallCoverage}
      />
      <StatCard
        icon={Layers}
        label="Instructions"
        value={r ? `${r.instructionCoverage.hit}/${r.instructionCoverage.total}` : '—'}
        progress={r?.instructionCoverage.ratio}
      />
      <StatCard
        icon={Activity}
        label="Functional"
        value={r ? `${r.functionalCoverage.hitCount}/${r.functionalCoverage.total}` : '—'}
        progress={r?.functionalCoverage.ratio}
      />
      <StatCard
        icon={Clock}
        label="Cycles"
        value={r ? r.totalCycles.toString() : '—'}
      />
      <StatCard
        icon={Zap}
        label="Hazards (R/C)"
        value={r ? `${r.hazardCoverage.rawCount}/${r.hazardCoverage.controlCount}` : '—'}
      />
      <StatCard
        icon={Cpu}
        label="Iteration"
        value={state.currentIteration > 0 ? `${state.currentIteration} / ${state.totalIterations}` : '—'}
        progress={state.totalIterations > 0 ? state.currentIteration / state.totalIterations : 0}
        subtitle={lastActivity?.agent}
      />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  progress,
  subtitle,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  progress?: number;
  subtitle?: string;
}) {
  return (
    <Card className="border bg-card/50">
      <CardContent className="p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="text-base font-semibold tabular-nums truncate">{value}</div>
            {subtitle && (
              <div className="text-[9px] text-muted-foreground truncate mt-0.5">{subtitle}</div>
            )}
          </div>
          <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground/60" />
        </div>
        {progress !== undefined && progress > 0 && (
          <div className="mt-1.5 h-0.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all duration-500" style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
