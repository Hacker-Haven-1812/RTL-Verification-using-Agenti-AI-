

import { RV32ICore, MEM_SIZE } from '../rv32i/core.js';
import { assemble } from '../rv32i/assembler.js';
import { analyzeCoverage, CoverageReport } from '../rv32i/coverage.js';
import { generateFallbackProgram, generateBroadProgram } from '../rv32i/fallback-generator.js';
import {
  caseGenerationAgent,
  coverageAnalysisAgent,
  missingCaseAgent,
  propertyGenerationAgent,
  isGeneratorAvailable,
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

      const generatorAvailable = isGeneratorAvailable();

      if (generatorAvailable) {
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
            const isRateLimit = msg.includes('429') || msg.toLowerCase().includes('too many requests') || msg.toLowerCase().includes('config');
            this.emit({ type: 'agent-activity', agent: 'Test Generator', phase: 'done', message: `Attempt ${attempt} failed: ${msg.slice(0, 80)}` });
            if (isRateLimit) {
              this.emit({ type: 'agent-activity', agent: 'Test Generator', phase: 'done', message: `Generator unavailable — switching to deterministic fallback` });
              break;
            }
            if (attempt < MAX_CASEGEN_RETRIES) {
              await new Promise(r => setTimeout(r, 1500 * attempt));
            }
          }
        }
      } else {
        this.emit({ type: 'agent-activity', agent: 'Test Generator', phase: 'thinking', message: `Generating test program for iteration ${iter}...` });
        this.emit({ type: 'agent-activity', agent: 'Test Generator', phase: 'done', message: `Using deterministic generator` });
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


      const detSummary = `Coverage at ${(cumulativeOverall * 100).toFixed(1)}%. Instructions: ${cumulativeHitInstructions.size}/${report.instructionCoverage.total} hit. Branches: ${report.branchCoverage.bothObserved}/${report.branchCoverage.totalBranchOps} both-ways. Registers: ${report.registerCoverage.written.length}/31 written. Functional: ${report.functionalCoverage.hitCount}/${report.functionalCoverage.total} scenarios.` +
        (cumulativeHitInstructions.size < report.instructionCoverage.total ? ` Missing: ${allInstructions.filter(m => !cumulativeHitInstructions.has(m)).slice(0, 8).join(', ')}.` : ' All instructions exercised.');
      const detAnalysis = {
        summary: detSummary,
        strongAreas: report.instructionCoverage.ratio > 0.5 ? ['Instruction coverage'] : [],
        weakAreas: report.branchCoverage.ratio < 0.5 ? ['Branch coverage'] : [],
        prioritizedRecommendations: cumulativeHitInstructions.size < report.instructionCoverage.total
          ? [`Exercise: ${allInstructions.filter(m => !cumulativeHitInstructions.has(m)).slice(0, 3).join(', ')}`]
          : ['Focus on branch variety and functional scenarios'],
      };
      this.emit({ type: 'agent-activity', agent: 'Coverage Analyzer', phase: 'thinking', message: 'Analyzing coverage report...' });
      try {
        const analysis = await coverageAnalysisAgent(report);
        this.emit({ type: 'coverage-analysis', iteration: iter, analysis });
        lastAnalysis = analysis;
        this.emit({ type: 'agent-activity', agent: 'Coverage Analyzer', phase: 'done', message: analysis.summary || 'Analysis complete' });
      } catch (e: any) {
        this.emit({ type: 'coverage-analysis', iteration: iter, analysis: detAnalysis });
        lastAnalysis = detAnalysis;
        this.emit({ type: 'agent-activity', agent: 'Coverage Analyzer', phase: 'done', message: detSummary.slice(0, 80) });
      }


      if (cumulativeOverall >= config.coverageGoal) {
        this.emit({ type: 'sim-loop-end', reason: 'goal-met', finalCoverage: cumulativeOverall });
        simLoopEnded = true;
        break;
      }


      const detSuggestions = allInstructions
        .filter(m => !cumulativeHitInstructions.has(m))
        .slice(0, 5)
        .map((instr) => ({
          scenario: `Exercise ${instr}`,
          rationale: `${instr} has not been executed yet`,
          suggestedInstructions: [instr],
        }));
      this.emit({ type: 'agent-activity', agent: 'Gap Analyzer', phase: 'thinking', message: 'Identifying coverage gaps...' });
      try {
        const miss = await missingCaseAgent(report, lastProgram);
        this.emit({ type: 'missing-case-suggestions', iteration: iter, suggestions: miss.suggestions });
        this.emit({ type: 'agent-activity', agent: 'Gap Analyzer', phase: 'done', message: `Proposed ${miss.suggestions.length} new scenarios` });
        if (miss.suggestions.length > 0) {
          config.initialScenarios = miss.suggestions.map(s => s.scenario);
        }
      } catch (e: any) {
        this.emit({ type: 'missing-case-suggestions', iteration: iter, suggestions: detSuggestions });
        this.emit({ type: 'agent-activity', agent: 'Gap Analyzer', phase: 'done', message: `Identified ${detSuggestions.length} missing instructions to target` });
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
        const detProps = getDeterministicProperties(moduleName);
        propResult = { properties: detProps };
        this.emit({ type: 'agent-activity', agent: 'Property Synthesizer', phase: 'done', message: `Using ${detProps.length} deterministic properties` });
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

function getDeterministicProperties(moduleName: string): { name: string; declaration: string; explanation: string }[] {
  if (moduleName === 'rv32i_alu') {
    return [
      { name: 'add_result', declaration: 'PROPERTY add_result:\n  TARGET rv32i_alu\n  FOR ALL operand_a:uint32, operand_b:uint32, alu_ctrl:uint4\n  IMPLIES alu_ctrl == 0 => alu_result == ((operand_a + operand_b) & 0xffffffff)', explanation: 'ALU ADD must produce sum.' },
      { name: 'sub_result', declaration: 'PROPERTY sub_result:\n  TARGET rv32i_alu\n  FOR ALL operand_a:uint32, operand_b:uint32, alu_ctrl:uint4\n  IMPLIES alu_ctrl == 1 => alu_result == ((operand_a - operand_b) & 0xffffffff)', explanation: 'ALU SUB must produce difference.' },
      { name: 'and_result', declaration: 'PROPERTY and_result:\n  TARGET rv32i_alu\n  FOR ALL operand_a:uint32, operand_b:uint32, alu_ctrl:uint4\n  IMPLIES alu_ctrl == 9 => alu_result == (operand_a & operand_b)', explanation: 'ALU AND must produce bitwise AND.' },
      { name: 'or_result', declaration: 'PROPERTY or_result:\n  TARGET rv32i_alu\n  FOR ALL operand_a:uint32, operand_b:uint32, alu_ctrl:uint4\n  IMPLIES alu_ctrl == 8 => alu_result == (operand_a | operand_b)', explanation: 'ALU OR must produce bitwise OR.' },
      { name: 'xor_self_zero', declaration: 'PROPERTY xor_self_zero:\n  TARGET rv32i_alu\n  FOR ALL operand_a:uint32, alu_ctrl:uint4\n  IMPLIES alu_ctrl == 5 && operand_b == operand_a => alu_result == 0', explanation: 'XOR with self must be zero.' },
    ];
  }
  if (moduleName === 'rv32i_regfile') {
    return [
      { name: 'read_zero_reg', declaration: 'PROPERTY read_zero_reg:\n  TARGET rv32i_regfile\n  FOR ALL raddr1:uint5, raddr2:uint5, we:uint1, waddr:uint5, wdata:uint32\n  IMPLIES raddr1 == 0 => rdata1 == 0', explanation: 'Reading x0 must return zero.' },
      { name: 'read_zero_reg2', declaration: 'PROPERTY read_zero_reg2:\n  TARGET rv32i_regfile\n  FOR ALL raddr1:uint5, raddr2:uint5, we:uint1, waddr:uint5, wdata:uint32\n  IMPLIES raddr2 == 0 => rdata2 == 0', explanation: 'Reading x0 on port 2 must return zero.' },
      { name: 'read_consistency', declaration: 'PROPERTY read_consistency:\n  TARGET rv32i_regfile\n  FOR ALL raddr1:uint5, raddr2:uint5\n  IMPLIES raddr1 == raddr2 => rdata1 == rdata2', explanation: 'Same address on both ports must return same value.' },
    ];
  }
  return [];
}
