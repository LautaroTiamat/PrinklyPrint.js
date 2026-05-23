/**
 * # `prinklyprint.js/react`
 *
 * Adapter React de PrinklyPrint.js. Provee:
 *
 * - `PrinklyPrintProvider` — context que comparte una instancia del cliente
 *   con todo el árbol. Evita instanciar `PrinklyPrint` en cada componente.
 * - Hooks de **lectura** (`usePing`, `usePrinters`, `useJobs`) — devuelven
 *   `{data, error, isLoading, refresh}` y soportan polling configurable.
 * - Hook de **acción** (`usePrint`) — devuelve `{print, isLoading, error, data}`
 *   y maneja el estado de la mutación.
 *
 * React es **peerDependency opcional**: la librería core funciona sin él. Solo
 * pagás React si importás desde este entry point.
 *
 * @example
 * ```tsx
 * import { PrinklyPrintProvider, usePrint, useJobs } from 'prinklyprint.js/react';
 *
 * function App() {
 *   return (
 *     <PrinklyPrintProvider config={{ port: 17777 }}>
 *       <PrintButton />
 *       <Queue />
 *     </PrinklyPrintProvider>
 *   );
 * }
 *
 * function PrintButton() {
 *   const { print, isLoading, error } = usePrint();
 *   async function handleClick() {
 *     const blob = await fetch('/api/factura.pdf').then(r => r.blob());
 *     await print(blob, { filename: 'factura.pdf' });
 *   }
 *   return (
 *     <button onClick={handleClick} disabled={isLoading}>
 *       {isLoading ? 'Enviando…' : 'Imprimir'}
 *       {error && <span>{error.message}</span>}
 *     </button>
 *   );
 * }
 *
 * function Queue() {
 *   const { data, isLoading } = useJobs({ pollInterval: 3000 });
 *   if (isLoading) return <p>Cargando…</p>;
 *   return <ul>{data?.jobs.map(j => <li key={j.id}>{j.filename}</li>)}</ul>;
 * }
 * ```
 *
 * @module
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { PrinklyPrint } from './client.js';
import { PrinklyPrintError } from './errors.js';
import type {
  ListJobsFilter,
  ListJobsResponse,
  PingResponse,
  PrintablePDF,
  PrintRequest,
  PrintResponse,
  Printer,
  PrinklyPrintConfig,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Context + Provider
// ─────────────────────────────────────────────────────────────────────

const PrinklyPrintContext = createContext<PrinklyPrint | null>(null);

export interface PrinklyPrintProviderProps {
  /**
   * Pasale la config del cliente (host, port, timeout, etc.). Si ya tenés una
   * instancia, usá `client` en su lugar.
   */
  config?: PrinklyPrintConfig;
  /**
   * Si pasás `client`, ignora `config` — usa tu instancia tal cual. Útil para
   * tests o para reusar una instancia compartida con código no-React.
   */
  client?: PrinklyPrint;
  children: ReactNode;
}

/**
 * Wrappea tu árbol de componentes para que cualquier hijo pueda acceder al
 * cliente vía hooks. Por lo general lo ponés una sola vez, alto en el árbol.
 *
 * La instancia se memoiza con `config` como dep, así si cambiás el port
 * dinámicamente (por ejemplo en una pantalla de settings) los hooks se
 * re-suscriben al nuevo agente automáticamente.
 */
export function PrinklyPrintProvider(props: PrinklyPrintProviderProps) {
  const { config, client, children } = props;

  // Estabilizamos la instancia por valor de config — comparación shallow.
  // Si pasás `client` directamente, lo respetamos sin envolver.
  const instance = useMemo(() => {
    if (client) return client;
    return new PrinklyPrint(config);
  }, [client, config?.baseUrl, config?.host, config?.port, config?.timeout, config?.fetch]);

  return createElement(PrinklyPrintContext.Provider, { value: instance }, children);
}

/**
 * Devuelve la instancia compartida del cliente. Tirá un error si no estás
 * dentro de un `<PrinklyPrintProvider>`; eso te evita bugs silenciosos.
 */
export function usePrinklyPrint(): PrinklyPrint {
  const ctx = useContext(PrinklyPrintContext);
  if (!ctx) {
    throw new PrinklyPrintError(
      'usePrinklyPrint debe usarse dentro de <PrinklyPrintProvider>.',
    );
  }
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────
// Hook genérico de "query" con polling
// ─────────────────────────────────────────────────────────────────────

/**
 * Estado estándar de cualquier hook de lectura: `data` cuando llegó la
 * respuesta, `error` si falló, `isLoading` mientras está pidiendo, y
 * `refresh()` para forzar otra request.
 */
export interface QueryState<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
  /** Dispara una nueva request inmediata (ignorando el ciclo de polling). */
  refresh: () => Promise<void>;
}

export interface QueryOptions {
  /**
   * Intervalo de polling en ms. Si lo pasás, el hook hace `fetcher()` cada
   * X ms automáticamente. Omitilo (o `0`) para deshabilitar polling.
   */
  pollInterval?: number;
  /**
   * Si es `false`, el hook NO arranca la primera fetch automática. Útil para
   * lazy-load donde querés decidir cuándo empezar.
   *
   * @default true
   */
  enabled?: boolean;
}

/**
 * Hook helper que NO está exportado al público — se usa internamente por los
 * hooks específicos para evitar duplicar la mecánica de polling + manejo de
 * unmount + race conditions.
 */
function useQuery<T>(fetcher: () => Promise<T>, options: QueryOptions = {}): QueryState<T> {
  const { pollInterval = 0, enabled = true } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Ref para que el cleanup de useEffect pueda ignorar respuestas que llegan
  // después de que el componente se desmontó (evita setState en unmounted).
  const aliveRef = useRef(true);

  // Mantenemos fetcher en un ref para que la fn estable de `refresh` lo lea
  // siempre actualizado sin tener que re-crear el callback.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    if (!aliveRef.current) return;
    setIsLoading(true);
    try {
      const result = await fetcherRef.current();
      if (!aliveRef.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (aliveRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    if (!enabled) return;

    void refresh();

    if (pollInterval > 0) {
      const handle = setInterval(() => void refresh(), pollInterval);
      return () => {
        aliveRef.current = false;
        clearInterval(handle);
      };
    }

    return () => {
      aliveRef.current = false;
    };
  }, [enabled, pollInterval, refresh]);

  return { data, error, isLoading, refresh };
}

// ─────────────────────────────────────────────────────────────────────
// Hooks públicos de lectura
// ─────────────────────────────────────────────────────────────────────

/**
 * Monitorea el healthcheck del agente. Útil para mostrar un indicador de
 * "PrinklyPrint conectado" en el header de tu app.
 *
 * @example
 * ```tsx
 * function StatusIndicator() {
 *   const { data, error } = usePing({ pollInterval: 5000 });
 *   if (error) return <span>🔴 Agente desconectado</span>;
 *   if (data?.paused) return <span>⏸ En pausa</span>;
 *   return <span>🟢 Listo</span>;
 * }
 * ```
 */
export function usePing(options?: QueryOptions): QueryState<PingResponse> {
  const client = usePrinklyPrint();
  return useQuery(() => client.ping(), options);
}

/**
 * Lista las impresoras del sistema. Refrescala periódicamente si querés
 * detectar impresoras enchufadas/desenchufadas en tiempo real.
 */
export function usePrinters(options?: QueryOptions): QueryState<Printer[]> {
  const client = usePrinklyPrint();
  return useQuery(() => client.listPrinters(), options);
}

/**
 * Lista jobs de la cola con polling automático.
 *
 * Por default usa `pollInterval: 3000` porque la cola es lo que más cambia
 * en tiempo real (jobs pasan de `queued` → `printing` → `done`). Si no querés
 * polling, pasale `{pollInterval: 0}`.
 */
export function useJobs(
  filter: ListJobsFilter = {},
  options: QueryOptions = {},
): QueryState<ListJobsResponse> {
  const client = usePrinklyPrint();
  const { pollInterval = 3000 } = options;
  // Estabilizar la dependencia de filter para que el callback no se recree
  // en cada render salvo que el filtro cambie efectivamente.
  const filterKey = JSON.stringify(filter);
  const fetcher = useCallback(() => client.listJobs(filter), [client, filterKey]);
  return useQuery(fetcher, { ...options, pollInterval });
}

// ─────────────────────────────────────────────────────────────────────
// Hook de mutación
// ─────────────────────────────────────────────────────────────────────

/** Estado del hook `usePrint` mientras se procesa la impresión. */
export interface PrintMutationState {
  /**
   * Función que dispara la impresión. Devuelve una Promise con la respuesta
   * del agente (`{job_id, status: 'queued'}`).
   */
  print: (
    pdf: PrintablePDF,
    req?: Omit<PrintRequest, 'pdf_base64' | 'pdf_url'>,
  ) => Promise<PrintResponse>;

  /** `true` mientras la request HTTP está en vuelo. */
  isLoading: boolean;

  /** Última respuesta exitosa (queda persistida hasta el próximo `print()`). */
  data: PrintResponse | null;

  /** Último error (queda persistido hasta el próximo `print()` exitoso). */
  error: Error | null;

  /** Resetea `data` y `error` sin disparar una nueva impresión. */
  reset: () => void;
}

/**
 * Hook para acciones de impresión, con manejo de estado pensado para botones.
 *
 * @example
 * ```tsx
 * function PrintButton({ blob, filename }: { blob: Blob; filename: string }) {
 *   const { print, isLoading, error, data } = usePrint();
 *
 *   return (
 *     <>
 *       <button
 *         disabled={isLoading}
 *         onClick={() => print(blob, { filename })}
 *       >
 *         {isLoading ? 'Imprimiendo…' : 'Imprimir'}
 *       </button>
 *       {error && <p style={{color: 'red'}}>{error.message}</p>}
 *       {data && <p>Job creado: {data.job_id}</p>}
 *     </>
 *   );
 * }
 * ```
 */
export function usePrint(): PrintMutationState {
  const client = usePrinklyPrint();
  const [data, setData] = useState<PrintResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const print = useCallback(
    async (pdf: PrintablePDF, req?: Omit<PrintRequest, 'pdf_base64' | 'pdf_url'>) => {
      setIsLoading(true);
      try {
        const result = await client.print(pdf, req);
        if (aliveRef.current) {
          setData(result);
          setError(null);
        }
        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (aliveRef.current) setError(e);
        // Re-lanzamos para que el caller pueda hacer await print() y catch.
        throw e;
      } finally {
        if (aliveRef.current) setIsLoading(false);
      }
    },
    [client],
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
  }, []);

  return { print, isLoading, data, error, reset };
}
