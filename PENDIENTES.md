# Pendientes y recordatorios de Appsign

## Antes de Play Store (en este orden)
1. **Probar con un APK de prueba**, nunca saltar directo a la tienda. `bubblewrap build` genera también un `.apk` para instalar en un celular de prueba (ver `PLAYSTORE.md`). Probar con manos reales y con la asociación de sordos.
2. Validar el vocabulario con la comunidad sorda (hoy es una versión de prueba, marcada `validated:false`).
3. Revisar la política de privacidad con alguien con conocimiento legal.
4. Ícono definitivo (el actual es provisorio, se va a rehacer).
5. Completar `config.js` (correo / WhatsApp de Colaborar) y `.well-known/assetlinks.json`.

## Actualizaciones de vocabulario (idea de flujo)
Constructor (cargar videos de la asociación con su subtítulo → separar palabras → revisar/validar → quitar las que sobren) → `library.json` con versión nueva → subir a GitHub → la app avisa «Vocabulario actualizado» con las palabras nuevas.
- Hoy el aviso aparece **cuando la persona abre la app** (compara la versión de `library.json`).
- Avisar sin abrir la app (notificación push) necesita un servidor: queda para más adelante.

## Ideas en lista
- Conversar: las dos funciones (voz a texto y señas a texto) conviven en un celular o en dos celulares separados, sin conexión entre ellos.
- Más repeticiones por palabra (mínimo 3, de más de una persona) y calibrar el umbral con señantes reales.
- Corte por subtítulo para otros estilos de cartel (blanco con letra negra, texto chico).
