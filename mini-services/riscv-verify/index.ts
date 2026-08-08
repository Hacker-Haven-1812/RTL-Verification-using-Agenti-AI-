import { createServer } from 'http';
import { Server } from 'socket.io';
import { Orchestrator, OrchestratorConfig, OrchestratorEvent, TARGETABLE_MODULES } from './orchestrator/orchestrator.js';

const httpServer = createServer();
const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Track active sessions so we can abort them
const sessions = new Map<string, Orchestrator>();

io.on('connection', (socket) => {
  console.log(`[verify-service] client connected: ${socket.id}`);

  socket.on('start-verification', (config: Partial<OrchestratorConfig> & { sessionId: string }) => {
    const sessionId = config.sessionId ?? `session-${Date.now()}`;
    console.log(`[verify-service] start-verification sessionId=${sessionId} config=`, config);

    // Abort any existing session for this socket
    const existing = sessions.get(socket.id);
    if (existing) existing.abort();

    const fullConfig: OrchestratorConfig = {
      sessionId,
      coverageGoal: config.coverageGoal ?? 0.85,
      maxIterations: config.maxIterations ?? 5,
      maxCyclesPerRun: config.maxCyclesPerRun ?? 2000,
      targetModules: config.targetModules && config.targetModules.length > 0 ? config.targetModules : ['rv32i_alu', 'rv32i_regfile'],
      initialScenarios: config.initialScenarios ?? [],
      instructionMixHint: config.instructionMixHint,
    };

    const emit = (e: OrchestratorEvent) => {
      // Always include sessionId for client-side correlation
      socket.emit('orchestrator-event', { ...e, sessionId });
    };
    const orch = new Orchestrator(emit);
    sessions.set(socket.id, orch);

    // Fire-and-forget — orchestrator emits events as it runs
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

  socket.on('disconnect', () => {
    const orch = sessions.get(socket.id);
    if (orch) orch.abort();
    sessions.delete(socket.id);
    console.log(`[verify-service] client disconnected: ${socket.id}`);
  });
});

const PORT = 3003;
const HOST = '0.0.0.0';
httpServer.listen(PORT, HOST, () => {
  console.log(`[verify-service] RISC-V Verification WebSocket server running on ${HOST}:${PORT}`);
  console.log(`[verify-service] targetable modules: ${TARGETABLE_MODULES.join(', ')}`);
});

process.on('SIGTERM', () => {
  console.log('[verify-service] SIGTERM received, shutting down...');
  httpServer.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  console.log('[verify-service] SIGINT received, shutting down...');
  httpServer.close(() => process.exit(0));
});
