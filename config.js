// Datos del equipo para «Colaborar» (los videos llegan por correo, con la palabra como asunto). Completalos antes de publicar.
export const CONFIG = {
  equipo: 'Equipo Appsign',
  email: 'solucioneselectromedicassj@gmail.com',      // ej.: 'colaborar@tudominio.com'
  lengua: 'LSA',     // lengua de señas de este vocabulario (LSA = Argentina). Otros países: LIBRAS, LSM…
  pais: 'AR',        // país (código de 2 letras)
  // Validación comunitaria (Supabase). Son datos PÚBLICOS por diseño (la clave «anon» solo puede sumar votos). NUNCA poner acá la clave de servicio.
  supabaseUrl: '',   // ej.: 'https://xxxx.supabase.co'
  supabaseKey: '',   // clave pública «anon»
};
