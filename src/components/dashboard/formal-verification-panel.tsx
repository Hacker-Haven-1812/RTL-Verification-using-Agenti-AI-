'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { CheckCircle2, XCircle, AlertTriangle, ShieldCheck } from 'lucide-react';
import type { FormalCheckResult } from '@/lib/riscv-types';

interface Props {
  formalResults: Record<string, {
    properties: import('@/lib/riscv-types').FormalProperty[];
    results: FormalCheckResult[];
    summary?: { proof: number; counterexample: number; errors: number };
  }>;
}

const STATUS_STYLE: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  proof: { icon: CheckCircle2, color: 'text-primary border-primary/40 bg-primary/5', label: 'Proof' },
  counterexample: { icon: XCircle, color: 'text-destructive border-destructive/40 bg-destructive/5', label: 'Counterexample' },
  'parse-error': { icon: AlertTriangle, color: 'text-primary border-primary/40 bg-primary/5', label: 'Parse Error' },
  'runtime-error': { icon: AlertTriangle, color: 'text-primary border-primary/40 bg-primary/5', label: 'Runtime Error' },
};

export function FormalVerificationPanel({ formalResults }: Props) {
  const modules = Object.entries(formalResults);
  const totalProof = modules.reduce((s, [, v]) => s + (v.summary?.proof ?? 0), 0);
  const totalCEX = modules.reduce((s, [, v]) => s + (v.summary?.counterexample ?? 0), 0);
  const totalErr = modules.reduce((s, [, v]) => s + (v.summary?.errors ?? 0), 0);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Formal Verification Path
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px] border-primary/40 text-primary bg-primary/5">
              <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
              {totalProof} proof
            </Badge>
            <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive bg-destructive/5">
              <XCircle className="h-2.5 w-2.5 mr-1" />
              {totalCEX} cex
            </Badge>
            {totalErr > 0 && (
              <Badge variant="outline" className="text-[10px] border-primary/40 text-primary bg-primary/5">
                <AlertTriangle className="h-2.5 w-2.5 mr-1" />
                {totalErr} err
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full max-h-[460px]">
          <div className="px-3 pb-3 pt-2">
            {modules.length === 0 && (
              <div className="text-xs text-muted-foreground italic py-8 text-center">
                Formal verification results will appear here as the Property Synthesizer generates properties and the checker evaluates them against the RTL.
              </div>
            )}
            <Accordion type="multiple" defaultValue={modules.map(([m]) => m)} className="w-full">
              {modules.map(([moduleName, data]) => (
                <AccordionItem key={moduleName} value={moduleName} className="border-border/40">
                  <AccordionTrigger className="text-xs hover:no-underline py-2">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="font-mono text-primary">{moduleName}</span>
                      <Badge variant="outline" className="text-[9px] py-0">
                        {data.properties.length} props · {data.results.length} checked
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pb-2">
                    <div className="space-y-1.5">
                      {data.results.map((r, i) => {
                        const st = STATUS_STYLE[r.status] ?? STATUS_STYLE['runtime-error'];
                        const Icon = st.icon;
                        return (
                          <div key={i} className={`rounded-md border px-2 py-1.5 text-xs ${st.color}`}>
                            <div className="flex items-center gap-2">
                              <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                              <span className="font-mono font-medium flex-1 truncate">{r.property.name}</span>
                              <Badge variant="outline" className="text-[9px] py-0 px-1">
                                {st.label}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground tabular-nums">
                                {r.trials} trials
                              </span>
                            </div>
                            {r.status === 'counterexample' && r.counterexample && (
                              <div className="mt-1.5 ml-5 text-[10px] font-mono text-destructive/80 bg-destructive/5 border border-destructive/20 rounded p-1.5">
                                <div className="text-[9px] uppercase tracking-wider text-destructive mb-1">Counterexample input:</div>
                                {Object.entries(r.counterexample).map(([k, v]) => (
                                  <div key={k}>
                                    <span className="text-destructive/80">{k}</span>
                                    <span className="text-destructive/60"> = </span>
                                    <span className="text-destructive/70">0x{(v >>> 0).toString(16)} ({v})</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {r.error && (
                              <div className="mt-1 ml-5 text-[10px] text-primary/80/80 font-mono break-all">
                                {r.error}
                              </div>
                            )}
                            {r.property.explanation && (
                              <div className="mt-1 ml-5 text-[10px] text-muted-foreground italic">
                                {r.property.explanation}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {data.results.length === 0 && (
                        <div className="text-[11px] text-muted-foreground italic px-2 py-1">
                          Awaiting check results…
                        </div>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
