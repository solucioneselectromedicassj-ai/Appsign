# Cómo se baja y se comparte Appsign

## Hoy (sin tiendas)
| Dónde | Cómo | Costo |
|---|---|---|
| **Cualquier celular o compu** | Abrir https://appsign-qj7v.vercel.app (o escanear el QR de `instalar.html`) | Gratis |
| **Android** | Chrome → ⋮ → «Instalar app», o bajar el **APK de prueba** (Releases → `apk-prueba`) | Gratis |
| **iPhone** | Safari → Compartir → «Agregar a inicio» | Gratis |

- Botón **Compartir Appsign** en Ajustes y página `instalar.html` (QR, WhatsApp, pasos de instalación).
- El APK de prueba es una «ventana» que abre la web: **cuando se actualiza la web (o `library.json`) se actualiza sola**, sin volver a instalar.
- APK: se genera en GitHub → pestaña **Actions** → «APK de prueba (Android)» → *Run workflow*. Queda en **Releases → apk-prueba** (`appsign-prueba.apk`). Está firmado con una llave de PRUEBA que es pública a propósito.

## Tienda de Android (Google Play)
1. Cuenta de **Google Play Console** (pago único, USD 25) y verificar la identidad.
2. Generar el paquete firmado para tienda (`.aab`) con la llave **privada** de ustedes (nunca la de prueba): con Bubblewrap (`PLAYSTORE.md`) o con https://www.pwabuilder.com (pegar el link, «Package for stores → Android»). **Guardar la llave y su contraseña: sin ella no se puede actualizar la app.**
3. En Play Console activar **Play App Signing**, copiar la huella **SHA-256** del certificado de firma y agregarla a `.well-known/assetlinks.json` (junto a la de prueba) para que abra sin barra del navegador.
4. Ficha: nombre, descripción corta y larga, ícono 512×512, imagen destacada 1024×500, 2 a 8 capturas de pantalla, categoría, política de privacidad (`privacy.html`), formulario «Seguridad de los datos» y clasificación de contenido.
5. Pruebas cerradas con testers antes de producción (Google lo exige para cuentas personales nuevas).
- El nombre del paquete (`app.appsign.traductor`) **no se puede cambiar después de publicar**: decidirlo antes.

## App Store (iPhone)
- Necesita **Apple Developer Program (USD 99 por año)** y una Mac con Xcode (o un servicio de compilación en la nube).
- Se arma envolviendo la web con **Capacitor** (cámara y micrófono declarados en `Info.plist`). Apple puede rechazar «apps que son solo una página web»: conviene mostrar funciones propias (cámara con reconocimiento en el dispositivo, vocabulario sin conexión).
- Pruebas con **TestFlight** antes de publicar.
- Mientras tanto, iPhone usa la versión instalable desde Safari.

## Antes de publicar en cualquier tienda
- Probar con manos reales en celulares reales (Android e iPhone) y con personas de la comunidad sorda.
- Validar el vocabulario (hoy es de prueba) y revisar la política de privacidad con alguien con conocimiento legal.
- Ícono definitivo, nombre y dominio propio (el link actual es provisorio).
