'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Cpu, GitBranch, ShieldCheck, Target, Lightbulb, FileCode2, TerminalSquare } from 'lucide-react';

interface Props {
  activePhase: 'idle' | 'case-gen' | 'sim' | 'coverage' | 'missing-case' | 'formal';
  currentIteration: number;
  formalActive: boolean;
  overallCoverage: number;
  coverageGoal: number;
}

export function ArchitectureDiagram({ activePhase, currentIteration, formalActive, overallCoverage, coverageGoal }: Props) {
  const nodeActive = (phase: string) => activePhase === phase;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">System Architecture — Agentic Verification Loop</CardTitle>
          <div className="flex items-center gap-2">
            {currentIteration > 0 && (
              <Badge variant="outline" className="text-[10px] font-mono">iter {currentIteration}</Badge>
            )}
            <Badge variant="outline" className="text-[10px] font-mono">
              {overallCoverage >= coverageGoal ? 'goal met' : `${(overallCoverage * 100).toFixed(0)}% / ${(coverageGoal * 100).toFixed(0)}%`}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <div className="flex justify-center mb-3">
            <Node icon={Cpu} title="RISC-V RTL Design" subtitle="RV32I · ALU + RegFile" active={false} accent="slate" />
          </div>
          <div className="grid grid-cols-2 gap-4 relative">
            <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
              <line x1="50%" y1="0" x2="25%" y2="20" stroke="oklch(0.4 0.014 240)" strokeWidth="1" strokeDasharray="3 3" />
              <line x1="50%" y1="0" x2="75%" y2="20" stroke="oklch(0.4 0.014 240)" strokeWidth="1" strokeDasharray="3 3" />
            </svg>
            <div className="space-y-2 pt-4">
              <div className="text-[10px] uppercase tracking-wider text-emerald-400/70 text-center font-medium">Simulation Loop</div>
              <Node icon={FileCode2} title="Test Generator" subtitle="→ assembly program" active={nodeActive('case-gen')} accent="emerald" compact />
              <Arrow active={nodeActive('case-gen') || nodeActive('sim')} />
              <Node icon={TerminalSquare} title="Simulation Engine" subtitle="RV32I core" active={nodeActive('sim')} accent="emerald" compact />
              <Arrow active={nodeActive('sim') || nodeActive('coverage')} />
              <Node icon={Target} title="Coverage Analyzer" subtitle="trace → report" active={nodeActive('coverage')} accent="cyan" compact />
              <Arrow active={nodeActive('coverage') || nodeActive('missing-case')} />
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <GitBranch className={`h-3 w-3 ${nodeActive('missing-case') ? 'text-amber-400' : 'text-amber-500/50'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-medium text-amber-400">Coverage Goal Met?</div>
                    <div className="text-[9px] text-muted-foreground">decision diamond</div>
                  </div>
                  <Badge variant="outline" className="text-[9px] py-0 px-1 border-amber-500/40 text-amber-400">
                    {overallCoverage >= coverageGoal ? 'YES → END' : 'NO → loop'}
                  </Badge>
                </div>
              </div>
              {overallCoverage < coverageGoal && (
                <>
                  <Arrow active={nodeActive('missing-case')} />
                  <Node icon={Lightbulb} title="Gap Analyzer" subtitle="→ new test scenarios" active={nodeActive('missing-case')} accent="amber" compact />
                  <div className="flex items-center justify-center pt-1">
                    <Badge variant="outline" className="text-[9px] py-0 px-1 border-amber-500/40 text-amber-400">
                      ↺ feedback to Test Generator
                    </Badge>
                  </div>
                </>
              )}
            </div>
            <div className="space-y-2 pt-4">
              <div className="text-[10px] uppercase tracking-wider text-fuchsia-400/70 text-center font-medium">Formal Verification</div>
              <Node icon={FileCode2} title="Property Synthesizer" subtitle="→ formal properties" active={formalActive} accent="fuchsia" compact />
              <Arrow active={formalActive} />
              <Node icon={ShieldCheck} title="Property Checker" subtitle="property-based testing" active={formalActive} accent="fuchsia" compact />
              <Arrow active={formalActive} />
              <div className="grid grid-cols-2 gap-1.5">
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5 text-center">
                  <CheckIcon />
                  <div className="text-[10px] font-medium text-emerald-400 mt-1">Proof</div>
                  <div className="text-[9px] text-muted-foreground">math certainty</div>
                </div>
                <div className="rounded-md border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 text-center">
                  <XIcon />
                  <div className="text-[10px] font-medium text-rose-400 mt-1">Counterexample</div>
                  <div className="text-[9px] text-muted-foreground">bug report</div>
                </div>
              </div>
              <div className="text-[9px] text-muted-foreground italic text-center pt-1">Complementary assurance layer</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const COLORS: Record<string, { border: string; bg: string; text: string; icon: string; ring: string }> = {
  emerald: { border: 'border-emerald-500/40', bg: 'bg-emerald-500/5', text: 'text-emerald-400', icon: 'text-emerald-400', ring: 'ring-emerald-500/40' },
  cyan: { border: 'border-cyan-500/40', bg: 'bg-cyan-500/5', text: 'text-cyan-400', icon: 'text-cyan-400', ring: 'ring-cyan-500/40' },
  amber: { border: 'border-amber-500/40', bg: 'bg-amber-500/5', text: 'text-amber-400', icon: 'text-amber-400', ring: 'ring-amber-500/40' },
  fuchsia: { border: 'border-fuchsia-500/40', bg: 'bg-fuchsia-500/5', text: 'text-fuchsia-400', icon: 'text-fuchsia-400', ring: 'ring-fuchsia-500/40' },
  slate: { border: 'border-slate-500/40', bg: 'bg-slate-500/5', text: 'text-slate-300', icon: 'text-slate-400', ring: 'ring-slate-500/40' },
};

function Node({ icon: Icon, title, subtitle, active, accent, compact }: {
  icon: typeof Cpu; title: string; subtitle: string; active: boolean; accent: 'emerald' | 'cyan' | 'amber' | 'fuchsia' | 'slate'; compact?: boolean;
}) {
  const c = COLORS[accent];
  return (
    <div className={`rounded-md border px-2 ${compact ? 'py-1.5' : 'py-2'} transition-all duration-300 ${c.border} ${c.bg} ${active ? `ring-1 ${c.ring} shadow-lg` : 'opacity-90'}`}>
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 flex-shrink-0 transition-transform duration-300 ${active ? c.icon + ' scale-110' : c.icon + '/60'}`} />
        <div className="flex-1 min-w-0">
          <div className={`text-[11px] font-medium truncate ${active ? c.text : c.text + '/80'}`}>{title}</div>
          <div className="text-[9px] text-muted-foreground truncate">{subtitle}</div>
        </div>
        {active && (
          <span className="relative flex h-1.5 w-1.5">
            <span className="live-dot absolute inline-flex h-full w-full rounded-full bg-current"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-current"></span>
          </span>
        )}
      </div>
    </div>
  );
}

function Arrow({ active }: { active: boolean }) {
  return (
    <div className="flex justify-center">
      <svg width="14" height="14" viewBox="0 0 14 14">
        <line x1="7" y1="0" x2="7" y2="9" stroke={active ? 'oklch(0.55 0.1 155)' : 'oklch(0.4 0.014 240)'} strokeWidth="1" strokeDasharray={active ? '' : '2 2'} className="transition-all duration-300" />
        <polygon points="3,9 11,9 7,13" fill={active ? 'oklch(0.55 0.1 155)' : 'oklch(0.4 0.014 240)'} className="transition-all duration-300" />
      </svg>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg className="mx-auto h-3 w-3 text-emerald-400" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 6 L5 9 L10 3" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="mx-auto h-3 w-3 text-rose-400" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 3 L9 9 M9 3 L3 9" />
    </svg>
  );
}
