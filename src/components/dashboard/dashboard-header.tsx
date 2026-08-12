'use client';

import { Cpu } from 'lucide-react';

interface Props {
  connected: boolean;
  status: 'idle' | 'running' | 'completed' | 'error' | 'aborted';
}

export function DashboardHeader({ connected, status }: Props) {
  return (
    <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-20">
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
                RTL Verification Using Agentic AI
              </h1>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                Autonomous multi-agent framework · Coverage closure · Formal checking
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            {connected ? 'ws connected' : 'ws offline'}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
            RV32I · 39 instructions
          </span>
        </div>
      </div>
    </header>
  );
}
