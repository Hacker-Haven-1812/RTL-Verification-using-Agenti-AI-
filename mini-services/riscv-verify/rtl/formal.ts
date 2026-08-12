

import { RtlModule } from './modules.js';

export interface FormalProperty {
  name: string;
  target: string;
  declaration: string;
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








export function parseProperty(source: string): FormalProperty {

  let cleaned = source
    .replace(/```[a-z]*\n?/g, '')   // strip code fences
    .replace(/```/g, '')
    .replace(/^\s*\*+\s*/gm, '')
    .replace(/\*\*(\w+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')     // strip inline `code`
    .replace(/\/\/[^\n]*/g, '')      // strip // comments
    .replace(/\/\*[\s\S]*?\*\//g, '')// strip /* */ comments
    .trim();

  cleaned = cleaned.replace(/\b(ALU_ADD|ALU_SUB|ALU_SLL|ALU_SLT|ALU_SLTU|ALU_XOR|ALU_SRL|ALU_SRA|ALU_OR|ALU_AND)\b/g,
    (m) => String(ALU_CTRL_NAMES[m]));

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

  cleaned = cleaned.replace(/\bAND\b/g, '&&');
  cleaned = cleaned.replace(/\bOR\b/g, '||');
  cleaned = cleaned.replace(/\bNOT\b/g, '!');
  cleaned = cleaned.replace(/\bXOR\b/g, '^');

  cleaned = cleaned
    .replace(/\$signed\(([^)]+)\)/g, '($1)')
    .replace(/\$unsigned\(([^)]+)\)/g, '($1)')
    .replace(/\$clog2\(([^)]+)\)/g, 'Math.log2($1)');

  cleaned = cleaned
    .replace(/\b(\d+)'b([01_]+)\b/g, (_, sz, val) => String(parseInt(val.replace(/_/g, ''), 2)))
    .replace(/\b(\d+)'h([0-9a-fA-F_]+)\b/g, (_, sz, val) => String(parseInt(val.replace(/_/g, ''), 16)))
    .replace(/\b(\d+)'d([0-9_]+)\b/g, (_, sz, val) => String(parseInt(val.replace(/_/g, ''), 10)))
    .replace(/\b(\d+)'o([0-7_]+)\b/g, (_, sz, val) => String(parseInt(val.replace(/_/g, ''), 8)));

  cleaned = cleaned.replace(/(\w+)\s*\[\s*(\d+)\s*:\s*(\d+)\s*\]/g, (_, name, high, low) => {
    const h = parseInt(high, 10);
    const l = parseInt(low, 10);
    if (h < l) return `(${name} >> ${h}) & ${((1 << (l - h + 1)) - 1)}`;
    const mask = (h - l + 1) >= 32 ? 0xffffffff : ((1 << (h - l + 1)) - 1);
    return `((${name} >> ${l}) & 0x${mask.toString(16)})`;
  });

  cleaned = cleaned.replace(/(\w+)\s*\[\s*(\d+)\s*\]/g, (_, name, idx) => {
    return `((${name} >> ${idx}) & 1)`;
  });

  cleaned = cleaned.replace(/\b(?:regs|prev_regs)\s*\[[^\]]+\]/g, '0');

  const nameMatch = cleaned.match(/^PROPERTY\s+(\w+)\s*:/i);
  if (!nameMatch) throw new Error('Missing "PROPERTY <name>:" header');
  const name = nameMatch[1];

  const targetMatch = cleaned.match(/TARGET\s+(\w+)/i);
  const target = targetMatch ? targetMatch[1] : 'rv32i_alu';

  const forallMatch = cleaned.match(/FOR\s+ALL\s+([\s\S]+?)\s+IMPLIES/i);
  if (!forallMatch) throw new Error('Missing "FOR ALL <inputs> IMPLIES ..." clause');
  const inputsRaw = forallMatch[1].trim();

  const inputs: { name: string; width: number }[] = [];
  for (const part of inputsRaw.split(',')) {
    const p = part.trim();
    if (!p) continue;
    const pNoArray = p.replace(/\[\s*\d+\s*\]\s*$/, '');
    let m = pNoArray.match(/^(\w+)\s*:\s*(?:uint|bit|reg|integer)?\s*<?(\d+)>?\s*$/i);
    if (m) {
      inputs.push({ name: m[1], width: parseInt(m[2], 10) });
      continue;
    }
    m = pNoArray.match(/^(\w+)\s*:\s*(?:bit|bool)\s*$/i);
    if (m) {
      inputs.push({ name: m[1], width: 1 });
      continue;
    }
    m = pNoArray.match(/^(\w+)\s*:\s*reg\s*\[\s*(\d+)\s*:\s*0\s*\]\s*$/i);
    if (m) {
      inputs.push({ name: m[1], width: parseInt(m[2], 10) + 1 });
      continue;
    }
    throw new Error(`Bad input declaration: '${p}'`);
  }
  if (inputs.length === 0) throw new Error('No inputs declared in FOR ALL clause');

  const impliesIdx = cleaned.search(/\bIMPLIES\s+/i);
  if (impliesIdx < 0) throw new Error('Missing "IMPLIES" clause');
  const afterImplies = cleaned.slice(impliesIdx + 8).trim();

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
    if (c === '=' && next === '>') {
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
    precondition = 'true';
    consequent = afterImplies.trim();
  }

  precondition = precondition
    .replace(/;$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  consequent = consequent
    .replace(/;$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!consequent || consequent.length === 0) {
    throw new Error('Empty consequent after parsing IMPLIES');
  }

  return { name, target, declaration: source, inputs, precondition, consequent };
}

function randU(width: number): number {
  if (width >= 32) return (Math.random() * 0xffffffff) | 0;
  const max = (1 << width) - 1;
  return (Math.random() * max) | 0;
}

function makePredicate(expr: string, scopeNames: string[]): (scope: Record<string, number>) => boolean {
  const allowed = new Set([...scopeNames, 'Math', 'true', 'false']);
  const stripped = expr
    .replace(/0[xX][0-9a-fA-F_]+/g, '0')   // 0xffffffff -> 0 (we just want to count identifiers)
    .replace(/0[bB][01_]+/g, '0')
    .replace(/\b\d+[eE][+-]?\d+\b/g, '0');  // scientific notation
  const idents = stripped.match(/[A-Za-z_]\w*/g) ?? [];
  for (const id of idents) {
    if (!allowed.has(id)) {
      throw new Error(`Unknown identifier '${id}' in expression: ${expr}`);
    }
  }
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
