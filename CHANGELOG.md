# Changelog

Todas las versiones notables de PrinklyPrint.js quedan documentadas acá. Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y el proyecto sigue [Semantic Versioning](https://semver.org/lang/es/).

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
