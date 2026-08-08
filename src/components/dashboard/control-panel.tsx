'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Play, Square, RotateCcw, Settings2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  status: 'idle' | 'running' | 'completed' | 'error' | 'aborted';
  onStart: (config: {
    coverageGoal: number;
    maxIterations: number;
    maxCyclesPerRun: number;
    targetModules: string[];
    initialScenarios: string[];
    instructionMixHint?: string;
  }) => void;
  onAbort: () => void;
  onReset: () => void;
  availableModules: string[];
}

const SEED_SCENARIOS = [
  'ARITH_OVERFLOW', 'BRANCH_TAKEN', 'BRANCH_NOT_TAKEN', 'MEMORY_LOAD',
  'MEMORY_STORE', 'DATA_HAZARD_RAW', 'JAL_JALR_PAIR', 'SHIFT_ARITHMETIC',
  'UPPER_IMMEDIATE', 'EBREAK_TERMINATION', 'SUB_UNDERFLOW', 'SIGNED_LT',
  'UNSIGNED_LT', 'CONTROL_HAZARD',
];

export function ControlPanel({ status, onStart, onAbort, onReset, availableModules }: Props) {
  const [coverageGoal, setCoverageGoal] = useState(0.70);
  const [maxIterations, setMaxIterations] = useState(6);
  const [maxCycles, setMaxCycles] = useState(2000);
  const [targetModules, setTargetModules] = useState<string[]>(availableModules);
  const [useSeedScenarios, setUseSeedScenarios] = useState(true);
  const [selectedSeeds, setSelectedSeeds] = useState<string[]>(['ARITH_OVERFLOW', 'BRANCH_TAKEN', 'MEMORY_LOAD', 'DATA_HAZARD_RAW']);
  const [hint, setHint] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isRunning = status === 'running';

  const handleStart = () => {
    onStart({
      coverageGoal,
      maxIterations,
      maxCyclesPerRun: maxCycles,
      targetModules,
      initialScenarios: useSeedScenarios ? selectedSeeds : [],
      instructionMixHint: hint.trim() || undefined,
    });
  };

  const toggleModule = (m: string) => {
    setTargetModules(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  };

  const toggleSeed = (s: string) => {
    setSelectedSeeds(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Configuration</CardTitle>
          <Badge
            variant="outline"
            className={`text-[10px] ${
              status === 'running' ? 'border-primary/40 text-primary bg-primary/5' :
              status === 'completed' ? 'border-primary/30 text-primary/80' :
              status === 'error' ? 'border-destructive/40 text-destructive bg-destructive/5' :
              'border-border text-muted-foreground'
            }`}
          >
            {status === 'running' && <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-primary mr-1.5"></span>}
            {status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Coverage goal slider */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Coverage Goal</Label>
            <span className="text-xs font-mono tabular-nums text-primary">{(coverageGoal * 100).toFixed(0)}%</span>
          </div>
          <Slider
            value={[coverageGoal * 100]}
            min={20}
            max={95}
            step={5}
            onValueChange={(v) => setCoverageGoal(v[0] / 100)}
            disabled={isRunning}
          />
        </div>

        {/* Max iterations */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Max Iterations</Label>
            <span className="text-xs font-mono tabular-nums text-primary">{maxIterations}</span>
          </div>
          <Slider
            value={[maxIterations]}
            min={1}
            max={8}
            step={1}
            onValueChange={(v) => setMaxIterations(v[0])}
            disabled={isRunning}
          />
        </div>

        {/* Max cycles per run */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Max Cycles / Run</Label>
            <span className="text-xs font-mono tabular-nums text-primary">{maxCycles}</span>
          </div>
          <Slider
            value={[maxCycles]}
            min={200}
            max={5000}
            step={100}
            onValueChange={(v) => setMaxCycles(v[0])}
            disabled={isRunning}
          />
        </div>

        {/* Target RTL modules */}
        <div className="space-y-1.5">
          <Label className="text-xs">Target modules (formal verification)</Label>
          <div className="flex flex-wrap gap-1">
            {availableModules.map((m) => (
              <button
                key={m}
                onClick={() => !isRunning && toggleModule(m)}
                disabled={isRunning}
                className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                  targetModules.includes(m)
                    ? 'border-primary/40 text-primary bg-primary/5'
                    : 'border-border text-muted-foreground bg-card/50 hover:bg-muted/50'
                } ${isRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Seed scenarios */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Seed scenarios (iteration 1)</Label>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">{useSeedScenarios ? `${selectedSeeds.length} selected` : 'auto'}</span>
              <Switch checked={useSeedScenarios} onCheckedChange={setUseSeedScenarios} disabled={isRunning} />
            </div>
          </div>
          {useSeedScenarios && (
            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
              {SEED_SCENARIOS.map((s) => (
                <button
                  key={s}
                  onClick={() => !isRunning && toggleSeed(s)}
                  disabled={isRunning}
                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                    selectedSeeds.includes(s)
                      ? 'border-primary/40 text-primary bg-primary/5'
                      : 'border-border text-muted-foreground bg-card/50 hover:bg-muted/50'
                  } ${isRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Advanced */}
        <div className="space-y-1.5">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Settings2 className="h-3 w-3" />
            {showAdvanced ? 'Hide' : 'Show'} advanced
          </button>
          {showAdvanced && (
            <div className="space-y-1.5 pl-4 border-l border-border/60">
              <Label className="text-xs">Instruction-mix hint (free-form, optional)</Label>
              <Input
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="e.g. emphasize unsigned compares and shifts"
                disabled={isRunning}
                className="text-xs"
              />
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <p className="text-[10px] text-muted-foreground italic cursor-help">
                      ℹ Passed to the Test Generator as additional context.
                    </p>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    Use this hint to bias test generation toward specific instruction families or scenario types without writing tests yourself.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          {!isRunning ? (
            <Button onClick={handleStart} className="flex-1">
              <Play className="h-3.5 w-3.5 mr-1.5" />
              Start Verification
            </Button>
          ) : (
            <Button onClick={onAbort} variant="destructive" className="flex-1">
              <Square className="h-3.5 w-3.5 mr-1.5" />
              Abort
            </Button>
          )}
          <Button onClick={onReset} variant="outline" disabled={isRunning}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="text-[10px] text-muted-foreground">
          Test programs and formal properties are generated on demand. Nothing is pre-stored.
        </div>
      </CardContent>
    </Card>
  );
}
