# Appsign (app pública)
Traductor de lengua de señas (LSA, Argentina) con la cámara. PWA sin build: HTML + JS puro.

- **Traducir**: señas → texto. **Conversar**: voz → texto para la persona sorda, señas → texto para quien oye, respuesta escrita en voz alta.
- **Colaborar**: la persona manda un video o foto al equipo (WhatsApp/correo). **No entra sola a la app.**
- **Vocabulario**: viene SOLO de `library.json`, que publica el equipo. Nada que haga un usuario cambia la biblioteca.

## Novedades de esta versión
- **Cámara trasera por defecto** (apunta a la persona sorda). Botón de cámara en el visor para pasar a la frontal; se recuerda la elección y solo la frontal se ve espejada.
- **Grabar video con subtítulos** (botón rojo en el visor): graba la cámara con las palabras reconocidas (y en Conversar, también lo que dice la otra persona) y lo comparte con el menú del celular; si no se puede, lo descarga. Pide confirmar el permiso de quien aparece.
- El motor de MediaPipe se busca primero en `mp/` y, si falta, en el CDN. Si falla, el error dice el paso (motor / wasm / modelo).
- Diseño nuevo, con tema claro/oscuro automático. Página `privacy.html`.

## Motor sin conexión (carpeta `mp/`)
Poner en `mp/`: `vision_bundle.mjs`, la carpeta `wasm/` (de `@mediapipe/tasks-vision@0.10.14`) y `hand_landmarker.task`
(https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task, ~8 MB).

## Configurar antes de publicar
Editá `config.js` con el correo y/o WhatsApp del equipo (para el botón Colaborar).

## Actualizar el vocabulario (cada 2–3 meses)
1. En el **Constructor** (carpeta `appsign-constructor`, uso interno) cargá videos/fotos, validá y generá `library.json`.
2. Reemplazá `library.json` en este repo, hacé commit y push. Vercel publica solo.
3. Los usuarios ven un aviso "Vocabulario actualizado" con las palabras nuevas.

## Publicar
Vercel: importar el repo, Framework "Other", sin build command. Requiere https (cámara/micrófono).
Local: `python3 -m http.server 8000` → http://localhost:8000

Estado: prototipo. Falta calibrar con manos reales y validar con la comunidad sorda.
