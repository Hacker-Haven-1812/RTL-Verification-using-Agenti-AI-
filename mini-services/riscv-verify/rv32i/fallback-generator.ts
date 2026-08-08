/**
 * Deterministic Fallback Program Generator
 * -----------------------------------------
 * When the LLM is unavailable (rate-limited or errored), this module generates
 * a real RV32I assembly program that targets the SPECIFIC missing instructions.
 *
 * This is NOT a mock — it produces real, runnable assembly that exercises the
 * exact instructions in the missing list. Each instruction gets a real test
 * case with proper operands and control flow.
 *
 * The generator builds programs instruction-family by instruction-family,
 * ensuring every missing instruction is actually executed.
 */

const ALL_INSTRUCTIONS = [
  'LUI', 'AUIPC', 'JAL', 'JALR',
  'BEQ', 'BNE', 'BLT', 'BGE', 'BLTU', 'BGEU',
  'LB', 'LH', 'LW', 'LBU', 'LHU',
  'SB', 'SH', 'SW',
  'ADDI', 'SLTI', 'SLTIU', 'XORI', 'ORI', 'ANDI', 'SLLI', 'SRLI', 'SRAI',
  'ADD', 'SUB', 'SLL', 'SLT', 'SLTU', 'XOR', 'SRL', 'SRA', 'OR', 'AND',
  'ECALL', 'EBREAK',
];

// Template snippets that exercise specific instructions.
// Each snippet is a self-contained block that can be concatenated.
const INSTRUCTION_TEMPLATES: Record<string, string> = {
  LUI: `  lui t0, 0x10000     # LUI: load upper immediate`,
  AUIPC: `  auipc t1, 0x10      # AUIPC: PC-relative upper immediate`,
  JAL: `  jal ra, jal_target
jal_back:
  j after_jal
jal_target:
  addi a0, a0, 1
  jal x0, jal_back
after_jal:`,
  JALR: `  # JALR: use auipc + addi to compute target address, then jalr
  auipc t2, 0
  addi t2, t2, 16      # point to jalr_target (4 instructions ahead = 16 bytes)
  jalr ra, t2, 0
jalr_back:
  j after_jalr
jalr_target:
  addi a1, a1, 1
  jalr x0, ra, 0
after_jalr:`,
  BEQ: `  li t3, 5
  li t4, 5
  beq t3, t4, beq_taken    # BEQ taken
  addi a2, a2, 99           # skipped
beq_taken:
  li t5, 6
  beq t3, t5, beq_not_taken # BEQ not taken
  addi a3, a3, 1            # executed
beq_not_taken:`,
  BNE: `  li t3, 5
  li t4, 6
  bne t3, t4, bne_taken     # BNE taken
  addi a2, a2, 99           # skipped
bne_taken:
  li t5, 5
  bne t3, t5, bne_not_taken # BNE not taken
  addi a3, a3, 1            # executed
bne_not_taken:`,
  BLT: `  li t3, 3
  li t4, 7
  blt t3, t4, blt_taken     # BLT taken (3 < 7)
  addi a2, a2, 99
blt_taken:
  blt t4, t3, blt_nt        # BLT not taken (7 !< 3)
  addi a3, a3, 1
blt_nt:`,
  BGE: `  li t3, 7
  li t4, 3
  bge t3, t4, bge_taken     # BGE taken (7 >= 3)
  addi a2, a2, 99
bge_taken:
  bge t4, t3, bge_nt        # BGE not taken (3 !>= 7)
  addi a3, a3, 1
bge_nt:`,
  BLTU: `  li t3, 3
  li t4, 7
  bltu t3, t4, bltu_taken   # BLTU taken
  addi a2, a2, 99
bltu_taken:
  bltu t4, t3, bltu_nt      # BLTU not taken
  addi a3, a3, 1
bltu_nt:`,
  BGEU: `  li t3, 7
  li t4, 3
  bgeu t3, t4, bgeu_taken   # BGEU taken
  addi a2, a2, 99
bgeu_taken:
  bgeu t4, t3, bgeu_nt      # BGEU not taken
  addi a3, a3, 1
bgeu_nt:`,
  LB: `  li t0, 0x1000
  li t1, 0x1234
  sh t1, 0(t0)
  lb t2, 0(t0)              # LB: load byte (signed)`,
  LH: `  li t0, 0x1002
  li t1, 0x5678
  sw t1, 0(t0)
  lh t2, 0(t0)              # LH: load halfword (signed)`,
  LW: `  li t0, 0x1004
  li t1, 0xABCDEF01
  sw t1, 0(t0)
  lw t2, 0(t0)              # LW: load word`,
  LBU: `  li t0, 0x1006
  li t1, 0xFF
  sb t1, 0(t0)
  lbu t2, 0(t0)             # LBU: load byte unsigned`,
  LHU: `  li t0, 0x1008
  li t1, 0xFFFF
  sh t1, 0(t0)
  lhu t2, 0(t0)             # LHU: load halfword unsigned`,
  SB: `  li t0, 0x1010
  li t1, 0x42
  sb t1, 0(t0)              # SB: store byte`,
  SH: `  li t0, 0x1012
  li t1, 0x4242
  sh t1, 0(t0)              # SH: store halfword`,
  SW: `  li t0, 0x1014
  li t1, 0xDEADBEEF
  sw t1, 0(t0)              # SW: store word`,
  ADDI: `  li t0, 100
  addi t1, t0, 50           # ADDI: 150
  addi t2, t0, -50          # ADDI negative: 50`,
  SLTI: `  li t0, 5
  slti t1, t0, 10           # SLTI: 1 (5 < 10)
  slti t2, t0, 3            # SLTI: 0 (5 !< 3)`,
  SLTIU: `  li t0, 5
  sltiu t1, t0, 10          # SLTIU: 1
  sltiu t2, t0, 3           # SLTIU: 0`,
  XORI: `  li t0, 0xF0
  xori t1, t0, 0x0F         # XORI: 0xFF`,
  ORI: `  li t0, 0xF0
  ori t1, t0, 0x0F          # ORI: 0xFF`,
  ANDI: `  li t0, 0xFF
  andi t1, t0, 0x0F         # ANDI: 0x0F`,
  SLLI: `  li t0, 1
  slli t1, t0, 4            # SLLI: 16`,
  SRLI: `  li t0, 256
  srli t1, t0, 4            # SRLI: 16`,
  SRAI: `  li t0, -256
  srai t1, t0, 4            # SRAI: -16 (arithmetic)`,
  ADD: `  li t0, 100
  li t1, 200
  add t2, t0, t1            # ADD: 300`,
  SUB: `  li t0, 200
  li t1, 50
  sub t2, t0, t1            # SUB: 150`,
  SLL: `  li t0, 1
  li t1, 4
  sll t2, t0, t1            # SLL: 16`,
  SLT: `  li t0, 3
  li t1, 7
  slt t2, t0, t1            # SLT: 1 (signed)`,
  SLTU: `  li t0, 3
  li t1, 7
  sltu t2, t0, t1           # SLTU: 1 (unsigned)`,
  XOR: `  li t0, 0xF0
  li t1, 0x0F
  xor t2, t0, t1            # XOR: 0xFF`,
  SRL: `  li t0, 256
  li t1, 4
  srl t2, t0, t1            # SRL: 16`,
  SRA: `  li t0, -256
  li t1, 4
  sra t2, t0, t1            # SRA: -16`,
  OR: `  li t0, 0xF0
  li t1, 0x0F
  or t2, t0, t1             # OR: 0xFF`,
  AND: `  li t0, 0xFF
  li t1, 0x0F
  and t2, t0, t1            # AND: 0x0F`,
  ECALL: `  ecall`,
  EBREAK: `  ebreak`,
};

/**
 * Generate a program that exercises the given missing instructions.
 * Uses unique labels per instruction to avoid duplicate-label errors.
 */
export function generateFallbackProgram(missingInstructions: string[], iteration: number): string {
  const lines: string[] = [];
  lines.push(`# Auto-generated test program (iteration ${iteration})`);
  lines.push(`# Targeting ${missingInstructions.length} missing instructions:`);
  lines.push(`# ${missingInstructions.join(', ')}`);
  lines.push(``);

  lines.push(`main:`);
  lines.push(`  li sp, 0x2000      # set up stack pointer`);

  // Add templates for each missing instruction with UNIQUE labels.
  const toTarget = missingInstructions.slice(0, 25);

  // If there are no missing instructions but we haven't met the goal yet,
  // generate a broad program to improve OTHER coverage dimensions (branches,
  // registers, hazards, functional scenarios).
  if (toTarget.length === 0) {
    lines.push(``);
    lines.push(`  # All instructions hit — generating broad program to improve other coverage dimensions`);
    // Use a diverse subset to exercise different registers, branches, and memory
    const broadSet = ['LUI', 'AUIPC', 'ADDI', 'SLTI', 'XORI', 'ORI', 'ANDI', 'SLLI', 'SRLI', 'SRAI',
                      'ADD', 'SUB', 'SLL', 'SLT', 'SLTU', 'XOR', 'SRL', 'SRA', 'OR', 'AND',
                      'BEQ', 'BNE', 'BLT', 'BGE', 'BLTU', 'BGEU',
                      'SW', 'SH', 'SB', 'LW', 'LH', 'LB', 'LHU', 'LBU',
                      'JAL', 'JALR', 'ECALL'];
    toTarget.push(...broadSet);
  }

  let labelCounter = 0;
  for (const instr of toTarget) {
    const template = INSTRUCTION_TEMPLATES[instr];
    if (template) {
      // Make all labels unique by appending _N to label definitions and references.
      const suffix = `_${labelCounter++}`;
      const labelDefs = [...template.matchAll(/^(\w+):/gm)].map(m => m[1]);
      let uniqueTemplate = template;
      for (const label of labelDefs) {
        uniqueTemplate = uniqueTemplate.replace(new RegExp(`\\b${label}\\b`, 'g'), `${label}${suffix}`);
      }
      lines.push(``);
      lines.push(`  # --- ${instr} ---`);
      lines.push(uniqueTemplate);
    }
  }

  // Always end with ebreak
  if (!toTarget.includes('EBREAK')) {
    lines.push(`  ebreak`);
  }

  return lines.join('\n');
}

/**
 * For iteration 1 (no missing list yet), generate a broad program covering
 * many instruction families.
 */
export function generateBroadProgram(): string {
  const families = [
    ['LUI', 'AUIPC', 'ADDI', 'SLTI', 'SLTIU', 'XORI', 'ORI', 'ANDI'],
    ['ADD', 'SUB', 'SLL', 'SLT', 'SLTU', 'XOR', 'SRL', 'SRA', 'OR', 'AND'],
    ['SLLI', 'SRLI', 'SRAI'],
    ['BEQ', 'BNE', 'BLT', 'BGE', 'BLTU', 'BGEU'],
    ['SW', 'SH', 'SB', 'LW', 'LH', 'LB', 'LHU', 'LBU'],
    ['JAL', 'JALR'],
    ['ECALL'],
  ];

  const lines: string[] = [];
  lines.push(`# Broad coverage test program (iteration 1)`);
  lines.push(`# Covers all major RV32I instruction families`);
  lines.push(``);
  lines.push(`main:`);
  lines.push(`  li sp, 0x2000`);

  for (const family of families) {
    lines.push(``);
    lines.push(`  # --- ${family[0]} family ---`);
    for (const instr of family) {
      const template = INSTRUCTION_TEMPLATES[instr];
      if (template) lines.push(template);
    }
  }

  lines.push(`  ebreak`);
  return lines.join('\n');
}
