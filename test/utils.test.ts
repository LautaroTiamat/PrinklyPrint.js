import { describe, it, expect } from 'vitest';

import { toBase64, normalizeHost } from '../src/utils.js';
import { PrinklyPrintError } from '../src/errors.js';

// %PDF-1.4 en base64
const VALID_B64 = 'JVBERi0xLjQ=';

describe('toBase64 (string)', () => {
  it('devuelve el base64 válido tal cual', async () => {
    await expect(toBase64(VALID_B64)).resolves.toBe(VALID_B64);
  });

  it('recorta el prefijo de una data URL', async () => {
    await expect(toBase64(`data:application/pdf;base64,${VALID_B64}`)).resolves.toBe(
      VALID_B64,
    );
  });

  it('tolera whitespace (base64 copiado con saltos de línea)', async () => {
    await expect(toBase64('JVBE\nRi0x\r\nLjQ=')).resolves.toBe(VALID_B64);
  });

  it('rechaza un string que no es base64 (ej: binario del PDF como string)', async () => {
    await expect(toBase64('%PDF-1.4 binario crudo')).rejects.toBeInstanceOf(
      PrinklyPrintError,
    );
  });

  it('rechaza el string vacío', async () => {
    await expect(toBase64('')).rejects.toBeInstanceOf(PrinklyPrintError);
  });

  it('rechaza base64 con longitud inválida (no múltiplo de 4)', async () => {
    await expect(toBase64('JVBERi0')).rejects.toBeInstanceOf(PrinklyPrintError);
  });
});

describe('toBase64 (binario)', () => {
  it('convierte un Uint8Array', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4');
    await expect(toBase64(bytes)).resolves.toBe('JVBERi0xLjQ=');
  });

  it('convierte un ArrayBuffer', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4');
    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    await expect(toBase64(buf)).resolves.toBe('JVBERi0xLjQ=');
  });

  it('convierte un Blob (vía arrayBuffer en Node)', async () => {
    const blob = new Blob(['%PDF-1.4']);
    await expect(toBase64(blob)).resolves.toBe('JVBERi0xLjQ=');
  });
});

describe('normalizeHost', () => {
  it('saca scheme y trailing slash', () => {
    expect(normalizeHost('http://localhost/')).toBe('localhost');
    expect(normalizeHost('https://mi-pc')).toBe('mi-pc');
    expect(normalizeHost('  127.0.0.1 ')).toBe('127.0.0.1');
  });

  it('envuelve IPv6 literales en corchetes', () => {
    expect(normalizeHost('::1')).toBe('[::1]');
    expect(normalizeHost('fe80::1')).toBe('[fe80::1]');
  });

  it('no toca una IPv6 ya con corchetes ni hostnames comunes', () => {
    expect(normalizeHost('[::1]')).toBe('[::1]');
    expect(normalizeHost('localhost')).toBe('localhost');
    expect(normalizeHost('mi-servidor.local')).toBe('mi-servidor.local');
  });
});
