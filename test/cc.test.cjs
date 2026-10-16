'use strict';
// node test/cc.test.cjs: la lista de sesiones de Claude Code y su servidor (src/cc.cjs).
const assert = require('node:assert/strict');
const http = require('node:http');
const { crear, servir, OLVIDO_MS } = require('../src/cc.cjs');

let fallas = 0;
async function prueba(nombre, fn) {
  try { await fn(); console.log(`  ok   ${nombre}`); }
  catch (err) { fallas++; console.log(`  FALLA ${nombre}\n        ${err.message}`); }
}

function armar(activo = true) {
  let t = 1000;
  const cambios = [], momentos = [];
  const cc = crear({ activo, ahora: () => t, alCambiar: (b) => cambios.push(b), alMomento: (m) => momentos.push(m) });
  return { cc, cambios, momentos, pasar: (ms) => { t += ms; } };
}

function pedir(puerto, { method = 'GET', path = '/cc', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: puerto, method, path, headers }, (res) => {
      let txt = '';
      res.on('data', (c) => { txt += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: txt ? JSON.parse(txt) : null }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

(async () => {
  console.log('Wisp · conexión con Claude Code');

  await prueba('lo más urgente gana: te necesita > trabaja > libre', () => {
    const { cc, cambios } = armar();
    cc.avisar({ session: 'a', name: 'Quire', state: 'working' });
    cc.avisar({ session: 'b', name: 'Wisp', state: 'needs' });
    assert.equal(cc.base, 'needs');
    cc.avisar({ session: 'b', name: 'Wisp', state: 'working' });
    assert.equal(cc.base, 'working');
    cc.avisar({ session: 'a', state: 'idle' });
    assert.equal(cc.base, 'working', 'b sigue trabajando');
    cc.avisar({ session: 'b', state: 'gone' });
    assert.equal(cc.base, 'idle');
    assert.deepEqual(cambios, ['working', 'needs', 'working', 'idle']);
  });

  await prueba('los momentos (festejo, susto) se pasan aparte y no cambian el fondo', () => {
    const { cc, momentos } = armar();
    cc.avisar({ session: 'a', state: 'working' });
    cc.avisar({ session: 'b', state: 'idle', moment: 'celebrate' });
    assert.deepEqual(momentos, ['celebrate']);
    assert.equal(cc.base, 'working');
    cc.avisar({ session: 'b', state: 'idle', moment: 'bailar' });
    assert.deepEqual(momentos, ['celebrate'], 'un momento que no existe no pasa');
  });

  await prueba('una sesión que no avisa más se olvida', () => {
    const { cc, pasar } = armar();
    cc.avisar({ session: 'a', state: 'working' });
    pasar(OLVIDO_MS - 1000);
    cc.recalcular();
    assert.equal(cc.base, 'working');
    pasar(2000);
    cc.recalcular();
    assert.equal(cc.base, 'idle');
    assert.equal(cc.resumen().sesiones.length, 0);
  });

  await prueba('apagado no toma avisos, y apagar borra la lista', () => {
    const { cc } = armar();
    cc.avisar({ session: 'a', state: 'needs' });
    cc.encender(false);
    assert.equal(cc.base, 'idle');
    assert.equal(cc.avisar({ session: 'a', state: 'needs' }), false);
    assert.equal(cc.base, 'idle');
    cc.encender(true);
    assert.equal(cc.avisar({ session: 'a', state: 'needs' }), true);
    assert.equal(cc.base, 'needs');
  });

  await prueba('avisos raros se ignoran', () => {
    const { cc } = armar();
    assert.equal(cc.avisar({ state: 'working' }), false);
    assert.equal(cc.avisar({ session: 'a', state: 'bailando' }), false);
    assert.equal(cc.base, 'idle');
  });

  // El servidor, en un puerto de prueba
  const puerto = 47911;
  const { cc } = armar();
  let guardado = null;
  const server = servir(cc, { puerto, alActivar: (v) => { guardado = v; } });
  await new Promise((r) => server.once('listening', r));
  const json = { 'Content-Type': 'application/json' };

  await prueba('POST /cc toma el aviso y GET /cc lo muestra', async () => {
    const r = await pedir(puerto, { method: 'POST', body: { session: 's1', name: 'Quire', state: 'needs' }, headers: json });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { activo: true, base: 'needs' });
    const g = await pedir(puerto);
    assert.deepEqual(g.json.sesiones, [{ id: 's1', nombre: 'Quire', estado: 'needs' }]);
  });

  await prueba('sin Content-Type JSON no pasa (una página web no puede mandarlo sin preguntar)', async () => {
    const r = await pedir(puerto, { method: 'POST', body: { session: 's2', state: 'working' }, headers: { 'Content-Type': 'text/plain' } });
    assert.equal(r.status, 415);
  });

  await prueba('un Host que no es local no pasa (DNS rebinding)', async () => {
    const r = await pedir(puerto, { headers: { Host: 'malo.example:47911' } });
    assert.equal(r.status, 403);
  });

  await prueba('POST /cc/activo apaga, guarda y responde el estado', async () => {
    const r = await pedir(puerto, { method: 'POST', path: '/cc/activo', body: { activo: false }, headers: json });
    assert.equal(r.status, 200);
    assert.equal(r.json.activo, false);
    assert.equal(guardado, false);
    const a = await pedir(puerto, { method: 'POST', body: { session: 's1', state: 'needs' }, headers: json });
    assert.deepEqual(a.json, { activo: false, base: 'idle' });
  });

  await prueba('JSON roto o cuerpo enorme: 400', async () => {
    assert.equal((await pedir(puerto, { method: 'POST', body: '{roto', headers: json })).status, 400);
    const enorme = await pedir(puerto, { method: 'POST', body: JSON.stringify({ x: 'a'.repeat(10000) }), headers: json }).catch(() => ({ status: 'cortado' }));
    assert.ok(enorme.status === 400 || enorme.status === 'cortado', String(enorme.status));
  });

  server.close();
  console.log(fallas ? `\n${fallas} falla(s)` : '\ntodo ok');
  process.exit(fallas ? 1 : 0);
})();
