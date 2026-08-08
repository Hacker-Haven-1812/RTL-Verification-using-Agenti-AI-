'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { AgentActivity } from '@/lib/riscv-types';

interface Props {
  activities: AgentActivity[];
}

export function AgentActivityPanel({ activities }: Props) {
  const reversed = [...activities].reverse();

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Activity Log</CardTitle>
          <div className="flex items-center gap-1.5">
            {activities.length > 0 && activities[activities.length - 1].phase === 'thinking' && (
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-primary" />
            )}
            <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
              {activities.length} events
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full max-h-[420px]">
          <div className="px-3 pb-3 space-y-0.5">
            {reversed.length === 0 && (
              <div className="text-xs text-muted-foreground italic py-8 text-center">
                No activity yet. Start a verification run to see live events.
              </div>
            )}
            {reversed.map((a) => (
              <div
                key={a.id}
                className="fade-in flex items-start gap-2 px-2 py-1 text-[11px] font-mono border-b border-border/20 last:border-b-0 hover:bg-muted/30"
              >
                <span className="text-muted-foreground/60 tabular-nums flex-shrink-0 w-10">
                  {new Date(a.timestamp).toLocaleTimeString('en-US', { hour12: false }).slice(3)}
                </span>
                <span className="text-muted-foreground flex-shrink-0 w-2">
                  {a.phase === 'thinking' ? '▸' : '◆'}
                </span>
                <span className="text-foreground/80 flex-shrink-0 w-28 truncate">
                  {a.agent}
                </span>
                <span className={`flex-1 ${a.phase === 'thinking' ? 'text-muted-foreground' : 'text-foreground/90'}`}>
                  {a.message}
                </span>
                {a.iteration !== undefined && (
                  <span className="text-muted-foreground/50 text-[10px] flex-shrink-0">
                    i{a.iteration}
                  </span>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
