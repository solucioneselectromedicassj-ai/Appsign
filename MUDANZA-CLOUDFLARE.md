# Pasar el sitio de Vercel a Cloudflare Pages (cuando empiece a crecer)

**Por qué:** el plan gratuito de Vercel incluye 100 GB de transferencia por mes y es solo para uso no comercial. Cada persona nueva descarga 12 a 18 MB. Cloudflare Pages gratis no mide el ancho de banda de archivos estáticos (según su documentación: máximo 25 MiB por archivo, 20.000 archivos por sitio). Verificá sus términos de uso comercial antes de mudarte.

**Qué ya está listo en este repo:** `_headers` (mismas cabeceras de seguridad que `vercel.json`). No hay paso de compilación.

## Pasos (unos 15 minutos, una sola vez)
1. Crear una cuenta en cloudflare.com (gratis).
2. **Workers y Pages → Crear → Pages → Conectar con Git** → elegir el repositorio `Appsign`.
3. Configuración de compilación: **Framework: ninguno · Comando de compilación: (vacío) · Directorio de salida: `/`**. Rama de producción: `main`.
4. Guardar y desplegar. Te da una dirección `appsign.pages.dev`.
5. **Probar** (con `appsign.pages.dev`): que cargue, que active la cámara y diga «Reconocedor listo», que `/.well-known/assetlinks.json` y `/library.json` respondan.
6. **Dominio propio (recomendado):** registrar un dominio y apuntarlo a Pages (Pages → Dominios personalizados). Así el día que cambies de proveedor nadie nota nada.
7. Si usás la app de Android (APK/TWA): cambiar la dirección en `android/app/src/main/AndroidManifest.xml` y en `.well-known/assetlinks.json` (el sitio `site` y el `host`), y recompilar. Con un dominio propio esto se hace una sola vez.
8. En Supabase → Authentication → URL Configuration, agregar la dirección nueva.
9. En Google Cloud (credencial de OAuth) agregar la dirección nueva si hace falta.
10. Cuando todo ande, poner un aviso en el sitio viejo o apagarlo. El QR de los volantes se rehace con la dirección nueva.

## Para después (Play Store)
El APK de hoy es una «ventana» que baja el reconocedor de internet la primera vez. Para que lo pague Google y no tu hosting, se puede empaquetar el motor y el modelo **dentro** de la app de la tienda (con Capacitor, en vez de TWA). Es un cambio de envoltorio, no de la app.
