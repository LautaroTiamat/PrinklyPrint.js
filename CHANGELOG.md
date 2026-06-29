# Changelog

Todas las versiones notables de PrinklyPrint.js quedan documentadas acá. Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y el proyecto sigue [Semantic Versioning](https://semver.org/lang/es/).

## [2.0.0] — 2026-06-29

**BREAKING CHANGE.** Se eliminó `printFromUrl()` y el campo `pdf_url` del request. El agente PrinklyPrint ya no descarga PDFs desde una URL remota: ahora el PDF se manda **siempre inline** (base64) vía `print()` / `printBase64()`.

### Eliminado
- **`PrinklyPrint.printFromUrl(url, req?)`** — removido por completo. La descarga remota la hacía el agente, lo que constituía una superficie de **SSRF** (podía ser inducido a pedir recursos internos de la red) sin un caso de uso que no se resolviera mejor desde la app cliente.
- **Campo `pdf_url`** de la interfaz `PrintRequest`. En consecuencia, los tipos de `print()`/`printBase64()` (y los hooks de React) pasaron de `Omit<PrintRequest, 'pdf_base64' | 'pdf_url'>` a `Omit<PrintRequest, 'pdf_base64'>`.

### Seguridad
- Cierra la clase de vulnerabilidad **SSRF** de raíz (en vez de blindarla): alineado con el agente, que eliminó el endpoint de descarga remota y **ya no realiza ninguna conexión saliente de red**.

### Migración
- Si usabas `printFromUrl(url, req)`: obtené el PDF en tu app y mandalo inline.
  ```ts
  // antes
  await printer.printFromUrl('https://mi-servidor/factura.pdf', { filename: 'factura.pdf' });
  // ahora
  const blob = await fetch('https://mi-servidor/factura.pdf').then(r => r.blob());
  await printer.print(blob, { filename: 'factura.pdf' });
  ```
- Si construías un `PrintRequest` a mano con `pdf_url`, ese campo ya no existe: usá `pdf_base64`.

## [1.1.0] — 2026-06-29

Soporte de **autenticación por token con pairing automático**, para acompañar al agente PrinklyPrint ≥ 1.1.0, que ahora exige un token bearer por instalación en los endpoints sensibles. **Retrocompatible**: contra un agente viejo (que nunca devuelve `401`) la librería funciona exactamente como antes, sin tocar `/pair`.

### Agregado
- **Pairing automático y transparente**: ante un `401`, la librería limpia el token cacheado, llama a `POST /pair` una vez y reintenta el request original con el token nuevo. Todo desde el único chokepoint HTTP (`request()`), así aplica a todos los métodos.
- **Método público `pair()`**: dispara el handshake a mano (útil con `autoPair: false` o para una UX explícita "Conectar con PrinklyPrint"). Usa un timeout más largo (`pairingTimeout`, default 120 s) porque el agente puede mostrar un diálogo nativo y esperar la aprobación del operador. Los pareos concurrentes se deduplican (reusan la misma Promise).
- **Método `isPaired()`**: indica si hay token cacheado para el agente actual.
- **Cache de token enchufable** (`TokenStore`): por default usa `localStorage` (`LocalStorageTokenStore`, key por `baseUrl`), con fallback automático a memoria (`MemoryTokenStore`) en SSR/Node o si `localStorage` falla (modo incógnito). Inyectable vía `config.tokenStore`. Se exportan `TokenStore`, `MemoryTokenStore`, `LocalStorageTokenStore` y `defaultTokenStore`.
- **Nuevas opciones en `PrinklyPrintConfig`** (todas opcionales): `appName` (etiqueta para el diálogo del agente), `tokenStore`, `pairingTimeout`, `autoPair`.
- **Nuevos errores**: `PairingDeniedError` (el operador/agente rechazó el pareo, o headless sin pre-aprobación) y `PairingRequiredError` (solo con `autoPair: false`: hay que llamar a `pair()`).
- **React**: hook `usePairing()` → `{ pair, isLoading, error, isPaired }`. Los hooks existentes (`usePrint`, `useJobs`, …) ya propagan `PairingDeniedError`/`PairingRequiredError` en su campo `error`.

### Cambiado
- Cada request a un endpoint sensible ahora manda `Authorization: Bearer <token>` si hay token cacheado. `GET /ping` y `POST /pair` quedan exentos y no disparan auto-pairing.
- No se paréa de forma proactiva: solo en respuesta a un `401`, para preservar la retrocompatibilidad con agentes viejos.

## [1.0.2] — 2026-05-23

### Corregido
- **`Illegal invocation` al llamar a `fetch` desde el navegador**. La librería guardaba la referencia a `fetch` como propiedad de la instancia y luego la invocaba como método (`this.fetchImpl(...)`), lo cual hacía que el navegador recibiera la instancia de `PrinklyPrint` como `this` en lugar de `window`. El navegador exige que el `this` de `fetch` sea el global object y rechaza la llamada con `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`. El síntoma era que toda llamada (ping, print, listPrinters, etc.) terminaba en `AgentUnreachableError` aunque el agente estuviera funcionando.
- **Fix**: ahora bindemos `fetch` a `globalThis` al construir el cliente. Funciona en browser (`window`), web workers (`self`), Node ≥18 y Deno/Bun (`global`). Backward-compatible: quienes ya estaban pasando un `fetch` bindeado manualmente como workaround pueden mantener su código sin cambios.

## [1.0.1] — 2026-05-23

### Cambios internos
- **CI/CD**: el pipeline de publicación migró a **OIDC Trusted Publishing** de npm. Ya no usamos un `NPM_TOKEN` de larga duración como secret de GitHub; cada release usa un token OIDC efímero firmado por GitHub Actions, verificado contra la confianza configurada en el paquete. No hay cambios visibles para los consumidores de la librería.

## [1.0.0] — 2026-05-23

Primer release público de la librería cliente oficial del agente [PrinklyPrint](https://github.com/LautaroTiamat/PrinklyPrint).

### Agregado
- **API core** vanilla JavaScript / TypeScript con cero dependencias de runtime: usa `fetch` nativo del navegador / Node 18+.
- **Clase `PrinklyPrint`** con métodos para todos los endpoints del agente:
  - `ping()`, `listPrinters()`, `getSettings()`
  - `print()`, `printBase64()`, `printFromUrl()`
  - `listJobs()`, `getJob()`, `retryJob()`, `cancelJob()`
- **Adapter React** (`prinklyprint.js/react`) con:
  - `PrinklyPrintProvider` — contexto que comparte el cliente entre componentes.
  - Hooks `usePrinklyPrint`, `usePing`, `usePrinters`, `useJobs`, `usePrint` con manejo automático de estado de carga, errores y polling.
- **Tipado TypeScript** completo incluido en el paquete (no requiere `@types/...` aparte).
- **Bundle dual ESM + CJS** generado con tsup. Funciona en bundlers modernos (Vite, webpack, esbuild, Rollup) y en Node ≥18.
- **Manejo de errores tipado** con clases `PrinklyPrintError`, `AgentUnreachableError`, `AgentResponseError` y `TimeoutError`.
- **Conversión automática** de `Blob` / `File` / `ArrayBuffer` a base64 antes de enviar al agente.
- **Soporte para puerto configurable**: el constructor acepta `{host, port}` para alinear con el puerto que el operador haya configurado en la UI del agente.
