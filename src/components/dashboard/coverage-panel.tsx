'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { CoverageReport } from '@/lib/riscv-types';

interface Props {
  report: CoverageReport | null;
  history: { iteration: number; overall: number; instruction: number; branch: number; register: number; hazard: number; functional: number }[];
}

function fmtPct(r: number | undefined | null): string {
  if (r === null || r === undefined || Number.isNaN(r)) return '0.0%';
  return (r * 100).toFixed(1) + '%';
}

function pctColor(r: number | undefined | null): string {
  if (r === null || r === undefined) return 'bg-muted';
  const p = r * 100;
  if (p >= 80) return 'bg-emerald-500';
  if (p >= 50) return 'bg-amber-500';
  return 'bg-rose-500';
}

export function CoveragePanel({ report, history }: Props) {
  const sparkline = useMemo(() => {
    if (history.length === 0) return null;
    const W = 220, H = 60;
    const pts = history.map((h, i) => ({
      x: (i / Math.max(1, history.length - 1)) * W,
      y: H - h.overall * H,
    }));
    const path = pts.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' ');
    const areaPath = `${path} L${W},${H} L0,${H} Z`;
    return { path, areaPath, W, H, pts };
  }, [history]);

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Coverage Closure</CardTitle>
          <Badge variant="outline" className="font-mono text-xs">
            {report ? `${fmtPct(report.overallCoverage)} overall` : 'idle'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Overall + sparkline */}
        <div className="rounded-md border border-border/60 bg-muted/30 p-3">
          <div className="flex items-end justify-between mb-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Overall</div>
              <div className="text-2xl font-semibold tabular-nums">
                {report ? (report.overallCoverage * 100).toFixed(1) : '0.0'}
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            {sparkline && (
              <svg width={sparkline.W} height={sparkline.H} className="overflow-visible">
                <defs>
                  <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.7 0.16 155)" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="oklch(0.7 0.16 155)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={sparkline.areaPath} fill="url(#spark-fill)" />
                <path d={sparkline.path} fill="none" stroke="oklch(0.7 0.16 155)" strokeWidth="1.5" />
                {sparkline.pts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r="2" fill="oklch(0.7 0.16 155)" />
                ))}
              </svg>
            )}
          </div>
        </div>

        {/* Coverage gauges */}
        <div className="grid grid-cols-2 gap-2">
          <GaugeRow
            label="Instruction"
            value={report ? `${report.instructionCoverage.hit}/${report.instructionCoverage.total}` : '—'}
            pct={report?.instructionCoverage.ratio}
          />
          <GaugeRow
            label="Branch"
            value={report ? `${report.branchCoverage.bothObserved}/${report.branchCoverage.totalBranchOps}` : '—'}
            pct={report?.branchCoverage.ratio}
          />
          <GaugeRow
            label="Register"
            value={report ? `${report.registerCoverage.written.length}/31` : '—'}
            pct={report?.registerCoverage.ratio}
          />
          <GaugeRow
            label="Hazard"
            value={report ? `R${report.hazardCoverage.rawCount}/C${report.hazardCoverage.controlCount}` : '—'}
            pct={report?.hazardCoverage.ratio}
          />
          <GaugeRow
            label="Memory"
            value={report ? `${report.memoryCoverage.bytesTouched}B` : '—'}
            pct={Math.min(1, (report?.memoryCoverage.bytesTouched ?? 0) / 256)}
          />
          <GaugeRow
            label="Functional"
            value={report ? `${report.functionalCoverage.hitCount}/${report.functionalCoverage.total}` : '—'}
            pct={report?.functionalCoverage.ratio}
          />
        </div>

        {/* Missing scenarios */}
        {report && report.missingScenarios.length > 0 && (
          <TooltipProvider delayDuration={200}>
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] uppercase tracking-wider text-amber-400">Coverage Gaps</div>
                <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">
                  {report.missingScenarios.length} missing
                </Badge>
              </div>
              <div className="max-h-24 overflow-y-auto space-y-0.5">
                {report.missingScenarios.slice(0, 12).map((s, i) => (
                  <div key={i} className="text-[11px] text-muted-foreground truncate">
                    <span className="text-amber-500/70">•</span> {s}
                  </div>
                ))}
                {report.missingScenarios.length > 12 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="text-[11px] text-amber-400/70 cursor-help">+ {report.missingScenarios.length - 12} more…</div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-md">
                      <div className="space-y-0.5 max-h-60 overflow-y-auto">
                        {report.missingScenarios.map((s, i) => (
                          <div key={i} className="text-[11px]">{s}</div>
                        ))}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          </TooltipProvider>
        )}

        {/* Instruction hit/miss matrix */}
        {report && (
          <div className="rounded-md border border-border/60 p-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">RV32I Instruction Coverage</div>
            <div className="flex flex-wrap gap-1">
              {report.instructionCoverage.hitMnemonicSet.map((m) => (
                <Badge key={m} variant="outline" className="text-[10px] py-0 px-1.5 border-emerald-500/40 text-emerald-400 bg-emerald-500/5">
                  {m}
                </Badge>
              ))}
              {report.instructionCoverage.missingMnemonicSet.map((m) => (
                <Badge key={m} variant="outline" className="text-[10px] py-0 px-1.5 border-rose-500/30 text-rose-400/60 bg-rose-500/5 line-through">
                  {m}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GaugeRow({ label, value, pct }: { label: string; value: string; pct?: number }) {
  const p = pct ?? 0;
  return (
    <div className="rounded-md border border-border/40 bg-card/50 px-2 py-1.5">
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">{value}</span>
      </div>
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div className={`h-full transition-all duration-500 ${pctColor(pct)}`} style={{ width: `${Math.min(100, p * 100)}%` }} />
      </div>
    </div>
  );
}
