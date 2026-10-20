'use strict';
// node test/glide.test.cjs: el viaje de Wisp de un lugar a otro (src/glide.cjs).
const assert = require('node:assert/strict');
const { crear } = require('../src/glide.cjs');

let fallas = 0;
function prueba(nombre, fn) {
  try { fn(); console.log(`  ok   ${nombre}`); }
  catch (err) { fallas++; console.log(`  FALLA ${nombre}\n        ${err.message}`); }
}

// Recorre `segundos` con pasos de `ms`; devuelve las posiciones x y cuándo llegó
function viajar(g, segundos, ms) {
  const xs = [];
  let llego = null;
  for (let t = ms; t <= segundos * 1000 + 1e-9; t += ms) {
    if (g.step(ms / 1000) && llego === null) llego = t;
    xs.push(g.pos.x);
  }
  return { xs, llego };
}

prueba('llega y queda clavado en el destino', () => {
  const g = crear({ x: 0, y: 0 });
  g.setGoal({ x: 600, y: -200 });
  const { llego } = viajar(g, 3, 13.3);
  assert.ok(llego !== null && llego < 1500, `llegó a los ${llego} ms`);
  assert.deepEqual({ ...g.pos }, { x: 600, y: -200 });
  assert.deepEqual({ ...g.vel }, { x: 0, y: 0 });
});

prueba('arranca suave: el primer cuadro casi no se mueve', () => {
  const g = crear({ x: 0, y: 0 });
  g.setGoal({ x: 600, y: 0 });
  g.step(0.0133);
  assert.ok(g.pos.x < 6, `primer paso: ${g.pos.x.toFixed(2)} px`);
});

prueba('no se pasa del destino ni vuelve', () => {
  const g = crear({ x: 0, y: 0 });
  g.setGoal({ x: 600, y: 0 });
  const { xs } = viajar(g, 2, 13.3);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] >= xs[i - 1] - 1e-9 && xs[i] <= 600 + 1e-9, `cuadro ${i}: ${xs[i]}`);
});

prueba('da lo mismo a 75 que a 32 pasos por segundo', () => {
  const a = crear({ x: 0, y: 0 }), b = crear({ x: 0, y: 0 });
  a.setGoal({ x: 600, y: 0 });
  b.setGoal({ x: 600, y: 0 });
  // 0,4 s: 30 pasos de 13,33 ms contra 13 de 30,77 ms
  for (let i = 0; i < 30; i++) a.step(0.4 / 30);
  for (let i = 0; i < 13; i++) b.step(0.4 / 13);
  assert.ok(Math.abs(a.pos.x - b.pos.x) < 0.5, `${a.pos.x.toFixed(2)} contra ${b.pos.x.toFixed(2)}`);
});

prueba('tarda lo mismo que el viaje de antes (~0,4 s al 90 %)', () => {
  const g = crear({ x: 0, y: 0 });
  g.setGoal({ x: 1000, y: 0 });
  let t = 0;
  while (g.pos.x < 900) { g.step(0.001); t += 1; }
  assert.ok(t > 330 && t < 460, `${t} ms`);
});

prueba('si el destino cambia a mitad de camino, la velocidad no salta', () => {
  const g = crear({ x: 0, y: 0 });
  g.setGoal({ x: 600, y: 0 });
  for (let i = 0; i < 15; i++) g.step(0.0133);
  const x0 = g.pos.x;
  g.step(0.0133);
  const v1 = g.pos.x - x0;
  // La ventana se corrió 150 px más lejos (arrastrándola)
  g.setGoal({ x: 750, y: 0 });
  const x1 = g.pos.x;
  g.step(0.0133);
  const v2 = g.pos.x - x1;
  assert.ok(Math.abs(v2 - v1) < 2.5, `de ${v1.toFixed(2)} a ${v2.toFixed(2)} px por cuadro`);
});

prueba('un paso enorme (la pantalla no pintó) no lo teletransporta', () => {
  const g = crear({ x: 0, y: 0 });
  g.setGoal({ x: 600, y: 0 });
  g.step(5);
  assert.ok(g.pos.x < 100, `${g.pos.x.toFixed(1)} px`);
});

console.log(fallas ? `\n${fallas} falla(s)` : '\ntodo ok');
process.exit(fallas ? 1 : 0);
