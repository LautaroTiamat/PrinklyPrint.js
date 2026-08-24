// @vitest-environment jsdom
/**
 * Tests de los hooks React. El "cliente" es un stub con la superficie que los
 * hooks tocan, inyectado vía la prop `client` del Provider (pensada justo
 * para esto). Cubre en particular las dos regresiones corregidas:
 *  - cambiar el filtro/cliente dispara un fetch INMEDIATO (no espera el poll)
 *  - una respuesta vieja en vuelo no pisa a la más nueva
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

import {
  PrinklyPrintProvider,
  usePing,
  useJobs,
  useJob,
  useSettings,
  usePrint,
  useJobActions,
  usePairing,
} from '../src/react.js';
import type { PrinklyPrint } from '../src/client.js';
import type { Job, ListJobsFilter, ListJobsResponse } from '../src/types.js';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const jobStub = (id: string, status: Job['status']): Job => ({
  id,
  filename: `${id}.pdf`,
  printer: '',
  options: null,
  metadata: null,
  status,
  attempts: 0,
  last_error: '',
  sumatra_log: '',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const listResponse = (jobs: Job[]): ListJobsResponse => ({
  total: jobs.length,
  limit: 100,
  offset: 0,
  jobs,
});

/** Stub con la superficie del cliente que usan los hooks. */
function makeClient(overrides: Partial<Record<string, unknown>> = {}) {
  const listeners = new Set<() => void>();
  const stub = {
    ping: vi.fn(async () => ({ ok: true as const, version: '1.0.0', paused: false })),
    listPrinters: vi.fn(async () => []),
    listJobs: vi.fn(async (_f?: ListJobsFilter) => listResponse([jobStub('j1', 'queued')])),
    getJob: vi.fn(async (id: string) => jobStub(id, 'done')),
    getSettings: vi.fn(async () => ({ machine_id: 'm1' })),
    print: vi.fn(async () => ({ job_id: 'j1', status: 'queued' as const })),
    retryJob: vi.fn(async () => ({ status: 'queued' as const })),
    cancelJob: vi.fn(async () => ({ status: 'cancelled' as const })),
    pair: vi.fn(async () => 'tok'),
    isPaired: vi.fn(() => false),
    onPairingChange: vi.fn((l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    }),
    ...overrides,
  };
  return {
    client: stub as unknown as PrinklyPrint,
    stub,
    firePairingChange: () => listeners.forEach((l) => l()),
  };
}

function wrapperFor(client: PrinklyPrint) {
  return ({ children }: { children: ReactNode }) =>
    createElement(PrinklyPrintProvider, { client, children });
}

describe('hooks de lectura', () => {
  it('usePing entrega data tras el fetch inicial', async () => {
    const { client } = makeClient();
    const { result } = renderHook(() => usePing(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.data?.version).toBe('1.0.0'));
    expect(result.current.error).toBeNull();
  });

  it('useJobs re-fetchea INMEDIATAMENTE al cambiar el filtro, sin polling', async () => {
    const calls: Array<ListJobsFilter | undefined> = [];
    const { client, stub } = makeClient();
    (stub.listJobs as ReturnType<typeof vi.fn>).mockImplementation(
      async (f?: ListJobsFilter) => {
        calls.push(f);
        return listResponse([jobStub(f?.status ?? 'todos', f?.status ?? 'queued')]);
      },
    );
    const { result, rerender } = renderHook(
      ({ filter }: { filter: ListJobsFilter }) => useJobs(filter, { pollInterval: 0 }),
      { wrapper: wrapperFor(client), initialProps: { filter: { status: 'queued' } as ListJobsFilter } },
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(calls).toHaveLength(1);

    rerender({ filter: { status: 'failed' as const } });
    await waitFor(() => expect(result.current.data?.jobs[0]?.id).toBe('failed'));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.status).toBe('failed');
  });

  it('una respuesta vieja en vuelo no pisa a la más nueva', async () => {
    let resolveOld!: (v: ListJobsResponse) => void;
    const old = new Promise<ListJobsResponse>((r) => {
      resolveOld = r;
    });
    let first = true;
    const { client, stub } = makeClient();
    (stub.listJobs as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      if (first) {
        first = false;
        return old; // la primera request queda colgada
      }
      return listResponse([jobStub('nueva', 'queued')]);
    });
    const { result, rerender } = renderHook(
      ({ filter }: { filter: ListJobsFilter }) => useJobs(filter, { pollInterval: 0 }),
      { wrapper: wrapperFor(client), initialProps: { filter: {} as ListJobsFilter } },
    );
    rerender({ filter: { status: 'queued' as const } }); // segunda request, resuelve ya
    await waitFor(() => expect(result.current.data?.jobs[0]?.id).toBe('nueva'));

    await act(async () => {
      resolveOld(listResponse([jobStub('vieja', 'queued')])); // llega tarde
    });
    expect(result.current.data?.jobs[0]?.id).toBe('nueva'); // no fue pisada
  });

  it('enabled: false no dispara ninguna request', async () => {
    const { client, stub } = makeClient();
    renderHook(() => usePing({ enabled: false }), { wrapper: wrapperFor(client) });
    await new Promise((r) => setTimeout(r, 20));
    expect(stub.ping).not.toHaveBeenCalled();
  });

  it('useJob queda deshabilitado con id null y fetchea al llegar el id', async () => {
    const { client, stub } = makeClient();
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useJob(id),
      { wrapper: wrapperFor(client), initialProps: { id: null as string | null } },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(stub.getJob).not.toHaveBeenCalled();

    rerender({ id: 'j9' });
    await waitFor(() => expect(result.current.data?.id).toBe('j9'));
  });

  it('useSettings entrega los defaults del agente', async () => {
    const { client } = makeClient();
    const { result } = renderHook(() => useSettings(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.data?.machine_id).toBe('m1'));
  });
});

describe('hooks de acción', () => {
  it('usePrint expone data tras imprimir y error tras fallar', async () => {
    const { client, stub } = makeClient();
    const { result } = renderHook(() => usePrint(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.print('JVBERi0=');
    });
    expect(result.current.data?.job_id).toBe('j1');

    (stub.print as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      await result.current.print('JVBERi0=').catch(() => {});
    });
    expect(result.current.error?.message).toBe('boom');
  });

  it('useJobActions reintenta y cancela, con manejo de error', async () => {
    const { client, stub } = makeClient();
    const { result } = renderHook(() => useJobActions(), { wrapper: wrapperFor(client) });

    await act(async () => {
      const r = await result.current.retryJob('j1');
      expect(r.status).toBe('queued');
    });
    expect(stub.retryJob).toHaveBeenCalledWith('j1');
    expect(result.current.error).toBeNull();

    (stub.cancelJob as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('no se puede'));
    await act(async () => {
      await result.current.cancelJob('j2').catch(() => {});
    });
    expect(result.current.error?.message).toBe('no se puede');

    act(() => result.current.reset());
    expect(result.current.error).toBeNull();
  });
});

describe('usePairing', () => {
  it('sincroniza isPaired con el cliente y reacciona a onPairingChange', async () => {
    let paired = false;
    const { client, stub, firePairingChange } = makeClient();
    (stub.isPaired as ReturnType<typeof vi.fn>).mockImplementation(() => paired);

    const { result } = renderHook(() => usePairing(), { wrapper: wrapperFor(client) });
    expect(result.current.isPaired).toBe(false);

    // Simula un auto-pairing disparado desde otro hook.
    paired = true;
    act(() => firePairingChange());
    expect(result.current.isPaired).toBe(true);
  });

  it('pair() resuelve con el token y marca isPaired', async () => {
    const { client } = makeClient();
    const { result } = renderHook(() => usePairing(), { wrapper: wrapperFor(client) });
    await act(async () => {
      const tok = await result.current.pair();
      expect(tok).toBe('tok');
    });
    expect(result.current.isPaired).toBe(true);
  });
});
