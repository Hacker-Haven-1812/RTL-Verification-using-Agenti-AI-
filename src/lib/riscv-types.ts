


export interface OrchestratorConfig {
  sessionId: string;
  coverageGoal: number;
  maxIterations: number;
  maxCyclesPerRun: number;
  targetModules: string[];
  initialScenarios: string[];
  instructionMixHint?: string;
}

export interface CoreTraceEntry {
  cycle: number;
  pc: number;
  raw: number;
  mnemonic: string;
  rs1?: number;
  rs1Val?: number;
  rs2?: number;
  rs2Val?: number;
  rd?: number;
  rdVal?: number;
  branchTaken?: boolean;
  branchTarget?: number;
  memRead?: { addr: number; size: number; value: number; signed: boolean };
  memWrite?: { addr: number; size: number; value: number };
  hazard: {
    dataHazard: boolean;
    controlHazard: boolean;
    hazardType?: 'RAW' | 'CONTROL' | 'NONE' | 'RAW+CONTROL';
  };
  exception?: string;
}

export interface ExecutionResult {
  exitReason: 'ebreak' | 'ecall' | 'max-cycles' | 'illegal-instruction' | 'memory-fault';
  cycles: number;
  instructionsRetired: number;
  trace: CoreTraceEntry[];
  finalRegs: number[];
  finalPc: number;
  error?: string;
}

export interface CoverageReport {
  instructionCoverage: {
    total: number;
    hit: number;
    ratio: number;
    hitMnemonicSet: string[];
    missingMnemonicSet: string[];
  };
  branchCoverage: {
    totalBranchOps: number;
    takenObserved: number;
    notTakenObserved: number;
    bothObserved: number;
    ratio: number;
  };
  registerCoverage: {
    written: number[];
    notWritten: number[];
    ratio: number;
  };
  hazardCoverage: {
    rawObserved: boolean;
    controlObserved: boolean;
    rawCount: number;
    controlCount: number;
    ratio: number;
  };
  memoryCoverage: {
    bytesTouched: number;
    totalBytes: number;
    ratio: number;
    readBytes: number;
    writtenBytes: number;
  };
  functionalCoverage: {
    scenarios: { name: string; hit: boolean; description: string }[];
    hitCount: number;
    total: number;
    ratio: number;
  };
  overallCoverage: number;
  missingScenarios: string[];
  totalCycles: number;
  totalInstructions: number;
}

export interface CoverageAnalysis {
  summary: string;
  strongAreas: string[];
  weakAreas: string[];
  prioritizedRecommendations: string[];
}

export interface MissingCaseSuggestion {
  scenario: string;
  rationale: string;
  suggestedInstructions: string[];
}

export interface FormalProperty {
  name: string;
  target: string;
  declaration: string;
  inputs: { name: string; width: number }[];
  precondition: string;
  consequent: string;
  explanation?: string;
}

export interface FormalCheckResult {
  property: FormalProperty;
  status: 'proof' | 'counterexample' | 'parse-error' | 'runtime-error';
  trials: number;
  counterexample?: Record<string, number>;
  error?: string;
  durationMs: number;
}

export interface AgentActivity {
  id: string;
  agent: string;
  phase: 'thinking' | 'done';
  message: string;
  detail?: any;
  timestamp: number;
  iteration?: number;
}

export type OrchestratorEvent =
  | { type: 'session-started'; sessionId: string; config: OrchestratorConfig }
  | { type: 'sim-iteration-start'; iteration: number; targetScenarios: string[] }
  | { type: 'agent-activity'; agent: string; phase: 'thinking' | 'done'; message: string; detail?: any }
  | { type: 'program-generated'; iteration: number; program: string; rationale: string; targets: string[]; assemblerErrors: { line: number; message: string }[]; instructionCount: number }
  | { type: 'simulation-progress'; iteration: number; cycle: number; pc: number; mnemonic: string; entry: CoreTraceEntry }
  | { type: 'simulation-complete'; iteration: number; result: ExecutionResult }
  | { type: 'coverage-update'; iteration: number; report: CoverageReport }
  | { type: 'coverage-analysis'; iteration: number; analysis: CoverageAnalysis }
  | { type: 'missing-case-suggestions'; iteration: number; suggestions: MissingCaseSuggestion[] }
  | { type: 'sim-loop-end'; reason: 'goal-met' | 'max-iterations'; finalCoverage: number }
  | { type: 'formal-start'; module: string }
  | { type: 'formal-properties-generated'; module: string; properties: { name: string; declaration: string; explanation: string }[] }
  | { type: 'formal-check-result'; module: string; result: FormalCheckResult }
  | { type: 'formal-end'; module: string; summary: { proof: number; counterexample: number; errors: number } }
  | { type: 'session-ended'; sessionId: string; summary: any }
  | { type: 'error'; message: string; where: string };

export interface VerificationState {
  status: 'idle' | 'running' | 'completed' | 'error' | 'aborted';
  sessionId: string | null;
  config: OrchestratorConfig | null;
  currentIteration: number;
  totalIterations: number;
  coverageHistory: { iteration: number; overall: number; instruction: number; branch: number; register: number; hazard: number; functional: number }[];
  latestReport: CoverageReport | null;
  latestAnalysis: CoverageAnalysis | null;
  latestProgram: { iteration: number; program: string; rationale: string; targets: string[]; assemblerErrors: any[]; instructionCount: number } | null;
  missingCaseSuggestions: MissingCaseSuggestion[];
  trace: CoreTraceEntry[];
  agentActivities: AgentActivity[];
  formalResults: Record<string, {
    properties: FormalProperty[];
    results: FormalCheckResult[];
    summary?: { proof: number; counterexample: number; errors: number };
  }>;
  simLoopEndReason: 'goal-met' | 'max-iterations' | null;
  errors: { message: string; where: string; timestamp: number }[];
  sessionStartTime: number | null;
  sessionEndTime: number | null;



  cumulativeCoverage: number;
  cumulativeHitInstructions: string[];
  cumulativeInstructionCount: number;
}
