# Hacia otros países y cuentas (ideas, no para ahora)

## Otros países
- Cada país/región tiene **su propia lengua de señas** (Argentina LSA, Brasil LIBRAS, México LSM…), no son traducciones entre sí. Cada una necesita **su vocabulario, su comunidad validadora y su fundación asociada**.
- Previsto desde ya: `library.json` y `candidatas.json` llevan `language` y `country`; la base de votos tiene `lengua` y `pais`; `config.js` tiene `lengua` y `pais`.
- Para sumar un país: un `library` por lengua, una versión de la app (o selector) que cargue el suyo, textos traducidos y validadores locales.

## Traducir entre dos señantes de países distintos (modelo aparte)
- Idea: reconocer una seña en una lengua, pasarla a un «concepto» común (un identificador, por ejemplo `GRACIAS`) y mostrar la palabra o la seña de la otra lengua.
- Para eso cada palabra del vocabulario necesita un campo opcional `concepto`. Todavía no se usa.
- Límite: las lenguas de señas tienen su propia gramática; sirve palabra a palabra, no frases, y muchas señas no tienen equivalente exacto. Hay que validarlo con personas que conozcan las dos.

## Cuentas
- Votar sin cuenta sigue posible (cuenta como «anónimo»). Para que un voto cuente como «persona sorda / intérprete» hace falta una **cuenta verificada por el equipo**.
- La base ya lo prevé (tabla `perfiles`, `rol_verificado`, votos con rol tomado del perfil). Falta la pantalla de ingreso en la app y elegir el método (correo con código o Google).
- Con cuentas aparecen obligaciones: política de privacidad con los datos que se guardan (correo, país, rol), borrado a pedido y, si la app llega a otros países, sus leyes (LGPD en Brasil, etc.).
