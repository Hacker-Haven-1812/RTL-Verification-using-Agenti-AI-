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
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Verification Flow</CardTitle>
          <div className="flex items-center gap-2">
            {currentIteration > 0 && (
              <Badge variant="outline" className="text-[10px] font-mono">
                iter {currentIteration}
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px] font-mono">
              {overallCoverage >= coverageGoal ? 'goal met' : `${(overallCoverage * 100).toFixed(0)}% / ${(coverageGoal * 100).toFixed(0)}%`}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {}
          <div className="flex justify-center mb-3">
            <Node
              icon={Cpu}
              title="RISC-V RTL Design"
              subtitle="RV32I · ALU + RegFile"
              active={false}
            />
          </div>

          {}
          <div className="grid grid-cols-2 gap-4 relative">
            {}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
              <line x1="50%" y1="0" x2="25%" y2="20" stroke="oklch(0.35 0.005 60)" strokeWidth="1" strokeDasharray="3 3" />
              <line x1="50%" y1="0" x2="75%" y2="20" stroke="oklch(0.35 0.005 60)" strokeWidth="1" strokeDasharray="3 3" />
            </svg>

            {}
            <div className="space-y-2 pt-4">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground text-center font-medium">
                Simulation Loop
              </div>
              <Node
                icon={FileCode2}
                title="Test Generator"
                subtitle="→ assembly"
                active={nodeActive('case-gen')}
                compact
              />
              <Arrow active={nodeActive('case-gen') || nodeActive('sim')} />
              <Node
                icon={TerminalSquare}
                title="Simulation Engine"
                subtitle="RV32I core"
                active={nodeActive('sim')}
                compact
              />
              <Arrow active={nodeActive('sim') || nodeActive('coverage')} />
              <Node
                icon={Target}
                title="Coverage Analyzer"
                subtitle="trace → report"
                active={nodeActive('coverage')}
                compact
              />
              <Arrow active={nodeActive('coverage') || nodeActive('missing-case')} />
              <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <GitBranch className={`h-3 w-3 ${nodeActive('missing-case') ? 'text-primary' : 'text-muted-foreground'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-medium">Coverage Goal Met?</div>
                    <div className="text-[9px] text-muted-foreground">decision</div>
                  </div>
                  <Badge variant="outline" className="text-[9px] py-0 px-1">
                    {overallCoverage >= coverageGoal ? 'YES → end' : 'NO → loop'}
                  </Badge>
                </div>
              </div>
              {overallCoverage < coverageGoal && (
                <>
                  <Arrow active={nodeActive('missing-case')} />
                  <Node
                    icon={Lightbulb}
                    title="Gap Analyzer"
                    subtitle="→ new scenarios"
                    active={nodeActive('missing-case')}
                    compact
                  />
                  <div className="flex items-center justify-center pt-1">
                    <Badge variant="outline" className="text-[9px] py-0 px-1">
                      ↺ feedback to Test Generator
                    </Badge>
                  </div>
                </>
              )}
            </div>

            {}
            <div className="space-y-2 pt-4">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground text-center font-medium">
                Formal Verification
              </div>
              <Node
                icon={FileCode2}
                title="Property Synthesizer"
                subtitle="→ formal props"
                active={formalActive}
                compact
              />
              <Arrow active={formalActive} />
              <Node
                icon={ShieldCheck}
                title="Property Checker"
                subtitle="random trials"
                active={formalActive}
                compact
              />
              <Arrow active={formalActive} />
              <div className="grid grid-cols-2 gap-1.5">
                <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5 text-center">
                  <CheckIcon />
                  <div className="text-[10px] font-medium mt-1">Proof</div>
                  <div className="text-[9px] text-muted-foreground">verified</div>
                </div>
                <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5 text-center">
                  <XIcon />
                  <div className="text-[10px] font-medium mt-1">Counterexample</div>
                  <div className="text-[9px] text-muted-foreground">bug found</div>
                </div>
              </div>
              <div className="text-[9px] text-muted-foreground italic text-center pt-1">
                Complementary assurance
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Node({
  icon: Icon,
  title,
  subtitle,
  active,
  compact,
}: {
  icon: typeof Cpu;
  title: string;
  subtitle: string;
  active: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-md border px-2 ${compact ? 'py-1.5' : 'py-2'} transition-all ${active ? 'border-primary bg-primary/5' : 'border-border bg-card/50'}`}
    >
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
        <div className="flex-1 min-w-0">
          <div className={`text-[11px] font-medium truncate ${active ? 'text-primary' : 'text-foreground/90'}`}>{title}</div>
          <div className="text-[9px] text-muted-foreground truncate">{subtitle}</div>
        </div>
        {active && (
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-primary" />
        )}
      </div>
    </div>
  );
}

function Arrow({ active }: { active: boolean }) {
  return (
    <div className="flex justify-center">
      <svg width="12" height="12" viewBox="0 0 12 12">
        <line x1="6" y1="0" x2="6" y2="8" stroke={active ? 'oklch(0.55 0.10 55)' : 'oklch(0.35 0.005 60)'} strokeWidth="1" strokeDasharray={active ? '' : '2 2'} />
        <polygon points="3,8 9,8 6,12" fill={active ? 'oklch(0.55 0.10 55)' : 'oklch(0.35 0.005 60)'} />
      </svg>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg className="mx-auto h-3 w-3 text-primary" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 6 L5 9 L10 3" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg className="mx-auto h-3 w-3 text-destructive" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 3 L9 9 M9 3 L3 9" />
    </svg>
  );
}
