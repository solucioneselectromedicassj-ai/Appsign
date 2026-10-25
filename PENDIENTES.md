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

## Cómo aprende la app (ciclo con el equipo, sin entrar sola al vocabulario)
1. En la app (Ajustes → «Ayudar a mejorar la app»), cada vez que alguien confirma o corrige una seña, se guarda en su celular **solo la posición de las manos** y la palabra.
2. Desde Colaborar → «Señas corregidas» la persona manda un archivo `appsign-correcciones-….json` (WhatsApp / correo).
3. En el Constructor: Datos → Importar. Quedan como **pendientes** en Revisar; las valida una persona de la comunidad sorda y recién ahí suman al vocabulario en la próxima versión.
Más adelante, con un servidor, el envío puede ser automático.

## Frases (idea)
- Guardar una lista de frases frecuentes (las que ya aparecen como subtítulos en los videos, ej.: «quiero informar», «es importante», «hay señas»).
- Si la app reconoce el principio y el final de una frase y en el medio hay palabras dudosas (¿?), proponer «¿Quisiste decir…?» con la frase completa y que la persona confirme.
- Conviene empezar cuando haya más palabras con 3 o más repeticiones; la lista de frases se cargaría desde el Constructor dentro de `library.json`.
