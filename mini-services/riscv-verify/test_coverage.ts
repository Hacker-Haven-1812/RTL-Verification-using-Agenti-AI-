
import { io } from 'socket.io-client';

const goal = parseFloat(process.argv[2] ?? '0.80');
const maxIters = parseInt(process.argv[3] ?? '6');
const maxCycles = parseInt(process.argv[4] ?? '2000');

console.log(`\n=== TEST: goal=${(goal*100).toFixed(0)}% iters=${maxIters} cycles=${maxCycles} ===\n`);

const socket = io('http://localhost:3003/', { path: '/', transports: ['websocket', 'polling'], forceNew: true });
let coverage = 0, iters = 0, fallbacks = 0, llmSuccesses = 0;
let cumulativeHits: string[] = [];
const hist: any[] = [];

socket.on('connect', () => {
  socket.emit('start-verification', {
    sessionId: `cov-test-${Date.now()}`,
    coverageGoal: goal, maxIterations: maxIters, maxCyclesPerRun: maxCycles,
    targetModules: ['rv32i_alu'], initialScenarios: []
  });
});

socket.on('orchestrator-event', (e: any) => {
  if (e.type === 'sim-iteration-start') iters++;
  if (e.type === 'agent-activity' && e.agent === 'Test Generator') {
    if (e.message?.includes('fallback')) fallbacks++;
    if (e.message?.includes('Generated') && !e.message?.includes('fallback')) llmSuccesses++;
  }
  if (e.type === 'coverage-update') {

    const hitSet = new Set(cumulativeHits);
    for (const m of (e.report.instructionCoverage.hitMnemonicSet || [])) hitSet.add(m);
    cumulativeHits = [...hitSet];
    const perIterCov = e.report?.overallCoverage ?? 0;
    const cumulativeInstrRatio = cumulativeHits.length / (e.report.instructionCoverage.total || 39);

    coverage = Math.max(coverage, cumulativeInstrRatio * 0.5 + perIterCov * 0.5);
    const hit = e.report.instructionCoverage.hit;
    const missing = e.report.instructionCoverage.missingMnemonicSet;
    hist.push({ iter: e.iteration, perIter: perIterCov, cumHits: cumulativeHits.length });
    console.log(`  iter ${e.iteration}: per-iter ${(perIterCov*100).toFixed(1)}% (${hit}/39) | cumulative ${cumulativeHits.length}/39 instructions hit`);
  }
  if (e.type === 'sim-loop-end') {
    console.log(`\nLoop ended: ${e.reason} at ${(e.finalCoverage*100).toFixed(1)}% (cumulative)`);
    coverage = e.finalCoverage;
  }
  if (e.type === 'session-ended') {
    const achieved = coverage >= goal;
    console.log(`\n========== RESULT ==========`);
    console.log(`Goal:          ${(goal*100).toFixed(0)}%`);
    console.log(`Achieved:      ${(coverage*100).toFixed(1)}%`);
    console.log(`Iterations:    ${iters}`);
    console.log(`LLM programs:  ${llmSuccesses}`);
    console.log(`Fallback:      ${fallbacks}`);
    console.log(`Cumulative instrs hit: ${cumulativeHits.length}/39`);
    console.log(`Status:        ${achieved ? '✓ GOAL ACHIEVED' : '✗ goal not reached'}`);
    console.log(`============================\n`);
    setTimeout(() => process.exit(achieved ? 0 : 1), 500);
  }
});

setTimeout(() => {
  console.log(`\nTIMEOUT after 280s — iters=${iters} final=${(coverage*100).toFixed(1)}%`);
  process.exit(2);
}, 280000);
