'use client';

import { Badge } from '@/components/ui/badge';
import { Cpu, Radio } from 'lucide-react';

interface Props {
  connected: boolean;
  status: 'idle' | 'running' | 'completed' | 'error' | 'aborted';
  sessionId: string | null;
}

export function DashboardHeader({ connected, status, sessionId }: Props) {
  return (
    <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm sticky top-0 z-20">
      <div className="px-4 py-2.5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Cpu className="h-6 w-6 text-emerald-400" />
              <span className="absolute -top-1 -right-1 flex h-2 w-2">
                <span className={`absolute inline-flex h-full w-full rounded-full ${status === 'running' ? 'bg-emerald-500 animate-ping' : 'bg-muted-foreground/40'}`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${status === 'running' ? 'bg-emerald-500' : 'bg-muted-foreground/60'}`}></span>
              </span>
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-tight">
                Agentic RISC-V RTL Verification
              </h1>
              <p className="text-[10px] text-muted-foreground leading-tight">
                Autonomous multi-agent framework · VLSID 2026 User Design Track
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] font-mono">
            <Radio className={`h-2.5 w-2.5 mr-1 ${connected ? 'text-emerald-400' : 'text-rose-400'}`} />
            {connected ? 'ws connected' : 'ws offline'}
          </Badge>
          <Badge variant="outline" className="text-[10px] font-mono">
            RV32I · 39 instrs
          </Badge>
          <Badge variant="outline" className="text-[10px] font-mono">
            4 AI agents
          </Badge>
          {sessionId && (
            <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground">
              {sessionId.slice(0, 16)}…
            </Badge>
          )}
        </div>
      </div>
    </header>
  );
}
