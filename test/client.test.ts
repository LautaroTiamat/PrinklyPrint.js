import { describe, it, expect } from 'vitest';

import {
  PrinklyPrint,
  PairingDeniedError,
  PairingRequiredError,
  AgentResponseError,
  MemoryTokenStore,
} from '../src/index.js';

// ─────────────────────────────────────────────────────────────────────
// Helpers: fetch mockeado + agentes simulados
// ─────────────────────────────────────────────────────────────────────

interface Call {
  path: string;
  method: string;
  authorization?: string;
  body?: any;
}

function makeFetch(handler: (path: string, call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const headersIn = (init.headers ?? {}) as Record<string, string>;
    const lower: Record<string, string> = {};
    for (const k of Object.keys(headersIn)) lower[k.toLowerCase()] = headersIn[k];
    const call: Call = {
      path: url.pathname,
      method: init.method ?? 'GET',
      authorization: lower['authorization'],
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return handler(url.pathname, call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Agente NUEVO: exige Bearer token en endpoints sensibles; /ping y /pair exentos. */
function newAgent(opts: { token?: string; approve?: boolean } = {}) {
  const token = opts.token ?? 'tok-abc';
  const approve = opts.approve ?? true;
  return (path: string, call: Call): Response => {
    if (path === '/ping') return json(200, { ok: true, version: '1.1.0', machine_id: 'm', paused: false });
    if (path === '/pair') {
      return approve ? json(200, { token }) : json(403, { error: 'pairing_denied', message: 'rechazado' });
    }
    if (call.authorization !== `Bearer ${token}`) {
      return json(401, { error: 'unauthorized', message: 'falta token' });
    }
    if (path === '/print') return json(202, { job_id: 'job-1', status: 'queued' });
    if (path === '/jobs') return json(200, { total: 0, limit: 0, offset: 0, jobs: [] });
    return json(200, {});
  };
}

/** Agente VIEJO: nunca exige token, nunca devuelve 401, no tiene /pair. */
function oldAgent() {
  return (path: string): Response => {
    if (path === '/ping') return json(200, { ok: true, version: '1.0.0', machine_id: 'm', paused: false });
    if (path === '/jobs') return json(200, { total: 0, limit: 0, offset: 0, jobs: [] });
    if (path === '/print') return json(202, { job_id: 'j', status: 'queued' });
    if (path === '/pair') return json(404, { error: 'not_found', message: 'agente viejo sin pairing' });
    return json(200, {});
  };
}

const paths = (calls: Call[]) => calls.map((c) => c.path);
const newClient = (fetchImpl: typeof fetch, extra = {}) =>
  new PrinklyPrint({ fetch: fetchImpl, tokenStore: new MemoryTokenStore(), ...extra });

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('auto-pairing ante 401', () => {
  it('401 -> paréa -> reintenta con éxito y el retry lleva el Authorization correcto', async () => {
    const { fetchImpl, calls } = makeFetch(newAgent());
    const client = newClient(fetchImpl);

    const res = await client.print('JVBERi0=', { filename: 'x.pdf' });

    expect(res.job_id).toBe('job-1');
    expect(paths(calls)).toEqual(['/print', '/pair', '/print']);
    expect(calls[0]!.authorization).toBeUndefined(); // primer intento sin token
    expect(calls[2]!.authorization).toBe('Bearer tok-abc'); // retry con token
  });

  it('manda el appName como label en /pair', async () => {
    const { fetchImpl, calls } = makeFetch(newAgent());
    const client = newClient(fetchImpl, { appName: 'Mi App' });

    await client.print('JVBERi0=');

    const pairCall = calls.find((c) => c.path === '/pair');
    expect(pairCall?.body).toEqual({ label: 'Mi App' });
  });

  it('reusa el token cacheado en la segunda llamada (no vuelve a parear)', async () => {
    const { fetchImpl, calls } = makeFetch(newAgent());
    const client = newClient(fetchImpl);

    await client.print('JVBERi0='); // paréa
    calls.length = 0; // reset

    const res = await client.listJobs();
    expect(res.total).toBe(0);
    expect(paths(calls)).toEqual(['/jobs']); // sin /pair
    expect(calls[0]!.authorization).toBe('Bearer tok-abc');
  });

  it('si el token rota en el agente (401 con token cacheado), limpia y re-paréa', async () => {
    const { fetchImpl, calls } = makeFetch(newAgent({ token: 'fresh' }));
    const store = new MemoryTokenStore();
    const client = new PrinklyPrint({ fetch: fetchImpl, tokenStore: store });
    store.set(client.baseUrl, 'stale'); // token viejo cacheado

    const res = await client.print('JVBERi0=');

    expect(res.job_id).toBe('job-1');
    expect(store.get(client.baseUrl)).toBe('fresh');
    expect(paths(calls)).toEqual(['/print', '/pair', '/print']);
    expect(calls[0]!.authorization).toBe('Bearer stale');
    expect(calls[2]!.authorization).toBe('Bearer fresh');
  });

  it('si el reintento vuelve a fallar con 401, propaga AgentResponseError (no loopea)', async () => {
    const { fetchImpl, calls } = makeFetch((path: string): Response => {
      if (path === '/pair') return json(200, { token: 'x' });
      return json(401, { error: 'unauthorized', message: 'siempre no' });
    });
    const client = newClient(fetchImpl);

    await expect(client.listJobs()).rejects.toBeInstanceOf(AgentResponseError);
    // un solo intento de pairing, dos de /jobs (original + retry)
    expect(calls.filter((c) => c.path === '/pair')).toHaveLength(1);
    expect(calls.filter((c) => c.path === '/jobs')).toHaveLength(2);
  });
});

describe('pairing denegado', () => {
  it('/pair 403 -> PairingDeniedError', async () => {
    const { fetchImpl } = makeFetch(newAgent({ approve: false }));
    const client = newClient(fetchImpl);

    await expect(client.print('JVBERi0=')).rejects.toBeInstanceOf(PairingDeniedError);
  });
});

describe('retrocompatibilidad con agente viejo', () => {
  it('nunca devuelve 401 -> nunca se llama a /pair', async () => {
    const { fetchImpl, calls } = makeFetch(oldAgent());
    const client = newClient(fetchImpl);

    await client.listJobs();
    await client.print('JVBERi0=');

    expect(paths(calls)).not.toContain('/pair');
    expect(paths(calls)).toEqual(['/jobs', '/print']);
  });
});

describe('endpoints exentos', () => {
  it('/ping no dispara auto-pairing aunque el agente exija token', async () => {
    const { fetchImpl, calls } = makeFetch(newAgent());
    const client = newClient(fetchImpl);

    const pong = await client.ping();
    expect(pong.ok).toBe(true);
    expect(paths(calls)).toEqual(['/ping']); // sin /pair
  });
});

describe('autoPair = false', () => {
  it('un 401 lanza PairingRequiredError y pair() manual funciona', async () => {
    const { fetchImpl, calls } = makeFetch(newAgent());
    const store = new MemoryTokenStore();
    const client = new PrinklyPrint({ fetch: fetchImpl, tokenStore: store, autoPair: false });

    await expect(client.listJobs()).rejects.toBeInstanceOf(PairingRequiredError);
    expect(calls.filter((c) => c.path === '/pair')).toHaveLength(0); // NO pareó solo

    const token = await client.pair(); // manual
    expect(token).toBe('tok-abc');
    expect(store.get(client.baseUrl)).toBe('tok-abc');

    const res = await client.listJobs(); // ahora anda
    expect(res.total).toBe(0);
  });
});

describe('dedupe de pairings concurrentes', () => {
  it('dos pair() simultáneos reusan la misma Promise (un solo POST /pair)', async () => {
    const { fetchImpl, calls } = makeFetch(newAgent());
    const client = newClient(fetchImpl);

    const [a, b] = await Promise.all([client.pair(), client.pair()]);

    expect(a).toBe('tok-abc');
    expect(b).toBe('tok-abc');
    expect(calls.filter((c) => c.path === '/pair')).toHaveLength(1);
  });
});

describe('isPaired', () => {
  it('refleja si hay token cacheado', async () => {
    const { fetchImpl } = makeFetch(newAgent());
    const client = newClient(fetchImpl);

    expect(client.isPaired()).toBe(false);
    await client.pair();
    expect(client.isPaired()).toBe(true);
  });
});
