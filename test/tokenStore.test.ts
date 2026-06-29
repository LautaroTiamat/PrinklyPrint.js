import { describe, it, expect, afterEach } from 'vitest';

import {
  MemoryTokenStore,
  LocalStorageTokenStore,
  defaultTokenStore,
} from '../src/index.js';

// ─────────────────────────────────────────────────────────────────────
// Helpers para simular (o romper) localStorage en el entorno de test (Node).
// ─────────────────────────────────────────────────────────────────────

const originalLS = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function setLocalStorage(value: unknown) {
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true });
}

function restoreLocalStorage() {
  if (originalLS) Object.defineProperty(globalThis, 'localStorage', originalLS);
  else setLocalStorage(undefined);
}

function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    store: map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

function throwingLocalStorage() {
  return {
    getItem: () => {
      throw new Error('bloqueado');
    },
    setItem: () => {
      throw new Error('bloqueado');
    },
    removeItem: () => {
      throw new Error('bloqueado');
    },
  };
}

// localStorage que LEE bien pero falla al escribir/borrar (Safari incógnito,
// storage locked-down). Pre-sembrable para simular un valor viejo.
function readOnlyLocalStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: () => {
      throw new Error('write bloqueado');
    },
    removeItem: () => {
      throw new Error('remove bloqueado');
    },
  };
}

afterEach(() => restoreLocalStorage());

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('MemoryTokenStore', () => {
  it('get/set/clear', () => {
    const s = new MemoryTokenStore();
    expect(s.get('k')).toBeNull();
    s.set('k', 'tok');
    expect(s.get('k')).toBe('tok');
    s.clear('k');
    expect(s.get('k')).toBeNull();
  });

  it('aísla por key', () => {
    const s = new MemoryTokenStore();
    s.set('a', '1');
    s.set('b', '2');
    expect(s.get('a')).toBe('1');
    expect(s.get('b')).toBe('2');
  });
});

describe('LocalStorageTokenStore', () => {
  it('persiste en localStorage con prefijo', () => {
    const ls = fakeLocalStorage();
    setLocalStorage(ls);
    const s = new LocalStorageTokenStore();

    s.set('http://127.0.0.1:17777', 'tok');
    expect(ls.store.get('prinklyprint:token:http://127.0.0.1:17777')).toBe('tok');
    expect(s.get('http://127.0.0.1:17777')).toBe('tok');

    s.clear('http://127.0.0.1:17777');
    expect(s.get('http://127.0.0.1:17777')).toBeNull();
  });

  it('cae a memoria cuando localStorage tira excepción (modo incógnito)', () => {
    setLocalStorage(throwingLocalStorage());
    const s = new LocalStorageTokenStore();

    // set falla en localStorage → guarda en el fallback en memoria
    s.set('k', 'tok');
    // get también falla en localStorage → lee del fallback
    expect(s.get('k')).toBe('tok');
  });

  it('prefiere el fallback sobre un valor viejo de LS (lee OK, write/remove bloqueados)', () => {
    // Simula el camino de rotación de token: clear() no puede borrar (queda OLD
    // en LS) y set() no puede escribir (NEW cae al fallback). get() debe
    // devolver NEW, no el OLD que quedó en localStorage.
    setLocalStorage(readOnlyLocalStorage({ 'prinklyprint:token:k': 'OLD' }));
    const s = new LocalStorageTokenStore();

    s.clear('k'); // removeItem tira (tragado) → OLD sigue en LS
    s.set('k', 'NEW'); // setItem tira → NEW va al fallback
    expect(s.get('k')).toBe('NEW');
  });
});

describe('defaultTokenStore', () => {
  it('devuelve MemoryTokenStore cuando no hay localStorage (Node/SSR)', () => {
    setLocalStorage(undefined);
    expect(defaultTokenStore()).toBeInstanceOf(MemoryTokenStore);
  });

  it('devuelve LocalStorageTokenStore cuando localStorage está disponible', () => {
    setLocalStorage(fakeLocalStorage());
    expect(defaultTokenStore()).toBeInstanceOf(LocalStorageTokenStore);
  });

  it('cae a MemoryTokenStore si localStorage existe pero tira al escribir', () => {
    setLocalStorage(throwingLocalStorage());
    expect(defaultTokenStore()).toBeInstanceOf(MemoryTokenStore);
  });
});
