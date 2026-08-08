/**
 * Closed-Loop Verification Orchestrator
 * --------------------------------------
 * Drives the full simulation loop + formal verification path described in the
 * VLSID 2026 design-track architecture diagram.
 *
 *   Simulation Loop (left):
 *     1. Case Generation Agent -> assembly program
 *     2. Assembler -> machine code
 *     3. RV32I Core -> execution trace
 *     4. Coverage Analyzer -> CoverageReport
 *     5. Coverage Analysis Agent -> natural-language summary
 *     6. If overallCoverage >= goal -> END
 *        else Missing Case Suggestion Agent -> suggestions
 *     7. Feed suggestions back to step 1, repeat
 *
 *   Formal Path (right, runs in parallel):
 *     P1. Property Generation Agent -> formal properties (DSL)
 *     P2. Property parser + checker -> Proof | Counterexample per property
 *
 * Every step emits real-time events via the orchestrator's emit() callback so
 * the WebSocket server can stream them to the dashboard.
 */

import { RV32ICore, MEM_SIZE } from '../rv32i/core.js';
import { assemble } from '../rv32i/assembler.js';
import { analyzeCoverage, CoverageReport } from '../rv32i/coverage.js';
import {
  caseGenerationAgent,
  coverageAnalysisAgent,
  missingCaseAgent,
  propertyGenerationAgent,
} from '../agents/agents.js';
import { ALL_RTL_MODULES, getRtlModule } from '../rtl/modules.js';
import { parseProperty, checkProperty, FormalProperty, FormalCheckResult } from '../rtl/formal.js';

export type OrchestratorEvent =
  | { type: 'session-started'; sessionId: string; config: OrchestratorConfig }
  | { type: 'sim-iteration-start'; iteration: number; targetScenarios: string[] }
  | { type: 'agent-activity'; agent: string; phase: 'thinking' | 'done'; message: string; detail?: any }
  | { type: 'program-generated'; iteration: number; program: string; rationale: string; targets: string[]; assemblerErrors: { line: number; message: string }[]; instructionCount: number }
  | { type: 'simulation-progress'; iteration: number; cycle: number; pc: number; mnemonic: string; entry: any }
  | { type: 'simulation-complete'; iteration: number; result: any }
  | { type: 'coverage-update'; iteration: number; report: CoverageReport }
  | { type: 'coverage-analysis'; iteration: number; analysis: any }
  | { type: 'missing-case-suggestions'; iteration: number; suggestions: any[] }
  | { type: 'sim-loop-end'; reason: 'goal-met' | 'max-iterations'; finalCoverage: number }
  // Formal path events
  | { type: 'formal-start'; module: string }
  | { type: 'formal-properties-generated'; module: string; properties: { name: string; declaration: string; explanation: string }[] }
  | { type: 'formal-check-result'; module: string; result: FormalCheckResult }
  | { type: 'formal-end'; module: string; summary: { proof: number; counterexample: number; errors: number } }
  | { type: 'session-ended'; sessionId: string; summary: any }
  | { type: 'error'; message: string; where: string };

export interface OrchestratorConfig {
  sessionId: string;
  coverageGoal: number;       // 0..1, e.g. 0.85
  maxIterations: number;      // sim loop iterations
  maxCyclesPerRun: number;    // simulator cycle limit per program
  targetModules: string[];    // modules to formally verify
  initialScenarios: string[]; // optional seed scenarios for iteration 1
  instructionMixHint?: string;
}

export class Orchestrator {
  private emit: (e: OrchestratorEvent) => void;
  private aborted = false;

  constructor(emit: (e: OrchestratorEvent) => void) {
    this.emit = emit;
  }

  public abort() { this.aborted = true; }

  public async run(config: OrchestratorConfig): Promise<void> {
    this.aborted = false;
    this.emit({ type: 'session-started', sessionId: config.sessionId, config });

    // ----------------------------------------------------------------
    // IMPORTANT: Run the simulation loop and the formal path SERIALLY.
    // Running them in parallel caused the LLM API to return HTTP 429
    // (Too Many Requests) because two agents fire calls at the same time.
    // The llmChat() helper in agents.ts now serializes all calls through
    // a global mutex, but we still keep the paths sequential here so the
    // dashboard activity feed is readable.
    // ----------------------------------------------------------------

    // Run the simulation loop first (each iteration depends on the prior)
    let lastProgram: string | undefined;
    let lastReport: CoverageReport | undefined;
    let lastAnalysis: any = undefined;
    let simLoopEnded = false;

    for (let iter = 1; iter <= config.maxIterations; iter++) {
      if (this.aborted) break;

      // Decide what to target this iteration
      let targetScenarios = config.initialScenarios;
      let missingScenarios: string[] | undefined;
      if (iter === 1) {
        targetScenarios = config.initialScenarios.length > 0
          ? config.initialScenarios
          : ['ARITH_OVERFLOW', 'BRANCH_TAKEN', 'BRANCH_NOT_TAKEN', 'MEMORY_LOAD', 'MEMORY_STORE', 'DATA_HAZARD_RAW'];
      } else if (lastReport) {
        missingScenarios = lastReport.missingScenarios;
        targetScenarios = [];
      }

      this.emit({ type: 'sim-iteration-start', iteration: iter, targetScenarios });

      // ---- Step 1: Case Generation Agent (with retry) ----
      let genResult: any = null;
      const MAX_CASEGEN_RETRIES = 3;
      for (let attempt = 1; attempt <= MAX_CASEGEN_RETRIES && !this.aborted; attempt++) {
        this.emit({ type: 'agent-activity', agent: 'Test Generator', phase: 'thinking', message: `Generating test program for iteration ${iter}${attempt > 1 ? ` (attempt ${attempt}/${MAX_CASEGEN_RETRIES})` : ''}...` });
        try {
          genResult = await caseGenerationAgent({
            iteration: iter,
            targetScenarios,
            missingScenarios,
            previousProgram: lastProgram,
            instructionMixHint: config.instructionMixHint,
          });
          // Validate: non-empty program
          if (!genResult.program || genResult.program.trim().length === 0) {
            throw new Error('Case Generation Agent returned an empty program');
          }
          break; // success
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          this.emit({ type: 'agent-activity', agent: 'Test Generator', phase: 'done', message: `Attempt ${attempt} failed: ${msg.slice(0, 100)}` });
          if (attempt < MAX_CASEGEN_RETRIES) {
            // Brief delay before retry — the llmChat helper already does backoff for 429s
            // but this also covers non-429 failures.
            await new Promise(r => setTimeout(r, 1500 * attempt));
          } else {
            this.emit({ type: 'error', message: `Case Generation Agent failed after ${MAX_CASEGEN_RETRIES} attempts: ${msg}`, where: `iter-${iter}-casegen` });
            // Don't break the whole session — try the next iteration if we have any budget left
            genResult = null;
          }
        }
      }
      if (!genResult) {
        // Skip this iteration but continue the loop
        continue;
      }
      this.emit({ type: 'agent-activity', agent: 'Test Generator', phase: 'done', message: `Generated ${genResult.program.split('\n').length} lines of assembly`, detail: { targets: genResult.targets, rationale: genResult.rationale } });

      // ---- Step 2: Assemble ----
      const asm = assemble(genResult.program);
      this.emit({
        type: 'program-generated',
        iteration: iter,
        program: genResult.program,
        rationale: genResult.rationale,
        targets: genResult.targets,
        assemblerErrors: asm.errors,
        instructionCount: asm.instructionCount,
      });
      if (asm.errors.length > 0) {
        this.emit({ type: 'agent-activity', agent: 'Assembler', phase: 'done', message: `Assembly had ${asm.errors.length} errors — skipping simulation`, detail: { errors: asm.errors } });
        // Try next iteration anyway — the AI might fix it
        lastProgram = genResult.program;
        continue;
      }
      if (asm.bytes.length === 0) {
        this.emit({ type: 'error', message: 'Assembler produced empty program', where: `iter-${iter}-assemble` });
        continue;
      }

      // ---- Step 3: Simulate ----
      const mem = new Uint8Array(MEM_SIZE);
      mem.set(asm.bytes, 0);
      const core = new RV32ICore(mem, { maxCycles: config.maxCyclesPerRun, startPc: 0, trackHazards: true });

      // Stream the first N cycles for the live trace view
      const STREAM_FIRST_N = 200;
      let streamed = 0;
      let lastStreamTime = 0;
      const runResult = core.run(config.maxCyclesPerRun);
      // Note: we already ran the full sim — now emit a representative trace
      // (we don't pause mid-execution for performance, but we emit the first
      // 200 entries as if they were streamed)
      for (const e of runResult.trace.slice(0, STREAM_FIRST_N)) {
        if (this.aborted) break;
        // Throttle: only emit at most 1 event per 5ms to avoid flooding
        const now = Date.now();
        if (now - lastStreamTime > 5 || streamed < 50) {
          this.emit({ type: 'simulation-progress', iteration: iter, cycle: e.cycle, pc: e.pc, mnemonic: e.mnemonic, entry: e });
          lastStreamTime = now;
          streamed++;
        }
      }

      this.emit({ type: 'simulation-complete', iteration: iter, result: runResult });

      // ---- Step 4: Coverage Analysis ----
      const report = analyzeCoverage(runResult.trace, runResult.cycles);
      this.emit({ type: 'coverage-update', iteration: iter, report });
      lastReport = report;
      lastProgram = genResult.program;

      // ---- Step 5: Coverage Analysis Agent ----
      this.emit({ type: 'agent-activity', agent: 'Coverage Analyzer', phase: 'thinking', message: 'Summarizing coverage report...' });
      try {
        const analysis = await coverageAnalysisAgent(report);
        this.emit({ type: 'coverage-analysis', iteration: iter, analysis });
        lastAnalysis = analysis;
        this.emit({ type: 'agent-activity', agent: 'Coverage Analyzer', phase: 'done', message: analysis.summary || 'Analysis complete' });
      } catch (e: any) {
        this.emit({ type: 'agent-activity', agent: 'Coverage Analyzer', phase: 'done', message: `Error: ${e.message}` });
      }

      // ---- Step 6: Goal check ----
      if (report.overallCoverage >= config.coverageGoal) {
        this.emit({ type: 'sim-loop-end', reason: 'goal-met', finalCoverage: report.overallCoverage });
        simLoopEnded = true;
        break;
      }

      // ---- Step 7: Missing Case Suggestion Agent ----
      this.emit({ type: 'agent-activity', agent: 'Gap Analyzer', phase: 'thinking', message: 'Proposing new test scenarios...' });
      try {
        const miss = await missingCaseAgent(report, lastProgram);
        this.emit({ type: 'missing-case-suggestions', iteration: iter, suggestions: miss.suggestions });
        this.emit({ type: 'agent-activity', agent: 'Gap Analyzer', phase: 'done', message: `Proposed ${miss.suggestions.length} new scenarios`, detail: { suggestions: miss.suggestions } });
        // Feed back: the next iteration's targetScenarios come from the suggestions
        if (miss.suggestions.length > 0) {
          config.initialScenarios = miss.suggestions.map(s => s.scenario);
        }
      } catch (e: any) {
        this.emit({ type: 'agent-activity', agent: 'Gap Analyzer', phase: 'done', message: `Error: ${e.message}` });
      }

      if (iter === config.maxIterations && !simLoopEnded) {
        this.emit({ type: 'sim-loop-end', reason: 'max-iterations', finalCoverage: report.overallCoverage });
        simLoopEnded = true;
      }
    }

    if (!simLoopEnded) {
      // Loop exited early (e.g. all iterations failed). Emit a max-iterations end.
      this.emit({ type: 'sim-loop-end', reason: 'max-iterations', finalCoverage: lastReport?.overallCoverage ?? 0 });
    }

    // ----------------------------------------------------------------
    // Now run the formal verification path SERIALLY (after sim loop).
    // This avoids hitting the LLM API with two concurrent agent calls.
    // ----------------------------------------------------------------
    if (!this.aborted && config.targetModules.length > 0) {
      await this.runFormalPath(config);
    }

    this.emit({ type: 'session-ended', sessionId: config.sessionId, summary: { finalCoverage: lastReport?.overallCoverage ?? 0, iterations: config.maxIterations, lastAnalysis } });
  }

  // ----------------- Formal Verification Path -----------------
  private async runFormalPath(config: OrchestratorConfig) {
    for (const moduleName of config.targetModules) {
      if (this.aborted) break;
      const mod = getRtlModule(moduleName);
      if (!mod) {
        this.emit({ type: 'error', message: `Unknown RTL module: ${moduleName}`, where: 'formal-path' });
        continue;
      }
      this.emit({ type: 'formal-start', module: moduleName });

      // P1: Property Generation Agent (with internal retry via llmChat)
      this.emit({ type: 'agent-activity', agent: 'Property Synthesizer', phase: 'thinking', message: `Generating formal properties for ${moduleName}...` });
      let propResult;
      try {
        propResult = await propertyGenerationAgent(mod);
      } catch (e: any) {
        this.emit({ type: 'agent-activity', agent: 'Property Synthesizer', phase: 'done', message: `Error: ${e.message}` });
        // Emit an empty formal-end so the dashboard knows this module is done
        this.emit({ type: 'formal-end', module: moduleName, summary: { proof: 0, counterexample: 0, errors: 0 } });
        continue;
      }
      this.emit({ type: 'formal-properties-generated', module: moduleName, properties: propResult.properties });
      this.emit({ type: 'agent-activity', agent: 'Property Synthesizer', phase: 'done', message: `Generated ${propResult.properties.length} properties`, detail: { properties: propResult.properties } });

      // P2: Parse + check each property
      let proof = 0, counterex = 0, errors = 0;
      for (const p of propResult.properties) {
        if (this.aborted) break;
        let parsed: FormalProperty;
        try {
          parsed = parseProperty(p.declaration);
        } catch (e: any) {
          errors++;
          this.emit({
            type: 'formal-check-result',
            module: moduleName,
            result: {
              property: { name: p.name, target: moduleName, declaration: p.declaration, inputs: [], precondition: '', consequent: '', explanation: p.explanation },
              status: 'parse-error',
              trials: 0,
              error: e.message,
              durationMs: 0,
            } as FormalCheckResult,
          });
          continue;
        }
        const result = checkProperty(parsed, mod, 1000);
        this.emit({ type: 'formal-check-result', module: moduleName, result });
        if (result.status === 'proof') proof++;
        else if (result.status === 'counterexample') counterex++;
        else errors++;
      }

      this.emit({ type: 'formal-end', module: moduleName, summary: { proof, counterexample: counterex, errors } });
    }
  }
}

// Convenience: list of all targetable RTL modules (used by the dashboard)
export const TARGETABLE_MODULES = ALL_RTL_MODULES.map(m => m.name);
