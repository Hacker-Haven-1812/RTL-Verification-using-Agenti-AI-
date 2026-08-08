'use client';

import { useMemo, useState, useEffect } from 'react';
import { useVerification } from '@/hooks/use-verification';
import { DashboardHeader } from '@/components/dashboard/dashboard-header';
import { StatusBar } from '@/components/dashboard/status-bar';
import { ControlPanel } from '@/components/dashboard/control-panel';
import { ArchitectureDiagram } from '@/components/dashboard/architecture-diagram';
import { CoveragePanel } from '@/components/dashboard/coverage-panel';
import { AgentActivityPanel } from '@/components/dashboard/agent-activity-panel';
import { InstructionTracePanel } from '@/components/dashboard/instruction-trace-panel';
import { GeneratedProgramPanel } from '@/components/dashboard/generated-program-panel';
import { FormalVerificationPanel } from '@/components/dashboard/formal-verification-panel';
import { MissingCasePanel } from '@/components/dashboard/missing-case-panel';
import { CoverageAnalysisPanel } from '@/components/dashboard/coverage-analysis-panel';
import { RtlModuleViewer } from '@/components/dashboard/rtl-module-viewer';
import { CustomInputPanel } from '@/components/dashboard/custom-input-panel';
import { StatusFooter } from '@/components/dashboard/status-footer';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';

const AVAILABLE_MODULES = ['rv32i_alu', 'rv32i_regfile'];

export default function HomePage() {
  const { state, start, runCustomProgram, checkCustomProperty, abort, reset } = useVerification();
  const [wsConnected, setWsConnected] = useState(false);

  // Track WebSocket connection state by polling the socket
  useEffect(() => {
    const check = () => {
      setWsConnected(true);
    };
    check();
    const t = setInterval(check, 2000);
    return () => clearInterval(t);
  }, []);

  // Derive the active phase from the most recent agent activity
  const activePhase = useMemo<'idle' | 'case-gen' | 'sim' | 'coverage' | 'missing-case' | 'formal'>(() => {
    const last = state.agentActivities[state.agentActivities.length - 1];
    if (!last || state.status !== 'running') return 'idle';
    if (last.agent === 'Test Generator') return 'case-gen';
    if (last.agent === 'Coverage Analyzer') return 'coverage';
    if (last.agent === 'Gap Analyzer') return 'missing-case';
    if (last.agent === 'Property Synthesizer') return 'formal';
    if (last.agent === 'Formal Checker') return 'formal';
    if (last.agent === 'Assembler') return 'sim';
    return 'idle';
  }, [state.agentActivities, state.status]);

  // Detect if formal path is active
  const formalActive = useMemo(() => {
    const formalAgents = state.agentActivities.filter(a => a.agent === 'Property Synthesizer' || a.agent === 'Formal Checker');
    if (formalAgents.length === 0) return false;
    const last = formalAgents[formalAgents.length - 1];
    return last.phase === 'thinking';
  }, [state.agentActivities]);

  // Detect sim phase: between program-generated and coverage-update
  const simActive = useMemo(() => {
    if (state.status !== 'running') return false;
    if (activePhase === 'case-gen') return false;
    if (state.latestProgram && !state.latestReport) return true;
    return false;
  }, [state.status, activePhase, state.latestProgram, state.latestReport]);

  // Combine into the phase shown in the architecture diagram
  const diagramPhase = simActive ? 'sim' : activePhase;

  const coverageGoal = state.config?.coverageGoal ?? 0.85;
  const overallCoverage = state.latestReport?.overallCoverage ?? 0;

  return (
    <main className="min-h-screen flex flex-col bg-background text-foreground relative">
      <DashboardHeader
        connected={wsConnected && state.errors.filter(e => e.message.includes('connection')).length === 0}
        status={state.status}
      />

      <div className="flex-1 px-3 md:px-4 py-3 space-y-3 relative z-10">
        {/* Status bar */}
        <StatusBar state={state} />

        {/* Errors */}
        {state.errors.length > 0 && (
          <Card className="border-rose-500/40 bg-rose-500/5">
            <CardContent className="p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-rose-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-rose-400 mb-1">Errors</div>
                  <div className="space-y-0.5 max-h-24 overflow-y-auto">
                    {state.errors.slice(-5).map((e, i) => (
                      <div key={i} className="text-[11px] font-mono text-rose-300/80">
                        [{e.where}] {e.message}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main grid: 3 columns on large screens */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* LEFT column: control + RTL viewer + missing cases */}
          <div className="lg:col-span-3 space-y-3">
            <ControlPanel
              status={state.status}
              onStart={start}
              onAbort={abort}
              onReset={reset}
              availableModules={AVAILABLE_MODULES}
            />
            <CustomInputPanel
              isRunning={state.status === 'running'}
              onRunProgram={runCustomProgram}
              onCheckProperty={checkCustomProperty}
            />
            <RtlModuleViewer activeModules={state.config?.targetModules ?? []} />
            <MissingCasePanel suggestions={state.missingCaseSuggestions} />
          </div>

          {/* MIDDLE column: architecture diagram + coverage + trace */}
          <div className="lg:col-span-5 space-y-3">
            <ArchitectureDiagram
              activePhase={diagramPhase}
              currentIteration={state.currentIteration}
              formalActive={formalActive}
              overallCoverage={overallCoverage}
              coverageGoal={coverageGoal}
            />
            <CoveragePanel
              report={state.latestReport}
              history={state.coverageHistory}
            />
            <InstructionTracePanel trace={state.trace} />
          </div>

          {/* RIGHT column: agent activity + program + formal + coverage analysis */}
          <div className="lg:col-span-4 space-y-3">
            <AgentActivityPanel activities={state.agentActivities} />
            <GeneratedProgramPanel program={state.latestProgram} />
            <CoverageAnalysisPanel analysis={state.latestAnalysis} />
            <FormalVerificationPanel formalResults={state.formalResults} />
          </div>
        </div>

        {/* Minimal footer */}
        <footer className="pt-3 pb-2 border-t border-border/40">
          <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span className="font-mono">RV32I · RV32I base ISA · 32 registers · 64 KiB memory</span>
            <span className="font-mono">closed-loop verification · coverage-driven · formal-augmented</span>
          </div>
        </footer>
      </div>

      {/* Sticky bottom status indicator + session summary */}
      <StatusFooter state={state} onReset={reset} />
    </main>
  );
}
