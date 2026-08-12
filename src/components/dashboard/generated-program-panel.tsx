'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Copy, Check, AlertCircle } from 'lucide-react';

interface Props {
  program: { iteration: number; program: string; rationale: string; targets: string[]; assemblerErrors: { line: number; message: string }[]; instructionCount: number } | null;
}

export function GeneratedProgramPanel({ program }: Props) {
  const [copied, setCopied] = useState(false);
  if (!program) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Generated Program</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground italic py-8 text-center">
            The Test Generator writes its RISC-V assembly program here. No tests are pre-stored.
          </div>
        </CardContent>
      </Card>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(program.program);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {

    }
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm font-medium">
            Generated Program — Iteration {program.iteration}
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">
              {program.instructionCount} instrs
            </Badge>
            {program.assemblerErrors.length > 0 ? (
              <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">
                {program.assemblerErrors.length} asm errors
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
                assembled OK
              </Badge>
            )}
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={copy}>
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
        {program.targets.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {program.targets.map((t, i) => (
              <Badge key={i} variant="outline" className="text-[9px] py-0 px-1.5 border-primary/40 text-primary bg-primary/5">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <Tabs defaultValue="asm" className="h-full flex flex-col">
          <TabsList className="mx-3 mt-2 self-start">
            <TabsTrigger value="asm" className="text-[11px]">Assembly</TabsTrigger>
            <TabsTrigger value="rationale" className="text-[11px]">Rationale</TabsTrigger>
            {program.assemblerErrors.length > 0 && (
              <TabsTrigger value="errors" className="text-[11px] text-destructive">
                <AlertCircle className="h-3 w-3 mr-1" />
                Errors
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="asm" className="flex-1 min-h-0 mt-0">
            <ScrollArea className="h-full max-h-[400px]">
              <pre className="font-mono text-[11px] leading-relaxed p-3 whitespace-pre-wrap break-words">
                {program.program || '(empty)'}
              </pre>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="rationale" className="flex-1 min-h-0 mt-0">
            <ScrollArea className="h-full max-h-[400px]">
              <div className="p-3 text-xs text-muted-foreground leading-relaxed">
                {program.rationale || '(no rationale provided by the agent)'}
              </div>
            </ScrollArea>
          </TabsContent>
          {program.assemblerErrors.length > 0 && (
            <TabsContent value="errors" className="flex-1 min-h-0 mt-0">
              <ScrollArea className="h-full max-h-[400px]">
                <div className="p-3 space-y-1">
                  {program.assemblerErrors.map((e, i) => (
                    <div key={i} className="text-[11px] font-mono text-destructive border border-destructive/20 bg-destructive/5 rounded px-2 py-1">
                      Line {e.line}: {e.message}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
}
