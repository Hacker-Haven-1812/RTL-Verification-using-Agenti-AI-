'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Play, FileCode2, ShieldCheck, Eraser, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  isRunning: boolean;
  onRunProgram: (program: string) => void;
  onCheckProperty: (moduleName: string, declaration: string) => void;
}

const SAMPLE_PROGRAM = `# Write your own RV32I program here.
# It will be assembled, loaded at address 0, and simulated
# in real time. Coverage is computed from the actual trace.

main:
  li a0, 5
  li a1, 7
  add a2, a0, a1     # 12
  sub a3, a1, a0     # 2
  xor a4, a0, a1     # 2
  slt a5, a0, a1     # 1
  sll a6, a0, a1     # 5 << 7 = 640

  # Memory test
  li t0, 0x1000
  sw a0, 0(t0)
  lw t1, 0(t0)

  # Branch test
  beq a0, a0, target
  addi a0, a0, 99    # skipped
target:
  bne a0, a1, neq
  addi a0, a0, 88    # skipped
neq:

  # Overflow test
  li a0, 0x7fffffff
  li a1, 1
  add a2, a0, a1     # overflow -> 0x80000000

  ebreak`;

const SAMPLE_PROPERTY = `PROPERTY add_commutative:
  TARGET rv32i_alu
  FOR ALL operand_a:uint32, operand_b:uint32, alu_ctrl:uint4
  IMPLIES alu_ctrl == ALU_ADD => alu_result == ((operand_a + operand_b) & 0xffffffff)`;

const AVAILABLE_MODULES = ['rv32i_alu', 'rv32i_regfile'];

export function CustomInputPanel({ isRunning, onRunProgram, onCheckProperty }: Props) {
  const [program, setProgram] = useState(SAMPLE_PROGRAM);
  const [moduleName, setModuleName] = useState('rv32i_alu');
  const [declaration, setDeclaration] = useState(SAMPLE_PROPERTY);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileCode2 className="h-4 w-4 text-primary" />
            Manual Input
          </CardTitle>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-sm">
                <div className="text-[11px] space-y-1">
                  <div>Run your own programs or properties directly.</div>
                  <div>• <b>Assembly</b>: write RV32I code, we assemble + simulate + analyze coverage in real time.</div>
                  <div>• <b>Property</b>: write a formal property in our DSL, we parse + check it with 2000 random trials.</div>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <Tabs defaultValue="program" className="h-full flex flex-col">
          <TabsList className="mx-3 mt-2 self-start">
            <TabsTrigger value="program" className="text-[11px]">
              <FileCode2 className="h-3 w-3 mr-1" />
              Assembly
            </TabsTrigger>
            <TabsTrigger value="property" className="text-[11px]">
              <ShieldCheck className="h-3 w-3 mr-1" />
              Formal Property
            </TabsTrigger>
          </TabsList>

          {/* Assembly tab */}
          <TabsContent value="program" className="flex-1 min-h-0 mt-0 flex flex-col">
            <div className="px-3 pt-2 pb-1 flex items-center justify-between gap-2 flex-wrap">
              <div className="text-[10px] text-muted-foreground">
                RV32I base ISA · pseudo-instructions supported (li, mv, j, ret, beqz, …)
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setProgram('')}
                  disabled={isRunning}
                >
                  <Eraser className="h-3 w-3 mr-1" />
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setProgram(SAMPLE_PROGRAM)}
                  disabled={isRunning}
                >
                  Load sample
                </Button>
              </div>
            </div>
            <Textarea
              value={program}
              onChange={(e) => setProgram(e.target.value)}
              disabled={isRunning}
              placeholder="# Type your RV32I assembly here..."
              className="flex-1 mx-3 mb-2 min-h-[180px] font-mono text-[11px] leading-relaxed resize-none bg-card/50"
              spellCheck={false}
            />
            <div className="px-3 pb-3 flex items-center justify-between gap-2">
              <div className="text-[10px] text-muted-foreground">
                {program.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).length} non-comment lines
              </div>
              <Button
                onClick={() => onRunProgram(program)}
                disabled={isRunning || !program.trim()}
                size="sm"
              >
                <Play className="h-3 w-3 mr-1.5" />
                {isRunning ? 'Running...' : 'Run My Program'}
              </Button>
            </div>
          </TabsContent>

          {/* Property tab */}
          <TabsContent value="property" className="flex-1 min-h-0 mt-0 flex flex-col">
            <div className="px-3 pt-2 pb-1 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">Target module:</span>
                {AVAILABLE_MODULES.map((m) => (
                  <button
                    key={m}
                    onClick={() => !isRunning && setModuleName(m)}
                    disabled={isRunning}
                    className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                      moduleName === m
                        ? 'border-primary/40 text-primary bg-primary/5'
                        : 'border-border text-muted-foreground bg-card/50 hover:bg-muted/50'
                    } ${isRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setDeclaration('')}
                  disabled={isRunning}
                >
                  <Eraser className="h-3 w-3 mr-1" />
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setDeclaration(SAMPLE_PROPERTY)}
                  disabled={isRunning}
                >
                  Load sample
                </Button>
              </div>
            </div>
            <Textarea
              value={declaration}
              onChange={(e) => setDeclaration(e.target.value)}
              disabled={isRunning}
              placeholder={'PROPERTY my_property:\n  TARGET rv32i_alu\n  FOR ALL operand_a:uint32, operand_b:uint32, alu_ctrl:uint4\n  IMPLIES alu_ctrl == ALU_ADD => alu_result == ((operand_a + operand_b) & 0xffffffff)'}
              className="flex-1 mx-3 mb-2 min-h-[180px] font-mono text-[11px] leading-relaxed resize-none bg-card/50"
              spellCheck={false}
            />
            <div className="px-3 pb-3 flex items-center justify-between gap-2">
              <div className="text-[10px] text-muted-foreground">
                DSL: PROPERTY / TARGET / FOR ALL / IMPLIES =&gt;
              </div>
              <Button
                onClick={() => onCheckProperty(moduleName, declaration)}
                disabled={isRunning || !declaration.trim()}
                size="sm"
              >
                <ShieldCheck className="h-3 w-3 mr-1.5" />
                {isRunning ? 'Checking...' : 'Check My Property'}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
