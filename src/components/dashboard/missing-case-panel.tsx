'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Lightbulb } from 'lucide-react';
import type { MissingCaseSuggestion } from '@/lib/riscv-types';

interface Props {
  suggestions: MissingCaseSuggestion[];
}

export function MissingCasePanel({ suggestions }: Props) {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-400" />
            Missing Case Suggestions
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">
            {suggestions.length} proposed
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full max-h-[280px]">
          <div className="px-3 pb-3 space-y-2 pt-2">
            {suggestions.length === 0 ? (
              <div className="text-xs text-muted-foreground italic py-6 text-center">
                After each iteration, the Gap Analyzer proposes new high-value test scenarios to close coverage gaps. Those suggestions feed back into the next iteration's Test Generator.
              </div>
            ) : (
              suggestions.map((s, i) => (
                <div key={i} className="fade-in rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
                  <div className="flex items-start gap-2">
                    <div className="flex-shrink-0 w-5 h-5 rounded-md bg-primary/10 border border-primary/30 flex items-center justify-center text-[10px] font-bold text-amber-400">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-amber-400/80">{s.scenario}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{s.rationale}</div>
                      {s.suggestedInstructions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {s.suggestedInstructions.map((inst, j) => (
                            <Badge key={j} variant="outline" className="text-[9px] py-0 px-1 font-mono border-primary/30 text-amber-400/80 bg-primary/5">
                              {inst}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
