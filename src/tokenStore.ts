/**
 * Cache del token de pairing. El agente PrinklyPrint emite un token por
 * instalación (POST /pair) que hay que mandar como `Authorization: Bearer` en
 * los endpoints sensibles. Para no re-parear en cada llamada lo cacheamos.
 *
 * El cache es enchufable vía `TokenStore`, así podés persistirlo donde quieras
 * (localStorage en browser, archivo/Redis en Node, etc.). La key es por
 * `baseUrl` para que distintos puertos/agentes tengan tokens separados.
 *
 * @module
 */

/**
 * Almacén enchufable del token de pairing, indexado por una `key` (la baseUrl
 * del agente). Implementá esta interfaz para persistir el token donde necesites.
 */
export interface TokenStore {
  /** Devuelve el token cacheado para esa key, o `null` si no hay. */
  get(key: string): string | null;
  /** Guarda el token para esa key. */
  set(key: string, token: string): void;
  /** Borra el token de esa key (se usa cuando el agente devuelve 401). */
  clear(key: string): void;
}

/**
 * Store en memoria (un `Map` por proceso). Es el fallback cuando `localStorage`
 * no está disponible (SSR, Node, web workers) o tira excepción (modo incógnito,
 * cookies bloqueadas). No persiste entre recargas de página.
 */
export class MemoryTokenStore implements TokenStore {
  private readonly map = new Map<string, string>();

  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  set(key: string, token: string): void {
    this.map.set(key, token);
  }

  clear(key: string): void {
    this.map.delete(key);
  }
}

/** Prefijo de las keys en localStorage, para no colisionar con otras apps. */
const LS_PREFIX = 'prinklyprint:token:';

/**
 * Acceso defensivo a `localStorage`. El lib DOM de TypeScript lo tipa como
 * `Storage` NO opcional, pero en Node/SSR `globalThis.localStorage` es
 * `undefined`. Tipamos el acceso con la nullability real para que la guarda
 * `if (ls)` sea semánticamente correcta y un refactor futuro no la borre
 * creyéndola redundante. (Es property access sobre globalThis: en Node devuelve
 * undefined, no tira ReferenceError.)
 */
function getLocalStorage(): Storage | undefined {
  return (globalThis as { localStorage?: Storage }).localStorage;
}

/**
 * Store basado en `localStorage`. Persiste el token entre recargas de la
 * página. Cada método está envuelto en try/catch: si `localStorage` falla
 * (modo incógnito con storage bloqueado, cuota llena, etc.) cae a un store en
 * memoria interno, de modo que la librería nunca rompe por culpa del storage.
 */
export class LocalStorageTokenStore implements TokenStore {
  private readonly fallback = new MemoryTokenStore();

  get(key: string): string | null {
    // El fallback solo se puebla cuando una escritura NO pudo llegar a
    // localStorage; por eso, si tiene un valor, es el autoritativo para esa key
    // (más nuevo que cualquier valor viejo que haya quedado en localStorage si
    // un clear() previo no pudo borrarlo). Lo preferimos antes de leer de LS.
    const fb = this.fallback.get(key);
    if (fb !== null) return fb;
    try {
      return getLocalStorage()?.getItem(LS_PREFIX + key) ?? null;
    } catch {
      return null;
    }
  }

  set(key: string, token: string): void {
    try {
      const ls = getLocalStorage();
      if (!ls) throw new Error('no localStorage');
      ls.setItem(LS_PREFIX + key, token);
    } catch {
      this.fallback.set(key, token);
    }
  }

  clear(key: string): void {
    try {
      getLocalStorage()?.removeItem(LS_PREFIX + key);
    } catch {
      // ignoramos: el fallback se limpia igual abajo
    }
    // Siempre limpiamos también el fallback por las dudas.
    this.fallback.clear(key);
  }
}

/**
 * Elige el store default según el entorno: `localStorage` si está disponible y
 * usable, si no un store en memoria. La detección es defensiva: algunos
 * entornos exponen `localStorage` pero tiran al usarlo.
 */
export function defaultTokenStore(): TokenStore {
  try {
    const ls = getLocalStorage();
    if (ls) {
      // Probamos un set/remove real: en modo incógnito `localStorage` existe
      // pero puede lanzar al escribir. El removeItem va en finally para no
      // dejar la key de prueba si el setItem llegó a escribir.
      const probe = `${LS_PREFIX}__probe__`;
      try {
        ls.setItem(probe, '1');
      } finally {
        ls.removeItem(probe);
      }
      return new LocalStorageTokenStore();
    }
  } catch {
    // cae a memoria
  }
  return new MemoryTokenStore();
}
