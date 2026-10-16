'use strict';

const { render } = WispSprites;
const cv = document.getElementById('c');
const ctx = cv.getContext('2d', { willReadFrequently: true });
const SCALE = 4;

let state = 'idle';
let since = performance.now();
let revert = 0;
// El estado de fondo: al que vuelve después de un festejo o un susto. Es 'idle' salvo que
// Claude Code esté trabajando ('waiting') o te necesite ('calling'); lo manda main.
let base = 'idle';
let momento = false;
let dir = 0;
let over = false;
let shown = true;

function setState(name, ms) {
  state = name;
  since = performance.now();
  clearTimeout(revert);
  momento = !!ms;
  if (ms) revert = setTimeout(() => setState(base), ms);
}

wisp.on('state', ({ name, ms }) => setState(name, ms));
wisp.on('base', (name) => {
  base = name;
  // Un momento en curso termina solo y vuelve al fondo nuevo; dormido, sigue durmiendo.
  if (!momento && state !== 'sleep' && state !== base) setState(base);
});
wisp.on('sleep', (asleep) => {
  if (asleep) setState('sleep');
  else if (state === 'sleep') setState(base);
});
wisp.on('move', (d) => { dir = d; });
wisp.on('visible', (v) => {
  shown = v;
  document.body.classList.toggle('on', v);
  if (!v) setOver(false);
});

// La ventana deja pasar el mouse salvo sobre los píxeles del fantasma (la sombra no cuenta).
// main manda dónde está el cursor (relativo a la ventana, o null si está afuera); acá se mira
// el píxel. Se vuelve a mirar en cada cuadro: si Wisp salta o se mueve, el cursor puede
// quedar sobre aire aunque no se haya movido.
let cursor = null;

function setOver(v) {
  if (v === over) return;
  over = v;
  document.body.classList.toggle('over', v);
  wisp.hit(v);
}
function checkOver() {
  if (!shown || !cursor) return setOver(false);
  const x = Math.floor(cursor.x / SCALE), y = Math.floor(cursor.y / SCALE);
  const alpha = x >= 0 && y >= 0 && x < 24 && y < 24 ? ctx.getImageData(x, y, 1, 1).data[3] : 0;
  setOver(alpha > 200);
}
wisp.on('cursor', (c) => { cursor = c; checkOver(); });
// Se reacciona al soltar el botón y no al evento click. Después de un rato, a esta ventana
// (que no toma el foco) le dejan de llegar los mousedown: solo llega el mouseup, y sin los
// dos Chromium nunca arma un click. Lo mostró debug.log el 15/10/2026, con la manito puesta.
window.addEventListener('pointerdown', (e) => wisp.dbg(`down btn=${e.button} over=${over}`));
window.addEventListener('pointerup', (e) => {
  wisp.dbg(`up btn=${e.button} over=${over}`);
  if (!over) return;
  if (e.button === 0) wisp.poke();
  else if (e.button === 2) wisp.menu();
});
window.addEventListener('contextmenu', (e) => e.preventDefault());

// El próximo cuadro se pide primero: si un dibujo falla, la animación sigue viva
requestAnimationFrame(function loop(now) {
  requestAnimationFrame(loop);
  const looking = dir && (state === 'idle' || state === 'waiting' || state === 'calling');
  try {
    render(ctx, state, (now - since) / 1000, looking ? { fdx: dir } : null);
  } catch (err) {
    console.error('[wisp] no pude dibujar el cuadro:', err);
  }
  if (cursor) checkOver();
});

// Entra con fundido: un cuadro con opacidad 0 y recién ahí se enciende
requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('on')));
