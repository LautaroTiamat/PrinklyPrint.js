/**
 * Contract test Go↔TS: valida que los tipos de `src/types.ts` sigan la forma
 * real del API del agente, fijada en `test/contract/api-shapes.json`.
 *
 * Ese archivo lo GENERA el agente (repo PrinklyPrint) con:
 *   CONTRACT_UPDATE=1 go test ./internal/server -run TestAPIContract
 * y se copia acá (test/contract/). Este test construye un sample por endpoint
 * TIPADO con `satisfies` (o sea: si types.ts no matchea, no compila — por eso
 * `npm run typecheck` incluye test/) y compara su forma canónica con la del
 * contrato. Un drift como el de machine_id (que se mudó de /ping a /settings)
 * rompe acá en vez de descubrirse en producción.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  AgentErrorBody,
  AgentSettings,
  Job,
  JobStatus,
  ListJobsResponse,
  PingResponse,
  Printer,
  PrintResponse,
} from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const localContractPath = join(here, 'contract', 'api-shapes.json');
// Copia canónica en el repo del agente (solo existe en máquinas con ambos repos).
const agentContractPath = join(here, '..', '..', 'PrinklyPrint', 'contract', 'api-shapes.json');

const fixture = JSON.parse(readFileSync(localContractPath, 'utf8')) as Record<string, unknown>;

// ── shapeOf: espejo exacto del shapeOf del test Go ───────────────────

function shapeOf(v: unknown): unknown {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length === 0 ? [] : [shapeOf(v[0])];
  switch (typeof v) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = shapeOf(val);
      }
      return out;
    }
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'bool';
    default:
      return typeof v;
  }
}

/** JSON.stringify con claves ordenadas recursivamente (para comparar formas). */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, val]) => `${JSON.stringify(k)}:${stable(val)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(v);
}

// ── Samples tipados: si types.ts se desvía, esto NO COMPILA ──────────

const jobSample = {
  id: 'j1',
  filename: 'contract.pdf',
  printer: '',
  options: {
    printer: '',
    paper_size: 'A4',
    custom_width_mm: 0,
    custom_height_mm: 0,
    orientation: 'portrait',
    copies: 1,
    duplex: 'none',
    color: true,
    scale: 'fit',
    page_range: '',
  },
  metadata: { origen: 'contract' },
  status: 'queued',
  attempts: 0,
  last_error: '',
  sumatra_log: '',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  // completed_at / next_attempt_at: ausentes en un job recién encolado —
  // igual que en el contrato, que se genera con un job fresco.
} satisfies Job;

const samples: Record<string, unknown> = {
  'GET /ping': { ok: true, paused: false, version: '1.0.0' } satisfies PingResponse,
  'GET /settings': {
    default_printer: '',
    paper_size: 'A4',
    custom_width_mm: 0,
    custom_height_mm: 0,
    orientation: 'portrait',
    color: true,
    duplex: 'none',
    scale: 'fit',
    paused: false,
    machine_id: 'contract00000000',
  } satisfies AgentSettings,
  'GET /printers[]': {
    name: 'x',
    is_default: true,
    is_network: true,
    status: 'ready',
    statuses: ['ready'],
    severity: 'ok',
    port_name: 'p',
    driver_name: 'd',
    location: 'l',
    comment: 'c',
    job_count: 1,
  } satisfies Printer,
  'POST /print': { job_id: 'j1', status: 'queued' } satisfies PrintResponse,
  'GET /jobs': {
    total: 1,
    limit: 100,
    offset: 0,
    jobs: [jobSample],
  } satisfies ListJobsResponse,
  'GET /jobs/{id}': jobSample,
  'POST /jobs/{id}/retry': { status: 'queued' } satisfies { status: JobStatus },
  'DELETE /jobs/{id}': { status: 'cancelled' } satisfies { status: JobStatus },
  'POST /pair': { token: 'tok' } satisfies { token: string },
  error: { error: 'bad_request', message: 'x' } satisfies AgentErrorBody,
};

// ── Tests ────────────────────────────────────────────────────────────

describe('contrato Go↔TS', () => {
  it('cubre exactamente los endpoints del contrato', () => {
    expect(Object.keys(samples).sort()).toEqual(Object.keys(fixture).sort());
  });

  for (const endpoint of Object.keys(fixture)) {
    it(`la forma de ${endpoint} coincide con el agente`, () => {
      expect(stable(shapeOf(samples[endpoint]))).toBe(stable(fixture[endpoint]));
    });
  }

  // Solo corre donde están los dos repos lado a lado (la máquina de desarrollo):
  // detecta que alguien regeneró el contrato en el agente y olvidó copiarlo acá.
  it.skipIf(!existsSync(agentContractPath))(
    'la copia local del contrato está al día con la del agente',
    () => {
      const agent = JSON.parse(readFileSync(agentContractPath, 'utf8'));
      expect(stable(fixture)).toBe(stable(agent));
    },
  );
});
