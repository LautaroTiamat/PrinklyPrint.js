/**
 * Jerarquía de errores que la librería puede lanzar. Todos heredan de
 * `PrinklyPrintError`, así podés tener un único `catch` general y, opcionalmente,
 * discriminar con `instanceof` para mensajes más específicos.
 *
 * @example
 * try {
 *   await printer.print(blob);
 * } catch (err) {
 *   if (err instanceof AgentUnreachableError) {
 *     mostrarMensaje('PrinklyPrint no está corriendo en esta PC.');
 *   } else if (err instanceof AgentResponseError && err.status === 400) {
 *     mostrarMensaje('PDF rechazado: ' + err.body.message);
 *   } else {
 *     console.error(err);
 *   }
 * }
 *
 * @module
 */

import type { AgentErrorBody } from './types.js';

/**
 * Error base. Cualquier error originado por esta librería es instancia de esta
 * clase. Útil para `try/catch` genéricos sin tener que listar cada subclase.
 */
export class PrinklyPrintError extends Error {
  override readonly name: string = 'PrinklyPrintError';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    // Restaurar prototype chain para que `instanceof` funcione con targets ≤ ES5
    // (algunos bundlers viejos transpilan la herencia de Error de forma rota).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * No se pudo establecer conexión con el agente PrinklyPrint.
 *
 * Las causas habituales son:
 * - El agente no está instalado en esta PC.
 * - El agente está instalado pero no está corriendo (cerrado por el usuario).
 * - El operador cambió el puerto y tu app sigue apuntando al default.
 * - Hay un firewall/antivirus bloqueando el loopback.
 *
 * Mostrale al usuario un mensaje claro sugiriendo abrir PrinklyPrint o
 * descargarlo de github.com/LautaroTiamat/PrinklyPrint/releases/latest.
 */
export class AgentUnreachableError extends PrinklyPrintError {
  override readonly name = 'AgentUnreachableError';

  constructor(
    public readonly baseUrl: string,
    cause?: unknown,
  ) {
    super(
      `No se pudo conectar al agente PrinklyPrint en ${baseUrl}. ` +
        'Verificá que esté instalado y corriendo en la PC.',
      { cause },
    );
  }
}

/**
 * El agente respondió con un status HTTP de error (4xx/5xx).
 *
 * El body parseado queda accesible en `.body` con la forma `{error, message}`.
 * El código machine-readable (`body.error`) es estable; el `message` puede
 * cambiar entre versiones y suele estar en español.
 */
export class AgentResponseError extends PrinklyPrintError {
  override readonly name = 'AgentResponseError';

  constructor(
    public readonly status: number,
    public readonly body: AgentErrorBody,
  ) {
    super(`PrinklyPrint respondió ${status} (${body.error}): ${body.message}`);
  }
}

/**
 * La request HTTP superó el `timeout` configurado en `PrinklyPrintConfig` y
 * fue cancelada con `AbortController`.
 *
 * Para impresiones pesadas (PDFs de muchas páginas) podés subir el timeout
 * al instanciar el cliente.
 */
export class TimeoutError extends PrinklyPrintError {
  override readonly name = 'TimeoutError';

  constructor(
    public readonly timeoutMs: number,
    public readonly url: string,
  ) {
    super(
      `La request a ${url} superó el timeout de ${timeoutMs}ms. ` +
        'Si tu PDF es muy grande, subí el timeout en el constructor.',
    );
  }
}
