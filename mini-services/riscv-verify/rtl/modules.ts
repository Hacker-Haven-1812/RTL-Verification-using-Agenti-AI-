

export interface RtlModule {
  name: string;
  description: string;
  verilogSource: string;
  ports: { name: string; direction: 'input' | 'output'; width: number; description: string }[];

  behavior: (inputs: Record<string, number>) => Record<string, number>;
}


export const ALU_MODULE: RtlModule = {
  name: 'rv32i_alu',
  description:
    'RV32I Arithmetic Logic Unit. Computes all 10 base-ISA ALU operations ' +
    '(ADD, SUB, SLL, SLT, SLTU, XOR, SRL, SRA, OR, AND) selected by a 4-bit ' +
    'alu_ctrl field. Output is 32-bit wide; the SLT/SLTU ops produce 0/1.',
  verilogSource: `module rv32i_alu (
    input  [31:0] operand_a,
    input  [31:0] operand_b,
    input  [3:0]  alu_ctrl,      // 4-bit ALU operation selector
    output reg [31:0] alu_result,
    output        zero_flag      // 1 when alu_result == 0
);
  localparam ALU_ADD  = 4'b0000;
  localparam ALU_SUB  = 4'b0001;
  localparam ALU_SLL  = 4'b0010;
  localparam ALU_SLT  = 4'b0011;
  localparam ALU_SLTU = 4'b0100;
  localparam ALU_XOR  = 4'b0101;
  localparam ALU_SRL  = 4'b0110;
  localparam ALU_SRA  = 4'b0111;
  localparam ALU_OR   = 4'b1000;
  localparam ALU_AND  = 4'b1001;

  wire [4:0] shamt = operand_b[4:0];

  always @(*) begin
    case (alu_ctrl)
      ALU_ADD  : alu_result = operand_a + operand_b;
      ALU_SUB  : alu_result = operand_a - operand_b;
      ALU_SLL  : alu_result = operand_a << shamt;
      ALU_SLT  : alu_result = ($signed(operand_a) < $signed(operand_b)) ? 32'b1 : 32'b0;
      ALU_SLTU : alu_result = (operand_a < operand_b) ? 32'b1 : 32'b0;
      ALU_XOR  : alu_result = operand_a ^ operand_b;
      ALU_SRL  : alu_result = operand_a >> shamt;
      ALU_SRA  : alu_result = $signed(operand_a) >>> shamt;
      ALU_OR   : alu_result = operand_a | operand_b;
      ALU_AND  : alu_result = operand_a & operand_b;
      default  : alu_result = 32'b0;
    endcase
  end

  assign zero_flag = (alu_result == 32'b0);
endmodule`,
  ports: [
    { name: 'operand_a', direction: 'input', width: 32, description: 'First operand (typically rs1)' },
    { name: 'operand_b', direction: 'input', width: 32, description: 'Second operand (typically rs2 or sign-extended immediate)' },
    { name: 'alu_ctrl', direction: 'input', width: 4, description: 'Operation selector (one-hot encoding)' },
    { name: 'alu_result', direction: 'output', width: 32, description: '32-bit ALU result' },
    { name: 'zero_flag', direction: 'output', width: 1, description: 'High when alu_result == 0' },
  ],
  behavior: (i) => {
    const a = i.operand_a | 0;
    const b = i.operand_b | 0;
    const ctrl = i.alu_ctrl & 0xf;
    let result = 0;
    switch (ctrl) {
      case 0x0: result = (a + b) | 0; break;
      case 0x1: result = (a - b) | 0; break;
      case 0x2: result = (a << (b & 0x1f)) | 0; break;
      case 0x3: result = (a < b) ? 1 : 0; break;
      case 0x4: result = ((a >>> 0) < (b >>> 0)) ? 1 : 0; break;
      case 0x5: result = (a ^ b) | 0; break;
      case 0x6: result = (a >>> (b & 0x1f)) | 0; break;
      case 0x7: result = (a >> (b & 0x1f)) | 0; break;
      case 0x8: result = (a | b) | 0; break;
      case 0x9: result = (a & b) | 0; break;
      default: result = 0;
    }
    return { alu_result: result >>> 0, zero_flag: (result === 0) ? 1 : 0 };
  },
};


export const REGFILE_MODULE: RtlModule = {
  name: 'rv32i_regfile',
  description:
    'RV32I Register File. 32 × 32-bit registers, two combinational read ports, ' +
    'one synchronous write port. Register x0 is hardwired to zero (writes discarded).',
  verilogSource: `module rv32i_regfile (
    input         clk,
    input         we,            // write enable
    input  [4:0]  waddr,
    input  [31:0] wdata,
    input  [4:0]  raddr1,
    input  [4:0]  raddr2,
    output [31:0] rdata1,
    output [31:0] rdata2
);
  reg [31:0] regs [0:31];
  integer i;
  initial begin
    for (i = 0; i < 32; i = i + 1) regs[i] = 32'b0;
  end

  always @(posedge clk) begin
    if (we && waddr != 5'b0) regs[waddr] <= wdata;
  end

  assign rdata1 = (raddr1 == 5'b0) ? 32'b0 : regs[raddr1];
  assign rdata2 = (raddr2 == 5'b0) ? 32'b0 : regs[raddr2];
endmodule`,
  ports: [
    { name: 'clk', direction: 'input', width: 1, description: 'Clock' },
    { name: 'we', direction: 'input', width: 1, description: 'Write enable' },
    { name: 'waddr', direction: 'input', width: 5, description: 'Write address' },
    { name: 'wdata', direction: 'input', width: 32, description: 'Write data' },
    { name: 'raddr1', direction: 'input', width: 5, description: 'Read port 1 address' },
    { name: 'raddr2', direction: 'input', width: 5, description: 'Read port 2 address' },
    { name: 'rdata1', direction: 'output', width: 32, description: 'Read port 1 data' },
    { name: 'rdata2', direction: 'output', width: 32, description: 'Read port 2 data' },
  ],
  behavior: (i) => {


    const state: number[] = (i as any).__state ?? new Array(32).fill(0);
    const we = i.we & 1;
    const waddr = i.waddr & 0x1f;
    const wdata = i.wdata | 0;
    const raddr1 = i.raddr1 & 0x1f;
    const raddr2 = i.raddr2 & 0x1f;
    const rdata1 = (raddr1 === 0) ? 0 : state[raddr1];
    const rdata2 = (raddr2 === 0) ? 0 : state[raddr2];

    if (we && waddr !== 0) state[waddr] = wdata | 0;
    return { rdata1: rdata1 >>> 0, rdata2: rdata2 >>> 0, __state: state };
  },
};

export const ALL_RTL_MODULES: RtlModule[] = [ALU_MODULE, REGFILE_MODULE];

export function getRtlModule(name: string): RtlModule | undefined {
  return ALL_RTL_MODULES.find(m => m.name === name);
}
