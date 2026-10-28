# Seguridad de Appsign (resumen técnico)

**Qué es público y qué no.** Una app web entrega su código al navegador: el código (`app.js`, `core.js`) y el vocabulario (`library.json`) se pueden ver y bajar. Lo que protege el trabajo es la licencia, los permisos sobre los videos y el vínculo con la comunidad sorda; no ofuscar el código.

**Qué hay hoy**
- Sin servidor, sin cuentas y sin base de datos: no hay nada que robar del lado del servidor.
- No se guarda ni se envía video. Del video solo se calculan puntos de manos (y, si se activa, cejas) dentro del celular.
- Sin código de terceros en tiempo de ejecución: el motor (MediaPipe 0.10.14) y los modelos viven en `mp/`. El respaldo desde un CDN se sacó.
- Cabeceras en `vercel.json`: política de contenido (solo archivos propios, sin scripts en línea ni `eval`), `nosniff`, no se puede embeber en otro sitio, política de referrer y de permisos (solo cámara y micrófono de este sitio).
- Todo texto que viene de afuera (palabras, aportes importados, nombres) se escapa antes de mostrarse (`esc()` o `textContent`); las capturas se generan localmente.
- El Constructor es interno (repo privado, solo local).

**Por vigilar**
- Reconocimiento de voz del navegador: Chrome manda el audio a Google (ya se avisa en la app).
- Videos y fotos que llegan por Colaborar/WhatsApp son datos personales en el teléfono del equipo: consentimiento, lugar donde se guardan y forma de borrarlos (Ley 25.326).
- Llave del APK de prueba: pública a propósito, no sirve para la tienda. La llave de la tienda se guarda fuera de GitHub (GitHub Secrets) con copia aparte.
- Activar verificación en dos pasos en GitHub, Vercel y Google Play.
- Si algún día se suma servidor (envíos automáticos): autenticación, límite de pedidos y revisión de lo que se sube.
