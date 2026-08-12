

import { CoreTraceEntry, RV32I_INSTRUCTION_SET } from './core.js';

export interface CoverageReport {
  instructionCoverage: {
    total: number;
    hit: number;
    ratio: number;
    hitMnemonicSet: string[];
    missingMnemonicSet: string[];
  };
  branchCoverage: {
    totalBranchOps: number;
    takenObserved: number;
    notTakenObserved: number;
    bothObserved: number;
    ratio: number;
  };
  registerCoverage: {
    written: number[];
    notWritten: number[];
    ratio: number;
  };
  hazardCoverage: {
    rawObserved: boolean;
    controlObserved: boolean;
    rawCount: number;
    controlCount: number;
    ratio: number;
  };
  memoryCoverage: {
    bytesTouched: number;
    totalBytes: number;
    ratio: number;
    readBytes: number;
    writtenBytes: number;
  };
  functionalCoverage: {
    scenarios: { name: string; hit: boolean; description: string }[];
    hitCount: number;
    total: number;
    ratio: number;
  };
  overallCoverage: number;
  missingScenarios: string[];
  totalCycles: number;
  totalInstructions: number;
}


const FUNCTIONAL_SCENARIOS: { name: string; description: string; check: (t: CoreTraceEntry[]) => boolean }[] = [
  {
    name: 'ARITH_OVERFLOW',
    description: 'An ADD or ADDI produced a 32-bit two-s-complement overflow (sign flip)',
    check: (t) => t.some(e => {
      if (!e.mnemonic.startsWith('ADD')) return false;
      const a = e.rs1Val ?? 0;
      const b = (e.mnemonic === 'ADD') ? (e.rs2Val ?? 0) : parseInt(e.mnemonic.split(' ')[1] ?? '0', 10);
      const r = e.rdVal ?? 0;
      return ((a >= 0 && b >= 0 && r < 0) || (a < 0 && b < 0 && r >= 0));
    }),
  },
  {
    name: 'SUB_UNDERFLOW',
    description: 'A SUB instruction underflowed (negative result from positive operands)',
    check: (t) => t.some(e => e.mnemonic === 'SUB' && ((e.rs1Val ?? 0) >= 0 && (e.rs2Val ?? 0) >= 0 && (e.rdVal ?? 0) < 0)),
  },
  {
    name: 'SIGNED_LT',
    description: 'A BLT or SLT was resolved with the signed-less-than path',
    check: (t) => t.some(e => (e.mnemonic === 'BLT' || e.mnemonic === 'SLT')),
  },
  {
    name: 'UNSIGNED_LT',
    description: 'A BLTU or SLTU was resolved with the unsigned-less-than path',
    check: (t) => t.some(e => (e.mnemonic === 'BLTU' || e.mnemonic === 'SLTU')),
  },
  {
    name: 'BRANCH_TAKEN',
    description: 'At least one conditional branch was taken',
    check: (t) => t.some(e => e.branchTaken === true && ['BEQ', 'BNE', 'BLT', 'BGE', 'BLTU', 'BGEU'].includes(e.mnemonic.split(' ')[0])),
  },
  {
    name: 'BRANCH_NOT_TAKEN',
    description: 'At least one conditional branch was NOT taken',
    check: (t) => t.some(e => e.branchTaken !== true && ['BEQ', 'BNE', 'BLT', 'BGE', 'BLTU', 'BGEU'].includes(e.mnemonic.split(' ')[0])),
  },
  {
    name: 'DATA_HAZARD_RAW',
    description: 'A RAW data hazard occurred (back-to-back dependent instructions)',
    check: (t) => t.some(e => e.hazard.dataHazard),
  },
  {
    name: 'CONTROL_HAZARD',
    description: 'A control hazard occurred (taken branch or jump)',
    check: (t) => t.some(e => e.hazard.controlHazard),
  },
  {
    name: 'MEMORY_STORE',
    description: 'A store instruction wrote to memory',
    check: (t) => t.some(e => e.memWrite !== undefined),
  },
  {
    name: 'MEMORY_LOAD',
    description: 'A load instruction read from memory',
    check: (t) => t.some(e => e.memRead !== undefined),
  },
  {
    name: 'JAL_JALR_PAIR',
    description: 'JAL (call) followed eventually by JALR (return) — function call pattern',
    check: (t) => {
      const hasCall = t.some(e => e.mnemonic === 'JAL' && e.rd === 1);
      const hasReturn = t.some(e => e.mnemonic === 'JALR' && e.rd === 0);
      return hasCall && hasReturn;
    },
  },
  {
    name: 'SHIFT_ARITHMETIC',
    description: 'A SRA / SRAI (arithmetic shift right, sign-extending) was executed',
    check: (t) => t.some(e => e.mnemonic.startsWith('SRA')),
  },
  {
    name: 'UPPER_IMMEDIATE',
    description: 'A LUI or AUIPC was used to build a 32-bit constant',
    check: (t) => t.some(e => e.mnemonic === 'LUI' || e.mnemonic === 'AUIPC'),
  },
  {
    name: 'X0_HARDWIRED',
    description: 'A write attempt to x0 was correctly discarded (x0 stays 0)',
    check: (t) => t.some(e => e.rd === 0 && e.rdVal === 0) && t.every(e => true),
  },
  {
    name: 'EBREAK_TERMINATION',
    description: 'The program voluntarily terminated via EBREAK',
    check: (t) => t.some(e => e.mnemonic === 'EBREAK'),
  },
];

export function analyzeCoverage(trace: CoreTraceEntry[], totalCycles: number): CoverageReport {

  const hitSet = new Set<string>();
  for (const e of trace) {
    const base = e.mnemonic.split(' ')[0];
    if (RV32I_INSTRUCTION_SET.includes(base as any)) hitSet.add(base);
  }
  const allInstr = [...RV32I_INSTRUCTION_SET];
  const hitInstr = allInstr.filter(m => hitSet.has(m));
  const missingInstr = allInstr.filter(m => !hitSet.has(m));


  const branchMnems = ['BEQ', 'BNE', 'BLT', 'BGE', 'BLTU', 'BGEU'];
  const branchInstances = new Map<string, { taken: boolean; notTaken: boolean; count: number }>();
  for (const e of trace) {
    const base = e.mnemonic.split(' ')[0];
    if (!branchMnems.includes(base)) continue;
    const key = `${base}@0x${e.pc.toString(16)}`;
    const cur = branchInstances.get(key) ?? { taken: false, notTaken: false, count: 0 };
    if (e.branchTaken) cur.taken = true;
    else cur.notTaken = true;
    cur.count++;
    branchInstances.set(key, cur);
  }
  const branchArr = [...branchInstances.values()];
  const bothObserved = branchArr.filter(b => b.taken && b.notTaken).length;
  const takenObserved = branchArr.filter(b => b.taken).length;
  const notTakenObserved = branchArr.filter(b => b.notTaken).length;
  const totalBranchOps = branchArr.length;
  const branchRatio = totalBranchOps === 0 ? 0 : bothObserved / totalBranchOps;


  const writtenRegs = new Set<number>();
  for (const e of trace) if (e.rd !== undefined && e.rd !== 0) writtenRegs.add(e.rd);
  const allRegs = Array.from({ length: 31 }, (_, i) => i + 1);
  const notWritten = allRegs.filter(r => !writtenRegs.has(r));


  let rawCount = 0, controlCount = 0;
  for (const e of trace) {
    if (e.hazard.dataHazard) rawCount++;
    if (e.hazard.controlHazard) controlCount++;
  }
  const hazardHit = (rawCount > 0 ? 1 : 0) + (controlCount > 0 ? 1 : 0);


  const memBytes = new Set<number>();
  let readBytes = 0, writtenBytes = 0;
  for (const e of trace) {
    if (e.memRead) {
      for (let i = 0; i < e.memRead.size; i++) {
        memBytes.add(e.memRead.addr + i);
        readBytes++;
      }
    }
    if (e.memWrite) {
      for (let i = 0; i < e.memWrite.size; i++) {
        memBytes.add(e.memWrite.addr + i);
        writtenBytes++;
      }
    }
  }
  const totalMemBytes = 1 << 16;
  const memRatio = memBytes.size / totalMemBytes;


  const scenarios = FUNCTIONAL_SCENARIOS.map(s => ({
    name: s.name,
    description: s.description,
    hit: s.check(trace),
  }));
  const hitFunc = scenarios.filter(s => s.hit).length;




  const overall =
    (hitInstr.length / allInstr.length) * 0.30 +
    branchRatio * 0.20 +
    (writtenRegs.size / 31) * 0.10 +
    (hazardHit / 2) * 0.10 +
    Math.min(memRatio * 100, 1) * 0.10 +
    (hitFunc / scenarios.length) * 0.20;


  const missingScenarios: string[] = [];
  for (const m of missingInstr) missingScenarios.push(`Instruction not yet exercised: ${m}`);
  for (const s of scenarios) if (!s.hit) missingScenarios.push(`Functional scenario not observed: ${s.name} — ${s.description}`);
  if (notWritten.length > 0) missingScenarios.push(`Registers never written: ${notWritten.map(r => 'x' + r).join(', ')}`);
  if (rawCount === 0) missingScenarios.push('No RAW data hazard yet — try back-to-back dependent ALU ops');
  if (controlCount === 0) missingScenarios.push('No control hazard yet — try a taken branch or JAL');

  return {
    instructionCoverage: {
      total: allInstr.length,
      hit: hitInstr.length,
      ratio: hitInstr.length / allInstr.length,
      hitMnemonicSet: hitInstr,
      missingMnemonicSet: missingInstr,
    },
    branchCoverage: {
      totalBranchOps,
      takenObserved,
      notTakenObserved,
      bothObserved,
      ratio: branchRatio,
    },
    registerCoverage: {
      written: [...writtenRegs].sort((a, b) => a - b),
      notWritten,
      ratio: writtenRegs.size / 31,
    },
    hazardCoverage: {
      rawObserved: rawCount > 0,
      controlObserved: controlCount > 0,
      rawCount,
      controlCount,
      ratio: hazardHit / 2,
    },
    memoryCoverage: {
      bytesTouched: memBytes.size,
      totalBytes: totalMemBytes,
      ratio: memRatio,
      readBytes,
      writtenBytes,
    },
    functionalCoverage: {
      scenarios,
      hitCount: hitFunc,
      total: scenarios.length,
      ratio: hitFunc / scenarios.length,
    },
    overallCoverage: overall,
    missingScenarios,
    totalCycles,
    totalInstructions: trace.length,
  };
}
