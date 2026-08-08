'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, AlertCircle, PauseCircle, Activity, Clock, Target, ShieldCheck, XCircle, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { VerificationState } from '@/lib/riscv-types';

interface Props {
  state: VerificationState;
  onReset: () => void;
}

export function StatusFooter({ state, onReset }: Props) {
  const [elapsed, setElapsed] = useState(0);
  // Track which sessionIds have had their summary dismissed by the user.
  // When a new session completes, its summary shows automatically.
  const [dismissedSessions, setDismissedSessions] = useState<Set<string>>(new Set());

  // Track elapsed time while running
  useEffect(() => {
    if (state.status !== 'running') return;
    const startTime = state.sessionStartTime ?? Date.now();
    const t = setInterval(() => setElapsed(Date.now() - startTime), 500);
    return () => clearInterval(t);
  }, [state.status, state.sessionStartTime]);

  // Auto-show summary when a session completes, unless the user dismissed it.
  const showSummary = state.status === 'completed'
    && state.sessionId !== null
    && !dismissedSessions.has(state.sessionId);

  const dismissSummary = () => {
    if (state.sessionId) {
      setDismissedSessions(prev => new Set(prev).add(state.sessionId!));
    }
  };

  const reopenSummary = () => {
    if (state.sessionId) {
      setDismissedSessions(prev => {
        const next = new Set(prev);
        next.delete(state.sessionId!);
        return next;
      });
    }
  };

  // Aggregate formal results for the summary
  const formalSummary = (() => {
    let proof = 0, cex = 0, err = 0;
    for (const m of Object.values(state.formalResults)) {
      proof += m.summary?.proof ?? 0;
      cex += m.summary?.counterexample ?? 0;
      err += m.summary?.errors ?? 0;
    }
    return { proof, cex, err };
  })();

  const isRunning = state.status === 'running';
  const isCompleted = state.status === 'completed';
  const isError = state.status === 'error';
  const isIdle = state.status === 'idle';

  // Progress: current iteration / total iterations
  const progress = state.totalIterations > 0
    ? Math.min(100, (state.currentIteration / state.totalIterations) * 100)
    : 0;

  // Determine current phase description
  const phaseDesc = (() => {
    if (isIdle) return 'Idle — configure and start a verification run, or write your own program/property below.';
    if (isError) return 'Session ended with errors — check the error panel above.';
    if (!isRunning) return 'Session complete.';
    const last = state.agentActivities[state.agentActivities.length - 1];
    if (!last) return 'Starting...';
    return `${last.agent}: ${last.message}`;
  })();

  return (
    <>
      {/* Sticky bottom status bar */}
      <div className="sticky bottom-0 z-30 mt-3">
        <Card className={`border-t-2 ${isRunning ? 'border-t-primary' : isCompleted ? 'border-t-primary' : isError ? 'border-t-destructive' : 'border-t-border'} bg-card/95 backdrop-blur-sm shadow-lg`}>
          <CardContent className="px-3 py-2.5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              {/* Status + phase */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <StatusIcon status={state.status} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${isRunning ? 'text-primary' : isCompleted ? 'text-primary' : isError ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {isRunning ? 'VERIFICATION RUNNING' : isCompleted ? 'VERIFICATION COMPLETE' : isError ? 'ERROR' : 'IDLE'}
                    </span>
                    {isRunning && state.currentIteration > 0 && (
                      <Badge variant="outline" className="text-[9px] py-0 px-1 border-primary/40 text-primary">
                        iter {state.currentIteration} / {state.totalIterations}
                      </Badge>
                    )}
                    {isCompleted && state.simLoopEndReason && (
                      <Badge variant="outline" className={`text-[9px] py-0 px-1 ${state.simLoopEndReason === 'goal-met' ? 'border-primary/40 text-primary' : 'border-primary/40 text-primary'}`}>
                        {state.simLoopEndReason === 'goal-met' ? 'goal met' : 'max iters reached'}
                      </Badge>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate max-w-md">
                    {phaseDesc}
                  </div>
                </div>
              </div>

              {/* Live metrics */}
              <div className="flex items-center gap-3 flex-wrap">
                <Metric
                  icon={Target}
                  label="Coverage"
                  value={state.latestReport ? `${(state.latestReport.overallCoverage * 100).toFixed(1)}%` : '—'}
                  color="emerald"
                />
                <Metric
                  icon={Activity}
                  label="Instructions"
                  value={state.latestReport ? `${state.latestReport.instructionCoverage.hit}/${state.latestReport.instructionCoverage.total}` : '—'}
                  color="cyan"
                />
                <Metric
                  icon={ShieldCheck}
                  label="Proofs"
                  value={String(formalSummary.proof)}
                  color="emerald"
                />
                <Metric
                  icon={XCircle}
                  label="Counterex"
                  value={String(formalSummary.cex)}
                  color="rose"
                />
                <Metric
                  icon={Clock}
                  label="Elapsed"
                  value={isRunning ? formatDuration(elapsed) : (isCompleted ? formatDuration(state.agentActivities.length > 0 ? (state.agentActivities[state.agentActivities.length - 1].timestamp - state.agentActivities[0].timestamp) : 0) : '—')}
                  color="amber"
                />
                {isCompleted && (
                  <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={reopenSummary}>
                    View Summary
                  </Button>
                )}
                {isCompleted && (
                  <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={onReset}>
                    <RotateCcw className="h-3 w-3 mr-1" />
                    New Run
                  </Button>
                )}
              </div>
            </div>

            {/* Progress bar */}
            {isRunning && state.totalIterations > 0 && (
              <div className="mt-2 h-0.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Session Summary modal */}
      {showSummary && isCompleted && (
        <SummaryModal state={state} formalSummary={formalSummary} elapsed={elapsed} onClose={dismissSummary} onReset={onReset} />
      )}
    </>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'running') {
    return <Loader2 className="h-5 w-5 text-primary animate-spin" />;
  }
  if (status === 'completed') {
    return <CheckCircle2 className="h-5 w-5 text-primary" />;
  }
  if (status === 'error') {
    return <AlertCircle className="h-5 w-5 text-destructive" />;
  }
  return <PauseCircle className="h-5 w-5 text-muted-foreground" />;
}

function Metric({ icon: Icon, label, value, color }: { icon: typeof Target; label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    emerald: 'text-primary',
    cyan: 'text-primary',
    amber: 'text-primary',
    rose: 'text-destructive',
  };
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={`h-3 w-3 ${colors[color]}`} />
      <div className="flex flex-col">
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground leading-none">{label}</span>
        <span className={`text-[11px] font-mono tabular-nums leading-none mt-0.5 ${colors[color]}`}>{value}</span>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function SummaryModal({ state, formalSummary, elapsed, onClose, onReset }: {
  state: VerificationState;
  formalSummary: { proof: number; cex: number; err: number };
  elapsed: number;
  onClose: () => void;
  onReset: () => void;
}) {
  const r = state.latestReport;
  const totalDuration = state.agentActivities.length > 0
    ? state.agentActivities[state.agentActivities.length - 1].timestamp - state.agentActivities[0].timestamp
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto border-primary/30" onClick={(e) => e.stopPropagation()}>
        <CardContent className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-primary" />
              <div>
                <h2 className="text-lg font-semibold">Verification Session Complete</h2>
                <p className="text-xs text-muted-foreground font-mono">{state.sessionId}</p>
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={onClose}>✕</Button>
          </div>

          {/* Outcome banner */}
          <div className={`rounded-md border p-3 mb-4 ${
            state.simLoopEndReason === 'goal-met'
              ? 'border-primary/40 bg-primary/5'
              : 'border-primary/40 bg-primary/5'
          }`}>
            <div className="flex items-center gap-2">
              {state.simLoopEndReason === 'goal-met' ? (
                <CheckCircle2 className="h-5 w-5 text-primary" />
              ) : (
                <AlertCircle className="h-5 w-5 text-primary" />
              )}
              <div>
                <div className={`text-sm font-medium ${state.simLoopEndReason === 'goal-met' ? 'text-primary' : 'text-primary'}`}>
                  {state.simLoopEndReason === 'goal-met' ? 'Coverage goal achieved' : 'Max iterations reached'}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {state.simLoopEndReason === 'goal-met'
                    ? `Reached ${r ? (r.overallCoverage * 100).toFixed(1) + '%' : 'N/A'} overall coverage — meeting the configured goal.`
                    : `Stopped after ${state.totalIterations} iterations at ${r ? (r.overallCoverage * 100).toFixed(1) + '%' : 'N/A'} overall coverage.`}
                </div>
              </div>
            </div>
          </div>

          {/* Big metric cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            <SummaryMetric label="Overall Coverage" value={r ? `${(r.overallCoverage * 100).toFixed(1)}%` : '—'} accent="emerald" />
            <SummaryMetric label="Iterations Run" value={`${state.currentIteration} / ${state.totalIterations}`} accent="cyan" />
            <SummaryMetric label="Formal Proofs" value={String(formalSummary.proof)} accent="emerald" />
            <SummaryMetric label="Counterexamples" value={String(formalSummary.cex)} accent="rose" />
          </div>

          {/* Coverage breakdown */}
          {r && (
            <div className="mb-4">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Coverage Breakdown</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                <BreakdownRow label="Instructions" value={`${r.instructionCoverage.hit} / ${r.instructionCoverage.total}`} pct={r.instructionCoverage.ratio} />
                <BreakdownRow label="Branches" value={`${r.branchCoverage.bothObserved} / ${r.branchCoverage.totalBranchOps}`} pct={r.branchCoverage.ratio} />
                <BreakdownRow label="Registers" value={`${r.registerCoverage.written.length} / 31`} pct={r.registerCoverage.ratio} />
                <BreakdownRow label="Hazards (RAW/CTRL)" value={`${r.hazardCoverage.rawCount} / ${r.hazardCoverage.controlCount}`} pct={r.hazardCoverage.ratio} />
                <BreakdownRow label="Memory bytes" value={String(r.memoryCoverage.bytesTouched)} pct={Math.min(1, r.memoryCoverage.bytesTouched / 256)} />
                <BreakdownRow label="Functional scenarios" value={`${r.functionalCoverage.hitCount} / ${r.functionalCoverage.total}`} pct={r.functionalCoverage.ratio} />
              </div>
            </div>
          )}

          {/* Functional scenarios list */}
          {r && (
            <div className="mb-4">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Functional Scenarios</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1 max-h-40 overflow-y-auto">
                {r.functionalCoverage.scenarios.map((s, i) => (
                  <div key={i} className={`text-[11px] flex items-center gap-1.5 ${s.hit ? 'text-primary' : 'text-muted-foreground'}`}>
                    {s.hit ? <CheckCircle2 className="h-3 w-3 flex-shrink-0" /> : <XCircle className="h-3 w-3 flex-shrink-0 opacity-40" />}
                    <span className="truncate">{s.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Formal verification summary */}
          {Object.keys(state.formalResults).length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Formal Verification</h3>
              <div className="space-y-1">
                {Object.entries(state.formalResults).map(([mod, data]) => (
                  <div key={mod} className="flex items-center justify-between text-xs bg-card/50 rounded-md border border-border/40 px-2 py-1.5">
                    <span className="font-mono text-primary">{mod}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px] border-primary/40 text-primary bg-primary/5">
                        <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                        {data.summary?.proof ?? 0} proof
                      </Badge>
                      <Badge variant="outline" className="text-[9px] border-destructive/40 text-destructive bg-destructive/5">
                        <XCircle className="h-2.5 w-2.5 mr-1" />
                        {data.summary?.counterexample ?? 0} cex
                      </Badge>
                      {(data.summary?.errors ?? 0) > 0 && (
                        <Badge variant="outline" className="text-[9px] border-primary/40 text-primary bg-primary/5">
                          {data.summary?.errors} err
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Coverage Analysis */}
          {state.latestAnalysis && (
            <div className="mb-4">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Coverage Analysis</h3>
              <div className="rounded-md border border-primary/30 bg-primary/5 p-2">
                <p className="text-xs text-foreground">{state.latestAnalysis.summary}</p>
                {state.latestAnalysis.prioritizedRecommendations.length > 0 && (
                  <div className="mt-2">
                    <div className="text-[10px] uppercase tracking-wider text-primary mb-1">Top Recommendations</div>
                    <ul className="text-[11px] text-muted-foreground space-y-0.5 list-decimal list-inside">
                      {state.latestAnalysis.prioritizedRecommendations.slice(0, 3).map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-3 border-t border-border/40">
            <div className="text-[10px] text-muted-foreground">
              Total duration: <span className="font-mono">{formatDuration(totalDuration)}</span>
              {r && <> · Total cycles simulated: <span className="font-mono">{r.totalCycles}</span></>}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
              <Button size="sm" onClick={onReset} className="bg-primary hover:bg-primary text-white">
                Start New Run
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryMetric({ label, value, accent }: { label: string; value: string; accent: string }) {
  const colors: Record<string, string> = {
    emerald: 'border-primary/40 bg-primary/5 text-primary',
    cyan: 'border-primary/40 bg-primary/5 text-primary',
    amber: 'border-primary/40 bg-primary/5 text-primary',
    rose: 'border-destructive/40 bg-destructive/5 text-destructive',
  };
  return (
    <div className={`rounded-md border px-3 py-2 ${colors[accent]}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function BreakdownRow({ label, value, pct }: { label: string; value: string; pct: number }) {
  const p = Math.min(100, pct * 100);
  const color = p >= 80 ? 'bg-primary' : p >= 50 ? 'bg-primary/60' : 'bg-muted-foreground/40';
  return (
    <div className="rounded-md border border-border/40 bg-card/50 px-2 py-1.5">
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">{value}</span>
      </div>
      <div className="h-0.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}
