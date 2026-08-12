
import { io } from 'socket.io-client';

interface TestScenario {
  name: string;
  config: any;
}

const SCENARIOS: TestScenario[] = [
  { name: 'minimal', config: { coverageGoal: 0.15, maxIterations: 1, maxCyclesPerRun: 400, targetModules: ['rv32i_alu'], initialScenarios: ['ARITH_OVERFLOW'] } },
  { name: 'two-iters', config: { coverageGoal: 0.35, maxIterations: 2, maxCyclesPerRun: 600, targetModules: ['rv32i_alu'], initialScenarios: ['BRANCH_TAKEN', 'MEMORY_LOAD'] } },
  { name: 'both-modules', config: { coverageGoal: 0.30, maxIterations: 2, maxCyclesPerRun: 800, targetModules: ['rv32i_alu', 'rv32i_regfile'], initialScenarios: ['ARITH_OVERFLOW'] } },
  { name: 'empty-seeds', config: { coverageGoal: 0.25, maxIterations: 2, maxCyclesPerRun: 500, targetModules: ['rv32i_alu'], initialScenarios: [] } },
  { name: 'high-goal', config: { coverageGoal: 0.95, maxIterations: 2, maxCyclesPerRun: 500, targetModules: ['rv32i_alu'], initialScenarios: ['SHIFT_ARITHMETIC'] } },
];

interface Result {
  name: string;
  ok: boolean;
  events: number;
  errors: number;
  parseErrors: number;
  proofs: number;
  cex: number;
  coverage: number;
  duration: number;
  summary: string;
}

async function runScenario(s: TestScenario): Promise<Result> {
  const start = Date.now();
  const r: Result = { name: s.name, ok: false, events: 0, errors: 0, parseErrors: 0, proofs: 0, cex: 0, coverage: 0, duration: 0, summary: '' };

  return new Promise<Result>((resolve) => {
    const socket = io('http://localhost:3003/', { path: '/', transports: ['websocket', 'polling'], forceNew: true, timeout: 15000 });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      r.duration = Date.now() - start;
      try { socket.disconnect(); } catch {}
      resolve(r);
    };

    const timer = setTimeout(() => {
      r.summary = 'TIMEOUT';
      finish();
    }, 180000);

    socket.on('connect', () => {
      socket.emit('start-verification', { sessionId: `f-${s.name}-${Date.now()}`, ...s.config });
    });

    socket.on('orchestrator-event', (e: any) => {
      r.events++;
      if (e.type === 'formal-check-result') {
        if (e.result?.status === 'proof') r.proofs++;
        else if (e.result?.status === 'counterexample') r.cex++;
        else if (e.result?.status === 'parse-error') r.parseErrors++;
      } else if (e.type === 'error') {
        r.errors++;
      } else if (e.type === 'coverage-update') {
        r.coverage = e.report?.overallCoverage ?? r.coverage;
      } else if (e.type === 'session-ended') {
        clearTimeout(timer);
        r.ok = r.errors === 0;
        r.summary = `cov=${(r.coverage * 100).toFixed(1)}% proofs=${r.proofs} cex=${r.cex} parseErr=${r.parseErrors} errs=${r.errors}`;
        setTimeout(finish, 1000);
      }
    });

    socket.on('connect_error', () => {
      r.summary = 'CONNECT ERROR';
      clearTimeout(timer);
      finish();
    });
  });
}

async function main() {
  console.log(`\n=== Focused Stress Test — ${SCENARIOS.length} scenarios ===\n`);
  const results: Result[] = [];

  for (let i = 0; i < SCENARIOS.length; i++) {
    const s = SCENARIOS[i];
    process.stdout.write(`[${i + 1}/${SCENARIOS.length}] ${s.name}...`);
    const r = await runScenario(s);
    results.push(r);
    console.log(` ${r.summary} (${(r.duration / 1000).toFixed(1)}s)`);
    if (i < SCENARIOS.length - 1) await new Promise(res => setTimeout(res, 10000));
  }

  console.log('\n=== SUMMARY ===');
  const allOk = results.every(r => r.ok);
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(15)} ${r.summary}`);
  }
  console.log(`\nOverall: ${allOk ? 'ALL PASS' : 'FAILURES DETECTED'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch(e => { console.error('Fatal:', e); process.exit(2); });
