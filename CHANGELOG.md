# Changelog

Todas las versiones notables de PrinklyPrint.js quedan documentadas acá. Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y el proyecto sigue [Semantic Versioning](https://semver.org/lang/es/).

## [2.2.0] — 2026-08-24

### Agregado
- **Hooks React nuevos**: `useSettings()` (defaults del agente + `machine_id`),
  `useJob(id)` (detalle de un job; deshabilitado con `id` null) y
  `useJobActions()` (`{retryJob, cancelJob, isLoading, error, reset}`) — un
  dashboard de cola ya no tiene que bajar a `usePrinklyPrint()` para reintentar
  o cancelar. El ejemplo `examples/react.tsx` muestra la botonera.
- **Contract test Go↔TS** (`test/contract.test.ts` + `test/contract/api-shapes.json`):
  la forma real del API del agente (generada por su suite Go) se valida contra
  los tipos de `src/types.ts` vía samples `satisfies`. El drift de tipos (como
  el traslado de `machine_id` de `/ping` a `/settings`) ahora rompe un test.
- **Tests de hooks React** (`test/react.test.tsx`, con jsdom + Testing Library)
  y **de los métodos del cliente** sin cobertura (`test/methods.test.ts`:
  jobs/settings/printers, timeout → `TimeoutError`, red → `AgentUnreachableError`,
  body no-JSON y 4xx → `AgentResponseError`).

### Cambiado
- `npm run typecheck` ahora incluye `test/` (necesario para que los `satisfies`
  del contract test validen en compilación).

### Corregido
- **Los hooks de lectura de React re-fetchean al cambiar el filtro o el cliente.**
  Antes, cambiar el `filter` de `useJobs` (o el `port`/`config` del Provider) no
  disparaba un fetch inmediato: los datos nuevos recién llegaban en el próximo
  tick de polling, o nunca con `pollInterval: 0`. Ahora el fetcher participa de
  las dependencias del efecto y el cambio re-fetchea al instante, como prometía
  la documentación del `PrinklyPrintProvider`.
- **Respuestas viejas ya no pisan a las nuevas en los hooks de lectura**: si una
  request quedó en vuelo cuando se disparó otra (cambio de filtro, `refresh()`
  manual), la respuesta obsoleta se descarta.
- **Fuga de `aliveRef` con `enabled: false`**: el efecto de los hooks de lectura
  no registraba cleanup cuando estaba deshabilitado, y un `refresh()` manual en
  vuelo podía hacer `setState` sobre un componente desmontado.
- **`toBase64` valida los strings**: un string que no es base64 (por ejemplo el
  binario del PDF pasado como string) ahora tira `PrinklyPrintError` del lado
  del cliente en vez de viajar corrupto al agente. También tolera y limpia
  whitespace (base64 copiado con saltos de línea).
- **`normalizeHost` soporta IPv6**: una IPv6 literal (`::1`) se envuelve en
  corchetes para que la base URL sea válida.

### Cambiado
- **El paquete npm ya no incluye sourcemaps**: embebían todo `src/` vía
  `sourcesContent` y duplicaban el peso del tarball. El código fuente está
  público en GitHub.
- README: los ejemplos de CDN apuntan a la major 2 (los de `@1` instalaban la
  API vieja con `printFromUrl`, eliminada por SSRF), se documentó
  `onPairingChange()` en la tabla de métodos y se corrigió el tamaño de bundle
  declarado (~6 KB gzip sin minificar).

## [2.1.0] — 2026-06-29

### Corregido
- **`PingResponse` ya no declara `machine_id`**, alineado con el agente que dejó de
  devolverlo en `GET /ping` (se movió a `GET /settings`, autenticado). **Nota:** si
  tu código TypeScript leía `ping.machine_id`, dejará de compilar; ya recibías
  `undefined` en runtime, así que no había dato real que perder. Sin otros cambios
  de comportamiento.

### Cambiado
- **`AgentSettings`** (respuesta de `GET /settings`) ahora incluye `machine_id`:
  es donde el agente expone ese identificador a partir de ahora. Si necesitás el
  `machine_id`, obtenelo con `getSettings()`.

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
