/**
 * Tipos públicos de la librería PrinklyPrint.js.
 *
 * Estos tipos modelan exactamente lo que devuelve y acepta el agente
 * PrinklyPrint en su API HTTP. Cualquier cambio acá tiene que estar
 * sincronizado con `PrinklyPrint/internal/server/handlers.go`.
 *
 * @module
 */

/**
 * Configuración del cliente al instanciar `PrinklyPrint`.
 */
export interface PrinklyPrintConfig {
  /**
   * Host donde escucha el agente.
   *
   * Casi siempre es `127.0.0.1` (loopback) porque el agente corre en la
   * misma PC que el navegador. Solo cambiá esto si tenés un setup raro
   * tipo VM con el agente en otra máquina de la LAN.
   *
   * @default '127.0.0.1'
   */
  host?: string;

  /**
   * Puerto donde escucha el agente.
   *
   * El default del agente es 17777, pero el operador puede cambiarlo desde
   * la pestaña General de la UI. Si tu organización usa otro puerto, pasalo
   * acá explícitamente.
   *
   * @default 17777
   */
  port?: number;

  /**
   * Si pasás `baseUrl`, ignora `host` y `port`. Útil cuando ya tenés la URL
   * armada (ej. `https://print.miempresa.com` detrás de un proxy reverso).
   *
   * @example 'http://192.168.1.50:17777'
   */
  baseUrl?: string;

  /**
   * Timeout en milisegundos para cada llamada HTTP. Si una request supera
   * este tiempo, se cancela con `TimeoutError`.
   *
   * @default 30000 (30 segundos)
   */
  timeout?: number;

  /**
   * `fetch` a usar internamente. Solo necesitás pasarlo si estás en un
   * entorno donde `fetch` no es global (Node ≤17, algunos workers exóticos).
   *
   * @default globalThis.fetch
   */
  fetch?: typeof fetch;
}

/**
 * Respuesta de `GET /ping`. El agente está vivo y respondiendo.
 */
export interface PingResponse {
  ok: true;
  /** Versión del agente PrinklyPrint instalado en la PC del operador. */
  version: string;
  /** Identificador estable de la PC (hash de hostname + dataDir). */
  machine_id: string;
  /** Si el operador puso la cola en pausa, no se procesan nuevos jobs. */
  paused: boolean;
}

/**
 * Severidad del estado de una impresora. Útil para colorear UI:
 * - `ok` → verde, lista para imprimir
 * - `warn` → amarillo, ocupada o requiere atención menor
 * - `error` → rojo, no puede imprimir hasta intervención del usuario
 */
export type PrinterSeverity = 'ok' | 'warn' | 'error';

/**
 * Una impresora detectada por el agente en el sistema operativo.
 *
 * Viene de `EnumPrinters` de Win32 + el pre-flight check del agente que
 * normaliza los flags de estado del spooler de Windows en strings legibles.
 */
export interface Printer {
  name: string;
  is_default: boolean;
  is_network: boolean;
  /** Texto resumido del estado actual ("Lista", "Sin papel", "Offline", ...). */
  status: string;
  /** Lista completa de banderas de estado del spooler (puede tener varias). */
  statuses: string[];
  severity: PrinterSeverity;
  port_name?: string;
  driver_name?: string;
  location?: string;
  comment?: string;
  /** Cantidad de jobs en la cola del spooler de Windows (no nuestra cola). */
  job_count: number;
}

/**
 * Defaults de impresión configurados por el operador en la pestaña Impresión.
 * Son los valores que el agente usa cuando una request `/print` no especifica
 * ese campo en `options`.
 */
export interface AgentSettings {
  default_printer: string;
  paper_size: PaperSize;
  custom_width_mm: number;
  custom_height_mm: number;
  orientation: Orientation;
  color: boolean;
  duplex: Duplex;
  scale: Scale;
  paused: boolean;
}

/** Tamaño de papel soportado por SumatraPDF más una opción Custom. */
export type PaperSize = 'A4' | 'Letter' | 'Legal' | 'A5' | 'Custom' | string;

export type Orientation = 'portrait' | 'landscape';

/** Impresión a doble cara. `none` = solo cara A. */
export type Duplex = 'none' | 'long_edge' | 'short_edge';

/**
 * Cómo escalar el PDF al tamaño de papel:
 * - `fit` → ajustar (el default razonable).
 * - `shrink` → solo achicar si no entra, nunca agrandar.
 * - `noscale` → respetar el tamaño original del PDF, recortar si sobra.
 */
export type Scale = 'fit' | 'shrink' | 'noscale';

/**
 * Estado de un job en la cola del agente.
 *
 * Flujo normal: `queued` → `printing` → `done`.
 * Si falla y supera `max_retries`: `queued` → `printing` → `failed`.
 * Si el usuario lo cancela antes de imprimir: `queued` → `cancelled`.
 */
export type JobStatus = 'queued' | 'printing' | 'done' | 'failed' | 'cancelled';

/**
 * Opciones de impresión que se mergean con los defaults del agente.
 *
 * Reglas de merge (idénticas a `resolveOptions` en el agente):
 * - Strings vacíos o `undefined` → toman el default.
 * - `copies <= 0` o `undefined` → toman 1.
 * - `color` y dimensiones custom usan `undefined` como "no especificado":
 *   pasar `color: false` fuerza B&N aunque el default sea color.
 */
export interface PrintOptions {
  /** Nombre exacto de la impresora. Vacío = default del agente / sistema. */
  printer?: string;
  paper_size?: PaperSize;
  /** Solo se usa si `paper_size === 'Custom'`. */
  custom_width_mm?: number;
  custom_height_mm?: number;
  orientation?: Orientation;
  /** Cantidad de copias. ≥ 1. */
  copies?: number;
  duplex?: Duplex;
  color?: boolean;
  scale?: Scale;
  /** Rango de páginas estilo SumatraPDF, ej. "1,3-5,10". Vacío = todas. */
  page_range?: string;
}

/**
 * Cuerpo de una request `POST /print`.
 *
 * Tenés que pasar `pdf_base64` O `pdf_url` (exactamente uno). Las helpers
 * `print()`, `printBase64()` y `printFromUrl()` se encargan de armar esto
 * por vos.
 */
export interface PrintRequest {
  /** PDF codificado en base64 (sin el prefijo `data:application/pdf;base64,`). */
  pdf_base64?: string;
  /** URL pública que el agente va a descargar y luego imprimir. */
  pdf_url?: string;
  /** Nombre amigable para mostrar en la cola. Recomendado siempre setearlo. */
  filename?: string;
  options?: PrintOptions;
  /** Cualquier metadata libre para trazabilidad (orderId, ticketId, etc.). */
  metadata?: Record<string, unknown>;
}

/**
 * Respuesta de `POST /print`. Solo se devuelve el id del job y su estado
 * inicial (`queued`); para obtener el detalle hay que hacer `getJob(id)`.
 */
export interface PrintResponse {
  job_id: string;
  status: 'queued';
}

/**
 * Un job de impresión persistido en la cola del agente.
 *
 * Los campos `options` y `metadata` se devuelven ya parseados (no JSON
 * strings) — el agente hace `Unmarshal` en `jobToDTO`.
 */
export interface Job {
  id: string;
  filename: string;
  printer: string;
  options: PrintOptions | null;
  metadata: Record<string, unknown> | null;
  status: JobStatus;
  attempts: number;
  /** Último mensaje de error si `status === 'failed'`. */
  last_error: string;
  /** Output crudo de SumatraPDF de la última ejecución (útil para debug). */
  sumatra_log: string;
  /** ISO 8601 timestamp. */
  created_at: string;
  /** ISO 8601 timestamp. */
  updated_at: string;
  /** Presente solo si el job terminó (done/failed/cancelled). */
  completed_at?: string;
  /** Presente solo si está esperando un reintento programado. */
  next_attempt_at?: string;
}

/**
 * Filtros para `listJobs()`. Todos opcionales.
 */
export interface ListJobsFilter {
  /** Filtra por estado. Omitir = todos los estados. */
  status?: JobStatus;
  /** Cantidad máxima de jobs a devolver. */
  limit?: number;
  /** Offset para paginar resultados. */
  offset?: number;
}

/**
 * Respuesta de `GET /jobs`. Incluye el total para paginar y la página actual.
 */
export interface ListJobsResponse {
  total: number;
  limit: number;
  offset: number;
  jobs: Job[];
}

/**
 * Forma del cuerpo JSON que devuelve el agente cuando responde con un código
 * HTTP de error (4xx / 5xx).
 */
export interface AgentErrorBody {
  /** Código machine-readable, ej. `"bad_body"`, `"not_found"`. */
  error: string;
  /** Mensaje humano en español. */
  message: string;
}

/**
 * Cualquier dato "imprimible" que la librería sabe convertir a base64.
 * - `Blob` / `File`: típico cuando descargás el PDF con `fetch().blob()`.
 * - `ArrayBuffer` / `Uint8Array`: útil si lo generaste en memoria.
 * - `string`: se asume que YA está en base64.
 */
export type PrintablePDF = Blob | ArrayBuffer | Uint8Array | string;
