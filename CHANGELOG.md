# Changelog

Todas las versiones notables de PrinklyPrint.js quedan documentadas acá. Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y el proyecto sigue [Semantic Versioning](https://semver.org/lang/es/).

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
