/**
 * Ejemplo React: dashboard mínimo que muestra todas las features del adapter.
 *
 * Para correrlo dentro de tu proyecto React:
 *
 *   npm install prinklyprint.js react react-dom
 *
 * y copiá este archivo a `src/App.tsx`. Asume que el agente PrinklyPrint
 * está corriendo en el puerto 17777 (default).
 */

import { useState } from 'react';
import {
  PrinklyPrintProvider,
  useJobActions,
  useJobs,
  usePairing,
  usePing,
  usePrint,
  usePrinters,
} from 'prinklyprint.js/react';

// ─── 1) Envolvemos toda la app con el Provider ──────────────────────
// `appName` se muestra en el diálogo nativo de aprobación del agente.
export default function App() {
  return (
    <PrinklyPrintProvider config={{ port: 17777, appName: 'Dashboard Demo' }}>
      <main style={{ fontFamily: 'system-ui', maxWidth: 800, margin: '2rem auto' }}>
        <h1 style={{ color: '#ec4899' }}>PrinklyPrint Dashboard</h1>
        <ConnectionStatus />
        <PairingBanner />
        <PrinterPicker />
        <PrintForm />
        <hr style={{ margin: '2rem 0' }} />
        <QueueMonitor />
      </main>
    </PrinklyPrintProvider>
  );
}

// ─── 1b) Banner de pairing ──────────────────────────────────────────
// Con autoPair (default) la primera impresión paréa sola; este botón es
// opcional, para autorizar de forma explícita y reaccionar a un rechazo.
function PairingBanner() {
  const { pair, isLoading, error, isPaired } = usePairing();

  if (isPaired) {
    return (
      <div style={{ background: '#d1fae5', color: '#065f46', padding: '0.75rem', marginTop: '0.5rem' }}>
        🔑 App autorizada para imprimir en esta PC.
      </div>
    );
  }
  return (
    <div style={{ background: '#eef2ff', color: '#3730a3', padding: '0.75rem', marginTop: '0.5rem' }}>
      <button onClick={() => void pair().catch(() => {})} disabled={isLoading}>
        {isLoading ? 'Esperando aprobación en PrinklyPrint…' : 'Conectar con PrinklyPrint'}
      </button>
      {error && <span style={{ color: '#991b1b', marginLeft: '0.75rem' }}>✗ {error.message}</span>}
    </div>
  );
}

// ─── 2) Indicador de estado del agente con polling cada 5s ──────────
function ConnectionStatus() {
  const { data, error } = usePing({ pollInterval: 5000 });

  if (error) {
    return (
      <div style={{ background: '#fee2e2', color: '#991b1b', padding: '0.75rem' }}>
        🔴 Agente desconectado — verificá que PrinklyPrint esté corriendo.
      </div>
    );
  }
  if (!data) return <div>Conectando…</div>;
  if (data.paused) {
    return (
      <div style={{ background: '#fef3c7', color: '#92400e', padding: '0.75rem' }}>
        ⏸ Agente en pausa (v{data.version})
      </div>
    );
  }
  return (
    <div style={{ background: '#d1fae5', color: '#065f46', padding: '0.75rem' }}>
      🟢 Agente listo (v{data.version})
    </div>
  );
}

// ─── 3) Selector de impresora con estado visual ─────────────────────
function PrinterPicker() {
  const { data: printers, isLoading } = usePrinters();
  if (isLoading) return <p>Cargando impresoras…</p>;
  if (!printers?.length) return <p>No se detectaron impresoras.</p>;

  return (
    <section style={{ marginTop: '1rem' }}>
      <h2>Impresoras</h2>
      <ul>
        {printers.map((p) => (
          <li key={p.name}>
            <span style={{ color: severityColor(p.severity) }}>●</span>{' '}
            <strong>{p.name}</strong>
            {p.is_default && ' (default)'} — {p.status}
          </li>
        ))}
      </ul>
    </section>
  );
}

function severityColor(s: 'ok' | 'warn' | 'error') {
  return s === 'ok' ? '#10b981' : s === 'warn' ? '#f59e0b' : '#ef4444';
}

// ─── 4) Formulario que envía un PDF a imprimir ──────────────────────
function PrintForm() {
  const { print, isLoading, error, data, reset } = usePrint();
  const [file, setFile] = useState<File | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    try {
      await print(file, { filename: file.name, metadata: { source: 'react-demo' } });
    } catch {
      // El error ya quedó en `error`; no hace falta hacer nada acá.
    }
  }

  return (
    <section style={{ marginTop: '1rem' }}>
      <h2>Imprimir un PDF</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button type="submit" disabled={!file || isLoading}>
          {isLoading ? 'Enviando…' : 'Imprimir'}
        </button>
        {data && (
          <p style={{ color: 'green' }}>
            ✓ Job encolado: <code>{data.job_id}</code>{' '}
            <button type="button" onClick={reset}>OK</button>
          </p>
        )}
        {error && <p style={{ color: 'red' }}>✗ {error.message}</p>}
      </form>
    </section>
  );
}

// ─── 5) Cola en vivo con polling cada 3s + reintentar/cancelar ──────
function QueueMonitor() {
  const { data, isLoading, refresh } = useJobs({ limit: 20 }, { pollInterval: 3000 });
  const { retryJob, cancelJob, isLoading: acting, error: actionError } = useJobActions();

  return (
    <section>
      <h2>Cola ({data?.total ?? '?'} jobs)</h2>
      <button onClick={refresh} disabled={isLoading}>
        Refrescar manualmente
      </button>
      {actionError && <p style={{ color: 'red' }}>{actionError.message}</p>}
      {data?.jobs.length === 0 && <p>Sin jobs.</p>}
      <table style={{ width: '100%', marginTop: '1rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f3f4f6' }}>
            <th style={cellStyle}>Archivo</th>
            <th style={cellStyle}>Impresora</th>
            <th style={cellStyle}>Estado</th>
            <th style={cellStyle}>Intentos</th>
            <th style={cellStyle}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {data?.jobs.map((j) => (
            <tr key={j.id}>
              <td style={cellStyle}>{j.filename}</td>
              <td style={cellStyle}>{j.printer || '(default)'}</td>
              <td style={cellStyle}>{j.status}</td>
              <td style={cellStyle}>{j.attempts}</td>
              <td style={cellStyle}>
                {j.status === 'failed' && (
                  <button disabled={acting} onClick={() => retryJob(j.id).then(refresh)}>
                    ↻ Reintentar
                  </button>
                )}
                {j.status === 'queued' && (
                  <button disabled={acting} onClick={() => cancelJob(j.id).then(refresh)}>
                    ✕ Cancelar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const cellStyle: React.CSSProperties = {
  padding: '0.5rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'left',
};
