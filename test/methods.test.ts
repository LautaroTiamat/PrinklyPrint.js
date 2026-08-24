/**
 * Cobertura de los métodos del cliente que no participan del flujo de pairing
 * (ese vive en client.test.ts): jobs, settings, printers, y la traducción de
 * errores de transporte (timeout, red, body no-JSON, HTTP 4xx).
 */
import { describe, it, expect } from 'vitest';

import {
  PrinklyPrint,
  MemoryTokenStore,
  AgentResponseError,
  AgentUnreachableError,
  TimeoutError,
} from '../src/index.js';

const BASE = 'http://127.0.0.1:17777';

interface Call {
  method: string;
  path: string;
  search: string;
  authorization: string | undefined;
}

/** Cliente con token pre-cacheado y un fetch fake que registra las llamadas. */
function makeClient(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: unknown, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.pathname,
      search: url.search,
      authorization: headers['Authorization'],
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;

  const tokenStore = new MemoryTokenStore();
  tokenStore.set(BASE, 'tok-test');
  const client = new PrinklyPrint({ fetch: fetchImpl, tokenStore });
  return { client, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('métodos de jobs/settings/printers', () => {
  it('listPrinters hace GET /printers con el token', async () => {
    const { client, calls } = makeClient(() => json([{ name: 'HP', status: 'ready' }]));
    const printers = await client.listPrinters();
    expect(printers[0]?.name).toBe('HP');
    expect(calls[0]).toMatchObject({
      method: 'GET',
      path: '/printers',
      authorization: 'Bearer tok-test',
    });
  });

  it('getSettings hace GET /settings y devuelve machine_id', async () => {
    const { client } = makeClient(() => json({ machine_id: 'abc', paused: false }));
    const s = await client.getSettings();
    expect(s.machine_id).toBe('abc');
  });

  it('getJob escapa el id en el path', async () => {
    const { client, calls } = makeClient(() => json({ id: 'a b', status: 'queued' }));
    await client.getJob('a b');
    expect(calls[0]?.path).toBe('/jobs/a%20b');
  });

  it('retryJob hace POST /jobs/{id}/retry', async () => {
    const { client, calls } = makeClient(() => json({ status: 'queued' }));
    const r = await client.retryJob('j1');
    expect(r.status).toBe('queued');
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/jobs/j1/retry' });
  });

  it('cancelJob hace DELETE /jobs/{id}', async () => {
    const { client, calls } = makeClient(() => json({ status: 'cancelled' }));
    const r = await client.cancelJob('j1');
    expect(r.status).toBe('cancelled');
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: '/jobs/j1' });
  });

  it('listJobs arma el query string solo con los filtros presentes', async () => {
    const { client, calls } = makeClient(() =>
      json({ total: 0, limit: 5, offset: 10, jobs: [] }),
    );
    await client.listJobs({ status: 'failed', limit: 5, offset: 10 });
    expect(calls[0]?.search).toBe('?status=failed&limit=5&offset=10');
    await client.listJobs();
    expect(calls[1]?.search).toBe('');
  });
});

describe('traducción de errores de transporte', () => {
  it('un fetch que no responde dentro del timeout tira TimeoutError', async () => {
    const fetchImpl = ((_input: unknown, init: RequestInit = {}) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      })) as typeof fetch;
    const client = new PrinklyPrint({
      fetch: fetchImpl,
      tokenStore: new MemoryTokenStore(),
      timeout: 30,
    });
    const err = await client.ping().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as TimeoutError).timeoutMs).toBe(30);
  });

  it('un fetch que revienta tira AgentUnreachableError con la causa', async () => {
    const boom = new Error('ECONNREFUSED');
    const fetchImpl = (async () => {
      throw boom;
    }) as typeof fetch;
    const client = new PrinklyPrint({ fetch: fetchImpl, tokenStore: new MemoryTokenStore() });
    const err = await client.ping().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentUnreachableError);
    expect((err as AgentUnreachableError).baseUrl).toBe(BASE);
    expect((err as AgentUnreachableError).cause).toBe(boom);
  });

  it('un 2xx con body no-JSON tira AgentResponseError invalid_response', async () => {
    const { client } = makeClient(
      () => new Response('<html>proxy roto</html>', { status: 200 }),
    );
    const err = await client.getSettings().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentResponseError);
    expect((err as AgentResponseError).body.error).toBe('invalid_response');
  });

  it('un 404 tira AgentResponseError con status y body del agente', async () => {
    const { client } = makeClient(() =>
      json({ error: 'not_found', message: 'job no existe' }, 404),
    );
    const err = await client.getJob('nope').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentResponseError);
    expect((err as AgentResponseError).status).toBe(404);
    expect((err as AgentResponseError).body.error).toBe('not_found');
  });
});
