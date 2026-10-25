# Publicar Appsign en Google Play (TWA)
Una TWA es la PWA envuelta en una app de Android. No hay que reescribir nada.

Lo que ya está listo en este repo: manifest con `id`, íconos 192/512/maskable, `privacy.html`, service worker, `.well-known/assetlinks.json` (con marcadores a reemplazar).

Lo que tenés que hacer vos:
1. **Cuenta de Google Play Console** (pago único de USD 25).
2. Con la app ya publicada en Vercel (https), instalar Bubblewrap: `npm i -g @bubblewrap/cli`, luego `bubblewrap init --manifest https://TU-DOMINIO/manifest.webmanifest` y `bubblewrap build`. Genera el `.aab` y una clave de firma (guardala y hacé copia: sin ella no podés actualizar).
3. Subir el `.aab` en Play Console. Activar **Play App Signing** y copiar la huella **SHA-256** del certificado de firma de la app.
4. Reemplazar en `.well-known/assetlinks.json` el `package_name` y la huella; publicar. Sin esto la app se ve con barra de navegador.
5. Ficha de la tienda: capturas de pantalla (hay que sacarlas en un celular con manos reales), descripción, categoría, URL de `privacy.html`, y el formulario de **Seguridad de los datos** (cámara y micrófono; no se guardan datos; el audio de «Conversar» lo transcribe el servicio de voz del dispositivo).
6. Antes de publicar: probar en un celular real con manos reales y con la fundación. La política de privacidad es un borrador: que la revise alguien con conocimiento legal.
