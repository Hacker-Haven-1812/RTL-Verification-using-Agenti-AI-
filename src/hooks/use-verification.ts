'use client';

import { useEffect, useReducer, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  OrchestratorEvent,
  VerificationState,
  OrchestratorConfig,
} from '@/lib/riscv-types';

const INITIAL_STATE: VerificationState = {
  status: 'idle',
  sessionId: null,
  config: null,
  currentIteration: 0,
  totalIterations: 0,
  coverageHistory: [],
  latestReport: null,
  latestAnalysis: null,
  latestProgram: null,
  missingCaseSuggestions: [],
  trace: [],
  agentActivities: [],
  formalResults: {},
  simLoopEndReason: null,
  errors: [],
};

type Action =
  | { type: 'RESET' }
  | { type: 'SESSION_STARTED'; sessionId: string; config: OrchestratorConfig }
  | { type: 'EVENT'; event: OrchestratorEvent & { sessionId?: string } }
  | { type: 'SOCKET_DISCONNECTED' };

function makeId() {
  return Math.random().toString(36).slice(2, 11);
}

function reducer(state: VerificationState, action: Action): VerificationState {
  switch (action.type) {
    case 'RESET':
      return { ...INITIAL_STATE };
    case 'SESSION_STARTED':
      return {
        ...INITIAL_STATE,
        status: 'running',
        sessionId: action.sessionId,
        config: action.config,
        totalIterations: action.config.maxIterations,
      };
    case 'SOCKET_DISCONNECTED':
      if (state.status === 'running') {
        return { ...state, status: 'error', errors: [...state.errors, { message: 'Real-time connection lost', where: 'socket', timestamp: Date.now() }] };
      }
      return state;
    case 'EVENT': {
      const e = action.event;
      switch (e.type) {
        case 'sim-iteration-start':
          return { ...state, currentIteration: e.iteration };
        case 'agent-activity': {
          const activity = {
            id: makeId(),
            agent: e.agent,
            phase: e.phase,
            message: e.message,
            detail: e.detail,
            timestamp: Date.now(),
            iteration: state.currentIteration,
          };
          // Cap activities at the most recent 200 to avoid memory blowup
          const activities = [...state.agentActivities, activity].slice(-200);
          return { ...state, agentActivities: activities };
        }
        case 'program-generated':
          return {
            ...state,
            latestProgram: {
              iteration: e.iteration,
              program: e.program,
              rationale: e.rationale,
              targets: e.targets,
              assemblerErrors: e.assemblerErrors,
              instructionCount: e.instructionCount,
            },
            // Reset trace when a new program starts
            trace: [],
          };
        case 'simulation-progress':
          // Cap trace at the most recent 500 entries
          return {
            ...state,
            trace: [...state.trace, e.entry].slice(-500),
          };
        case 'simulation-complete':
          return state;
        case 'coverage-update': {
          const r = e.report;
          const hist = [...state.coverageHistory, {
            iteration: e.iteration,
            overall: r.overallCoverage,
            instruction: r.instructionCoverage.ratio,
            branch: r.branchCoverage.ratio,
            register: r.registerCoverage.ratio,
            hazard: r.hazardCoverage.ratio,
            functional: r.functionalCoverage.ratio,
          }];
          return { ...state, coverageHistory: hist, latestReport: r };
        }
        case 'coverage-analysis':
          return { ...state, latestAnalysis: e.analysis };
        case 'missing-case-suggestions':
          return { ...state, missingCaseSuggestions: e.suggestions };
        case 'sim-loop-end':
          return { ...state, simLoopEndReason: e.reason, status: 'completed' };
        case 'formal-start':
          return {
            ...state,
            formalResults: {
              ...state.formalResults,
              [e.module]: { properties: [], results: [], summary: undefined },
            },
          };
        case 'formal-properties-generated': {
          const prev = state.formalResults[e.module] ?? { properties: [], results: [], summary: undefined };
          return {
            ...state,
            formalResults: {
              ...state.formalResults,
              [e.module]: { ...prev, properties: e.properties.map(p => ({ ...p, target: e.module })) },
            },
          };
        }
        case 'formal-check-result': {
          const prev = state.formalResults[e.module] ?? { properties: [], results: [], summary: undefined };
          return {
            ...state,
            formalResults: {
              ...state.formalResults,
              [e.module]: { ...prev, results: [...prev.results, e.result] },
            },
          };
        }
        case 'formal-end': {
          const prev = state.formalResults[e.module] ?? { properties: [], results: [], summary: undefined };
          return {
            ...state,
            formalResults: {
              ...state.formalResults,
              [e.module]: { ...prev, summary: e.summary },
            },
          };
        }
        case 'session-ended':
          return { ...state, status: 'completed' };
        case 'error':
          return { ...state, errors: [...state.errors, { message: e.message, where: e.where, timestamp: Date.now() }] };
        default:
          return state;
      }
    }
    default:
      return state;
  }
}

export interface UseVerificationOptions {
  onSessionEnded?: () => void;
}

export function useVerification(opts: UseVerificationOptions = {}) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const socketRef = useRef<Socket | null>(null);
  const onSessionEndedRef = useRef(opts.onSessionEnded);

  useEffect(() => {
    onSessionEndedRef.current = opts.onSessionEnded;
  }, [opts.onSessionEnded]);

  useEffect(() => {
    const socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1500,
      timeout: 15000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      // Connected — nothing to do until start-verification is emitted
    });
    socket.on('disconnect', () => {
      dispatch({ type: 'SOCKET_DISCONNECTED' });
    });
    socket.on('orchestrator-event', (event: OrchestratorEvent & { sessionId?: string }) => {
      dispatch({ type: 'EVENT', event });
      if (event.type === 'session-ended' || event.type === 'sim-loop-end') {
        onSessionEndedRef.current?.();
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const start = useCallback((config: Partial<OrchestratorConfig>) => {
    const sessionId = `session-${Date.now()}`;
    dispatch({ type: 'RESET' });
    const fullConfig: OrchestratorConfig = {
      sessionId,
      coverageGoal: config.coverageGoal ?? 0.85,
      maxIterations: config.maxIterations ?? 4,
      maxCyclesPerRun: config.maxCyclesPerRun ?? 1500,
      targetModules: config.targetModules && config.targetModules.length > 0 ? config.targetModules : ['rv32i_alu', 'rv32i_regfile'],
      initialScenarios: config.initialScenarios ?? [],
      instructionMixHint: config.instructionMixHint,
    };
    dispatch({ type: 'SESSION_STARTED', sessionId, config: fullConfig });
    socketRef.current?.emit('start-verification', fullConfig);
  }, []);

  const abort = useCallback(() => {
    socketRef.current?.emit('abort-verification');
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  return { state, start, abort, reset, socket: socketRef };
}
