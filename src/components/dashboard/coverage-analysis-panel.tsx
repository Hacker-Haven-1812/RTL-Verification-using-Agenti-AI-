'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Brain } from 'lucide-react';
import type { CoverageAnalysis } from '@/lib/riscv-types';

interface Props {
  analysis: CoverageAnalysis | null;
}

export function CoverageAnalysisPanel({ analysis }: Props) {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Brain className="h-4 w-4 text-cyan-400" />
            Coverage Analysis (LLM)
          </CardTitle>
          {analysis && (
            <Badge variant="outline" className="text-[10px] border-cyan-500/40 text-cyan-400">
              {analysis.weakAreas.length} weak · {analysis.strongAreas.length} strong
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full max-h-[280px]">
          <div className="px-3 pb-3 pt-2 space-y-2">
            {!analysis ? (
              <div className="text-xs text-muted-foreground italic py-6 text-center">
                After each simulation run, the Coverage Analysis Agent reads the deterministic coverage report and produces a plain-English summary with prioritized recommendations for the next iteration.
              </div>
            ) : (
              <>
                <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2">
                  <div className="text-[9px] uppercase tracking-wider text-cyan-400 mb-1">Summary</div>
                  <div className="text-xs text-foreground">{analysis.summary}</div>
                </div>
                {analysis.strongAreas.length > 0 && (
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-emerald-400 mb-1">Strong Areas</div>
                    <div className="flex flex-wrap gap-1">
                      {analysis.strongAreas.map((s, i) => (
                        <Badge key={i} variant="outline" className="text-[10px] py-0 px-1.5 border-emerald-500/40 text-emerald-400 bg-emerald-500/5">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {analysis.weakAreas.length > 0 && (
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-rose-400 mb-1">Weak Areas</div>
                    <div className="flex flex-wrap gap-1">
                      {analysis.weakAreas.map((s, i) => (
                        <Badge key={i} variant="outline" className="text-[10px] py-0 px-1.5 border-rose-500/40 text-rose-400 bg-rose-500/5">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {analysis.prioritizedRecommendations.length > 0 && (
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-amber-400 mb-1">Prioritized Recommendations</div>
                    <div className="space-y-1">
                      {analysis.prioritizedRecommendations.map((r, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs">
                          <span className="flex-shrink-0 w-4 h-4 rounded-sm bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-[9px] font-bold text-amber-400 mt-0.5">
                            {i + 1}
                          </span>
                          <span className="text-muted-foreground">{r}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
