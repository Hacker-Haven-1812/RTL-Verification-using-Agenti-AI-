'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Props {
  trace: import('@/lib/riscv-types').CoreTraceEntry[];
}

const HAZARD_BADGE: Record<string, string> = {
  RAW: 'border-primary/40 text-primary bg-primary/5',
  CONTROL: 'border-primary/40 text-primary bg-primary/5',
  'RAW+CONTROL': 'border-destructive/40 text-destructive bg-destructive/5',
  NONE: '',
};

function fmtHex(n: number, width = 4): string {
  return '0x' + (n >>> 0).toString(16).toUpperCase().padStart(width, '0');
}

export function InstructionTracePanel({ trace }: Props) {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Execution Trace</CardTitle>
          <Badge variant="outline" className="text-[10px] font-mono">
            {trace.length} cycles
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full max-h-[420px]">
          {trace.length === 0 ? (
            <div className="text-xs text-muted-foreground italic py-8 text-center">
              No execution trace yet. Trace entries stream in real time as the simulator runs.
            </div>
          ) : (
            <div className="font-mono text-[11px]">
              <div className="grid grid-cols-[3rem_5rem_7rem_1fr_8rem] gap-2 px-3 py-1.5 border-b border-border/40 sticky top-0 bg-card/95 backdrop-blur-sm text-[10px] uppercase tracking-wider text-muted-foreground">
                <div>cycle</div>
                <div>pc</div>
                <div>mnemonic</div>
                <div>operands</div>
                <div>hazard</div>
              </div>
              <div>
                {trace.map((e, i) => (
                  <div
                    key={i}
                    className={`fade-in grid grid-cols-[3rem_5rem_7rem_1fr_8rem] gap-2 px-3 py-0.5 border-b border-border/20 hover:bg-muted/30 ${i % 2 === 0 ? 'bg-card/30' : ''}`}
                  >
                    <div className="text-muted-foreground tabular-nums">{e.cycle}</div>
                    <div className="text-primary/80 tabular-nums">{fmtHex(e.pc)}</div>
                    <div className="text-primary truncate">
                      {e.mnemonic.split(' ')[0]}
                      {e.mnemonic.includes(' ') && (
                        <span className="text-muted-foreground ml-1">{e.mnemonic.split(' ').slice(1).join(' ')}</span>
                      )}
                    </div>
                    <div className="text-muted-foreground truncate">
                      {e.rs1 !== undefined && (
                        <span className="mr-2">
                          <span className="text-muted-foreground">x{e.rs1}</span>
                          <span className="text-muted-foreground/60">=</span>
                          <span className="text-foreground/80">{e.rs1Val ?? 0}</span>
                        </span>
                      )}
                      {e.rs2 !== undefined && (
                        <span className="mr-2">
                          <span className="text-muted-foreground">x{e.rs2}</span>
                          <span className="text-muted-foreground/60">=</span>
                          <span className="text-foreground/80">{e.rs2Val ?? 0}</span>
                        </span>
                      )}
                      {e.rd !== undefined && (
                        <span>
                          <span className="text-muted-foreground/60">→</span>
                          <span className="text-primary/80"> x{e.rd}</span>
                          <span className="text-muted-foreground/60">=</span>
                          <span className="text-primary/80">{e.rdVal ?? 0}</span>
                        </span>
                      )}
                      {e.memRead && (
                        <span className="ml-2 text-primary/70">
                          R[{fmtHex(e.memRead.addr, 3)}]={e.memRead.value}
                        </span>
                      )}
                      {e.memWrite && (
                        <span className="ml-2 text-primary/70">
                          W[{fmtHex(e.memWrite.addr, 3)}]={e.memWrite.value}
                        </span>
                      )}
                    </div>
                    <div>
                      {e.hazard.hazardType && e.hazard.hazardType !== 'NONE' && (
                        <Badge variant="outline" className={`text-[9px] py-0 px-1 ${HAZARD_BADGE[e.hazard.hazardType] ?? ''}`}>
                          {e.hazard.hazardType}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
