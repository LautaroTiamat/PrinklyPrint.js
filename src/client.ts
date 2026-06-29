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
  PairingDeniedError,
  PairingRequiredError,
  TimeoutError,
} from './errors.js';
import { defaultTokenStore, type TokenStore } from './tokenStore.js';
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
  private readonly appName?: string;
  private readonly tokenStore: TokenStore;
  private readonly pairingTimeout: number;
  private readonly autoPair: boolean;
  /** Promise del pair() en vuelo, para deduplicar pareos concurrentes. */
  private pairPromise: Promise<string> | null = null;
  /** Listeners notificados cuando se cachea o limpia el token (pairing). */
  private readonly pairingListeners = new Set<() => void>();

  constructor(config: PrinklyPrintConfig = {}) {
    const {
      host = '127.0.0.1',
      port = 17777,
      baseUrl,
      timeout = 30_000,
      fetch: fetchImpl,
      appName,
      tokenStore,
      pairingTimeout = 120_000,
      autoPair = true,
    } = config;

    if (baseUrl) {
      this.baseUrl = baseUrl.replace(/\/$/, '');
    } else {
      this.baseUrl = `http://${normalizeHost(host)}:${port}`;
    }

    this.timeout = timeout;
    this.appName = appName;
    this.tokenStore = tokenStore ?? defaultTokenStore();
    this.pairingTimeout = pairingTimeout;
    this.autoPair = autoPair;
    // En entornos modernos (browser, Node ≥18, Deno, Bun) `fetch` ya es global.
    // En Node ≤17 hay que pasarlo explícito (`node-fetch`, `undici`).
    const resolvedFetch = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
    if (!resolvedFetch) {
      throw new Error(
        'No hay fetch disponible en este entorno. Pasá uno explícito en PrinklyPrintConfig.fetch.',
      );
    }
    // Bind explícito a globalThis para evitar "Illegal invocation" cuando lo
    // invocamos como `this.fetchImpl(...)`. El navegador requiere que el `this`
    // de fetch sea window (o globalThis); guardarlo como property del cliente
    // hace que el call-site pase la instancia como `this`, lo cual el browser
    // rechaza. .bind(globalThis) fija el contexto permanentemente y funciona
    // en browser (window), workers (self), Node ≥18 y Deno/Bun (global).
    this.fetchImpl = resolvedFetch.bind(globalThis);
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
    req: Omit<PrintRequest, 'pdf_base64'> = {},
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
    req: Omit<PrintRequest, 'pdf_base64'> = {},
  ): Promise<PrintResponse> {
    return this.request<PrintResponse>('POST', '/print', { pdf_base64, ...req });
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
  // Pairing / autenticación
  // ───────────────────────────────────────────────────────────────────

  /**
   * `true` si ya hay un token cacheado para este agente (es decir, esta app ya
   * se pareó). Útil para mostrar estado en la UI sin disparar una request.
   */
  isPaired(): boolean {
    return this.tokenStore.get(this.baseUrl) !== null;
  }

  /**
   * Se suscribe a cambios de pairing: invoca el listener cuando la librería
   * cachea un token nuevo (`pair()` exitoso) o lo invalida ante un `401`.
   * Devuelve una función para desuscribirse. Lo usa el hook `usePairing` de
   * React para mantener `isPaired` sincronizado incluso cuando el pareo ocurre
   * automáticamente desde otro método.
   */
  onPairingChange(listener: () => void): () => void {
    this.pairingListeners.add(listener);
    return () => {
      this.pairingListeners.delete(listener);
    };
  }

  private notifyPairingChange(): void {
    for (const listener of this.pairingListeners) listener();
  }

  /**
   * Hace el handshake de pairing con el agente (`POST /pair`) y cachea el token
   * resultante para este `baseUrl`. Normalmente NO necesitás llamarla a mano:
   * con `autoPair: true` (default) la librería paréa sola ante un `401`. Usala
   * manualmente solo si configuraste `autoPair: false` y querés controlar la UX.
   *
   * Usa `pairingTimeout` (más largo que el timeout normal) porque la primera vez
   * para un origen nuevo el agente puede mostrar un diálogo nativo y esperar a
   * que el operador apruebe.
   *
   * Los pareos concurrentes se deduplican: si ya hay un `pair()` en vuelo, las
   * llamadas simultáneas reusan la misma Promise.
   *
   * @returns El token obtenido (también queda cacheado en el `tokenStore`).
   * @throws {PairingDeniedError} si el agente responde `403` (operador rechazó
   *         o headless sin pre-aprobación).
   * @throws {AgentUnreachableError} si el agente no está corriendo.
   */
  async pair(): Promise<string> {
    // Dedupe: si ya hay un pareo en curso, reusamos su Promise.
    if (this.pairPromise) return this.pairPromise;

    const body = this.appName !== undefined ? { label: this.appName } : undefined;
    this.pairPromise = (async () => {
      const response = await this.doFetch('POST', '/pair', body, null, this.pairingTimeout);

      if (response.status === 403) {
        throw new PairingDeniedError(await this.parseErrorBody(response), this.baseUrl);
      }
      if (!response.ok) {
        throw new AgentResponseError(response.status, await this.parseErrorBody(response));
      }

      const data = await this.parseOkJson<{ token?: string }>(response);
      if (!data.token) {
        throw new AgentResponseError(response.status, {
          error: 'invalid_response',
          message: '/pair no devolvió un token',
        });
      }
      this.tokenStore.set(this.baseUrl, data.token);
      this.notifyPairingChange();
      return data.token;
    })();

    try {
      return await this.pairPromise;
    } finally {
      this.pairPromise = null;
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────

  /**
   * Wrapper único de `fetch` (chokepoint HTTP). Centraliza:
   * - El header `Authorization: Bearer <token>` cuando hay token cacheado.
   * - El flujo de re-pairing ante `401`: limpia el token, paréa UNA vez y
   *   reintenta el request original UNA vez con el token nuevo. Si `autoPair`
   *   es `false`, lanza `PairingRequiredError` en vez de parear.
   * - Serialización JSON, timeout, y traducción de errores.
   *
   * `/ping` y `/pair` están exentos: no llevan token ni disparan auto-pairing.
   * Esto preserva la retrocompatibilidad — contra un agente viejo que nunca
   * devuelve `401`, nunca se intenta parear.
   *
   * Todos los demás métodos de la clase pasan por acá.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    isRetry = false,
  ): Promise<T> {
    const exempt = path === '/ping' || path === '/pair';
    const token = exempt ? null : this.tokenStore.get(this.baseUrl);

    const response = await this.doFetch(method, path, body, token, this.timeout);

    // 401 en un endpoint sensible: el token falta, expiró o rotó en el agente.
    if (response.status === 401 && !exempt && !isRetry) {
      this.tokenStore.clear(this.baseUrl);
      this.notifyPairingChange();
      if (!this.autoPair) {
        throw new PairingRequiredError(this.baseUrl);
      }
      await this.pair(); // cachea el token nuevo; lanza PairingDeniedError si 403
      return this.request<T>(method, path, body, true); // reintento único
    }

    if (!response.ok) {
      throw new AgentResponseError(response.status, await this.parseErrorBody(response));
    }

    // El agente devuelve siempre JSON, incluso para los endpoints "void"
    // (los handlers de retry/cancel devuelven `{status: "..."}`).
    return this.parseOkJson<T>(response);
  }

  /**
   * Parsea el body de una respuesta 2xx como JSON. Si el agente (o un proxy)
   * devuelve un body no-JSON, traduce el fallo a `AgentResponseError` para que
   * TODA la superficie de error quede dentro de la jerarquía `PrinklyPrintError`
   * (simétrico con parseErrorBody).
   */
  private async parseOkJson<T>(response: Response): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch {
      throw new AgentResponseError(response.status, {
        error: 'invalid_response',
        message: 'el agente devolvió un body no-JSON en una respuesta 2xx',
      });
    }
  }

  /**
   * Ejecuta un único `fetch` con timeout y headers (Content-Type si hay body,
   * Authorization si hay token). Traduce errores de red/timeout pero NO
   * interpreta el status — eso lo hace quien llama (request / pair).
   */
  private async doFetch(
    method: string,
    path: string,
    body: unknown,
    token: string | null,
    timeoutMs: number,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // OJO: ahora puede haber headers SIN body (Authorization sin Content-Type).
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      return await this.fetchImpl(url, {
        method,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      // AbortError → timeout. Cualquier otra excepción es problema de red.
      if (err instanceof Error && err.name === 'AbortError') {
        throw new TimeoutError(timeoutMs, url);
      }
      throw new AgentUnreachableError(this.baseUrl, err);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parsea el body de una respuesta de error como `{error, message}`. Si el
   * agente devolvió algo distinto (proxy intermedio, etc.) cae a un body
   * genérico para no romper el `.body` del error.
   */
  private async parseErrorBody(response: Response): Promise<AgentErrorBody> {
    try {
      return (await response.json()) as AgentErrorBody;
    } catch {
      return { error: 'invalid_response', message: response.statusText || 'sin body parseable' };
    }
  }
}
