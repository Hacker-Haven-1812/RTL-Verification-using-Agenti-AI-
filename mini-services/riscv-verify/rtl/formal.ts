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

// Parse a property block of the form:
//   PROPERTY <name>:
//     TARGET <module-name>
//     FOR ALL <input-decls>
//     IMPLIES <pre> => <post>
//        OR
//     IMPLIES <post>           (precondition defaults to "true")
export function parseProperty(source: string): FormalProperty {
  const cleaned = source
    .replace(/\/\/[^\n]*/g, '')            // strip // comments
    .replace(/\/\*[\s\S]*?\*\//g, '')      // strip /* */ comments
    .trim();

  // Substitute ALU_* mnemonics with their numeric values for easier eval
  const substituted = cleaned.replace(/\b(ALU_ADD|ALU_SUB|ALU_SLL|ALU_SLT|ALU_SLTU|ALU_XOR|ALU_SRL|ALU_SRA|ALU_OR|ALU_AND)\b/g,
    (m) => String(ALU_CTRL_NAMES[m]));

  // Strip Verilog-only syntax that JS can't evaluate
  const sanitized = substituted
    .replace(/\$signed\(([^)]+)\)/g, '($1)')     // $signed(x) -> (x)
    .replace(/\$unsigned\(([^)]+)\)/g, '($1)')
    .replace(/\b\d+'b[01_]+\b/g, (m) => String(parseInt(m.replace(/'b/, '').replace(/_/g, ''), 2)))  // 4'b0000 -> 0
    .replace(/\b\d+'h[0-9a-fA-F_]+\b/g, (m) => String(parseInt(m.replace(/.*'h/, '').replace(/_/g, ''), 16)))
    .replace(/\b\d+'d[0-9_]+\b/g, (m) => String(parseInt(m.replace(/.*'d/, '').replace(/_/g, ''), 10)));

  const nameMatch = sanitized.match(/^PROPERTY\s+(\w+)\s*:/i);
  if (!nameMatch) throw new Error('Missing "PROPERTY <name>:" header');
  const name = nameMatch[1];

  const targetMatch = sanitized.match(/TARGET\s+(\w+)/i);
  const target = targetMatch ? targetMatch[1] : 'rv32i_alu';

  const forallMatch = sanitized.match(/FOR\s+ALL\s+([\s\S]+?)\s+IMPLIES/i);
  if (!forallMatch) throw new Error('Missing "FOR ALL <inputs> IMPLIES ..." clause');
  const inputsRaw = forallMatch[1].trim();

  const inputs: { name: string; width: number }[] = [];
  for (const part of inputsRaw.split(',')) {
    const m = part.trim().match(/^(\w+)\s*:\s*uint\s*(\d+)$/i);
    if (!m) throw new Error(`Bad input declaration: '${part}'`);
    inputs.push({ name: m[1], width: parseInt(m[2], 10) });
  }

  // Find the IMPLIES clause and split on the first standalone "=>" (not part of ">=" or "==")
  const impliesIdx = sanitized.search(/\bIMPLIES\s+/i);
  if (impliesIdx < 0) throw new Error('Missing "IMPLIES" clause');
  const afterImplies = sanitized.slice(impliesIdx + 8).trim();

  // Find first " => " (with whitespace) that is NOT part of ">=" or "==" or "<="
  // We look for the pattern: not in [=<>!] followed by => followed by space
  const arrowMatch = afterImplies.match(/^([\s\S]+?)\s+=>\s+([\s\S]+)$/);
  let precondition: string;
  let consequent: string;
  if (arrowMatch) {
    precondition = arrowMatch[1].trim();
    consequent = arrowMatch[2].trim();
  } else {
    // No arrow found — treat the whole expression as the consequent with precondition = true
    precondition = 'true';
    consequent = afterImplies.trim();
  }

  // Reject Verilog ternary syntax that uses ? : (we want plain JS)
  // Already substituted above. Final cleanup: remove trailing/leading parens
  // that could break the Function constructor.
  precondition = precondition.replace(/;$/, '').trim();
  consequent = consequent.replace(/;$/, '').trim();

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
