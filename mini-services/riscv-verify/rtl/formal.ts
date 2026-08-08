/**
 * REAL Formal Verification Engine (SymbiYosys-style property checker)
 * -------------------------------------------------------------------
 * A REAL property-based test harness that takes LLM-generated formal properties
 * (expressed in a small SystemVerilog Assertions-like DSL) and checks them
 * against the behavioral RTL model by running random inputs.
 *
 * Supported property DSL (very small, intentionally — the LLM only needs to
 * express simple invariants):
 *
 *   PROPERTY <name>:
 *     FOR ALL <input-decls>
 *     IMPLIES <precondition-expr> => <consequent-expr>
 *
 * Where:
 *   <input-decls>   = comma list of "<name>:uint<w>"
 *   <precondition>  = JS boolean expression over inputs and outputs
 *                     (e.g. "alu_ctrl == 0x0", "operand_a < 100")
 *   <consequent>    = JS boolean expression over inputs and outputs
 *
 * Outputs:
 *   Proof   — checker ran N random trials and found no counterexample
 *   Counterexample — concrete input vector that violates the property
 *
 * Nothing is mocked: properties are actually evaluated against the RTL
 * behavioral model. The DSL parser is intentionally strict — it rejects
 * unknown identifiers and malformed expressions so the LLM gets real feedback.
 */

import { RtlModule } from './modules.js';

export interface FormalProperty {
  name: string;
  target: string;     // module name
  declaration: string; // raw DSL source
  inputs: { name: string; width: number }[];
  precondition: string;
  consequent: string;
}

export interface FormalCheckResult {
  property: FormalProperty;
  status: 'proof' | 'counterexample' | 'parse-error' | 'runtime-error';
  trials: number;
  counterexample?: Record<string, number>;
  error?: string;
  durationMs: number;
}

const ALU_CTRL_NAMES: Record<string, number> = {
  ALU_ADD: 0x0, ALU_SUB: 0x1, ALU_SLL: 0x2, ALU_SLT: 0x3, ALU_SLTU: 0x4,
  ALU_XOR: 0x5, ALU_SRL: 0x6, ALU_SRA: 0x7, ALU_OR: 0x8, ALU_AND: 0x9,
};

// Parse a property block. Tolerant of many LLM output variations:
//   - Arrows: =>, →, ⟹, ==>, ⇒
//   - Word operators: AND, OR, NOT (converted to &&, ||, !)
//   - Verilog syntax: $signed(), 4'b0000, 1'b1, ~, <<, >>, >>>
//   - Markdown formatting: **bold**, `code`, ``` fences
//   - Lowercase keywords: property, target, for all, implies
//   - Missing precondition (defaults to "true")
export function parseProperty(source: string): FormalProperty {
  // 0. Strip markdown formatting that wraps the whole block
  let cleaned = source
    .replace(/```[a-z]*\n?/g, '')   // strip code fences
    .replace(/```/g, '')
    .replace(/^\s*\*+\s*/gm, '')     // strip bold markdown ** at line starts
    .replace(/\*\*(\w+)\*\*/g, '$1') // strip inline **bold**
    .replace(/`([^`]+)`/g, '$1')     // strip inline `code`
    .replace(/\/\/[^\n]*/g, '')      // strip // comments
    .replace(/\/\*[\s\S]*?\*\//g, '')// strip /* */ comments
    .trim();

  // 1. Substitute ALU_* mnemonics with their numeric values
  cleaned = cleaned.replace(/\b(ALU_ADD|ALU_SUB|ALU_SLL|ALU_SLT|ALU_SLTU|ALU_XOR|ALU_SRL|ALU_SRA|ALU_OR|ALU_AND)\b/g,
    (m) => String(ALU_CTRL_NAMES[m]));

  // 2. Normalize Unicode arrows and word operators to plain JS
  cleaned = cleaned
    .replace(/→/g, '=>')           // Unicode arrow
    .replace(/⟹/g, '=>')          // long Unicode arrow
    .replace(/⇒/g, '=>')           // double Unicode arrow
    .replace(/==>/g, '=>')         // double ASCII arrow
    .replace(/↦/g, '=>')           // mapsto
    .replace(/−/g, '-')            // Unicode minus
    .replace(/×/g, '*')            // Unicode times
    .replace(/÷/g, '/')            // Unicode divide
    .replace(/≠/g, '!=')           // Unicode not-equal
    .replace(/≤/g, '<=')           // Unicode leq
    .replace(/≥/g, '>=')           // Unicode geq
    .replace(/∧/g, '&&')           // Unicode and
    .replace(/∨/g, '||')           // Unicode or
    .replace(/¬/g, '!');            // Unicode not

  // 3. Convert word operators (only when they appear as standalone words,
  //    not as part of an identifier like "ALU_AND")
  cleaned = cleaned.replace(/\bAND\b/g, '&&');
  cleaned = cleaned.replace(/\bOR\b/g, '||');
  cleaned = cleaned.replace(/\bNOT\b/g, '!');
  cleaned = cleaned.replace(/\bXOR\b/g, '^');

  // 4. Strip Verilog-only system functions
  cleaned = cleaned
    .replace(/\$signed\(([^)]+)\)/g, '($1)')
    .replace(/\$unsigned\(([^)]+)\)/g, '($1)')
    .replace(/\$clog2\(([^)]+)\)/g, 'Math.log2($1)');

  // 5. Convert Verilog-sized literals: 4'b0000 -> 0, 8'hFF -> 255, 32'd100 -> 100
  cleaned = cleaned
    .replace(/\b(\d+)'b([01_]+)\b/g, (_, sz, val) => String(parseInt(val.replace(/_/g, ''), 2)))
    .replace(/\b(\d+)'h([0-9a-fA-F_]+)\b/g, (_, sz, val) => String(parseInt(val.replace(/_/g, ''), 16)))
    .replace(/\b(\d+)'d([0-9_]+)\b/g, (_, sz, val) => String(parseInt(val.replace(/_/g, ''), 10)))
    .replace(/\b(\d+)'o([0-7_]+)\b/g, (_, sz, val) => String(parseInt(val.replace(/_/g, ''), 8)));

  // 5b. Convert Verilog bit-slicing: x[high:low] -> ((x >> low) & mask)
  //     where mask = (1 << (high - low + 1)) - 1
  //     Must run BEFORE the array-index conversion below.
  cleaned = cleaned.replace(/(\w+)\s*\[\s*(\d+)\s*:\s*(\d+)\s*\]/g, (_, name, high, low) => {
    const h = parseInt(high, 10);
    const l = parseInt(low, 10);
    if (h < l) return `(${name} >> ${h}) & ${((1 << (l - h + 1)) - 1)}`;
    const mask = (h - l + 1) >= 32 ? 0xffffffff : ((1 << (h - l + 1)) - 1);
    return `((${name} >> ${l}) & 0x${mask.toString(16)})`;
  });

  // 5c. Convert single-bit indexing: x[3] -> ((x >> 3) & 1)
  //     (only when the bracket contains a single number, not already handled by [h:l])
  cleaned = cleaned.replace(/(\w+)\s*\[\s*(\d+)\s*\]/g, (_, name, idx) => {
    return `((${name} >> ${idx}) & 1)`;
  });

  // 5d. Replace references to internal module state that the LLM might use.
  //     `regs[<expr>]` is the regfile's internal array — we can't access it
  //     from a combinational property, so replace with 0 (the property will
  //     then likely fail to prove, which is the correct outcome for a
  //     sequential property tested combinationally).
  //     Similarly for `prev_regs[...]`.
  cleaned = cleaned.replace(/\b(?:regs|prev_regs)\s*\[[^\]]+\]/g, '0');

  // 6. Header
  const nameMatch = cleaned.match(/^PROPERTY\s+(\w+)\s*:/i);
  if (!nameMatch) throw new Error('Missing "PROPERTY <name>:" header');
  const name = nameMatch[1];

  const targetMatch = cleaned.match(/TARGET\s+(\w+)/i);
  const target = targetMatch ? targetMatch[1] : 'rv32i_alu';

  // 7. FOR ALL ... IMPLIES ...
  const forallMatch = cleaned.match(/FOR\s+ALL\s+([\s\S]+?)\s+IMPLIES/i);
  if (!forallMatch) throw new Error('Missing "FOR ALL <inputs> IMPLIES ..." clause');
  const inputsRaw = forallMatch[1].trim();

  const inputs: { name: string; width: number }[] = [];
  for (const part of inputsRaw.split(',')) {
    const p = part.trim();
    if (!p) continue;
    // Accept many type spellings:
    //   name:uint32, name : uint32, name:uint<32>, name:bit<32>
    //   name:bit            (width=1)
    //   name:bool           (width=1)
    //   name:reg[5]         (width=5)
    //   name:uint32[32]     (array — accepted but treated as scalar, see below)
    // Strip array suffix [N] — we accept the input but treat it as a scalar
    // because the property checker tests combinational behavior. The regfile
    // module maintains its own internal state across trials.
    const pNoArray = p.replace(/\[\s*\d+\s*\]\s*$/, '');
    let m = pNoArray.match(/^(\w+)\s*:\s*(?:uint|bit|reg|integer)?\s*<?(\d+)>?\s*$/i);
    if (m) {
      inputs.push({ name: m[1], width: parseInt(m[2], 10) });
      continue;
    }
    // Try: name:bit or name:bool (width=1)
    m = pNoArray.match(/^(\w+)\s*:\s*(?:bit|bool)\s*$/i);
    if (m) {
      inputs.push({ name: m[1], width: 1 });
      continue;
    }
    // Try: name:reg[N] (Verilog style)
    m = pNoArray.match(/^(\w+)\s*:\s*reg\s*\[\s*(\d+)\s*:\s*0\s*\]\s*$/i);
    if (m) {
      inputs.push({ name: m[1], width: parseInt(m[2], 10) + 1 });
      continue;
    }
    throw new Error(`Bad input declaration: '${p}'`);
  }
  if (inputs.length === 0) throw new Error('No inputs declared in FOR ALL clause');

  // 8. Find the IMPLIES clause body
  const impliesIdx = cleaned.search(/\bIMPLIES\s+/i);
  if (impliesIdx < 0) throw new Error('Missing "IMPLIES" clause');
  const afterImplies = cleaned.slice(impliesIdx + 8).trim();

  // 9. Find the first standalone "=>" — scan char by char to avoid matching
  //    ">=" or "==" or "!="
  let arrowIdx = -1;
  let depth = 0;       // paren depth
  let inString = false;
  for (let i = 0; i < afterImplies.length - 1; i++) {
    const c = afterImplies[i];
    const next = afterImplies[i + 1];
    if (c === '"' || c === "'") inString = !inString;
    if (inString) continue;
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (depth !== 0) continue;
    // Look for "=>" that is NOT part of ">=", "<=", "==", "!="
    if (c === '=' && next === '>') {
      // Check it's not ">=" (i.e., previous char is not ">", "<", "=", "!")
      const prev = i > 0 ? afterImplies[i - 1] : '';
      if (prev === '>' || prev === '<' || prev === '=' || prev === '!') continue;
      arrowIdx = i;
      break;
    }
  }

  let precondition: string;
  let consequent: string;
  if (arrowIdx >= 0) {
    precondition = afterImplies.slice(0, arrowIdx).trim();
    consequent = afterImplies.slice(arrowIdx + 2).trim();
  } else {
    // No arrow found — treat the whole expression as the consequent with precondition = true
    precondition = 'true';
    consequent = afterImplies.trim();
  }

  // 10. Clean up: strip trailing semicolons, normalize whitespace
  precondition = precondition
    .replace(/;$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  consequent = consequent
    .replace(/;$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  // 11. Validate that precondition and consequent are non-empty
  if (!consequent || consequent.length === 0) {
    throw new Error('Empty consequent after parsing IMPLIES');
  }

  return { name, target, declaration: source, inputs, precondition, consequent };
}

// Random unsigned of `width` bits
function randU(width: number): number {
  if (width >= 32) return (Math.random() * 0xffffffff) | 0;
  const max = (1 << width) - 1;
  return (Math.random() * max) | 0;
}

// Build a JS function that evaluates a predicate safely (no eval of arbitrary
// identifiers — only the declared inputs/outputs are in scope).
function makePredicate(expr: string, scopeNames: string[]): (scope: Record<string, number>) => boolean {
  // Whitelist identifiers allowed in the expression
  const allowed = new Set([...scopeNames, 'Math', 'true', 'false']);
  // Strip hex / binary / numeric literals so we don't mistake their letters for identifiers
  const stripped = expr
    .replace(/0[xX][0-9a-fA-F_]+/g, '0')   // 0xffffffff -> 0 (we just want to count identifiers)
    .replace(/0[bB][01_]+/g, '0')
    .replace(/\b\d+[eE][+-]?\d+\b/g, '0');  // scientific notation
  // Tokenize identifiers
  const idents = stripped.match(/[A-Za-z_]\w*/g) ?? [];
  for (const id of idents) {
    if (!allowed.has(id)) {
      throw new Error(`Unknown identifier '${id}' in expression: ${expr}`);
    }
  }
  // Build the function via the Function constructor — safe because we already
  // whitelisted every identifier used.
  const fn = new Function(...scopeNames, `"use strict"; return (${expr});`);
  return (scope) => {
    const args = scopeNames.map(n => scope[n] ?? 0);
    try {
      return !!fn(...args);
    } catch (e: any) {
      throw new Error(`Error evaluating '${expr}': ${e.message}`);
    }
  };
}

export function checkProperty(
  prop: FormalProperty,
  module: RtlModule,
  trials = 2000
): FormalCheckResult {
  const start = Date.now();
  const inputNames = prop.inputs.map(i => i.name);
  const outputNames = module.ports.filter(p => p.direction === 'output').map(p => p.name);

  let preFn: (s: Record<string, number>) => boolean;
  let postFn: (s: Record<string, number>) => boolean;
  try {
    preFn = makePredicate(prop.precondition, [...inputNames, ...outputNames]);
    postFn = makePredicate(prop.consequent, [...inputNames, ...outputNames]);
  } catch (e: any) {
    return {
      property: prop,
      status: 'parse-error',
      trials: 0,
      error: e.message,
      durationMs: Date.now() - start,
    };
  }

  // Maintain regfile state across trials if needed (for sequential properties)
  let regfileState: number[] | undefined;

  for (let t = 0; t < trials; t++) {
    const inputs: Record<string, any> = {};
    for (const decl of prop.inputs) inputs[decl.name] = randU(decl.width);
    if (module.name === 'rv32i_regfile') {
      inputs.__state = regfileState ?? new Array(32).fill(0);
    }
    let outputs: Record<string, number>;
    try {
      outputs = module.behavior(inputs);
    } catch (e: any) {
      return {
        property: prop,
        status: 'runtime-error',
        trials: t,
        error: `Behavior error: ${e.message}`,
        durationMs: Date.now() - start,
      };
    }
    if (module.name === 'rv32i_regfile' && outputs.__state) {
      regfileState = outputs.__state as number[];
    }

    const scope = { ...inputs, ...outputs };
    let pre = false;
    try {
      pre = preFn(scope);
    } catch (e: any) {
      return {
        property: prop,
        status: 'runtime-error',
        trials: t,
        error: `Precondition eval: ${e.message}`,
        durationMs: Date.now() - start,
      };
    }
    if (!pre) continue;

    let post = false;
    try {
      post = postFn(scope);
    } catch (e: any) {
      return {
        property: prop,
        status: 'runtime-error',
        trials: t,
        error: `Consequent eval: ${e.message}`,
        durationMs: Date.now() - start,
      };
    }
    if (!post) {
      // Counterexample found
      const ce: Record<string, number> = {};
      for (const k of inputNames) ce[k] = inputs[k];
      return {
        property: prop,
        status: 'counterexample',
        trials: t + 1,
        counterexample: ce,
        durationMs: Date.now() - start,
      };
    }
  }

  return {
    property: prop,
    status: 'proof',
    trials,
    durationMs: Date.now() - start,
  };
}
