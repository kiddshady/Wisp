// Sprites de Wisp: todo se dibuja píxel por píxel sobre un lienzo de 24 × 24.
// Lo usan el renderer (con <script>) y el proceso main (con require, para el ícono de la bandeja).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WispSprites = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // o contorno · w cuerpo · s sombra · e ojos/boca · h brillo · b cachetes
  // d gota de sudor · g destellos · z puntitos y zetas
  const PALETTE = { o: '#2a2140', w: '#eef0ff', s: '#b9b6e6', e: '#2a2140', h: '#ffffff', b: '#f39ac0', d: '#8fd3ff', g: '#ffe48a', z: '#b9b6e6' };

  // Cuerpo (16 de ancho)
  const TOP = [
    '.....oooooo.....',
    '...oowwwwwwoo...',
    '..owwwwwwwwwwo..',
    '.owwwwwwwwwwwwo.',
    '.owwwwwwwwwwwso.',
    'owwwwwwwwwwwwwso',
    'owwwwwwwwwwwwwso',
    'owwwwwwwwwwwwwso',
    'owwwwwwwwwwwwwso',
    'owwwwwwwwwwwwwso',
    'owwwwwwwwwwwwsso',
    'owwwwwwwwwwwwsso',
  ];
  // La colita ondula entre dos cuadros
  const SKIRT = [
    ['owwwoowwwwoowsso', '.ooo..oooo..ooo.'],
    ['owwwwoowwwwoosso', '.oooo..oooo..oo.'],
  ];

  // Caras: filas que se pintan encima del cuerpo (_ = no tocar)
  const FACES = {
    idle:   { 5: '____he___he_____', 6: '____ee___ee_____', 7: '____ee___ee_____', 8: '___b_______b____' },
    blink:  { 7: '____ee___ee_____', 8: '___b_______b____' },
    wait:   { 4: '_____he___he____', 5: '_____ee___ee____', 6: '_____ee___ee____', 8: '___b_______b____', 9: '_______ee_______' },
    happy:  { 5: '_____e____e_____', 6: '____e_e__e_e____', 8: '___b________b___' },   // sin boca: solo ^^ y cachetes
    scared: { 3: '_____________d__', 4: '____ee___ee_dd__', 5: '____ee___ee_____', 6: '____ee___ee_____', 7: '____ee___ee_____',
              9: '_____e_e_e______', 10: '______e_e_______' },
    sleep:  { 7: '___eee___eee____', 8: '___b_______b____', 9: '_______e________' },
  };

  const ZBIG = ['zzzz', '..z.', '.z..', 'zzzz'];
  const ZSMALL = ['zzz', '.z.', 'zzz'];

  // Índice de cuadro siempre en 0..n-1, aunque t llegue negativo
  function frame(t, fps, n) { return ((Math.floor(t * fps) % n) + n) % n; }

  function px(ctx, color, x, y) { ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1); }
  function stamp(ctx, color, rows, x, y) {
    rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] !== '.') px(ctx, color, x + i, y + j); });
  }
  function sparkle(ctx, color, x, y, big) {
    px(ctx, color, x, y);
    if (big) { px(ctx, color, x - 1, y); px(ctx, color, x + 1, y); px(ctx, color, x, y - 1); px(ctx, color, x, y + 1); }
  }

  function drawGhost(ctx, g) {
    const ox = 4 + (g.x || 0), oy = 6 + (g.y || 0);
    TOP.concat(SKIRT[g.skirt || 0]).forEach((r, j) => {
      for (let i = 0; i < 16; i++) if (r[i] !== '.') px(ctx, PALETTE[r[i]], ox + i, oy + j);
    });
    const f = FACES[g.face || 'idle'];
    for (const k in f) {
      const r = f[k];
      for (let i = 0; i < 16; i++) if (r[i] !== '_') px(ctx, PALETTE[r[i]], ox + i + (g.fdx || 0), oy + Number(k));
    }
  }

  function shadow(ctx, cx, w) {
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.fillRect(cx - w, 21, w * 2, 1);
    ctx.fillRect(cx - w + 1, 22, w * 2 - 2, 1);
  }

  // Estados: cada uno devuelve la pose para t segundos desde que arrancó
  const STATES = {
    idle(t) {
      const y = Math.round(Math.sin(t * 2.2) * 1.2);
      const cyc = t % 6;
      const fdx = cyc > 2.2 && cyc < 3.2 ? -1 : cyc > 4 && cyc < 5 ? 1 : 0;
      return { y, skirt: frame(t, 3, 2), face: (t % 3.7) < 0.14 ? 'blink' : 'idle', fdx, shadow: y < 0 ? 4 : 5 };
    },
    waiting(t) {
      const y = Math.round(Math.sin(t * 1.4));
      return {
        y, skirt: frame(t, 2, 2), face: 'wait', shadow: y < 0 ? 4 : 5,
        fx(ctx) { const n = frame(t, 2.5, 4); for (let i = 0; i < n; i++) px(ctx, PALETTE.z, 15 + i * 2, 3 + y); },
      };
    },
    celebrate(t) {
      const phase = (t * 1.6) % 1;
      const y = -Math.round(Math.sin(phase * Math.PI) * 5);
      const spots = [[1, 8], [22, 6], [2, 17], [21, 16], [19, 1], [4, 2]];
      return {
        y, skirt: frame(t, 6, 2), face: 'happy', shadow: 5 + Math.round(y / 2.5),
        fx(ctx) {
          spots.forEach(([sx, sy], i) => {
            const v = (t * 3 + i * 0.37) % 1;
            if (v < 0.75) sparkle(ctx, PALETTE.g, sx, sy, v < 0.5);
          });
        },
      };
    },
    scared(t) {
      const shaking = (t % 1.2) < 0.7;
      const x = shaking ? [0, 1, 0, -1][frame(t, 20, 4)] : 0;
      return {
        x, skirt: frame(t, 8, 2), face: 'scared', shadow: 5,
        fx(ctx) { if (shaking) { for (let r = 1; r <= 3; r++) px(ctx, PALETTE.b, 21, r); px(ctx, PALETTE.b, 21, 5); } },
      };
    },
    sleep(t) {
      const y = Math.round(Math.sin(t * 1.2));
      return {
        y, skirt: frame(t, 1.2, 2), face: 'sleep', shadow: 5,
        fx(ctx) {
          [0, 1].forEach(k => {
            const p = (t * 0.45 + k * 0.5) % 1;
            ctx.globalAlpha = p < 0.15 ? p / 0.15 : p > 0.8 ? (1 - p) / 0.2 : 1;
            stamp(ctx, PALETTE.z, k === 0 ? ZBIG : ZSMALL, 18 + Math.round(p * 2), 5 - Math.round(p * 5));
          });
          ctx.globalAlpha = 1;
        },
      };
    },
  };

  // extra pisa la pose (por ejemplo fdx para que mire hacia donde se mueve)
  function render(ctx, name, t, extra) {
    ctx.clearRect(0, 0, 24, 24);
    const g = STATES[name](Math.max(0, t));
    if (extra) Object.assign(g, extra);
    shadow(ctx, 12 + (g.x || 0), g.shadow);
    drawGhost(ctx, g);
    if (g.fx) g.fx(ctx);
  }

  return { PALETTE, TOP, SKIRT, FACES, STATES, render };
});
