'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Real RTL module sources — these are the actual designs under verification.
// Sourced from /mini-services/riscv-verify/rtl/modules.ts (duplicated here for
// client display since we cannot import server code from client components).
const RTL_MODULES = [
  {
    name: 'rv32i_alu',
    description: 'RV32I Arithmetic Logic Unit. Computes all 10 base-ISA ALU operations (ADD, SUB, SLL, SLT, SLTU, XOR, SRL, SRA, OR, AND) selected by a 4-bit alu_ctrl field.',
    ports: [
      { name: 'operand_a', dir: 'input', width: 32, desc: 'First operand (rs1)' },
      { name: 'operand_b', dir: 'input', width: 32, desc: 'Second operand (rs2 or imm)' },
      { name: 'alu_ctrl', dir: 'input', width: 4, desc: 'Operation selector (one-hot)' },
      { name: 'alu_result', dir: 'output', width: 32, desc: '32-bit ALU result' },
      { name: 'zero_flag', dir: 'output', width: 1, desc: 'High when alu_result == 0' },
    ],
    verilog: `module rv32i_alu (
    input  [31:0] operand_a,
    input  [31:0] operand_b,
    input  [3:0]  alu_ctrl,
    output reg [31:0] alu_result,
    output        zero_flag
);
  localparam ALU_ADD  = 4'b0000;
  localparam ALU_SUB  = 4'b0001;
  // ... (8 more opcodes)
  wire [4:0] shamt = operand_b[4:0];
  always @(*) begin
    case (alu_ctrl)
      ALU_ADD  : alu_result = operand_a + operand_b;
      ALU_SUB  : alu_result = operand_a - operand_b;
      ALU_SLL  : alu_result = operand_a << shamt;
      ALU_SLT  : alu_result = ($signed(operand_a) < $signed(operand_b)) ? 1 : 0;
      ALU_SLTU : alu_result = (operand_a < operand_b) ? 1 : 0;
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
  },
  {
    name: 'rv32i_regfile',
    description: 'RV32I Register File. 32 × 32-bit registers, two combinational read ports, one synchronous write port. Register x0 is hardwired to zero.',
    ports: [
      { name: 'clk', dir: 'input', width: 1, desc: 'Clock' },
      { name: 'we', dir: 'input', width: 1, desc: 'Write enable' },
      { name: 'waddr', dir: 'input', width: 5, desc: 'Write address' },
      { name: 'wdata', dir: 'input', width: 32, desc: 'Write data' },
      { name: 'raddr1', dir: 'input', width: 5, desc: 'Read port 1 address' },
      { name: 'raddr2', dir: 'input', width: 5, desc: 'Read port 2 address' },
      { name: 'rdata1', dir: 'output', width: 32, desc: 'Read port 1 data' },
      { name: 'rdata2', dir: 'output', width: 32, desc: 'Read port 2 data' },
    ],
    verilog: `module rv32i_regfile (
    input         clk,
    input         we,
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
  // Synchronous write — x0 hardwired to zero
  always @(posedge clk) begin
    if (we && waddr != 5'b0) regs[waddr] <= wdata;
  end
  // Combinational read
  assign rdata1 = (raddr1 == 5'b0) ? 32'b0 : regs[raddr1];
  assign rdata2 = (raddr2 == 5'b0) ? 32'b0 : regs[raddr2];
endmodule`,
  },
];

interface Props {
  activeModules: string[];
}

export function RtlModuleViewer({ activeModules }: Props) {
  const [selected, setSelected] = useState(RTL_MODULES[0].name);
  const mod = RTL_MODULES.find(m => m.name === selected) ?? RTL_MODULES[0];

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Design Under Verification</CardTitle>
          <div className="flex gap-1">
            {RTL_MODULES.map((m) => (
              <button
                key={m.name}
                onClick={() => setSelected(m.name)}
                className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                  selected === m.name
                    ? 'border-primary/40 text-primary bg-primary/5'
                    : 'border-border text-muted-foreground hover:bg-muted/50'
                }`}
              >
                {m.name}
                {activeModules.includes(m.name) && (
                  <span className="ml-1 inline-block h-1 w-1 rounded-full bg-primary"></span>
                )}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <Tabs defaultValue="verilog" className="h-full flex flex-col">
          <TabsList className="mx-3 mt-2 self-start">
            <TabsTrigger value="verilog" className="text-[11px]">Verilog</TabsTrigger>
            <TabsTrigger value="ports" className="text-[11px]">Ports</TabsTrigger>
          </TabsList>
          <TabsContent value="verilog" className="flex-1 min-h-0 mt-0">
            <ScrollArea className="h-full max-h-[280px]">
              <pre className="font-mono text-[10px] leading-relaxed p-3 whitespace-pre overflow-x-auto">
                {mod.verilog}
              </pre>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="ports" className="flex-1 min-h-0 mt-0">
            <ScrollArea className="h-full max-h-[280px]">
              <div className="p-3 space-y-2">
                <p className="text-[11px] text-muted-foreground">{mod.description}</p>
                <div className="rounded-md border border-border/60 overflow-hidden">
                  <div className="grid grid-cols-[1fr_3rem_3rem_1.5fr] gap-2 px-2 py-1 border-b border-border/40 bg-muted/40 text-[9px] uppercase tracking-wider text-muted-foreground">
                    <div>name</div>
                    <div>dir</div>
                    <div>width</div>
                    <div>description</div>
                  </div>
                  {mod.ports.map((p) => (
                    <div key={p.name} className="grid grid-cols-[1fr_3rem_3rem_1.5fr] gap-2 px-2 py-1 border-b border-border/20 text-[11px] last:border-b-0">
                      <div className="font-mono text-primary">{p.name}</div>
                      <div>
                        <Badge variant="outline" className={`text-[9px] py-0 px-1 ${p.dir === 'input' ? 'border-primary/40 text-primary' : 'border-primary/40 text-primary'}`}>
                          {p.dir === 'input' ? 'in' : 'out'}
                        </Badge>
                      </div>
                      <div className="font-mono text-muted-foreground">{p.width}</div>
                      <div className="text-muted-foreground text-[10px]">{p.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
