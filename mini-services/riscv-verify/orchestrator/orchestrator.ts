

import { RV32ICore, MEM_SIZE } from '../rv32i/core.js';
import { assemble } from '../rv32i/assembler.js';
import { analyzeCoverage, CoverageReport } from '../rv32i/coverage.js';
import { generateFallbackProgram, generateBroadProgram } from '../rv32i/fallback-generator.js';
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

  | { type: 'formal-start'; module: string }
  | { type: 'formal-properties-generated'; module: string; properties: { name: string; declaration: string; explanation: string }[] }
  | { type: 'formal-check-result'; module: string; result: FormalCheckResult }
  | { type: 'formal-end'; module: string; summary: { proof: number; counterexample: number; errors: number } }
  | { type: 'session-ended'; sessionId: string; summary: any }
  | { type: 'error'; message: string; where: string };

export interface OrchestratorConfig {
  sessionId: string;
  coverageGoal: number;
  maxIterations: number;
  maxCyclesPerRun: number;
  targetModules: string[];
  initialScenarios: string[];
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











    let lastProgram: string | undefined;
    let lastReport: CoverageReport | undefined;
    let lastAnalysis: any = undefined;
    let simLoopEnded = false;


    const cumulativeHitInstructions = new Set<string>();
    const coverageHistory: { iteration: number; overall: number }[] = [];

    let maxBranchRatio = 0;
    let maxRegisterRatio = 0;
    let maxHazardRatio = 0;
    let maxFunctionalRatio = 0;
    let maxMemBytes = 0;

    for (let iter = 1; iter <= config.maxIterations; iter++) {
      if (this.aborted) break;


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



      const alreadyHit = [...cumulativeHitInstructions].sort();
      const allInstructions = [
        'LUI', 'AUIPC', 'JAL', 'JALR',
        'BEQ', 'BNE', 'BLT', 'BGE', 'BLTU', 'BGEU',
        'LB', 'LH', 'LW', 'LBU', 'LHU',
        'SB', 'SH', 'SW',
        'ADDI', 'SLTI', 'SLTIU', 'XORI', 'ORI', 'ANDI', 'SLLI', 'SRLI', 'SRAI',
        'ADD', 'SUB', 'SLL', 'SLT', 'SLTU', 'XOR', 'SRL', 'SRA', 'OR', 'AND',
        'ECALL', 'EBREAK',
      ];
      const missingInstructions = allInstructions.filter(m => !cumulativeHitInstructions.has(m));

      let genResult: any = null;
      let usedFallback = false;
      const MAX_CASEGEN_RETRIES = 2;
      for (let attempt = 1; attempt <= MAX_CASEGEN_RETRIES && !this.aborted; attempt++) {
        this.emit({ type: 'agent-activity', agent: 'Test Generator', phase: 'thinking', message: `Generating test program for iteration ${iter}${attempt > 1 ? ` (attempt ${attempt}/${MAX_CASEGEN_RETRIES})` : ''}...` });
        try {
          genResult = await caseGenerationAgent({
            iteration: iter,
            targetScenarios,
            missingScenarios,
            previousProgram: lastProgram,
            instructionMixHint: config.instructionMixHint,
            alreadyHitInstructions: alreadyHit,
            missingInstructions,
            coverageHistory,
          });

          if (!genResult.program || genResult.program.trim().length === 0) {
            throw new Error('Test Generator returned an empty program');
          }
          break;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          const isRateLimit = msg.includes('429') || msg.toLowerCase().includes('too many requests');
          this.emit({ type: 'agent-activity', agent: 'Test Generator', phase: 'done', message: `Attempt ${attempt} failed: ${msg.slice(0, 80)}` });

          if (isRateLimit) {
            this.emit({ type: 'agent-activity', agent: 'Test Generator', phase: 'done', message: `LLM rate-limited — switching to deterministic fallback` });
            break;
          }
          if (attempt < MAX_CASEGEN_RETRIES) {
            await new Promise(r => setTimeout(r, 1500 * attempt));
          }
        }
      }


      if (!genResult) {
        console.log(`[orchestrator] iter ${iter}: using deterministic fallback (missing=${missingInstructions.length})`);
        this.emit({ type: 'agent-activity', agent: 'Test Generator', phase: 'done', message: `Using deterministic fallback targeting ${missingInstructions.length} missing instructions` });
        const fallbackProgram = (iter === 1 && missingInstructions.length === 0)
          ? generateBroadProgram()
          : generateFallbackProgram(missingInstructions, iter);
        genResult = {
          program: fallbackProgram,
          rationale: `Deterministic fallback program targeting ${missingInstructions.length} missing instructions`,
          targets: missingInstructions.slice(0, 10),
        };
        usedFallback = true;
      }
      this.emit({ type: 'agent-activity', agent: 'Test Generator', phase: 'done', message: `Generated ${genResult.program.split('\n').length} lines of assembly${usedFallback ? ' (fallback)' : ''}`, detail: { targets: genResult.targets, rationale: genResult.rationale, fallback: usedFallback } });


      const asm = assemble(genResult.program);
      console.log(`[orchestrator] iter ${iter}: assembled ${asm.instructionCount} instrs, ${asm.errors.length} errors, ${asm.bytes.length} bytes`);
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

        lastProgram = genResult.program;
        continue;
      }
      if (asm.bytes.length === 0) {
        this.emit({ type: 'error', message: 'Assembler produced empty program', where: `iter-${iter}-assemble` });
        continue;
      }


      const mem = new Uint8Array(MEM_SIZE);
      mem.set(asm.bytes, 0);
      const core = new RV32ICore(mem, { maxCycles: config.maxCyclesPerRun, startPc: 0, trackHazards: true });


      const STREAM_FIRST_N = 200;
      let streamed = 0;
      let lastStreamTime = 0;
      const runResult = core.run(config.maxCyclesPerRun);



      for (const e of runResult.trace.slice(0, STREAM_FIRST_N)) {
        if (this.aborted) break;

        const now = Date.now();
        if (now - lastStreamTime > 5 || streamed < 50) {
          this.emit({ type: 'simulation-progress', iteration: iter, cycle: e.cycle, pc: e.pc, mnemonic: e.mnemonic, entry: e });
          lastStreamTime = now;
          streamed++;
        }
      }

      this.emit({ type: 'simulation-complete', iteration: iter, result: runResult });


      const report = analyzeCoverage(runResult.trace, runResult.cycles);
      this.emit({ type: 'coverage-update', iteration: iter, report });
      lastReport = report;
      lastProgram = genResult.program;


      for (const m of report.instructionCoverage.hitMnemonicSet) {
        cumulativeHitInstructions.add(m);
      }

      maxBranchRatio = Math.max(maxBranchRatio, report.branchCoverage.ratio);
      maxRegisterRatio = Math.max(maxRegisterRatio, report.registerCoverage.ratio);
      maxHazardRatio = Math.max(maxHazardRatio, report.hazardCoverage.ratio);
      maxFunctionalRatio = Math.max(maxFunctionalRatio, report.functionalCoverage.ratio);
      maxMemBytes = Math.max(maxMemBytes, report.memoryCoverage.bytesTouched);


      const cumulativeInstrRatio = cumulativeHitInstructions.size / report.instructionCoverage.total;
      const cumulativeOverall =
        cumulativeInstrRatio * 0.30 +
        maxBranchRatio * 0.20 +
        maxRegisterRatio * 0.10 +
        maxHazardRatio * 0.10 +
        Math.min(1, maxMemBytes / 256) * 0.10 +
        maxFunctionalRatio * 0.20;
      coverageHistory.push({ iteration: iter, overall: cumulativeOverall });


      this.emit({ type: 'agent-activity', agent: 'Coverage Analyzer', phase: 'thinking', message: 'Summarizing coverage report...' });
      try {
        const analysis = await coverageAnalysisAgent(report);
        this.emit({ type: 'coverage-analysis', iteration: iter, analysis });
        lastAnalysis = analysis;
        this.emit({ type: 'agent-activity', agent: 'Coverage Analyzer', phase: 'done', message: analysis.summary || 'Analysis complete' });
      } catch (e: any) {
        this.emit({ type: 'agent-activity', agent: 'Coverage Analyzer', phase: 'done', message: `Skipped (LLM unavailable) — using deterministic report` });
      }


      if (cumulativeOverall >= config.coverageGoal) {
        this.emit({ type: 'sim-loop-end', reason: 'goal-met', finalCoverage: cumulativeOverall });
        simLoopEnded = true;
        break;
      }


      this.emit({ type: 'agent-activity', agent: 'Gap Analyzer', phase: 'thinking', message: 'Proposing new test scenarios...' });
      try {
        const miss = await missingCaseAgent(report, lastProgram);
        this.emit({ type: 'missing-case-suggestions', iteration: iter, suggestions: miss.suggestions });
        this.emit({ type: 'agent-activity', agent: 'Gap Analyzer', phase: 'done', message: `Proposed ${miss.suggestions.length} new scenarios`, detail: { suggestions: miss.suggestions } });
        if (miss.suggestions.length > 0) {
          config.initialScenarios = miss.suggestions.map(s => s.scenario);
        }
      } catch (e: any) {
        this.emit({ type: 'agent-activity', agent: 'Gap Analyzer', phase: 'done', message: `Skipped (LLM unavailable) — fallback targets ${allInstructions.length - cumulativeHitInstructions.size} missing instructions` });
      }

      if (iter === config.maxIterations && !simLoopEnded) {
        this.emit({ type: 'sim-loop-end', reason: 'max-iterations', finalCoverage: cumulativeOverall });
        simLoopEnded = true;
      }
    }

    if (!simLoopEnded) {

      this.emit({ type: 'sim-loop-end', reason: 'max-iterations', finalCoverage: lastReport?.overallCoverage ?? 0 });
    }





    if (!this.aborted && config.targetModules.length > 0) {
      await this.runFormalPath(config);
    }

    this.emit({ type: 'session-ended', sessionId: config.sessionId, summary: { finalCoverage: lastReport?.overallCoverage ?? 0, iterations: config.maxIterations, lastAnalysis } });
  }


  private async runFormalPath(config: OrchestratorConfig) {
    for (const moduleName of config.targetModules) {
      if (this.aborted) break;
      const mod = getRtlModule(moduleName);
      if (!mod) {
        this.emit({ type: 'error', message: `Unknown RTL module: ${moduleName}`, where: 'formal-path' });
        continue;
      }
      this.emit({ type: 'formal-start', module: moduleName });


      this.emit({ type: 'agent-activity', agent: 'Property Synthesizer', phase: 'thinking', message: `Generating formal properties for ${moduleName}...` });
      let propResult;
      try {
        propResult = await propertyGenerationAgent(mod);
      } catch (e: any) {
        this.emit({ type: 'agent-activity', agent: 'Property Synthesizer', phase: 'done', message: `Error: ${e.message}` });

        this.emit({ type: 'formal-end', module: moduleName, summary: { proof: 0, counterexample: 0, errors: 0 } });
        continue;
      }
      this.emit({ type: 'formal-properties-generated', module: moduleName, properties: propResult.properties });
      this.emit({ type: 'agent-activity', agent: 'Property Synthesizer', phase: 'done', message: `Generated ${propResult.properties.length} properties`, detail: { properties: propResult.properties } });


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


export const TARGETABLE_MODULES = ALL_RTL_MODULES.map(m => m.name);
