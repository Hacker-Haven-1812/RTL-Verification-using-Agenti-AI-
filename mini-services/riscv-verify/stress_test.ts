
import { io } from 'socket.io-client';

interface TestScenario {
  name: string;
  config: {
    coverageGoal: number;
    maxIterations: number;
    maxCyclesPerRun: number;
    targetModules: string[];
    initialScenarios: string[];
    instructionMixHint?: string;
  };
}

interface TestResult {
  scenario: string;
  durationMs: number;
  eventsReceived: number;
  endReason: string | null;
  errors: { type: string; message: string; where: string }[];
  parseErrors: number;
  runtimeErrors: number;
  counterexamples: number;
  proofs: number;
  finalCoverage: number;
  iterationsStarted: number;
  programsGenerated: number;
  programsAssembledCleanly: number;
  emptyPrograms: number;
  agentErrors: number;
  summary: string;
}

const SCENARIOS: TestScenario[] = [

  { name: 'minimal-1iter-lowgoal', config: { coverageGoal: 0.10, maxIterations: 1, maxCyclesPerRun: 300, targetModules: ['rv32i_alu'], initialScenarios: ['ARITH_OVERFLOW'] } },

  { name: 'tiny-cycles-100', config: { coverageGoal: 0.20, maxIterations: 2, maxCyclesPerRun: 100, targetModules: ['rv32i_alu'], initialScenarios: ['BRANCH_TAKEN'] } },

  { name: 'empty-scenarios', config: { coverageGoal: 0.30, maxIterations: 2, maxCyclesPerRun: 500, targetModules: ['rv32i_alu'], initialScenarios: [] } },

  { name: 'only-regfile', config: { coverageGoal: 0.40, maxIterations: 2, maxCyclesPerRun: 800, targetModules: ['rv32i_regfile'], initialScenarios: ['MEMORY_STORE'] } },

  { name: 'both-modules', config: { coverageGoal: 0.50, maxIterations: 3, maxCyclesPerRun: 1000, targetModules: ['rv32i_alu', 'rv32i_regfile'], initialScenarios: ['ARITH_OVERFLOW', 'BRANCH_TAKEN'] } },

  { name: 'all-scenarios', config: { coverageGoal: 0.55, maxIterations: 3, maxCyclesPerRun: 1200, targetModules: ['rv32i_alu'], initialScenarios: ['ARITH_OVERFLOW','BRANCH_TAKEN','MEMORY_LOAD','BRANCH_NOT_TAKEN','MEMORY_STORE','SUB_UNDERFLOW','UPPER_IMMEDIATE','SHIFT_ARITHMETIC','JAL_JALR_PAIR','CONTROL_HAZARD','UNSIGNED_LT','EBREAK_TERMINATION','SIGNED_LT','DATA_HAZARD_RAW'] } },

  { name: 'unreachable-goal', config: { coverageGoal: 0.99, maxIterations: 3, maxCyclesPerRun: 600, targetModules: ['rv32i_alu'], initialScenarios: ['ARITH_OVERFLOW'] } },

  { name: 'high-cycles', config: { coverageGoal: 0.60, maxIterations: 2, maxCyclesPerRun: 3000, targetModules: ['rv32i_alu'], initialScenarios: ['JAL_JALR_PAIR', 'UPPER_IMMEDIATE'] } },

  { name: 'many-iterations', config: { coverageGoal: 0.70, maxIterations: 5, maxCyclesPerRun: 400, targetModules: ['rv32i_alu'], initialScenarios: ['SHIFT_ARITHMETIC'] } },

  { name: 'with-hint-shifts', config: { coverageGoal: 0.40, maxIterations: 2, maxCyclesPerRun: 800, targetModules: ['rv32i_alu'], initialScenarios: ['SHIFT_ARITHMETIC'], instructionMixHint: 'emphasize shift operations and unsigned compares' } },

  { name: 'with-hint-hazards', config: { coverageGoal: 0.40, maxIterations: 2, maxCyclesPerRun: 800, targetModules: ['rv32i_alu'], initialScenarios: ['DATA_HAZARD_RAW'], instructionMixHint: 'generate back-to-back dependent ALU ops to trigger RAW hazards' } },

  { name: 'extreme-low-goal', config: { coverageGoal: 0.05, maxIterations: 1, maxCyclesPerRun: 200, targetModules: ['rv32i_alu'], initialScenarios: ['EBREAK_TERMINATION'] } },
];

async function runScenario(scenario: TestScenario, idx: number, total: number): Promise<TestResult> {
  const result: TestResult = {
    scenario: scenario.name,
    durationMs: 0,
    eventsReceived: 0,
    endReason: null,
    errors: [],
    parseErrors: 0,
    runtimeErrors: 0,
    counterexamples: 0,
    proofs: 0,
    finalCoverage: 0,
    iterationsStarted: 0,
    programsGenerated: 0,
    programsAssembledCleanly: 0,
    emptyPrograms: 0,
    agentErrors: 0,
    summary: '',
  };

  const start = Date.now();
  const socket = io('http://localhost:3003/', {
    path: '/',
    transports: ['websocket', 'polling'],
    forceNew: true,
    timeout: 15000,
  });

  return new Promise<TestResult>((resolve) => {
    let settled = false;
    const finish = (r: TestResult) => {
      if (settled) return;
      settled = true;
      r.durationMs = Date.now() - start;
      try { socket.disconnect(); } catch {}
      resolve(r);
    };


    const HARD_TIMEOUT_MS = 180_000;
    const hardTimer = setTimeout(() => {
      result.errors.push({ type: 'timeout', message: `Hard timeout after ${HARD_TIMEOUT_MS}ms`, where: 'test-harness' });
      result.summary = 'TIMEOUT';
      finish(result);
    }, HARD_TIMEOUT_MS);

    socket.on('connect', () => {
      socket.emit('start-verification', {
        sessionId: `stress-test-${idx}-${Date.now()}`,
        ...scenario.config,
      });
    });

    socket.on('orchestrator-event', (event: any) => {
      result.eventsReceived++;
      switch (event.type) {
        case 'sim-iteration-start':
          result.iterationsStarted++;
          break;
        case 'program-generated':
          result.programsGenerated++;
          if (!event.program || event.program.trim().length === 0) result.emptyPrograms++;
          if (event.assemblerErrors && event.assemblerErrors.length === 0) result.programsAssembledCleanly++;
          break;
        case 'coverage-update':
          result.finalCoverage = event.report?.overallCoverage ?? result.finalCoverage;
          break;
        case 'formal-check-result':
          if (event.result?.status === 'proof') result.proofs++;
          else if (event.result?.status === 'counterexample') result.counterexamples++;
          else if (event.result?.status === 'parse-error') result.parseErrors++;
          else if (event.result?.status === 'runtime-error') result.runtimeErrors++;
          break;
        case 'error':
          result.errors.push({ type: 'orchestrator-error', message: event.message ?? '', where: event.where ?? '' });
          break;
        case 'agent-activity':
          if (event.phase === 'done' && event.message && event.message.toLowerCase().includes('error')) {
            result.agentErrors++;
            result.errors.push({ type: 'agent-error', message: `[${event.agent}] ${event.message}`, where: 'agent-activity' });
          }
          break;
        case 'sim-loop-end':
          result.endReason = event.reason;
          result.finalCoverage = event.finalCoverage ?? result.finalCoverage;
          break;
        case 'session-ended':
          clearTimeout(hardTimer);
          result.summary = `OK (${result.eventsReceived} events, ${result.iterationsStarted} iters, cov=${(result.finalCoverage * 100).toFixed(1)}%, proofs=${result.proofs}, cex=${result.counterexamples}, parseErr=${result.parseErrors}, rtErr=${result.runtimeErrors})`;

          setTimeout(() => finish(result), 1500);
          break;
      }
    });

    socket.on('connect_error', (e: any) => {
      result.errors.push({ type: 'connect-error', message: e.message, where: 'socket' });
      if (!settled) {
        result.summary = `CONNECT ERROR: ${e.message}`;
        clearTimeout(hardTimer);
        finish(result);
      }
    });
  });
}

async function main() {
  console.log(`\n=== Continuous Stress Test — ${SCENARIOS.length} scenarios ===\n`);
  console.log(`(Inter-scenario cooldown: 8s to avoid sustained 429 rate-limiting)\n`);
  const results: TestResult[] = [];

  for (let i = 0; i < SCENARIOS.length; i++) {
    const s = SCENARIOS[i];
    console.log(`\n[${i + 1}/${SCENARIOS.length}] ${s.name}  →  starting...`);
    const r = await runScenario(s, i, SCENARIOS.length);
    results.push(r);
    console.log(`[${i + 1}/${SCENARIOS.length}] ${s.name}  →  ${r.summary}  (${(r.durationMs / 1000).toFixed(1)}s, ${r.errors.length} errors)`);
    if (r.errors.length > 0) {
      for (const e of r.errors.slice(0, 5)) {
        console.log(`           ! [${e.type}] ${e.message.slice(0, 120)} @ ${e.where}`);
      }
    }

    if (i < SCENARIOS.length - 1) {
      console.log(`           (cooldown 8s before next scenario...)`);
      await new Promise(resolve => setTimeout(resolve, 8000));
    }
  }


  console.log('\n\n========== AGGREGATE REPORT ==========\n');
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);
  const totalParseErrors = results.reduce((s, r) => s + r.parseErrors, 0);
  const totalRuntimeErrors = results.reduce((s, r) => s + r.runtimeErrors, 0);
  const totalAgentErrors = results.reduce((s, r) => s + r.agentErrors, 0);
  const totalEmptyPrograms = results.reduce((s, r) => s + r.emptyPrograms, 0);
  const totalProgramsGenerated = results.reduce((s, r) => s + r.programsGenerated, 0);
  const totalProofs = results.reduce((s, r) => s + r.proofs, 0);
  const totalCEX = results.reduce((s, r) => s + r.counterexamples, 0);

  console.log(`Scenarios run:           ${results.length}`);
  console.log(`Total errors:            ${totalErrors}`);
  console.log(`  - orchestrator errors: ${results.reduce((s, r) => s + r.errors.filter(e => e.type === 'orchestrator-error').length, 0)}`);
  console.log(`  - agent errors:        ${totalAgentErrors}`);
  console.log(`  - timeouts:            ${results.filter(r => r.summary.startsWith('TIMEOUT')).length}`);
  console.log(`  - connect errors:      ${results.filter(r => r.summary.startsWith('CONNECT')).length}`);
  console.log(`Formal parse errors:     ${totalParseErrors}`);
  console.log(`Formal runtime errors:   ${totalRuntimeErrors}`);
  console.log(`Empty programs:          ${totalEmptyPrograms} / ${totalProgramsGenerated}`);
  console.log(`Proofs found:            ${totalProofs}`);
  console.log(`Counterexamples found:   ${totalCEX}`);

  console.log('\n--- Per-scenario breakdown ---');
  for (const r of results) {
    const status = r.errors.length === 0 && !r.summary.startsWith('TIMEOUT') && !r.summary.startsWith('CONNECT') ? '✓' : '✗';
    console.log(`  ${status} ${r.scenario.padEnd(28)} ${r.summary.slice(0, 90)}`);
  }


  const allErrorMessages = new Map<string, number>();
  for (const r of results) {
    for (const e of r.errors) {
      const key = `${e.type}: ${e.message.slice(0, 100)}`;
      allErrorMessages.set(key, (allErrorMessages.get(key) ?? 0) + 1);
    }
  }
  if (allErrorMessages.size > 0) {
    console.log('\n--- Unique error messages (count) ---');
    for (const [msg, count] of [...allErrorMessages.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  [${count}x] ${msg}`);
    }
  }

  console.log('\n========== END REPORT ==========\n');
  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(2);
});
