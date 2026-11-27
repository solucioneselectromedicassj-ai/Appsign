// Datos del equipo para «Colaborar» (los videos llegan por correo, con la palabra como asunto). Completalos antes de publicar.
export const CONFIG = {
  equipo: 'Equipo Appsign',
  whatsapp: '5492644474932',               // número del equipo para recibir aportes por WhatsApp (con código de país, sin + ni espacios)
  horario: { dias: [1, 2, 3, 4, 5], desde: 8, hasta: 19, zona: 'America/Argentina/San_Juan' },   // cuándo se reciben videos: lunes a viernes de 8 a 19 h (dias: 0 = domingo … 6 = sábado)
  email: 'appsignsoporte@gmail.com',      // ej.: 'colaborar@tudominio.com'
  lengua: 'LSA',     // lengua de señas de este vocabulario (LSA = Argentina). Otros países: LIBRAS, LSM…
  pais: 'AR',        // país (código de 2 letras)
  // Validación comunitaria (Supabase). Son datos PÚBLICOS por diseño (la clave «anon» solo puede sumar votos). NUNCA poner acá la clave de servicio.
  supabaseUrl: '',   // ej.: 'https://xxxx.supabase.co'
  supabaseKey: '',   // clave pública «anon»
};
