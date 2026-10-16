'use strict';
// Conexión con Claude Code: cada sesión de CC (el mod de cc-mod/) avisa por HTTP local qué
// está haciendo, y Wisp muestra lo más urgente de todas juntas:
//   alguna te necesita (un permiso, una pregunta) > alguna trabaja > ninguna hace nada.
// Además de su estado, un aviso puede traer un momento: festejo al terminar, susto al fallar.
// Escucha solo en 127.0.0.1. Para que una página web no pueda mandarle avisos, pide
// Content-Type application/json (el navegador no lo manda a otro origen sin preguntar antes,
// y esa pregunta acá no tiene respuesta) y un Host local (contra el DNS rebinding).

const http = require('node:http');

const PORT = 4790;
const OLVIDO_MS = 150 * 1000;   // el mod repite su estado cada 60 s: tres avisos perdidos y se olvida
const ESTADOS = ['idle', 'working', 'needs'];
const MOMENTOS = ['celebrate', 'scared'];

function crear({ alCambiar, alMomento, activo = true, ahora = Date.now }) {
  const sesiones = new Map();
  let base = 'idle';
  let encendido = activo;

  function recalcular() {
    const t = ahora();
    for (const [id, s] of sesiones) if (t - s.visto > OLVIDO_MS) sesiones.delete(id);
    const estados = [...sesiones.values()].map((s) => s.estado);
    const nueva = estados.includes('needs') ? 'needs' : estados.includes('working') ? 'working' : 'idle';
    if (nueva !== base) {
      base = nueva;
      alCambiar(base);
    }
  }

  function avisar({ session, name, state, moment }) {
    if (!encendido) return false;
    if (typeof session !== 'string' || !session || session.length > 200) return false;
    if (state === 'gone') sesiones.delete(session);
    else if (ESTADOS.includes(state)) {
      sesiones.set(session, { nombre: typeof name === 'string' ? name.slice(0, 80) : '', estado: state, visto: ahora() });
    } else return false;
    recalcular();
    if (MOMENTOS.includes(moment)) alMomento(moment);
    return true;
  }

  function encender(v) {
    encendido = !!v;
    if (!encendido) sesiones.clear();
    recalcular();
  }

  function resumen() {
    recalcular();
    return {
      activo: encendido,
      base,
      sesiones: [...sesiones.entries()].map(([id, s]) => ({ id, nombre: s.nombre, estado: s.estado })),
    };
  }

  return { avisar, encender, resumen, recalcular, get base() { return base; }, get activo() { return encendido; } };
}

function leer(req) {
  return new Promise((resolve, reject) => {
    let cuerpo = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      cuerpo += c;
      if (cuerpo.length > 4096) { reject(new Error('demasiado largo')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(cuerpo ? JSON.parse(cuerpo) : {}); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

// alActivar(v) se llama cuando un /wisp on|off cambia el encendido, para guardarlo.
function servir(cc, { puerto = PORT, alActivar = () => {}, log = () => {} } = {}) {
  const server = http.createServer(async (req, res) => {
    const responder = (status, cuerpo) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cuerpo));
    };
    const host = String(req.headers.host || '');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return responder(403, { error: 'host' });

    if (req.method === 'GET' && req.url === '/cc') return responder(200, cc.resumen());
    if (req.method !== 'POST' || !['/cc', '/cc/activo'].includes(req.url)) return responder(404, { error: 'no existe' });
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return responder(415, { error: 'json' });

    let datos;
    try { datos = await leer(req); } catch { return responder(400, { error: 'json inválido' }); }

    if (req.url === '/cc/activo') {
      if (typeof datos.activo !== 'boolean') return responder(400, { error: 'activo' });
      cc.encender(datos.activo);
      alActivar(datos.activo);
      log('cc activo', datos.activo);
      return responder(200, cc.resumen());
    }
    const tomado = cc.avisar(datos);
    log('cc aviso', JSON.stringify(datos), tomado ? '' : '(ignorado)');
    return responder(200, { activo: cc.activo, base: cc.base });
  });
  server.on('error', (err) => log('cc server', err.code || err.message));
  server.listen(puerto, '127.0.0.1');
  return server;
}

module.exports = { crear, servir, PORT, OLVIDO_MS };
