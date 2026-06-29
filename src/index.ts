/**
 * # PrinklyPrint.js
 *
 * Cliente JavaScript/TypeScript oficial del agente PrinklyPrint.
 *
 * Permite enviar PDFs a la impresora desde una aplicación web sin que el
 * navegador muestre el diálogo de impresión. Requiere que el agente
 * PrinklyPrint esté instalado y corriendo en la PC del operador:
 * https://github.com/LautaroTiamat/PrinklyPrint
 *
 * @example Uso vanilla
 * ```ts
 * import { PrinklyPrint } from 'prinklyprint.js';
 *
 * const printer = new PrinklyPrint();
 *
 * const blob = await fetch('/api/factura.pdf').then(r => r.blob());
 * await printer.print(blob, { filename: 'factura.pdf' });
 * ```
 *
 * @example Uso con React (entry point `prinklyprint.js/react`)
 * ```tsx
 * import { PrinklyPrintProvider, usePrint } from 'prinklyprint.js/react';
 *
 * function App() {
 *   return (
 *     <PrinklyPrintProvider config={{ port: 17777 }}>
 *       <PrintButton />
 *     </PrinklyPrintProvider>
 *   );
 * }
 *
 * function PrintButton() {
 *   const { print, isLoading } = usePrint();
 *   return <button onClick={() => print(blob)} disabled={isLoading}>Imprimir</button>;
 * }
 * ```
 *
 * @packageDocumentation
 */

export { PrinklyPrint } from './client.js';

export {
  PrinklyPrintError,
  AgentUnreachableError,
  AgentResponseError,
  TimeoutError,
  PairingDeniedError,
  PairingRequiredError,
} from './errors.js';

export {
  MemoryTokenStore,
  LocalStorageTokenStore,
  defaultTokenStore,
} from './tokenStore.js';
export type { TokenStore } from './tokenStore.js';

export type {
  AgentErrorBody,
  AgentSettings,
  Duplex,
  Job,
  JobStatus,
  ListJobsFilter,
  ListJobsResponse,
  Orientation,
  PaperSize,
  PingResponse,
  PrintablePDF,
  PrintOptions,
  PrintRequest,
  PrintResponse,
  Printer,
  PrinklyPrintConfig,
  PrinterSeverity,
  Scale,
} from './types.js';
