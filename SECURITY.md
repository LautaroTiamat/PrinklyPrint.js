# Política de seguridad

## Reportar una vulnerabilidad

Agradecemos los reportes de seguridad responsables. **No abras un issue público**
para una vulnerabilidad.

- **Canal preferido:** usá *Report a vulnerability* en la pestaña **Security** del
  repositorio de GitHub (GitHub Security Advisories, privado). Crea un canal
  confidencial entre quien reporta y los mantenedores.
- **Qué incluir:** versión afectada, descripción, pasos de reproducción / PoC,
  impacto estimado y, si podés, una recomendación de remediación.
- **Qué esperar:** confirmaremos la recepción, evaluaremos el impacto y
  coordinaremos la divulgación una vez disponible una corrección. Pedimos no
  divulgar públicamente hasta entonces.

> Esta librería es el **cliente**. Si el problema es del agente local (la API
> HTTP, el token, el pairing, los datos en reposo), reportalo en el repositorio
> del agente [PrinklyPrint](https://github.com/LautaroTiamat/PrinklyPrint).

## Versiones soportadas

Se da soporte de seguridad a la **última versión mayor publicada**.

| Versión | Soporte |
|---------|---------|
| 2.x     | ✅ |
| < 2.0   | ❌ (actualizá) |

## Resumen de la postura de seguridad

PrinklyPrint.js es un **cliente delgado** del agente local PrinklyPrint. El modelo
de seguridad importante vive en el **agente**, no en la librería:

- **La autenticación y autorización las impone el AGENTE**, no la librería. El
  agente exige un token Bearer por instalación y requiere el consentimiento del
  operador (pairing con diálogo nativo) para autorizar un origen nuevo. La
  librería no decide quién puede imprimir: solo participa del handshake.
- **Manejo del token.** La librería **cachea el token por instalación de agente**
  (una clave por `baseUrl`) en el storage del navegador (`localStorage` por
  defecto, con fallback a memoria en SSR/Node o modo incógnito), y lo envía en el
  header `Authorization: Bearer <token>` en cada request a un endpoint sensible.
  El cache es enchufable vía `tokenStore` si querés otro almacenamiento.
- **Pairing transparente y retrocompatible.** La librería solo inicia el pairing
  **en respuesta a un `401`** del agente (no de forma proactiva), lo que la hace
  compatible con agentes viejos que nunca devuelven `401`.
- **Sin conexiones salientes propias.** La librería solo le habla al agente local
  (por defecto `http://127.0.0.1:17777`, loopback). No contacta servidores
  externos por su cuenta. Ya no existe `printFromUrl`/`pdf_url`: los PDF se envían
  siempre inline (base64), de modo que tampoco se le pide al agente que haga
  descargas remotas.

### Consideraciones para quien integra la librería

- El token cacheado es un secreto a nivel navegador. Como cualquier dato en
  `localStorage`, es accesible por JavaScript del mismo origen: protegé tu app
  contra XSS, que es el principal vector para robarlo. En contextos sin un origen
  persistente y confiable, considerá el `tokenStore` en memoria.
- Pasá un `appName` claro: es la etiqueta que ve el operador en el diálogo de
  aprobación del agente.
- El control de qué orígenes pueden imprimir lo administra el operador desde el
  agente (lista de orígenes permitidos). Quitar tu origen allí revoca el acceso
  aunque la librería conserve el token cacheado.

Más detalle del token y el pairing: ver el **README del agente**
[PrinklyPrint](https://github.com/LautaroTiamat/PrinklyPrint) y la sección
[Pairing y token](README.md#-pairing-y-token) de este README.
