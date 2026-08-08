'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { AgentActivity } from '@/lib/riscv-types';

interface Props {
  activities: AgentActivity[];
}

const AGENT_COLORS: Record<string, string> = {
  'Case Generation': 'border-emerald-500/40 text-emerald-400 bg-emerald-500/5',
  'Coverage Analysis': 'border-cyan-500/40 text-cyan-400 bg-cyan-500/5',
  'Missing Case Suggestion': 'border-amber-500/40 text-amber-400 bg-amber-500/5',
  'Property Generation': 'border-fuchsia-500/40 text-fuchsia-400 bg-fuchsia-500/5',
  'Assembler': 'border-slate-500/40 text-slate-400 bg-slate-500/5',
};

const AGENT_ICONS: Record<string, string> = {
  'Case Generation': 'CG',
  'Coverage Analysis': 'CA',
  'Missing Case Suggestion': 'MC',
  'Property Generation': 'PG',
  'Assembler': 'ASM',
};

export function AgentActivityPanel({ activities }: Props) {
  // Show most recent at the top
  const reversed = [...activities].reverse();

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Agent Activity</CardTitle>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              {activities.length > 0 && activities[activities.length - 1].phase === 'thinking' && (
                <span className="live-dot absolute inline-flex h-full w-full rounded-full bg-emerald-500"></span>
              )}
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-[10px] text-muted-foreground">
              {activities.length} events
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full max-h-[420px]">
          <div className="px-3 pb-3 space-y-1.5">
            {reversed.length === 0 && (
              <div className="text-xs text-muted-foreground italic py-8 text-center">
                No agent activity yet. Start a verification run to see agents collaborate in real time.
              </div>
            )}
            {reversed.map((a) => (
              <div
                key={a.id}
                className={`fade-in-up rounded-md border px-2 py-1.5 text-xs ${AGENT_COLORS[a.agent] ?? 'border-border bg-card'}`}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0 w-7 h-7 rounded-md bg-card/80 border border-border/60 flex items-center justify-center text-[9px] font-bold">
                    {AGENT_ICONS[a.agent] ?? a.agent.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{a.agent}</span>
                      <div className="flex items-center gap-1.5">
                        {a.phase === 'thinking' ? (
                          <Badge variant="outline" className="text-[9px] py-0 px-1 border-amber-500/40 text-amber-400">
                            <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-amber-500 mr-1"></span>
                            thinking
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px] py-0 px-1 border-emerald-500/40 text-emerald-400">
                            done
                          </Badge>
                        )}
                        {a.iteration !== undefined && (
                          <span className="text-[9px] text-muted-foreground font-mono">i{a.iteration}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 break-words">
                      {a.message}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
