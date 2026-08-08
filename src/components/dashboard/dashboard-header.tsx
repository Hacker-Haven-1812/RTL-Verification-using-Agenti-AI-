'use client';

import { Badge } from '@/components/ui/badge';
import { Radio } from 'lucide-react';

interface Props {
  connected: boolean;
  status: 'idle' | 'running' | 'completed' | 'error' | 'aborted';
}

export function DashboardHeader({ connected, status }: Props) {
  return (
    <header className="border-b border-border bg-card/60 backdrop-blur-sm sticky top-0 z-20">
      <div className="px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 rounded-sm bg-primary" />
            <div>
              <h1 className="text-sm font-semibold leading-tight tracking-tight">
                RV32I Verification Console
              </h1>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                Autonomous RTL verification · Coverage closure · Formal checking
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-primary' : 'bg-muted-foreground/40'}`} />
            {connected ? 'connected' : 'offline'}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
            RV32I · 39 instructions
          </span>
        </div>
      </div>
    </header>
  );
}
