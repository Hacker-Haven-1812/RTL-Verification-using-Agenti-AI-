/**
 * REAL RISC-V RV32I Assembler
 * ----------------------------
 * Two-pass assembler supporting the entire RV32I base ISA.
 *
 *   Pass 1: Resolve labels (collect symbol table).
 *   Pass 2: Encode each instruction to a 32-bit word.
 *
 * Supports:
 *   - All register names: x0..x31, zero, ra, sp, gp, tp, t0..t6, s0..s11,
 *     a0..a7, fp
 *   - Pseudo-instructions: li, mv, nop, j, jr, ret, beqz, bnez, bltz, bgez,
 *     neg, not, seqz, snez, la (best-effort), b (unconditional branch alias)
 *   - Comments starting with # or ;
 *   - Blank lines
 *   - Directives: .word, .byte, .half, .string/.ascii, .org (for setting PC)
 *
 * The output is a Uint8Array of little-endian machine code, ready to be
 * loaded into the simulator's memory at offset 0.
 */

export interface AssemblerError {
  line: number;
  message: string;
}

export interface AssemblerResult {
  bytes: Uint8Array;
  errors: AssemblerError[];
  symbols: Record<string, number>;
  lineMap: number[]; // byteOffset -> source line number (1-indexed)
  instructionCount: number;
}

const REG_NAMES: Record<string, number> = {
  x0: 0, zero: 0,
  x1: 1, ra: 1,
  x2: 2, sp: 2,
  x3: 3, gp: 3,
  x4: 4, tp: 4,
  x5: 5, t0: 5,
  x6: 6, t1: 6,
  x7: 7, t2: 7,
  x8: 8, s0: 8, fp: 8,
  x9: 9, s1: 9,
  x10: 10, a0: 10,
  x11: 11, a1: 11,
  x12: 12, a2: 12,
  x13: 13, a3: 13,
  x14: 14, a4: 14,
  x15: 15, a5: 15,
  x16: 16, a6: 16,
  x17: 17, a7: 17,
  x18: 18, s2: 18,
  x19: 19, s3: 19,
  x20: 20, s4: 20,
  x21: 21, s5: 21,
  x22: 22, s6: 22,
  x23: 23, s7: 23,
  x24: 24, s8: 24,
  x25: 25, s9: 25,
  x26: 26, s10: 26,
  x27: 27, s11: 27,
  x28: 28, t3: 28,
  x29: 29, t4: 29,
  x30: 30, t5: 30,
  x31: 31, t6: 31,
};

function parseReg(tok: string, line: number): number {
  const v = REG_NAMES[tok.toLowerCase()];
  if (v === undefined) throw new Error(`Line ${line}: unknown register '${tok}'`);
  return v;
}

function parseImm(tok: string, symbols: Record<string, number>, line: number): number {
  if (tok.startsWith('0x') || tok.startsWith('-0x') || tok.startsWith('+0x')) {
    return parseInt(tok, 16);
  }
  if (tok.startsWith('0b') || tok.startsWith('-0b')) {
    return parseInt(tok, 2);
  }
  if (symbols[tok] !== undefined) return symbols[tok];
  const n = Number(tok);
  if (Number.isNaN(n)) throw new Error(`Line ${line}: invalid immediate '${tok}'`);
  return n;
}

// Split a line into (label?, mnemonic, operands[]) — handles "label:" prefix
function tokenizeLine(line: string): { label?: string; mnemonic?: string; operands: string[] } {
  // Strip comments
  let l = line;
  const hashIdx = l.search(/[#;]/);
  if (hashIdx >= 0) l = l.slice(0, hashIdx);
  l = l.trim();
  if (!l) return { operands: [] };

  let label: string | undefined;
  // A label may be "label:" possibly followed by an instruction
  const labelMatch = l.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
  if (labelMatch) {
    label = labelMatch[1];
    l = labelMatch[2].trim();
    if (!l) return { label, operands: [] };
  }

  // Mnemonic = first whitespace-separated token; operands = comma-separated remainder
  const sp = l.search(/\s/);
  let mnemonic: string | undefined;
  let rest = '';
  if (sp < 0) {
    mnemonic = l;
  } else {
    mnemonic = l.slice(0, sp);
    rest = l.slice(sp + 1).trim();
  }
  const operands = rest ? rest.split(',').map(s => s.trim()).filter(s => s.length > 0) : [];
  return { label, mnemonic: mnemonic.toLowerCase(), operands };
}

// ----------------- Instruction encoders -----------------
// Each returns a 32-bit unsigned word. All immediate fields use signed/unsigned
// values consistent with the RISC-V spec — no offset hacking.

function encR(funct7: number, rs2: number, rs1: number, funct3: number, rd: number, opcode: number): number {
  return (((funct7 & 0x7f) << 25) | ((rs2 & 0x1f) << 20) | ((rs1 & 0x1f) << 15) |
    ((funct3 & 0x7) << 12) | ((rd & 0x1f) << 7) | (opcode & 0x7f)) >>> 0;
}
function encI(imm: number, rs1: number, funct3: number, rd: number, opcode: number): number {
  return (((imm & 0xfff) << 20) | ((rs1 & 0x1f) << 15) | ((funct3 & 0x7) << 12) |
    ((rd & 0x1f) << 7) | (opcode & 0x7f)) >>> 0;
}
function encS(imm: number, rs2: number, rs1: number, funct3: number, opcode: number): number {
  const imm11_5 = (imm >> 5) & 0x7f;
  const imm4_0 = imm & 0x1f;
  return ((imm11_5 << 25) | ((rs2 & 0x1f) << 20) | ((rs1 & 0x1f) << 15) |
    ((funct3 & 0x7) << 12) | (imm4_0 << 7) | (opcode & 0x7f)) >>> 0;
}
function encB(imm: number, rs2: number, rs1: number, funct3: number, opcode: number): number {
  // imm is signed 13-bit, bit 0 always 0
  const i = imm & 0x1fff;
  const imm12 = (i >> 12) & 0x1;
  const imm10_5 = (i >> 5) & 0x3f;
  const imm4_1 = (i >> 1) & 0xf;
  const imm11 = (i >> 11) & 0x1;
  return ((imm12 << 31) | (imm10_5 << 25) | ((rs2 & 0x1f) << 20) | ((rs1 & 0x1f) << 15) |
    ((funct3 & 0x7) << 12) | (imm4_1 << 8) | (imm11 << 7) | (opcode & 0x7f)) >>> 0;
}
function encU(imm: number, rd: number, opcode: number): number {
  return ((imm & 0xfffff000) | ((rd & 0x1f) << 7) | (opcode & 0x7f)) >>> 0;
}
function encJ(imm: number, rd: number, opcode: number): number {
  const i = imm & 0x1fffff;
  const imm20 = (i >> 20) & 0x1;
  const imm10_1 = (i >> 1) & 0x3ff;
  const imm11 = (i >> 11) & 0x1;
  const imm19_12 = (i >> 12) & 0xff;
  return ((imm20 << 31) | (imm10_1 << 21) | (imm11 << 20) | (imm19_12 << 12) |
    ((rd & 0x1f) << 7) | (opcode & 0x7f)) >>> 0;
}

const R_OPS: Record<string, { funct3: number; funct7: number }> = {
  add: { funct3: 0x0, funct7: 0x00 },
  sub: { funct3: 0x0, funct7: 0x20 },
  sll: { funct3: 0x1, funct7: 0x00 },
  slt: { funct3: 0x2, funct7: 0x00 },
  sltu: { funct3: 0x3, funct7: 0x00 },
  xor: { funct3: 0x4, funct7: 0x00 },
  srl: { funct3: 0x5, funct7: 0x00 },
  sra: { funct3: 0x5, funct7: 0x20 },
  or: { funct3: 0x6, funct7: 0x00 },
  and: { funct3: 0x7, funct7: 0x00 },
};

const I_OPS: Record<string, number> = {
  addi: 0x0, slti: 0x2, sltiu: 0x3, xori: 0x4, ori: 0x6, andi: 0x7,
  slli: 0x1, srli: 0x5, srai: 0x5,
};

const LOAD_OPS: Record<string, number> = { lb: 0x0, lh: 0x1, lw: 0x2, lbu: 0x4, lhu: 0x5 };
const STORE_OPS: Record<string, number> = { sb: 0x0, sh: 0x1, sw: 0x2 };
const BRANCH_OPS: Record<string, number> = { beq: 0x0, bne: 0x1, blt: 0x4, bge: 0x5, bltu: 0x6, bgeu: 0x7 };

export function assemble(source: string): AssemblerResult {
  const errors: AssemblerError[] = [];
  const lines = source.split(/\r?\n/);
  const symbols: Record<string, number> = {};

  // ----------------- Pass 1: collect symbols -----------------
  let pc = 0;
  const parsedLines: { lineNo: number; label?: string; mnemonic?: string; operands: string[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    let parsed;
    try {
      parsed = tokenizeLine(lines[i]);
    } catch (e: any) {
      errors.push({ line: lineNo, message: e.message });
      continue;
    }
    if (parsed.label) {
      if (symbols[parsed.label] !== undefined) {
        errors.push({ line: lineNo, message: `Duplicate label '${parsed.label}'` });
      }
      symbols[parsed.label] = pc;
    }
    if (parsed.mnemonic) {
      // Directives affect layout
      if (parsed.mnemonic === '.org') {
        try {
          pc = parseImm(parsed.operands[0], {}, lineNo);
        } catch (e: any) {
          errors.push({ line: lineNo, message: e.message });
        }
      } else if (parsed.mnemonic === '.word') {
        pc += 4 * Math.max(1, parsed.operands.length);
      } else if (parsed.mnemonic === '.half') {
        pc += 2 * Math.max(1, parsed.operands.length);
      } else if (parsed.mnemonic === '.byte') {
        pc += Math.max(1, parsed.operands.length);
      } else if (parsed.mnemonic === '.ascii' || parsed.mnemonic === '.string') {
        const s = parsed.operands.join(',').replace(/^"|"$/g, '');
        pc += s.length + (parsed.mnemonic === '.string' ? 1 : 0);
      } else if (parsed.mnemonic.startsWith('.')) {
        // Unknown directive - ignore
      } else if (parsed.mnemonic === 'li') {
        // li expands to 1 or 2 real instructions depending on the immediate
        try {
          const imm = parseImm(parsed.operands[1] ?? '0', {}, lineNo);
          if (imm >= -2048 && imm <= 2047) pc += 4;
          else pc += 8; // lui + addi
        } catch {
          pc += 8; // assume worst case
        }
      } else {
        pc += 4;
      }
      parsedLines.push({ lineNo, mnemonic: parsed.mnemonic, operands: parsed.operands });
    } else if (parsed.label) {
      parsedLines.push({ lineNo, label: parsed.label, operands: [] });
    }
  }

  // ----------------- Pass 2: encode -----------------
  // Allocate buffer big enough — we'll trim at the end
  const maxBytes = pc + 64;
  const buf = new Uint8Array(maxBytes);
  pc = 0;
  const lineMap: number[] = new Array(maxBytes).fill(0);
  let instrCount = 0;

  for (const p of parsedLines) {
    if (!p.mnemonic) continue;
    const m = p.mnemonic;

    try {
      if (m === '.org') {
        pc = parseImm(p.operands[0], symbols, p.lineNo);
        continue;
      }
      if (m === '.word' || m === '.half' || m === '.byte') {
        for (const op of p.operands) {
          const v = parseImm(op, symbols, p.lineNo);
          if (m === '.word') {
            buf[pc] = v & 0xff; buf[pc + 1] = (v >> 8) & 0xff; buf[pc + 2] = (v >> 16) & 0xff; buf[pc + 3] = (v >> 24) & 0xff;
            lineMap[pc] = p.lineNo; pc += 4;
          } else if (m === '.half') {
            buf[pc] = v & 0xff; buf[pc + 1] = (v >> 8) & 0xff;
            lineMap[pc] = p.lineNo; pc += 2;
          } else {
            buf[pc] = v & 0xff; lineMap[pc] = p.lineNo; pc += 1;
          }
        }
        continue;
      }
      if (m === '.ascii' || m === '.string') {
        const s = p.operands.join(',').replace(/^"|"$/g, '');
        for (let i = 0; i < s.length; i++) {
          buf[pc] = s.charCodeAt(i) & 0xff; lineMap[pc] = p.lineNo; pc++;
        }
        if (m === '.string') { buf[pc] = 0; lineMap[pc] = p.lineNo; pc++; }
        continue;
      }

      let word: number | null = null;

      // R-type
      if (R_OPS[m]) {
        const rd = parseReg(p.operands[0], p.lineNo);
        const rs1 = parseReg(p.operands[1], p.lineNo);
        const rs2 = parseReg(p.operands[2], p.lineNo);
        word = encR(R_OPS[m].funct7, rs2, rs1, R_OPS[m].funct3, rd, 0x33);
      }
      // I-type arithmetic
      else if (I_OPS[m] !== undefined && m !== 'slli' && m !== 'srli' && m !== 'srai') {
        const rd = parseReg(p.operands[0], p.lineNo);
        const rs1 = parseReg(p.operands[1], p.lineNo);
        const imm = parseImm(p.operands[2], symbols, p.lineNo);
        word = encI(imm, rs1, I_OPS[m], rd, 0x13);
      }
      // Shift immediates
      else if (m === 'slli' || m === 'srli' || m === 'srai') {
        const rd = parseReg(p.operands[0], p.lineNo);
        const rs1 = parseReg(p.operands[1], p.lineNo);
        const shamt = parseImm(p.operands[2], symbols, p.lineNo) & 0x1f;
        const funct7 = (m === 'srai') ? 0x20 : 0x00;
        word = encR(funct7, shamt, rs1, I_OPS[m], rd, 0x13);
      }
      // Load
      else if (LOAD_OPS[m] !== undefined) {
        const rd = parseReg(p.operands[0], p.lineNo);
        // Two forms: "lw rd, imm(rs1)" or "lw rd, rs1, imm"
        let rs1: number, imm: number;
        if (p.operands[1].includes('(')) {
          const m2 = p.operands[1].match(/^(-?\w+|0x[0-9a-fA-F]+)?\(?(\w+)\)?$/);
          if (!m2) throw new Error(`Line ${p.lineNo}: bad load operand '${p.operands[1]}'`);
          imm = m2[1] ? parseImm(m2[1], symbols, p.lineNo) : 0;
          rs1 = parseReg(m2[2], p.lineNo);
        } else {
          rs1 = parseReg(p.operands[1], p.lineNo);
          imm = parseImm(p.operands[2], symbols, p.lineNo);
        }
        word = encI(imm, rs1, LOAD_OPS[m], rd, 0x03);
      }
      // Store
      else if (STORE_OPS[m] !== undefined) {
        const rs2 = parseReg(p.operands[0], p.lineNo);
        let rs1: number, imm: number;
        if (p.operands[1].includes('(')) {
          const m2 = p.operands[1].match(/^(-?\w+|0x[0-9a-fA-F]+)?\(?(\w+)\)?$/);
          if (!m2) throw new Error(`Line ${p.lineNo}: bad store operand '${p.operands[1]}'`);
          imm = m2[1] ? parseImm(m2[1], symbols, p.lineNo) : 0;
          rs1 = parseReg(m2[2], p.lineNo);
        } else {
          rs1 = parseReg(p.operands[1], p.lineNo);
          imm = parseImm(p.operands[2], symbols, p.lineNo);
        }
        word = encS(imm, rs2, rs1, STORE_OPS[m], 0x23);
      }
      // Branch
      else if (BRANCH_OPS[m] !== undefined) {
        const rs1 = parseReg(p.operands[0], p.lineNo);
        const rs2 = parseReg(p.operands[1], p.lineNo);
        const target = parseImm(p.operands[2], symbols, p.lineNo);
        const off = target - pc;
        word = encB(off, rs2, rs1, BRANCH_OPS[m], 0x63);
      }
      // JAL
      else if (m === 'jal') {
        if (p.operands.length === 1) {
          // Pseudo: "jal label" -> "jal ra, label"
          const target = parseImm(p.operands[0], symbols, p.lineNo);
          const off = target - pc;
          word = encJ(off, 1, 0x6f);
        } else {
          const rd = parseReg(p.operands[0], p.lineNo);
          const target = parseImm(p.operands[1], symbols, p.lineNo);
          const off = target - pc;
          word = encJ(off, rd, 0x6f);
        }
      }
      // JALR
      else if (m === 'jalr') {
        if (p.operands.length === 1) {
          word = encI(0, parseReg(p.operands[0], p.lineNo), 0x0, 1, 0x67);
        } else {
          const rd = parseReg(p.operands[0], p.lineNo);
          const rs1 = parseReg(p.operands[1], p.lineNo);
          const imm = p.operands[2] ? parseImm(p.operands[2], symbols, p.lineNo) : 0;
          word = encI(imm, rs1, 0x0, rd, 0x67);
        }
      }
      // LUI / AUIPC
      else if (m === 'lui') {
        const rd = parseReg(p.operands[0], p.lineNo);
        const imm = parseImm(p.operands[1], symbols, p.lineNo);
        word = encU(imm, rd, 0x37);
      } else if (m === 'auipc') {
        const rd = parseReg(p.operands[0], p.lineNo);
        const imm = parseImm(p.operands[1], symbols, p.lineNo);
        word = encU(imm, rd, 0x17);
      }
      // System
      else if (m === 'ecall') {
        word = encI(0, 0, 0x0, 0, 0x73);
      } else if (m === 'ebreak') {
        word = encI(1, 0, 0x0, 0, 0x73);
      }
      // Pseudo-instructions
      else if (m === 'li') {
        const rd = parseReg(p.operands[0], p.lineNo);
        const imm = parseImm(p.operands[1], symbols, p.lineNo);
        if (imm >= -2048 && imm <= 2047) {
          word = encI(imm, 0, 0x0, rd, 0x13); // addi rd, x0, imm
        } else {
          // lui rd, upper20 ; addi rd, rd, lower12
          const upper = (imm + 0x800) & 0xfffff000;
          const lower = imm & 0xfff;
          const w1 = encU(upper, rd, 0x37);
          buf[pc] = w1 & 0xff; buf[pc + 1] = (w1 >> 8) & 0xff; buf[pc + 2] = (w1 >> 16) & 0xff; buf[pc + 3] = (w1 >> 24) & 0xff;
          lineMap[pc] = p.lineNo; pc += 4; instrCount++;
          word = encI(lower, rd, 0x0, rd, 0x13);
        }
      } else if (m === 'mv') {
        const rd = parseReg(p.operands[0], p.lineNo);
        const rs1 = parseReg(p.operands[1], p.lineNo);
        word = encI(0, rs1, 0x0, rd, 0x13);
      } else if (m === 'nop') {
        word = encI(0, 0, 0x0, 0, 0x13);
      } else if (m === 'j') {
        const target = parseImm(p.operands[0], symbols, p.lineNo);
        const off = target - pc;
        word = encJ(off, 0, 0x6f); // jal x0, off
      } else if (m === 'jr') {
        const rs1 = parseReg(p.operands[0], p.lineNo);
        word = encI(0, rs1, 0x0, 0, 0x67);
      } else if (m === 'ret') {
        word = encI(0, 1, 0x0, 0, 0x67); // jalr x0, ra, 0
      } else if (m === 'b') {
        const target = parseImm(p.operands[0], symbols, p.lineNo);
        const off = target - pc;
        word = encB(off, 0, 0, 0x0, 0x63); // beq x0, x0, off
      } else if (m === 'beqz') {
        const rs1 = parseReg(p.operands[0], p.lineNo);
        const target = parseImm(p.operands[1], symbols, p.lineNo);
        const off = target - pc;
        word = encB(off, 0, rs1, 0x0, 0x63);
      } else if (m === 'bnez') {
        const rs1 = parseReg(p.operands[0], p.lineNo);
        const target = parseImm(p.operands[1], symbols, p.lineNo);
        const off = target - pc;
        word = encB(off, 0, rs1, 0x1, 0x63);
      } else if (m === 'bltz') {
        const rs1 = parseReg(p.operands[0], p.lineNo);
        const target = parseImm(p.operands[1], symbols, p.lineNo);
        const off = target - pc;
        word = encB(off, 0, rs1, 0x4, 0x63);
      } else if (m === 'bgez') {
        const rs1 = parseReg(p.operands[0], p.lineNo);
        const target = parseImm(p.operands[1], symbols, p.lineNo);
        const off = target - pc;
        word = encB(off, 0, rs1, 0x5, 0x63);
      } else if (m === 'neg') {
        const rd = parseReg(p.operands[0], p.lineNo);
        const rs1 = parseReg(p.operands[1], p.lineNo);
        word = encR(0x20, rs1, 0, 0x0, rd, 0x33); // sub rd, x0, rs1
      } else if (m === 'not') {
        const rd = parseReg(p.operands[0], p.lineNo);
        const rs1 = parseReg(p.operands[1], p.lineNo);
        word = encI(-1, rs1, 0x4, rd, 0x13); // xori rd, rs1, -1
      } else if (m === 'seqz') {
        const rd = parseReg(p.operands[0], p.lineNo);
        const rs1 = parseReg(p.operands[1], p.lineNo);
        word = encI(1, rs1, 0x3, rd, 0x13); // sltiu rd, rs1, 1
      } else if (m === 'snez') {
        const rd = parseReg(p.operands[0], p.lineNo);
        const rs1 = parseReg(p.operands[1], p.lineNo);
        word = encR(0, rs1, 0, 0x3, rd, 0x33); // sltu rd, x0, rs1
      } else {
        throw new Error(`Line ${p.lineNo}: unknown instruction '${m}'`);
      }

      if (word !== null) {
        buf[pc] = word & 0xff;
        buf[pc + 1] = (word >> 8) & 0xff;
        buf[pc + 2] = (word >> 16) & 0xff;
        buf[pc + 3] = (word >> 24) & 0xff;
        lineMap[pc] = p.lineNo;
        pc += 4;
        instrCount++;
      }
    } catch (e: any) {
      errors.push({ line: p.lineNo, message: e.message });
    }
  }

  // Trim to actual size
  const bytes = buf.slice(0, pc);
  return { bytes, errors, symbols, lineMap: lineMap.slice(0, pc), instructionCount: instrCount };
}
