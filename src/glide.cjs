'use strict';
// El viaje de Wisp de un lugar a otro: un resorte con amortiguación crítica. Arranca suave,
// frena suave y no rebota. Guarda la velocidad, así que si el destino cambia a mitad de
// camino (la ventana se está arrastrando) dobla sin tironear. Todo va por tiempo: da lo
// mismo cuántos pasos lleguen por segundo.

const OMEGA = 10;        // rigidez (1/s): ~0,4 s al 90 % del camino, ~0,65 s al 99 %
const MAX_DT = 0.05;     // un paso más largo (la pantalla no pintó) se toma como de 50 ms
// Más cerca que esto y casi quieto, llegó. Con menos, los últimos píxeles se arrastraban
// de a uno durante ~300 ms y el último caía 133 ms después del anterior: un clic al final.
const REST_DIST = 1.5;   // px
const REST_SPEED = 30;   // px/s

function crear(pos) {
  const p = { x: pos.x, y: pos.y };
  const v = { x: 0, y: 0 };
  let goal = { ...p };

  // Solución exacta del resorte crítico para un paso dt, por eje
  function eje(k, dt) {
    const x = p[k] - goal[k];
    const e = Math.exp(-OMEGA * dt);
    const c = v[k] + OMEGA * x;
    p[k] = goal[k] + (x + c * dt) * e;
    v[k] = (v[k] - OMEGA * c * dt) * e;
  }

  return {
    get pos() { return p; },
    get goal() { return goal; },
    get vel() { return v; },
    setGoal(g) { goal = { x: g.x, y: g.y }; },
    // Avanza dt segundos. Devuelve true cuando llegó (y deja la posición clavada en el destino).
    step(dt) {
      dt = Math.min(Math.max(dt, 0), MAX_DT);
      eje('x', dt);
      eje('y', dt);
      const lejos = Math.hypot(goal.x - p.x, goal.y - p.y);
      if (lejos < REST_DIST && Math.hypot(v.x, v.y) < REST_SPEED) {
        p.x = goal.x; p.y = goal.y; v.x = 0; v.y = 0;
        return true;
      }
      return false;
    },
  };
}

module.exports = { crear, OMEGA };
