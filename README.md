# Appsign (app pública)
Traductor de lengua de señas (LSA, Argentina) con la cámara. PWA sin build: HTML + JS puro.

- **Traducir**: señas → texto. **Conversar**: voz → texto para la persona sorda, señas → texto para quien oye, respuesta escrita en voz alta.
- **Colaborar**: la persona manda un video o foto al equipo (WhatsApp/correo). **No entra sola a la app.**
- **Vocabulario**: viene SOLO de `library.json`, que publica el equipo. Nada que haga un usuario cambia la biblioteca.

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
