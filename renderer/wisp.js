'use strict';

const { render } = WispSprites;
const cv = document.getElementById('c');
const ctx = cv.getContext('2d', { willReadFrequently: true });
const SCALE = 4;

let state = 'idle';
let since = performance.now();
let revert = 0;
let dir = 0;
let over = false;
let shown = true;

function setState(name, ms) {
  state = name;
  since = performance.now();
  clearTimeout(revert);
  if (ms) revert = setTimeout(() => setState('idle'), ms);
}

wisp.on('state', ({ name, ms }) => setState(name, ms));
wisp.on('sleep', (asleep) => {
  if (asleep) setState('sleep');
  else if (state === 'sleep') setState('idle');
});
wisp.on('move', (d) => { dir = d; });
wisp.on('visible', (v) => {
  shown = v;
  document.body.classList.toggle('on', v);
  if (!v) setOver(false);
});

// La ventana deja pasar el mouse salvo sobre los píxeles del fantasma (la sombra no cuenta)
function setOver(v) {
  if (v === over) return;
  over = v;
  document.body.classList.toggle('over', v);
  wisp.hit(v);
}
window.addEventListener('mousemove', (e) => {
  if (!shown) return;
  const x = Math.floor(e.clientX / SCALE), y = Math.floor(e.clientY / SCALE);
  const alpha = x >= 0 && y >= 0 && x < 24 && y < 24 ? ctx.getImageData(x, y, 1, 1).data[3] : 0;
  setOver(alpha > 200);
});
document.addEventListener('mouseleave', () => setOver(false));
window.addEventListener('click', () => { if (over) wisp.poke(); });
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (over) wisp.menu();
});

// El próximo cuadro se pide primero: si un dibujo falla, la animación sigue viva
requestAnimationFrame(function loop(now) {
  requestAnimationFrame(loop);
  const looking = dir && (state === 'idle' || state === 'waiting');
  try {
    render(ctx, state, (now - since) / 1000, looking ? { fdx: dir } : null);
  } catch (err) {
    console.error('[wisp] no pude dibujar el cuadro:', err);
  }
});

// Entra con fundido: un cuadro con opacidad 0 y recién ahí se enciende
requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('on')));
