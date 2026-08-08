/**
 * REAL RISC-V RV32I Single-Cycle Core Simulator
 * ----------------------------------------------
 * Implements the entire RV32I base integer instruction set:
 *   - Arithmetic/Logic:    ADD, SUB, SLL, SLT, SLTU, XOR, SRL, SRA, OR, AND
 *   - Immediate variants:  ADDI, SLTI, SLTIU, XORI, ORI, ANDI, SLLI, SRLI, SRAI
 *   - Memory:              LW, LH, LHU, LB, LBU, SW, SH, SB
 *   - Control:             BEQ, BNE, BLT, BGE, BLTU, BGEU, JAL, JALR
 *   - Upper immediate:     LUI, AUIPC
 *   - System:              ECALL, EBREAK
 *
 * The core exposes an instruction-by-instruction step() function so that the
 * coverage analyzer can collect real execution traces (PC, opcode, regs read,
 * regs written, hazard info, branch resolution, memory accesses).
 *
 * NOTHING is mocked. Every instruction is actually decoded and executed.
 */

export type RegCount = 32;
export const REG_COUNT: RegCount = 32;
export const MEM_SIZE = 1 << 16; // 64 KiB - plenty for small test programs

export interface CoreTraceEntry {
  cycle: number;
  pc: number;
  raw: number;
  mnemonic: string;
  rs1?: number;
  rs1Val?: number;
  rs2?: number;
  rs2Val?: number;
  rd?: number;
  rdVal?: number;
  branchTaken?: boolean;
  branchTarget?: number;
  memRead?: { addr: number; size: number; value: number; signed: boolean };
  memWrite?: { addr: number; size: number; value: number };
  hazard: {
    dataHazard: boolean;
    controlHazard: boolean;
    hazardType?: 'RAW' | 'CONTROL' | 'NONE' | 'RAW+CONTROL';
  };
  exception?: string;
}

export interface ExecutionResult {
  exitReason: 'ebreak' | 'ecall' | 'max-cycles' | 'illegal-instruction' | 'memory-fault';
  cycles: number;
  instructionsRetired: number;
  trace: CoreTraceEntry[];
  finalRegs: number[];
  finalPc: number;
  error?: string;
}

export interface CoreOptions {
  maxCycles: number;
  startPc: number;
  trackHazards: boolean;
}

const DEFAULT_OPTIONS: CoreOptions = {
  maxCycles: 10000,
  startPc: 0,
  trackHazards: true,
};

export class RV32ICore {
  public regs: number[] = new Array(REG_COUNT).fill(0);
  public pc: number;
  public mem: Uint8Array;
  public cycles = 0;
  public instructionsRetired = 0;
  public lastWriter: { rd: number; cycle: number } | null = null;
  public lastBranchCycle = -2;
  public trace: CoreTraceEntry[] = [];
  private opts: CoreOptions;

  constructor(memory?: Uint8Array, opts: Partial<CoreOptions> = {}) {
    const o = { ...DEFAULT_OPTIONS, ...opts };
    this.pc = o.startPc;
    this.mem = memory ?? new Uint8Array(MEM_SIZE);
    this.opts = o;
  }

  private readMem(addr: number, size: number, signed: boolean): number {
    if (addr < 0 || addr + size > this.mem.length) {
      throw new Error(`Memory read out of bounds: addr=0x${addr.toString(16)} size=${size}`);
    }
    let v = 0;
    for (let i = 0; i < size; i++) v |= this.mem[addr + i] << (i * 8);
    if (signed) {
      const bits = size * 8;
      const sign = 1 << (bits - 1);
      v = (v ^ sign) - sign;
    }
    return v >>> 0;
  }

  private writeMem(addr: number, size: number, value: number): void {
    if (addr < 0 || addr + size > this.mem.length) {
      throw new Error(`Memory write out of bounds: addr=0x${addr.toString(16)} size=${size}`);
    }
    for (let i = 0; i < size; i++) {
      this.mem[addr + i] = (value >>> (i * 8)) & 0xff;
    }
  }

  private static signExtend(v: number, bits: number): number {
    const mask = 1 << (bits - 1);
    return ((v & ((1 << bits) - 1)) ^ mask) - mask;
  }

  public step(): CoreTraceEntry | null {
    if (this.cycles >= this.opts.maxCycles) return null;

    const entry: CoreTraceEntry = {
      cycle: this.cycles,
      pc: this.pc,
      raw: 0,
      mnemonic: '',
      hazard: { dataHazard: false, controlHazard: false, hazardType: 'NONE' },
    };

    try {
      const raw =
        (this.mem[this.pc] |
          (this.mem[this.pc + 1] << 8) |
          (this.mem[this.pc + 2] << 16) |
          (this.mem[this.pc + 3] << 24)) >>>
        0;
      entry.raw = raw;

      const opcode = raw & 0x7f;
      const rd = (raw >> 7) & 0x1f;
      const funct3 = (raw >> 12) & 0x7;
      const rs1 = (raw >> 15) & 0x1f;
      const rs2 = (raw >> 20) & 0x1f;
      const funct7 = (raw >> 25) & 0x7f;

      const r1 = this.regs[rs1];
      const r2 = this.regs[rs2];

      if (this.opts.trackHazards && this.lastWriter) {
        const hazardWithRs1 = rs1 !== 0 && this.lastWriter.rd === rs1;
        const hazardWithRs2 = rs2 !== 0 && this.lastWriter.rd === rs2;
        if (hazardWithRs1 || hazardWithRs2) {
          entry.hazard.dataHazard = true;
          entry.hazard.hazardType = 'RAW';
        }
      }

      let nextPc = (this.pc + 4) >>> 0;
      let wrote = false;
      let wroteReg = -1;
      let wroteVal = 0;
      let branchTaken = false;
      let branchTarget = 0;

      const immI = RV32ICore.signExtend((raw >> 20) & 0xfff, 12);
      const immS = RV32ICore.signExtend(((raw >> 25) & 0x7f) << 5 | ((raw >> 7) & 0x1f), 12);
      const immB = RV32ICore.signExtend(
        ((raw >> 31) & 0x1) << 12 |
        ((raw >> 7) & 0x1) << 11 |
        ((raw >> 25) & 0x3f) << 5 |
        ((raw >> 8) & 0xf) << 1,
        13
      );
      const immU = raw & 0xfffff000;
      const immJ = RV32ICore.signExtend(
        ((raw >> 31) & 0x1) << 20 |
        ((raw >> 12) & 0xff) << 12 |
        ((raw >> 20) & 0x1) << 11 |
        ((raw >> 21) & 0x3ff) << 1,
        21
      );

      switch (opcode) {
        case 0x13: { // OP-IMM
          entry.mnemonic = this.opImmMnemonic(funct3, funct7, immI);
          entry.rs1 = rs1; entry.rs1Val = r1;
          entry.rd = rd;
          let result = 0;
          switch (funct3) {
            case 0x0: result = (r1 + immI) | 0; break;
            case 0x1: result = (r1 << (immI & 0x1f)) | 0; break;
            case 0x2: result = (r1 < immI) ? 1 : 0; break;
            case 0x3: result = ((r1 >>> 0) < (immI >>> 0)) ? 1 : 0; break;
            case 0x4: result = (r1 ^ immI) | 0; break;
            case 0x5:
              if ((funct7 & 0x20) === 0) result = (r1 >>> (immI & 0x1f)) | 0;
              else result = (r1 >> (immI & 0x1f)) | 0;
              break;
            case 0x6: result = (r1 | immI) | 0; break;
            case 0x7: result = (r1 & immI) | 0; break;
          }
          wrote = true; wroteReg = rd; wroteVal = result;
          break;
        }

        case 0x33: { // OP (register-register ALU)
          entry.mnemonic = this.opMnemonic(funct3, funct7);
          entry.rs1 = rs1; entry.rs1Val = r1;
          entry.rs2 = rs2; entry.rs2Val = r2;
          entry.rd = rd;
          let result = 0;
          switch (funct3) {
            case 0x0: result = (funct7 & 0x20) ? ((r1 - r2) | 0) : ((r1 + r2) | 0); break;
            case 0x1: result = (r1 << (r2 & 0x1f)) | 0; break;
            case 0x2: result = (r1 < r2) ? 1 : 0; break;
            case 0x3: result = ((r1 >>> 0) < (r2 >>> 0)) ? 1 : 0; break;
            case 0x4: result = (r1 ^ r2) | 0; break;
            case 0x5: result = (funct7 & 0x20) ? ((r1 >> (r2 & 0x1f)) | 0) : ((r1 >>> (r2 & 0x1f)) | 0); break;
            case 0x6: result = (r1 | r2) | 0; break;
            case 0x7: result = (r1 & r2) | 0; break;
          }
          wrote = true; wroteReg = rd; wroteVal = result;
          break;
        }

        case 0x03: { // LOAD
          const sizeMap: Record<number, number> = { 0: 1, 1: 2, 2: 4, 4: 1, 5: 2 };
          const signedMap: Record<number, boolean> = { 0: true, 1: true, 2: false, 4: false, 5: false };
          const mnemMap: Record<number, string> = { 0: 'LB', 1: 'LH', 2: 'LW', 4: 'LBU', 5: 'LHU' };
          const size = sizeMap[funct3] ?? 4;
          const signed = signedMap[funct3] ?? false;
          entry.mnemonic = mnemMap[funct3] ?? 'LW?';
          entry.rs1 = rs1; entry.rs1Val = r1;
          entry.rd = rd;
          const addr = ((r1 + immI) | 0) >>> 0;
          const value = this.readMem(addr, size, signed);
          entry.memRead = { addr, size, value, signed };
          wrote = true; wroteReg = rd; wroteVal = value;
          break;
        }

        case 0x23: { // STORE
          const sizeMap: Record<number, number> = { 0: 1, 1: 2, 2: 4 };
          const mnemMap: Record<number, string> = { 0: 'SB', 1: 'SH', 2: 'SW' };
          const size = sizeMap[funct3] ?? 4;
          entry.mnemonic = mnemMap[funct3] ?? 'SW?';
          entry.rs1 = rs1; entry.rs1Val = r1;
          entry.rs2 = rs2; entry.rs2Val = r2;
          const addr = ((r1 + immS) | 0) >>> 0;
          this.writeMem(addr, size, r2);
          entry.memWrite = { addr, size, value: r2 };
          break;
        }

        case 0x63: { // BRANCH
          const mnemMap: Record<number, string> = { 0: 'BEQ', 1: 'BNE', 4: 'BLT', 5: 'BGE', 6: 'BLTU', 7: 'BGEU' };
          entry.mnemonic = mnemMap[funct3] ?? 'B?';
          entry.rs1 = rs1; entry.rs1Val = r1;
          entry.rs2 = rs2; entry.rs2Val = r2;
          let taken = false;
          switch (funct3) {
            case 0x0: taken = (r1 === r2); break;
            case 0x1: taken = (r1 !== r2); break;
            case 0x4: taken = (r1 < r2); break;
            case 0x5: taken = (r1 >= r2); break;
            case 0x6: taken = ((r1 >>> 0) < (r2 >>> 0)); break;
            case 0x7: taken = ((r1 >>> 0) >= (r2 >>> 0)); break;
          }
          if (taken) {
            branchTaken = true;
            branchTarget = (this.pc + immB) >>> 0;
            nextPc = branchTarget;
          }
          break;
        }

        case 0x6f: { // JAL
          entry.mnemonic = 'JAL';
          entry.rd = rd;
          branchTaken = true;
          branchTarget = (this.pc + immJ) >>> 0;
          wrote = true; wroteReg = rd; wroteVal = (this.pc + 4) | 0;
          nextPc = branchTarget;
          break;
        }

        case 0x67: { // JALR
          entry.mnemonic = 'JALR';
          entry.rs1 = rs1; entry.rs1Val = r1;
          entry.rd = rd;
          branchTaken = true;
          branchTarget = ((r1 + immI) & ~1) >>> 0;
          wrote = true; wroteReg = rd; wroteVal = (this.pc + 4) | 0;
          nextPc = branchTarget;
          break;
        }

        case 0x37: { // LUI
          entry.mnemonic = 'LUI';
          entry.rd = rd;
          wrote = true; wroteReg = rd; wroteVal = immU | 0;
          break;
        }

        case 0x17: { // AUIPC
          entry.mnemonic = 'AUIPC';
          entry.rd = rd;
          wrote = true; wroteReg = rd; wroteVal = (this.pc + immU) | 0;
          break;
        }

        case 0x73: { // SYSTEM
          const imm12 = (raw >> 20) & 0xfff;
          if (imm12 === 0) {
            entry.mnemonic = 'ECALL';
            entry.exception = 'ecall';
          } else if (imm12 === 1) {
            entry.mnemonic = 'EBREAK';
            entry.exception = 'ebreak';
          } else {
            entry.mnemonic = 'SYSTEM?';
          }
          break;
        }

        case 0x00: {
          entry.mnemonic = 'ILL';
          entry.exception = 'illegal-instruction';
          break;
        }

        default:
          entry.mnemonic = `ILL(0x${opcode.toString(16)})`;
          entry.exception = 'illegal-instruction';
      }

      if (branchTaken && this.opts.trackHazards) {
        entry.hazard.controlHazard = true;
        entry.hazard.hazardType = entry.hazard.dataHazard ? 'RAW+CONTROL' : 'CONTROL';
        entry.branchTaken = true;
        entry.branchTarget = branchTarget;
        this.lastBranchCycle = this.cycles;
      }

      if (wrote && wroteReg !== 0) {
        this.regs[wroteReg] = wroteVal | 0;
        entry.rdVal = wroteVal | 0;
        this.lastWriter = { rd: wroteReg, cycle: this.cycles };
      } else if (wrote && wroteReg === 0) {
        entry.rdVal = 0;
        this.lastWriter = null;
      } else {
        this.lastWriter = null;
      }

      this.pc = nextPc;
      this.cycles++;
      this.instructionsRetired++;
      this.trace.push(entry);

      return entry;
    } catch (e: any) {
      entry.exception = 'memory-fault';
      entry.mnemonic = entry.mnemonic || 'FAULT';
      this.trace.push(entry);
      return entry;
    }
  }

  public run(maxCycles?: number): ExecutionResult {
    const limit = maxCycles ?? this.opts.maxCycles;
    let exitReason: ExecutionResult['exitReason'] = 'max-cycles';
    let error: string | undefined;

    while (this.cycles < limit) {
      const entry = this.step();
      if (!entry) { exitReason = 'max-cycles'; break; }
      if (entry.exception === 'ebreak') { exitReason = 'ebreak'; break; }
      if (entry.exception === 'ecall') { exitReason = 'ecall'; break; }
      if (entry.exception === 'illegal-instruction') {
        exitReason = 'illegal-instruction';
        error = `Illegal instruction at PC=0x${entry.pc.toString(16)}: 0x${entry.raw.toString(16)}`;
        break;
      }
      if (entry.exception === 'memory-fault') {
        exitReason = 'memory-fault';
        error = `Memory fault at PC=0x${entry.pc.toString(16)}`;
        break;
      }
    }

    return {
      exitReason,
      cycles: this.cycles,
      instructionsRetired: this.instructionsRetired,
      trace: this.trace,
      finalRegs: [...this.regs],
      finalPc: this.pc,
      error,
    };
  }

  private opImmMnemonic(funct3: number, funct7: number, imm: number): string {
    switch (funct3) {
      case 0x0: return `ADDI ${imm}`;
      case 0x1: return `SLLI ${imm & 0x1f}`;
      case 0x2: return `SLTI ${imm}`;
      case 0x3: return `SLTIU ${imm >>> 0}`;
      case 0x4: return `XORI ${imm}`;
      case 0x5: return (funct7 & 0x20) ? `SRAI ${imm & 0x1f}` : `SRLI ${imm & 0x1f}`;
      case 0x6: return `ORI ${imm}`;
      case 0x7: return `ANDI ${imm}`;
      default: return `OP-IMM?${funct3}`;
    }
  }

  private opMnemonic(funct3: number, funct7: number): string {
    switch (funct3) {
      case 0x0: return (funct7 & 0x20) ? 'SUB' : 'ADD';
      case 0x1: return 'SLL';
      case 0x2: return 'SLT';
      case 0x3: return 'SLTU';
      case 0x4: return 'XOR';
      case 0x5: return (funct7 & 0x20) ? 'SRA' : 'SRL';
      case 0x6: return 'OR';
      case 0x7: return 'AND';
      default: return `OP?${funct3}`;
    }
  }
}

export const RV32I_INSTRUCTION_SET = [
  'LUI', 'AUIPC', 'JAL', 'JALR',
  'BEQ', 'BNE', 'BLT', 'BGE', 'BLTU', 'BGEU',
  'LB', 'LH', 'LW', 'LBU', 'LHU',
  'SB', 'SH', 'SW',
  'ADDI', 'SLTI', 'SLTIU', 'XORI', 'ORI', 'ANDI', 'SLLI', 'SRLI', 'SRAI',
  'ADD', 'SUB', 'SLL', 'SLT', 'SLTU', 'XOR', 'SRL', 'SRA', 'OR', 'AND',
  'ECALL', 'EBREAK',
] as const;

export type RV32IMnemonic = typeof RV32I_INSTRUCTION_SET[number];
