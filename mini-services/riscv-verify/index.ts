import { createServer } from 'http';
import { Server } from 'socket.io';
import { Orchestrator, OrchestratorConfig, OrchestratorEvent, TARGETABLE_MODULES } from './orchestrator/orchestrator.js';
import { assemble } from './rv32i/assembler.js';
import { RV32ICore, MEM_SIZE } from './rv32i/core.js';
import { analyzeCoverage } from './rv32i/coverage.js';
import { parseProperty, checkProperty } from './rtl/formal.js';
import { getRtlModule } from './rtl/modules.js';

const PORT = parseInt(process.env.PORT || '3003', 10);
const HOST = process.env.HOST || '0.0.0.0';
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : ['*'];
const CORS_HEADER = CORS_ORIGINS.includes('*') ? '*' : CORS_ORIGINS.join(', ');

const httpServer = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_HEADER);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.url === '/health' || req.url === '/healthz') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      status: 'ok',
      service: 'rv32i-verify',
      uptime: process.uptime(),
      modules: TARGETABLE_MODULES,
      activeSessions: sessions.size,
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  if (req.url === '/info') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      service: 'RTL Verification Using Agentic AI — Backend',
      version: '1.0.0',
      modules: TARGETABLE_MODULES,
      websocketPath: '/socket.io/',
      transports: ['websocket', 'polling'],
    }));
    return;
  }

  if (!req.url?.startsWith('/socket.io') && !req.url?.startsWith('/?EIO')) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not found', endpoints: ['/health', '/info'] }));
  }
});

const io = new Server(httpServer, {
  path: '/socket.io/',
  cors: {
    origin: CORS_ORIGINS,
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e8,
});

const sessions = new Map<string, Orchestrator>();

io.on('connection', (socket) => {
  console.log(`[verify-service] client connected: ${socket.id}`);

  socket.on('start-verification', (config: Partial<OrchestratorConfig> & { sessionId: string }) => {
    const sessionId = config.sessionId ?? `session-${Date.now()}`;
    console.log(`[verify-service] start-verification sessionId=${sessionId}`);

    const existing = sessions.get(socket.id);
    if (existing) existing.abort();

    const fullConfig: OrchestratorConfig = {
      sessionId,
      coverageGoal: config.coverageGoal ?? 0.70,
      maxIterations: config.maxIterations ?? 6,
      maxCyclesPerRun: config.maxCyclesPerRun ?? 2000,
      targetModules: config.targetModules && config.targetModules.length > 0 ? config.targetModules : ['rv32i_alu', 'rv32i_regfile'],
      initialScenarios: config.initialScenarios ?? [],
      instructionMixHint: config.instructionMixHint,
    };

    const emit = (e: OrchestratorEvent) => {
      socket.emit('orchestrator-event', { ...e, sessionId });
    };
    const orch = new Orchestrator(emit);
    sessions.set(socket.id, orch);

    orch.run(fullConfig).catch((e) => {
      console.error(`[verify-service] orchestrator error:`, e);
      emit({ type: 'error', message: e.message, where: 'orchestrator' });
    });
  });

  socket.on('abort-verification', () => {
    const orch = sessions.get(socket.id);
    if (orch) {
      orch.abort();
      console.log(`[verify-service] aborted session for ${socket.id}`);
    }
  });

  socket.on('run-custom-program', (payload: { sessionId: string; program: string; maxCycles?: number }) => {
    const sessionId = payload.sessionId ?? `custom-${Date.now()}`;
    console.log(`[verify-service] run-custom-program sessionId=${sessionId}`);
    const emit = (e: any) => socket.emit('orchestrator-event', { ...e, sessionId });

    try {
      emit({ type: 'agent-activity', agent: 'Assembler', phase: 'thinking', message: 'Assembling program...' });
      const asm = assemble(payload.program || '');
      emit({ type: 'agent-activity', agent: 'Assembler', phase: 'done', message: `Assembled ${asm.instructionCount} instructions${asm.errors.length > 0 ? ` with ${asm.errors.length} errors` : ''}` });

      emit({
        type: 'program-generated',
        iteration: 1,
        program: payload.program || '',
        rationale: 'User-submitted custom program',
        targets: [],
        assemblerErrors: asm.errors,
        instructionCount: asm.instructionCount,
      });

      if (asm.errors.length > 0 || asm.bytes.length === 0) {
        emit({ type: 'error', message: `Assembly failed: ${asm.errors.length} errors`, where: 'custom-program' });
        emit({ type: 'sim-loop-end', reason: 'max-iterations', finalCoverage: 0 });
        emit({ type: 'session-ended', sessionId, summary: { finalCoverage: 0, iterations: 0 } });
        return;
      }

      emit({ type: 'sim-iteration-start', iteration: 1, targetScenarios: ['USER_PROVIDED'] });
      const mem = new Uint8Array(MEM_SIZE);
      mem.set(asm.bytes, 0);
      const maxCycles = payload.maxCycles ?? 1500;
      const core = new RV32ICore(mem, { maxCycles, startPc: 0, trackHazards: true });
      const result = core.run(maxCycles);

      const STREAM_FIRST_N = 200;
      let lastStreamTime = 0;
      for (const e of result.trace.slice(0, STREAM_FIRST_N)) {
        const now = Date.now();
        if (now - lastStreamTime > 5) {
          emit({ type: 'simulation-progress', iteration: 1, cycle: e.cycle, pc: e.pc, mnemonic: e.mnemonic, entry: e });
          lastStreamTime = now;
        }
      }
      emit({ type: 'simulation-complete', iteration: 1, result });

      const report = analyzeCoverage(result.trace, result.cycles);
      emit({ type: 'coverage-update', iteration: 1, report });

      emit({ type: 'sim-loop-end', reason: 'goal-met', finalCoverage: report.overallCoverage });
      emit({ type: 'session-ended', sessionId, summary: { finalCoverage: report.overallCoverage, iterations: 1 } });
    } catch (e: any) {
      console.error(`[verify-service] run-custom-program error:`, e);
      emit({ type: 'error', message: e.message, where: 'custom-program' });
      emit({ type: 'session-ended', sessionId, summary: { finalCoverage: 0, iterations: 0, error: e.message } });
    }
  });

  socket.on('check-custom-property', (payload: { sessionId: string; moduleName: string; declaration: string }) => {
    const sessionId = payload.sessionId ?? `custom-prop-${Date.now()}`;
    const emit = (e: any) => socket.emit('orchestrator-event', { ...e, sessionId });

    const mod = getRtlModule(payload.moduleName);
    if (!mod) {
      emit({ type: 'error', message: `Unknown module: ${payload.moduleName}`, where: 'custom-property' });
      emit({ type: 'session-ended', sessionId, summary: { error: 'unknown module' } });
      return;
    }

    emit({ type: 'formal-start', module: payload.moduleName });
    emit({ type: 'agent-activity', agent: 'Formal Checker', phase: 'thinking', message: `Parsing property...` });

    let parsed;
    try {
      parsed = parseProperty(payload.declaration || '');
    } catch (e: any) {
      emit({
        type: 'formal-check-result',
        module: payload.moduleName,
        result: {
          property: { name: 'user_property', target: payload.moduleName, declaration: payload.declaration, inputs: [], precondition: '', consequent: '' },
          status: 'parse-error',
          trials: 0,
          error: e.message,
          durationMs: 0,
        },
      });
      emit({ type: 'formal-end', module: payload.moduleName, summary: { proof: 0, counterexample: 0, errors: 1 } });
      emit({ type: 'session-ended', sessionId, summary: { error: e.message } });
      return;
    }

    emit({ type: 'agent-activity', agent: 'Formal Checker', phase: 'done', message: `Checking "${parsed.name}" with 2000 trials...` });
    const result = checkProperty(parsed, mod, 2000);
    emit({ type: 'formal-check-result', module: payload.moduleName, result });

    const proof = result.status === 'proof' ? 1 : 0;
    const cex = result.status === 'counterexample' ? 1 : 0;
    const errors = (result.status === 'parse-error' || result.status === 'runtime-error') ? 1 : 0;
    emit({ type: 'formal-end', module: payload.moduleName, summary: { proof, counterexample: cex, errors } });
    emit({ type: 'session-ended', sessionId, summary: { status: result.status } });
  });

  socket.on('disconnect', () => {
    const orch = sessions.get(socket.id);
    if (orch) orch.abort();
    sessions.delete(socket.id);
    console.log(`[verify-service] client disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`[verify-service] RTL Verification backend running on ${HOST}:${PORT}`);
  console.log(`[verify-service] Targetable modules: ${TARGETABLE_MODULES.join(', ')}`);
  console.log(`[verify-service] CORS origins: ${CORS_ORIGINS.join(', ')}`);
  console.log(`[verify-service] Health check: http://${HOST}:${PORT}/health`);
});

process.on('SIGTERM', () => {
  console.log('[verify-service] SIGTERM received, shutting down...');
  for (const [id, orch] of sessions) orch.abort();
  httpServer.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  console.log('[verify-service] SIGINT received, shutting down...');
  for (const [id, orch] of sessions) orch.abort();
  httpServer.close(() => process.exit(0));
});
