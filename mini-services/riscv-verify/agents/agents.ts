/**
 * REAL AI Agents — powered by z-ai-web-dev-sdk
 * ---------------------------------------------
 * Four specialized agents as described in the VLSID 2026 design track:
 *
 *   1. Case Generation Agent
 *      - Input: a request describing which scenarios to target (or the
 *        coverage-gap list from agent #3)
 *      - Output: a RISC-V RV32I assembly program (text)
 *
 *   2. Coverage Analysis Agent
 *      - Input: a CoverageReport (computed by the deterministic analyzer)
 *      - Output: a natural-language summary of what's covered and what's
 *        weak, with prioritized recommendations
 *
 *   3. Missing Case Suggestion Agent
 *      - Input: the coverage report + the previous test program
 *      - Output: a structured list of suggested new test cases (with
 *        rationale), fed back to agent #1
 *
 *   4. Property Generation Agent
 *      - Input: a target RTL module (Verilog source) + a natural-language
 *        spec hint
 *      - Output: formal properties in our small DSL (parseable by
 *        rtl/formal.ts)
 *
 * Every agent prompt is constructed from real data (coverage report, RTL
 * source, missing-scenario list). Nothing about the *tests* or *properties*
 * is hard-coded — the agents generate them at runtime via the LLM.
 */

import ZAI from 'z-ai-web-dev-sdk';
import type { CoverageReport } from '../rv32i/coverage.js';
import type { RtlModule } from '../rtl/modules.js';

let _zai: any = null;
async function getZai() {
  if (!_zai) _zai = await ZAI.create();
  return _zai;
}

// ----------------- Retry + Rate-Limit Helpers -----------------
//
// The z-ai LLM endpoint enforces rate limits. When we fire many agent calls in
// rapid succession (especially in parallel — Case Gen + Property Gen), we get
// HTTP 429 "Too many requests". These helpers fix that:
//
//   - `llmChat()` wraps every LLM call with exponential backoff retry.
//   - A global mutex serializes all LLM calls so we never fire two at once.
//   - A minimum inter-call delay spaces out successive calls.

const MIN_CALL_INTERVAL_MS = 2500;       // ≥2.5s between LLM calls (avoids 429)
const MAX_RETRIES = 6;
const BASE_BACKOFF_MS = 3000;             // start at 3s, double each retry
const MAX_BACKOFF_MS = 60_000;            // cap at 60s

let _lastCallTime = 0;
let _llmMutex: Promise<any> = Promise.resolve();

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function llmChat(messages: { role: string; content: string }[], opts: { temperature?: number; max_tokens?: number } = {}) {
  // Serialize all LLM calls through a single mutex — prevents parallel 429s
  let release: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const prev = _llmMutex;
  _llmMutex = wait;
  await prev;

  try {
    // Enforce minimum inter-call interval
    const now = Date.now();
    const elapsed = now - _lastCallTime;
    if (elapsed < MIN_CALL_INTERVAL_MS) {
      await sleep(MIN_CALL_INTERVAL_MS - elapsed);
    }
    _lastCallTime = Date.now();

    const zai = await getZai();
    let lastError: any = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const resp = await zai.chat.completions.create({
          messages,
          temperature: opts.temperature ?? 0.5,
          max_tokens: opts.max_tokens ?? 1200,
        });
        return resp.choices[0]?.message?.content ?? '';
      } catch (e: any) {
        lastError = e;
        const msg = (e?.message ?? '').toLowerCase();
        const is429 = msg.includes('429') || msg.includes('too many requests') || msg.includes('rate');
        const is5xx = msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504') || msg.includes('server error');
        if (is429 || is5xx) {
          // Backoff: 3s, 6s, 12s, 24s, 48s, 60s (capped) + jitter
          const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, attempt)) + Math.random() * 1000;
          console.error(`[agents] LLM call failed (attempt ${attempt + 1}/${MAX_RETRIES}): ${msg.slice(0, 100)} — retrying in ${(backoff / 1000).toFixed(1)}s`);
          await sleep(backoff);
          // Reset lastCallTime so the next attempt also respects the interval
          _lastCallTime = Date.now();
          continue;
        }
        // Non-retryable error — throw immediately
        throw e;
      }
    }
    throw lastError ?? new Error('LLM call exhausted retries');
  } finally {
    release!();
  }
}

// ----------------- Agent 1: Case Generation -----------------
export interface CaseGenRequest {
  targetScenarios?: string[];      // human-readable scenario names to hit
  missingScenarios?: string[];     // from coverage analyzer
  previousProgram?: string;        // last program we tried
  iteration: number;
  instructionMixHint?: string;     // free-form hint
}

export interface CaseGenResult {
  program: string;
  rationale: string;
  targetScenarios: string[];
}

const CASE_GEN_SYSTEM = `You are the Case Generation Agent of an autonomous RISC-V RTL verification framework.

Your job: write a small, self-contained RISC-V RV32I assembly test program that exercises the specific scenarios requested.

STRICT REQUIREMENTS:
1. Use ONLY the RV32I base integer instruction set. No M/F/D/A extensions.
   Allowed mnemonics:
     LUI AUIPC JAL JALR
     BEQ BNE BLT BGE BLTU BGEU
     LB LH LW LBU LHU SB SH SW
     ADDI SLTI SLTIU XORI ORI ANDI SLLI SRLI SRAI
     ADD SUB SLL SLT SLTU XOR SRL SRA OR AND
     ECALL EBREAK
   Pseudo-instructions allowed: li, mv, nop, j, jr, ret, beqz, bnez, bltz, bgez,
   neg, not, seqz, snez, b
2. The program MUST terminate with an EBREAK instruction.
3. Keep it under 60 instructions. Programs are loaded at address 0; PC starts at 0.
4. Use labels for branches and jumps (the assembler resolves them).
5. Comments start with #.
6. Registers x0..x31 are available. x0 is hardwired to 0. Use the stack (sp=x2)
   only if needed — there is no ABI setup, all registers start at 0.
7. Memory below 0x1000 is reserved for the program; use addresses >= 0x1000 for
   loads/stores.
8. Target the SPECIFIC scenarios listed in the request — do not just write a
   generic test. Each instruction should serve a coverage purpose.

Respond in EXACTLY this format (no markdown fences, no extra prose):
---PROGRAM---
<assembly code>
---RATIONALE---
<2-3 sentences explaining what scenarios this program targets and why>
---TARGETS---
<comma-separated list of scenario names this program exercises>`;

export async function caseGenerationAgent(req: CaseGenRequest): Promise<CaseGenResult> {
  const lines: string[] = [];
  lines.push(`ITERATION: ${req.iteration}`);
  if (req.targetScenarios && req.targetScenarios.length > 0) {
    lines.push(`TARGET SCENARIOS (must exercise these):`);
    for (const s of req.targetScenarios) lines.push(`  - ${s}`);
  }
  if (req.missingScenarios && req.missingScenarios.length > 0) {
    lines.push(`COVERAGE GAPS TO CLOSE (from previous iteration):`);
    for (const s of req.missingScenarios.slice(0, 15)) lines.push(`  - ${s}`);
  }
  if (req.previousProgram) {
    lines.push(`PREVIOUS PROGRAM (avoid simply duplicating — extend or complement it):`);
    lines.push('```');
    lines.push(req.previousProgram.slice(0, 3000));
    lines.push('```');
  }
  if (req.instructionMixHint) {
    lines.push(`HINT: ${req.instructionMixHint}`);
  }

  const text = await llmChat(
    [
      { role: 'system', content: CASE_GEN_SYSTEM },
      { role: 'user', content: lines.join('\n') },
    ],
    { temperature: 0.7, max_tokens: 1500 }
  );
  return parseCaseGenResponse(text);
}

function parseCaseGenResponse(text: string): CaseGenResult {
  // Try to extract the ---PROGRAM--- / ---RATIONALE--- / ---TARGETS--- blocks
  const progMatch = text.match(/---\s*PROGRAM\s*---\s*([\s\S]*?)(?=---\s*RATIONALE\s*---|$)/);
  const ratMatch = text.match(/---\s*RATIONALE\s*---\s*([\s\S]*?)(?=---\s*TARGETS\s*---|$)/);
  const tgtMatch = text.match(/---\s*TARGETS\s*---\s*([\s\S]*?)$/);

  let program = progMatch ? progMatch[1].trim() : '';
  if (!program) {
    // Fallback: strip markdown fences and treat the whole text as program
    program = text.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
    // Cut at any trailing prose-looking section
    const cut = program.search(/\n(About this program|Explanation:|Notes:)/i);
    if (cut > 0) program = program.slice(0, cut).trim();
  }
  // Strip markdown fences if present
  program = program.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();

  const rationale = ratMatch ? ratMatch[1].trim() : '';
  const targets = tgtMatch
    ? tgtMatch[1].split(',').map(s => s.trim()).filter(s => s.length > 0)
    : [];

  return { program, rationale, targets };
}

// ----------------- Agent 2: Coverage Analysis -----------------
export interface CoverageAnalysisResult {
  summary: string;
  strongAreas: string[];
  weakAreas: string[];
  prioritizedRecommendations: string[];
}

const COV_SYS = `You are the Coverage Analysis Agent of an autonomous RISC-V RTL verification framework.

You receive a structured coverage report computed from the actual simulation
trace. Your job: produce a concise, actionable analysis in plain English.

Output format (no markdown, no preamble):
SUMMARY: <one sentence summary>
STRONG: <comma-separated areas with > 70% coverage>
WEAK: <comma-separated areas with < 50% coverage, in priority order>
RECS:
1. <recommendation>
2. <recommendation>
3. <recommendation>
4. <recommendation>
5. <recommendation>

Be specific. Reference actual numbers from the report. Prioritize recommendations
by expected coverage impact.`;

export async function coverageAnalysisAgent(report: CoverageReport): Promise<CoverageAnalysisResult> {
  const input = `COVERAGE REPORT
===============
Overall coverage: ${(report.overallCoverage * 100).toFixed(1)}%

Instruction coverage: ${report.instructionCoverage.hit}/${report.instructionCoverage.total} = ${(report.instructionCoverage.ratio * 100).toFixed(1)}%
  Hit: ${report.instructionCoverage.hitMnemonicSet.join(', ')}
  Missing: ${report.instructionCoverage.missingMnemonicSet.join(', ') || '(none)'}

Branch coverage: ${report.branchCoverage.bothObserved}/${report.branchCoverage.totalBranchOps} branches observed both taken & not-taken = ${(report.branchCoverage.ratio * 100).toFixed(1)}%
  Taken-only: ${report.branchCoverage.takenObserved}, Not-taken-only: ${report.branchCoverage.notTakenObserved}

Register coverage: ${report.registerCoverage.written.length}/31 = ${(report.registerCoverage.ratio * 100).toFixed(1)}%
  Never written: ${report.registerCoverage.notWritten.map(r => 'x' + r).join(', ') || '(none)'}

Hazard coverage: RAW=${report.hazardCoverage.rawCount} CONTROL=${report.hazardCoverage.controlCount} (${(report.hazardCoverage.ratio * 100).toFixed(1)}%)

Memory coverage: ${report.memoryCoverage.bytesTouched} bytes touched out of ${report.memoryCoverage.totalBytes} (${(report.memoryCoverage.ratio * 100).toFixed(2)}%)
  Read: ${report.memoryCoverage.readBytes} bytes, Written: ${report.memoryCoverage.writtenBytes} bytes

Functional coverage: ${report.functionalCoverage.hitCount}/${report.functionalCoverage.total} = ${(report.functionalCoverage.ratio * 100).toFixed(1)}%
${report.functionalCoverage.scenarios.map(s => `  [${s.hit ? 'X' : ' '}] ${s.name} — ${s.description}`).join('\n')}

Total cycles: ${report.totalCycles}
Total instructions: ${report.totalInstructions}`;

  const text = await llmChat(
    [
      { role: 'system', content: COV_SYS },
      { role: 'user', content: input },
    ],
    { temperature: 0.3, max_tokens: 800 }
  );
  return parseCoverageResponse(text);
}

function parseCoverageResponse(text: string): CoverageAnalysisResult {
  const summary = (text.match(/SUMMARY:\s*(.+)/i)?.[1] ?? '').trim();
  const strong = (text.match(/STRONG:\s*(.+)/i)?.[1] ?? '')
    .split(',').map(s => s.trim()).filter(s => s.length > 0 && !s.toLowerCase().startsWith('none'));
  const weak = (text.match(/WEAK:\s*(.+)/i)?.[1] ?? '')
    .split(',').map(s => s.trim()).filter(s => s.length > 0 && !s.toLowerCase().startsWith('none'));
  const recsBlock = text.split(/RECS:\s*/i)[1] ?? '';
  const recs = recsBlock
    .split(/\n\d+\.\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return { summary, strongAreas: strong, weakAreas: weak, prioritizedRecommendations: recs };
}

// ----------------- Agent 3: Missing Case Suggestion -----------------
export interface MissingCaseResult {
  suggestions: { scenario: string; rationale: string; suggestedInstructions: string[] }[];
}

const MISS_SYS = `You are the Missing Case Suggestion Agent of an autonomous RISC-V RTL verification framework.

Given the current coverage report and the last test program, propose 3-5 NEW
high-value test scenarios that would close the largest coverage gaps. Do NOT
write assembly — that is the Case Generation Agent's job. Just propose the
scenarios with rationale.

Output format (no markdown):
SCENARIO: <short name>
RATIONALE: <why this closes a gap>
INSTRUCTIONS: <comma-separated RV32I mnemonics to focus on>

(repeat for each suggestion, separated by a blank line)`;

export async function missingCaseAgent(
  report: CoverageReport,
  previousProgram: string | undefined
): Promise<MissingCaseResult> {
  const input = `CURRENT COVERAGE GAPS:
${report.missingScenarios.slice(0, 20).map(s => '  - ' + s).join('\n')}

FUNCTIONAL SCENARIOS NOT YET HIT:
${report.functionalCoverage.scenarios.filter(s => !s.hit).map(s => `  - ${s.name}: ${s.description}`).join('\n') || '  (all hit)'}

INSTRUCTION COVERAGE: ${(report.instructionCoverage.ratio * 100).toFixed(1)}%
MISSING INSTRUCTIONS: ${report.instructionCoverage.missingMnemonicSet.join(', ') || '(none)'}

${previousProgram ? `LAST TEST PROGRAM (avoid duplicating its scenarios):\n\`\`\`\n${previousProgram.slice(0, 1500)}\n\`\`\`` : 'No previous program.'}`;

  const text = await llmChat(
    [
      { role: 'system', content: MISS_SYS },
      { role: 'user', content: input },
    ],
    { temperature: 0.5, max_tokens: 900 }
  );
  return parseMissingCaseResponse(text);
}

function parseMissingCaseResponse(text: string): MissingCaseResult {
  const blocks = text.split(/\n\s*\n/).filter(b => b.trim().startsWith('SCENARIO:'));
  const suggestions = blocks.map(b => {
    const scenario = (b.match(/SCENARIO:\s*(.+)/i)?.[1] ?? '').trim();
    const rationale = (b.match(/RATIONALE:\s*(.+)/i)?.[1] ?? '').trim();
    const instrs = (b.match(/INSTRUCTIONS:\s*(.+)/i)?.[1] ?? '')
      .split(',').map(s => s.trim()).filter(s => s.length > 0);
    return { scenario, rationale, suggestedInstructions: instrs };
  }).filter(s => s.scenario.length > 0);
  return { suggestions };
}

// ----------------- Agent 4: Property Generation -----------------
export interface PropertyGenResult {
  properties: { name: string; declaration: string; explanation: string }[];
}

const PROP_SYS = `You are the Property Generation Agent of an autonomous RISC-V RTL verification framework.

Your job: convert the given RTL module's specification into formal properties
using the small DSL below. The properties will be checked by an automated
property-based test harness that tests COMBINATIONAL behavior only (one cycle
at a time, no history).

DSL SYNTAX (one property per block):
PROPERTY <name>:
  TARGET <module-name>
  FOR ALL <input1>:uint<w1>, <input2>:uint<w2>, ...
  IMPLIES <precondition-expr> => <consequent-expr>

CRITICAL RULES:
- Identifiers in scope: ONLY input names + output names listed in the PORTS section.
  Do NOT reference internal signals like "regs", "prev_regs", or any array.
- ALL properties must be COMBINATIONAL — the consequent must depend ONLY on the
  current-cycle inputs, NOT on any previous state or history.
- Use ONLY these JS-compatible operators: ==, !=, <, >, <=, >=, &&, ||, !, ^, &, |, +, -, *, /, <<, >>, >>>.
- Do NOT use Verilog-specific syntax: NO $signed(), NO bit-slicing like x[4:0],
  NO array indexing like regs[addr], NO ternary ? : (use && / || instead).
- For type declarations, use ONLY: uint<N> (e.g. uint32, uint4, uint5, uint1).
  Do NOT use "bit", "bool", "reg", "integer", or array types like uint32[32].
- For the ALU module, use ALU_ADD, ALU_SUB, ALU_SLL, ALU_SLT, ALU_SLTU,
  ALU_XOR, ALU_SRL, ALU_SRA, ALU_OR, ALU_AND as alu_ctrl constants.
- For 32-bit masks, use 0xffffffff (lowercase hex).
- Properties should be SOUND: the consequent must hold whenever the precondition
  holds. The checker will look for counterexamples.
- Generate 3 to 5 properties. Each must be a SIMPLE combinatorial invariant.
- Do NOT use markdown. Output each property block separated by a blank line.
- After each property block, add an EXPLANATION line:
  EXPLANATION: <one-sentence justification>

GOOD examples (combinational, parseable):
PROPERTY add_result:
  TARGET rv32i_alu
  FOR ALL operand_a:uint32, operand_b:uint32, alu_ctrl:uint4
  IMPLIES alu_ctrl == ALU_ADD => alu_result == ((operand_a + operand_b) & 0xffffffff)
EXPLANATION: ALU in ADD mode must produce the sum of the two operands.

PROPERTY sub_self_zero:
  TARGET rv32i_alu
  FOR ALL operand_a:uint32, alu_ctrl:uint4
  IMPLIES alu_ctrl == ALU_SUB => alu_result == 0
EXPLANATION: SUB with identical operands must produce zero.

PROPERTY read_zero_reg:
  TARGET rv32i_regfile
  FOR ALL raddr1:uint5, raddr2:uint5, we:uint1, waddr:uint5, wdata:uint32
  IMPLIES raddr1 == 0 => rdata1 == 0
EXPLANATION: Reading register x0 must always return zero.

BAD examples (do NOT generate these — they will fail to parse):
- "we:bit" (use "we:uint1" instead)
- "prev_regs:uint32[32]" (arrays not allowed)
- "regs[raddr1]" (internal state not accessible)
- "operand_b[4:0]" (use "(operand_b & 0x1f)" instead)
- "$signed(operand_a)" (use "operand_a" directly)`;

export async function propertyGenerationAgent(module: RtlModule): Promise<PropertyGenResult> {
  const input = `RTL MODULE: ${module.name}
DESCRIPTION: ${module.description}

PORTS:
${module.ports.map(p => `  ${p.direction} ${p.name} [${p.width} bits] — ${p.description}`).join('\n')}

VERILOG SOURCE:
\`\`\`verilog
${module.verilogSource}
\`\`\`

Generate 3-6 formal properties for this module using the DSL described above.
The properties must be checkable against the behavioral model.`;

  const text = await llmChat(
    [
      { role: 'system', content: PROP_SYS },
      { role: 'user', content: input },
    ],
    { temperature: 0.4, max_tokens: 1800 }
  );
  return parsePropertyResponse(text);
}

function parsePropertyResponse(text: string): PropertyGenResult {
  // Strip markdown fences
  const cleaned = text.replace(/```[a-z]*\n?/g, '').replace(/```/g, '');
  // Split on PROPERTY: marker
  const blocks = cleaned.split(/\n(?=PROPERTY\s+\w+\s*:)/);
  const properties: { name: string; declaration: string; explanation: string }[] = [];
  for (const b of blocks) {
    const m = b.match(/PROPERTY\s+(\w+)\s*:/);
    if (!m) continue;
    const name = m[1];
    // Property body = everything up to EXPLANATION:
    const bodyEnd = b.search(/\nEXPLANATION:/i);
    const declaration = (bodyEnd >= 0 ? b.slice(0, bodyEnd) : b).trim();
    const explanation = (b.match(/EXPLANATION:\s*(.+)/i)?.[1] ?? '').trim();
    properties.push({ name, declaration, explanation });
  }
  return { properties };
}
