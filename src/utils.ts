/**
 * Helpers internos de la librería. No están exportados desde el index público
 * para mantener la API estable; son detalles de implementación.
 *
 * @module
 * @internal
 */

import type { PrintablePDF } from './types.js';

/**
 * Convierte cualquier `PrintablePDF` a un string base64 puro (sin el prefijo
 * `data:application/pdf;base64,`).
 *
 * - Si ya es un string, lo devuelve tal cual (asume que es base64 válido). Si
 *   detecta el prefijo `data:` lo recorta automáticamente.
 * - Si es un `Blob` / `File`, lo lee con `FileReader` y le saca el prefijo.
 * - Si es un `ArrayBuffer` / `Uint8Array`, lo convierte byte a byte.
 *
 * Esta es la única conversión que la librería hace por vos; el agente
 * solo acepta base64 (no admite multipart/form-data ni binario crudo, para
 * mantener el endpoint de print trivialmente JSON).
 */
export async function toBase64(input: PrintablePDF): Promise<string> {
  if (typeof input === 'string') {
    // Soporta data URLs: 'data:application/pdf;base64,JVBERi0...'
    const commaIdx = input.indexOf(',');
    if (input.startsWith('data:') && commaIdx !== -1) {
      return input.slice(commaIdx + 1);
    }
    return input;
  }

  if (input instanceof ArrayBuffer) {
    return arrayBufferToBase64(input);
  }
  if (input instanceof Uint8Array) {
    // Copia el rango efectivo en un ArrayBuffer puro para evitar el caso
    // SharedArrayBuffer (que TS marca como incompatible con ArrayBuffer).
    const copy = new Uint8Array(input.byteLength);
    copy.set(input);
    return arrayBufferToBase64(copy.buffer);
  }

  // Blob / File: usamos FileReader si está disponible (browser) y fallback a
  // Buffer.from si estamos en Node.
  if (typeof FileReader !== 'undefined') {
    return blobToBase64ViaFileReader(input);
  }
  // Node 18+: Blob expone arrayBuffer()
  const buf = await input.arrayBuffer();
  return arrayBufferToBase64(buf);
}

function blobToBase64ViaFileReader(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader devolvió un tipo inesperado'));
        return;
      }
      // result es 'data:<mime>;base64,<datos>'. Sacamos el prefijo.
      const commaIdx = result.indexOf(',');
      resolve(commaIdx === -1 ? result : result.slice(commaIdx + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader falló'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Conversión binaria → base64 sin depender de `Buffer` (para que funcione
 * idéntico en browser y Node). Procesa en chunks de 32 KB para no chocar
 * contra el límite de argumentos de `String.fromCharCode`.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  // btoa es estándar en browsers y existe en Node ≥16; los runtimes más viejos
  // ya no son soportados (`engines.node = >=18` en package.json).
  return btoa(binary);
}

/**
 * Pequeño helper para validar que `host` no incluya scheme ni path. El
 * constructor del cliente arma la URL `http://${host}:${port}` así que si
 * pasás `http://localhost` por accidente, la URL queda mal formada.
 */
export function normalizeHost(host: string): string {
  return host
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
}
