/**
 * Cliente HTTP del agente PrinklyPrint.
 *
 * Esta clase es el núcleo de la librería: encapsula `fetch`, maneja el timeout
 * con `AbortController`, parsea las respuestas JSON y traduce los errores HTTP
 * a la jerarquía de errores tipada de `errors.ts`.
 *
 * El consumo es 100% no-bloqueante (Promises / async-await). No usamos
 * EventEmitter ni callbacks — todos los métodos devuelven Promise.
 *
 * @module
 */

import {
  AgentResponseError,
  AgentUnreachableError,
  TimeoutError,
} from './errors.js';
import { normalizeHost, toBase64 } from './utils.js';
import type {
  AgentErrorBody,
  AgentSettings,
  Job,
  JobStatus,
  ListJobsFilter,
  ListJobsResponse,
  PingResponse,
  PrintablePDF,
  PrintOptions,
  PrintRequest,
  PrintResponse,
  Printer,
  PrinklyPrintConfig,
} from './types.js';

/**
 * Cliente del agente PrinklyPrint corriendo en `127.0.0.1:17777` (default).
 *
 * Es seguro reusar una sola instancia para toda la app — los métodos no
 * mantienen estado mutable entre llamadas. De hecho es lo recomendado, así
 * la base URL queda centralizada.
 *
 * @example Setup mínimo
 * ```ts
 * import { PrinklyPrint } from 'prinklyprint.js';
 *
 * const printer = new PrinklyPrint();
 * await printer.ping();
 * ```
 *
 * @example Puerto custom
 * ```ts
 * const printer = new PrinklyPrint({ port: 17800 });
 * ```
 *
 * @example Imprimir un PDF descargado
 * ```ts
 * const blob = await fetch('/api/factura/123.pdf').then(r => r.blob());
 * const { job_id } = await printer.print(blob, {
 *   filename: 'factura-123.pdf',
 *   options: { copies: 2 },
 *   metadata: { orderId: '123' },
 * });
 * ```
 */
export class PrinklyPrint {
  /** URL base ya armada y normalizada. Sin trailing slash. */
  public readonly baseUrl: string;

  private readonly timeout: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: PrinklyPrintConfig = {}) {
    const { host = '127.0.0.1', port = 17777, baseUrl, timeout = 30_000, fetch: fetchImpl } = config;

    if (baseUrl) {
      this.baseUrl = baseUrl.replace(/\/$/, '');
    } else {
      this.baseUrl = `http://${normalizeHost(host)}:${port}`;
    }

    this.timeout = timeout;
    // En entornos modernos (browser, Node ≥18, Deno, Bun) `fetch` ya es global.
    // En Node ≤17 hay que pasarlo explícito (`node-fetch`, `undici`).
    const resolvedFetch = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
    if (!resolvedFetch) {
      throw new Error(
        'No hay fetch disponible en este entorno. Pasá uno explícito en PrinklyPrintConfig.fetch.',
      );
    }
    this.fetchImpl = resolvedFetch;
  }

  // ───────────────────────────────────────────────────────────────────
  // Endpoints de salud y descubrimiento
  // ───────────────────────────────────────────────────────────────────

  /**
   * Healthcheck del agente. Si esta llamada falla con `AgentUnreachableError`,
   * el agente probablemente no está corriendo.
   *
   * También devuelve `paused`: cuando es `true`, los nuevos jobs se aceptan
   * pero quedan en cola sin procesarse hasta que el operador reanude desde la
   * UI / bandeja.
   */
  ping(): Promise<PingResponse> {
    return this.request<PingResponse>('GET', '/ping');
  }

  /**
   * Lista las impresoras instaladas en el sistema operativo del operador.
   *
   * El estado viene enriquecido (severity ok/warn/error) — útil para mostrar
   * un selector con colores. La impresora marcada `is_default: true` es la que
   * se usa cuando no especificás `options.printer` en `print()`.
   */
  listPrinters(): Promise<Printer[]> {
    return this.request<Printer[]>('GET', '/printers');
  }

  /**
   * Devuelve los defaults de impresión que el operador configuró en la
   * pestaña "Impresión" del agente.
   *
   * Esos defaults son los que el agente aplica cuando una request `/print`
   * no incluye ese campo en `options`. Útil para inicializar formularios
   * de impresión con los mismos valores que el operador eligió.
   */
  getSettings(): Promise<AgentSettings> {
    return this.request<AgentSettings>('GET', '/settings');
  }

  // ───────────────────────────────────────────────────────────────────
  // Encolar trabajos de impresión
  // ───────────────────────────────────────────────────────────────────

  /**
   * Encola un PDF para imprimir. Acepta `Blob`, `File`, `ArrayBuffer`,
   * `Uint8Array` o un string base64; la librería se encarga de convertirlo.
   *
   * Esta es la forma idiomática de imprimir y la que vas a usar el 95% del
   * tiempo. Internamente delega en `printBase64` después de convertir.
   *
   * @param pdf  El PDF a imprimir (en cualquier formato soportado).
   * @param req  Filename, options y metadata. `filename` es muy recomendable
   *             para que la cola del operador sea legible.
   */
  async print(
    pdf: PrintablePDF,
    req: Omit<PrintRequest, 'pdf_base64' | 'pdf_url'> = {},
  ): Promise<PrintResponse> {
    const pdf_base64 = await toBase64(pdf);
    return this.printBase64(pdf_base64, req);
  }

  /**
   * Versión "raw" de `print()` para cuando ya tenés el PDF en base64 y querés
   * evitar la conversión interna. Es lo que `print()` llama por debajo.
   */
  printBase64(
    pdf_base64: string,
    req: Omit<PrintRequest, 'pdf_base64' | 'pdf_url'> = {},
  ): Promise<PrintResponse> {
    return this.request<PrintResponse>('POST', '/print', { pdf_base64, ...req });
  }

  /**
   * Le pide al agente que descargue el PDF desde una URL pública y luego lo
   * imprima. La descarga ocurre **en la PC del operador** — el navegador del
   * usuario no participa, así que es perfecta cuando el PDF ya está alojado
   * en un servidor accesible.
   *
   * Si la URL requiere autenticación, mejor descargá el PDF en tu app web
   * (con los headers correctos) y usá `print(blob)` en lugar de esto.
   */
  printFromUrl(
    pdf_url: string,
    req: Omit<PrintRequest, 'pdf_base64' | 'pdf_url'> = {},
  ): Promise<PrintResponse> {
    return this.request<PrintResponse>('POST', '/print', { pdf_url, ...req });
  }

  // ───────────────────────────────────────────────────────────────────
  // Gestión de la cola
  // ───────────────────────────────────────────────────────────────────

  /**
   * Lista jobs de la cola, con filtros opcionales.
   *
   * Útil para construir un dashboard de "trabajos pendientes" o un historial.
   * Los jobs vienen ordenados por `created_at` descendente.
   */
  listJobs(filter: ListJobsFilter = {}): Promise<ListJobsResponse> {
    const params = new URLSearchParams();
    if (filter.status) params.set('status', filter.status);
    if (filter.limit !== undefined) params.set('limit', String(filter.limit));
    if (filter.offset !== undefined) params.set('offset', String(filter.offset));
    const qs = params.toString();
    return this.request<ListJobsResponse>('GET', qs ? `/jobs?${qs}` : '/jobs');
  }

  /**
   * Devuelve el detalle de un job por id, incluyendo intentos, último error
   * y el output crudo de SumatraPDF (útil para debug de impresiones fallidas).
   *
   * @throws {AgentResponseError} con `.status === 404` si el id no existe.
   */
  getJob(id: string): Promise<Job> {
    return this.request<Job>('GET', `/jobs/${encodeURIComponent(id)}`);
  }

  /**
   * Reencola un job en estado `failed`. Resetea el contador de intentos.
   *
   * @throws {AgentResponseError} `404` si no existe o no está en `failed`.
   */
  retryJob(id: string): Promise<{ status: JobStatus }> {
    return this.request<{ status: JobStatus }>('POST', `/jobs/${encodeURIComponent(id)}/retry`);
  }

  /**
   * Cancela un job en estado `queued`. Si ya empezó a imprimirse no se puede
   * cancelar — el spooler de Windows ya tomó el control.
   *
   * @throws {AgentResponseError} `404` si no existe o no se puede cancelar.
   */
  cancelJob(id: string): Promise<{ status: JobStatus }> {
    return this.request<{ status: JobStatus }>('DELETE', `/jobs/${encodeURIComponent(id)}`);
  }

  // ───────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────

  /**
   * Wrapper único de `fetch` que centraliza:
   * - Construcción de la URL absoluta.
   * - Serialización JSON del body.
   * - Timeout vía `AbortController`.
   * - Traducción de errores de red → `AgentUnreachableError`.
   * - Traducción de status ≥ 400 → `AgentResponseError` con el body parseado.
   *
   * Todos los demás métodos de la clase pasan por acá.
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      // AbortError → timeout. Cualquier otra excepción es problema de red.
      if (err instanceof Error && err.name === 'AbortError') {
        throw new TimeoutError(this.timeout, url);
      }
      throw new AgentUnreachableError(this.baseUrl, err);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      // Intentamos parsear el body como {error, message}. Si el agente devolvió
      // algo distinto (proxy intermedio, error de wine, etc.) caemos a un body
      // genérico para no romper el .body del error.
      let body: AgentErrorBody;
      try {
        body = (await response.json()) as AgentErrorBody;
      } catch {
        body = { error: 'invalid_response', message: response.statusText || 'sin body parseable' };
      }
      throw new AgentResponseError(response.status, body);
    }

    // El agente devuelve siempre JSON, incluso para los endpoints "void"
    // (los handlers de retry/cancel devuelven `{status: "..."}`).
    return (await response.json()) as T;
  }
}
