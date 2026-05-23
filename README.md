<div align="center">

# PrinklyPrint.js

**Cliente JavaScript oficial del agente [PrinklyPrint](https://github.com/LautaroTiamat/PrinklyPrint).**

Imprimí PDFs desde tu aplicación web sin que el navegador muestre el diálogo "Imprimir".

Funciona en **cualquier stack JavaScript**: HTML+JS puro, jQuery, Vue, Svelte, Angular, etc. — **no necesitás TypeScript ni React**. Los tipos TypeScript vienen incluidos para quien los quiera usar, y hay un adapter opcional con hooks para proyectos React. Cero dependencias de runtime.

[![npm version](https://img.shields.io/npm/v/prinklyprint.js?style=flat-square&color=ec4899)](https://www.npmjs.com/package/prinklyprint.js)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Types](https://img.shields.io/badge/types-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](src/types.ts)
[![Bundle size](https://img.shields.io/bundlephobia/minzip/prinklyprint.js?style=flat-square&color=10b981)](https://bundlephobia.com/package/prinklyprint.js)

</div>

---

## ¿Qué es esto?

[**PrinklyPrint**](https://github.com/LautaroTiamat/PrinklyPrint) es un agente nativo para Windows que escucha en `127.0.0.1:17777` (puerto configurable) y permite imprimir PDFs de forma silenciosa — sin que el navegador muestre el diálogo "Imprimir".

**PrinklyPrint.js** es el SDK que tu aplicación web usa para hablarle a ese agente. Wrappea su API HTTP en una clase ergonómica, con tipos TypeScript, conversión automática de `Blob`/`File`/`ArrayBuffer` a base64 y hooks de React para componentes reactivos.

```ts
import { PrinklyPrint } from 'prinklyprint.js';

const printer = new PrinklyPrint();
const blob = await fetch('/api/factura.pdf').then(r => r.blob());
await printer.print(blob, { filename: 'factura.pdf' });
// Listo: la impresora local del cliente saca el ticket. Sin diálogos. Sin clicks.
```

---

## ✨ Características

| | |
|---|---|
| 🪶  **Cero dependencias** | Solo `fetch` nativo del browser / Node ≥18. Bundle < 3 KB gzipped. |
| 🧱  **Vanilla JS friendly** | Funciona en HTML+JS puro sin bundler. **No requiere TypeScript ni framework.** Importás vía CDN y listo. |
| 🎯  **TypeScript opcional** | Tipos incluidos en el paquete para quien los quiera usar. No hace falta instalar `@types/...` aparte. |
| ⚛️  **Adapter React opcional** | Entry point separado `prinklyprint.js/react` con `<PrinklyPrintProvider>` + hooks `usePrint`, `useJobs`, `usePrinters`, `usePing`, `usePrinklyPrint`. |
| 🔄  **Conversión automática** | Pasale `Blob`, `File`, `ArrayBuffer`, `Uint8Array` o base64. La librería resuelve. |
| 🚨  **Errores tipados** | `AgentUnreachableError`, `AgentResponseError`, `TimeoutError` con discriminación por `instanceof`. |
| ⏱️  **Timeout configurable** | Default 30s, ajustable por instancia. Cancela con `AbortController`. |
| 📡  **Polling integrado** | Los hooks de React aceptan `pollInterval` para listas que se actualizan solas. |
| 🌐  **ESM + CJS** | Bundle dual para que funcione en Vite, webpack, Rollup, esbuild y Node. |

---

## 📦 Instalación

```bash
npm install prinklyprint.js
# o
pnpm add prinklyprint.js
# o
yarn add prinklyprint.js
```

Para usar el adapter de React (opcional):

```bash
npm install prinklyprint.js react react-dom
```

> **Requisito previo**: el [agente PrinklyPrint](https://github.com/LautaroTiamat/PrinklyPrint/releases/latest/download/PrinklyPrint-Setup.exe) debe estar instalado y corriendo en la PC donde se ejecuta tu aplicación web.

---

## 🚀 Uso

### Vanilla JS / TypeScript

```ts
import { PrinklyPrint, AgentUnreachableError } from 'prinklyprint.js';

// Default: http://127.0.0.1:17777 (puerto default del agente).
const printer = new PrinklyPrint();

// Si el operador cambió el puerto desde la UI, pasáselo:
const printer = new PrinklyPrint({ port: 17800 });

// Imprimir un PDF descargado:
try {
  const blob = await fetch('/api/factura/123.pdf').then(r => r.blob());
  const { job_id } = await printer.print(blob, {
    filename: 'factura-123.pdf',
    options: { copies: 2, paper_size: 'A4' },
    metadata: { orderId: '123' },
  });
  console.log('Job encolado:', job_id);
} catch (err) {
  if (err instanceof AgentUnreachableError) {
    alert('PrinklyPrint no está corriendo. Descargalo de github.com/LautaroTiamat/PrinklyPrint');
  } else {
    throw err;
  }
}
```

### React

```tsx
import { PrinklyPrintProvider, usePrint, useJobs } from 'prinklyprint.js/react';

// 1) Envolvé tu app con el Provider (lo hacés una sola vez, alto en el árbol).
function App() {
  return (
    <PrinklyPrintProvider config={{ port: 17777 }}>
      <PrintButton />
      <Queue />
    </PrinklyPrintProvider>
  );
}

// 2) Cualquier componente hijo puede imprimir o leer la cola.
function PrintButton() {
  const { print, isLoading, error } = usePrint();

  async function handleClick() {
    const blob = await fetch('/api/factura.pdf').then(r => r.blob());
    await print(blob, { filename: 'factura.pdf' });
  }

  return (
    <button onClick={handleClick} disabled={isLoading}>
      {isLoading ? 'Imprimiendo…' : 'Imprimir'}
      {error && <span style={{color: 'red'}}> {error.message}</span>}
    </button>
  );
}

// 3) El hook useJobs hace polling automático cada 3s.
function Queue() {
  const { data, isLoading } = useJobs({ status: 'queued' });
  if (isLoading) return <p>Cargando…</p>;
  return <ul>{data?.jobs.map(j => <li key={j.id}>{j.filename} — {j.status}</li>)}</ul>;
}
```

### HTML + JS puro (sin bundler, vía CDN)

Si no usás bundler (Vite, webpack, etc.) e ingresás la librería directo en una etiqueta `<script>`, podés cargarla desde cualquier CDN público — **no necesitás `npm install`, ni Node, ni un build step**.

```html
<!DOCTYPE html>
<html>
<body>
  <button id="print-btn">Imprimir</button>

  <script type="module">
    // Opción 1: esm.sh (recomendado para módulos ESM modernos)
    import { PrinklyPrint } from 'https://esm.sh/prinklyprint.js@1';

    const printer = new PrinklyPrint();

    document.getElementById('print-btn').addEventListener('click', async () => {
      const blob = await fetch('/factura.pdf').then(r => r.blob());
      await printer.print(blob, { filename: 'factura.pdf' });
    });
  </script>
</body>
</html>
```

#### CDNs disponibles

| CDN | URL | Cuándo usarlo |
|-----|-----|---------------|
| **esm.sh** | `https://esm.sh/prinklyprint.js@1` | Default recomendado. Optimiza el bundle para browsers modernos. |
| **jsDelivr** | `https://cdn.jsdelivr.net/npm/prinklyprint.js@1/+esm` | Si esm.sh está caído, o si preferís un CDN con mirrors globales. |
| **unpkg** | `https://unpkg.com/prinklyprint.js@1` | Alternativa clásica, sirve el contenido del paquete tal cual está en npm. |

Pineá una versión específica (`@1.0.0`) en producción para builds reproducibles; usá `@1` solo para prototipos rápidos donde no te importa si una versión menor cambia.

#### ¿Sin instalar TypeScript ni React?

Cero. Estos snippets corren en cualquier navegador moderno sin nada extra:

```html
<script type="module">
  import { PrinklyPrint } from 'https://esm.sh/prinklyprint.js@1';

  // jQuery, Vue, Alpine, Svelte, Angular, vanilla — da igual.
  // Esto es solamente HTML + JS y funciona idéntico.
  const printer = new PrinklyPrint({ port: 17777 });
  const info = await printer.ping();
  console.log('Agente vivo:', info.version);
</script>
```

Ver ejemplos completos:
- [`examples/vanilla.html`](examples/vanilla.html) — HTML+JS puro, sin bundler.
- [`examples/react.tsx`](examples/react.tsx) — dashboard React con todos los hooks.

---

## 📖 API Reference

### `new PrinklyPrint(config?)`

| Opción | Tipo | Default | Descripción |
|--------|------|---------|-------------|
| `host` | `string` | `'127.0.0.1'` | Host del agente. |
| `port` | `number` | `17777` | Puerto del agente (configurable desde la UI). |
| `baseUrl` | `string` | — | Override completo (ignora host/port). |
| `timeout` | `number` | `30000` | Timeout HTTP en ms. |
| `fetch` | `typeof fetch` | global | Inyectable (para Node ≤17 o tests). |

### Métodos del cliente

| Método | Devuelve | Qué hace |
|--------|----------|----------|
| `ping()` | `PingResponse` | Healthcheck. Si tira `AgentUnreachableError`, el agente no está corriendo. |
| `listPrinters()` | `Printer[]` | Lista impresoras del SO con estado enriquecido. |
| `getSettings()` | `AgentSettings` | Defaults de impresión configurados por el operador. |
| `print(pdf, req?)` | `PrintResponse` | Imprime cualquier `Blob`/`File`/`ArrayBuffer`/base64. |
| `printBase64(b64, req?)` | `PrintResponse` | Cuando ya tenés el PDF en base64. |
| `printFromUrl(url, req?)` | `PrintResponse` | El agente descarga la URL y luego imprime. |
| `listJobs(filter?)` | `ListJobsResponse` | Lista jobs (filtros: `status`, `limit`, `offset`). |
| `getJob(id)` | `Job` | Detalle de un job, incluyendo `last_error` y `sumatra_log`. |
| `retryJob(id)` | `{status}` | Reencola un job `failed`. |
| `cancelJob(id)` | `{status}` | Cancela un job `queued`. |

### Hooks de React (`prinklyprint.js/react`)

| Hook | Tipo | Descripción |
|------|------|-------------|
| `<PrinklyPrintProvider config={…}>` | Component | Wrapper que comparte el cliente con todos los hijos. |
| `usePrinklyPrint()` | `PrinklyPrint` | Devuelve la instancia compartida. |
| `usePing(opts?)` | `QueryState<PingResponse>` | Healthcheck con polling opcional. |
| `usePrinters(opts?)` | `QueryState<Printer[]>` | Lista impresoras con polling opcional. |
| `useJobs(filter?, opts?)` | `QueryState<ListJobsResponse>` | Lista jobs (default: polling 3s). |
| `usePrint()` | `PrintMutationState` | Mutación con `{print, isLoading, error, data, reset}`. |

Todos los hooks de lectura devuelven la misma shape:

```ts
{ data, error, isLoading, refresh }
```

### Errores

```ts
import {
  PrinklyPrintError,      // base — todos heredan de acá
  AgentUnreachableError,  // agente no instalado o apagado
  AgentResponseError,     // 4xx/5xx — leé .status y .body.error
  TimeoutError,           // request superó .timeout
} from 'prinklyprint.js';
```

---

## ⚙️ Sincronizar puerto con el agente

El operador puede cambiar el puerto del agente desde la pestaña **General → Puerto** de la UI. Si tu aplicación apunta a un puerto distinto, vas a obtener `AgentUnreachableError`.

Para evitar fricción, podés exponer el puerto como variable de entorno / setting del usuario:

```ts
const printer = new PrinklyPrint({
  port: Number(import.meta.env.VITE_PRINKLY_PORT ?? 17777),
});
```

---

## 🧪 Desarrollo local

```bash
npm install
npm run build           # tsup → dist/ con ESM + CJS + .d.ts
npm run typecheck       # tsc --noEmit
npm test                # vitest
```

Para probar contra un agente real, abrí [PrinklyPrint](https://github.com/LautaroTiamat/PrinklyPrint) en otra ventana y serví el ejemplo vanilla con cualquier server estático:

```bash
npm run build
npx serve .
# abrí http://localhost:3000/examples/vanilla.html
```

> **Atención**: antes de que tu app pueda imprimir, agregá su dominio en la pestaña **General → Orígenes CORS** del agente (incluí `http://localhost:3000` para desarrollo).

---

## 🤝 Compatibilidad

| Entorno | Soportado |
|---------|-----------|
| Browser modernos (Chrome 80+, Firefox 80+, Edge 80+, Safari 14+) | ✅ |
| Node ≥ 18 | ✅ |
| Bun | ✅ |
| Deno | ✅ |
| React ≥ 18 (peerDep opcional) | ✅ |
| Server-Side Rendering | ✅ (los hooks chequean `aliveRef` antes de hacer setState) |
| TypeScript ≥ 5.0 | ✅ |

---

## ❓ FAQ

**¿Necesito instalar algo más en la PC del usuario?**
Sí: el [agente PrinklyPrint](https://github.com/LautaroTiamat/PrinklyPrint/releases/latest/download/PrinklyPrint-Setup.exe). Esta librería es solo el cliente HTTP — el trabajo real lo hace el agente local.

**¿Funciona con `fetch` desde `https://`?**
Sí. El agente acepta conexiones desde orígenes `https://` siempre que estén en la whitelist CORS configurada. Los browsers permiten `https → http://127.0.0.1` para loopback sin marcarlo como mixed content.

**¿Puedo enviar otros formatos además de PDF?**
No. El agente usa SumatraPDF internamente, que solo procesa PDF. Si necesitás imprimir imágenes u otros formatos, convertilos a PDF en tu app antes de mandarlos.

**¿Cómo manejo el caso donde el agente no está instalado?**
Catcheá `AgentUnreachableError` en tu primer `ping()` o `print()`. Mostrale al usuario un link directo al instalador: `https://github.com/LautaroTiamat/PrinklyPrint/releases/latest/download/PrinklyPrint-Setup.exe`.

**¿Hay forma de saber cuándo el job efectivamente terminó de imprimir?**
Usá `getJob(jobId)` con polling, o `useJobs()` en React. Cuando `status === 'done'` el papel ya salió. Si llegaste a `failed`, hay un `last_error` y `sumatra_log` con el detalle.

---

## 📜 Licencia

[MIT](LICENSE) © 2026 [LautaroTiamat](https://github.com/LautaroTiamat).

---

<div align="center">

**¿Buscás el agente?** → [github.com/LautaroTiamat/PrinklyPrint](https://github.com/LautaroTiamat/PrinklyPrint)

</div>
