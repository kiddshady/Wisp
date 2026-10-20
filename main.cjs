'use strict';
const { app, BrowserWindow, Tray, Menu, screen, powerMonitor, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const ui = require('./src/ui-protocol.cjs');
const updater = require('./src/updater.cjs');
const ccMod = require('./src/cc.cjs');
const glider = require('./src/glide.cjs');

let win32 = null;
try {
  win32 = require('./src/win32.cjs');
} catch (err) {
  console.error('[wisp] sin acceso a Win32, me quedo en la esquina:', err.message);
}

const SCALE = 4;
const SIZE = 24 * SCALE;      // la ventana mide lo mismo que el lienzo escalado
const PERCH_Y = 20 * SCALE;   // así la sombra (renglones 21-22) cae sobre la barra de título
const PERCH_RIGHT = 120;      // distancia al borde derecho, lejos de minimizar/maximizar/cerrar
const POLL_MS = 80;
const SLEEP_AFTER_S = 60;

const TESTS = [
  ['Floating', 'idle', 0],
  ['Working', 'waiting', 4000],
  ['Celebrating', 'celebrate', 2200],
  ['Scared', 'scared', 2200],
  ['Sleeping', 'sleep', 5000],
  ['Calling you', 'calling', 4000],
];

// Lo que muestra Wisp según lo que hacen las sesiones de Claude Code (ver src/cc.cjs)
const BASE_SPRITE = { idle: 'idle', working: 'waiting', needs: 'calling' };
const ESTADO_CC = { idle: 'idle', working: 'working', needs: 'needs you' };

// `npm start` corre al lado del Wisp instalado: otro nombre (otro userData y otro candado de
// instancia única) y, con WISP_PORT, otro puerto.
if (!app.isPackaged) app.setName('Wisp Dev');
const PUERTO = Number(process.env.WISP_PORT) || ccMod.PORT;

const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
else ui.registerScheme();

let win = null;
let tray = null;
let glide = null;      // el viaje de Wisp (src/glide.cjs)
let moving = false;
let lastStep = 0;
let lastDir = 0;
let lastHwnd = 0;
let visible = true;
let asleep = false;
let still = false;
let cc = null;

// Con WISP_DEBUG=1 anota lo que pasa con el mouse y los estados en %APPDATA%\Wisp\debug.log
const DEBUG = !!process.env.WISP_DEBUG;
function dbg(...parts) {
  if (!DEBUG) return;
  const line = `${new Date().toISOString()} ${parts.join(' ')}\n`;
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'debug.log'), line); } catch {}
}

// ── Ajustes (userData\config.json) ───────────────────────
function configPath() { return path.join(app.getPath('userData'), 'config.json'); }
function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; }
}
function writeConfig(cambios) {
  try { fs.writeFileSync(configPath(), JSON.stringify({ ...readConfig(), ...cambios }, null, 2)); }
  catch (err) { dbg('config', err.message); }
}

function send(channel, value) {
  if (channel !== 'move' && channel !== 'cursor' && channel !== 'moving') dbg('send', channel, JSON.stringify(value));
  if (win && !win.isDestroyed()) win.webContents.send(channel, value);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function cornerOf(display) {
  const wa = display.workArea;
  return { x: wa.x + wa.width - SIZE - 24, y: wa.y + wa.height - SIZE + 4 };
}

function perchFor(physRect) {
  const r = screen.screenToDipRect(null, physRect);
  const display = screen.getDisplayMatching(r);
  const b = display.bounds, wa = display.workArea;
  const fullscreen = r.x <= b.x && r.y <= b.y && r.x + r.width >= b.x + b.width && r.y + r.height >= b.y + b.height;
  if (fullscreen) return { hide: true };
  const y = r.y - PERCH_Y;
  if (y < wa.y) return cornerOf(display);   // maximizada o pegada arriba: no hay lugar para sentarse
  const x = clamp(r.x + r.width - PERCH_RIGHT - SIZE, Math.max(r.x, wa.x), wa.x + wa.width - SIZE);
  return { x, y };
}

// ── Movimiento ───────────────────────────────────────────
// El reloj lo marca la pantalla: mientras Wisp viaja, el renderer avisa en cada cuadro
// (requestAnimationFrame) y main da un paso. Antes era un setInterval de 16 ms, que en
// Windows late cada ~31 ms porque el reloj del sistema va de a 15,6 ms: medido el
// 20/10/2026, Wisp viajaba a 32 cuadros por segundo en un monitor de 75 Hz.
function place() {
  win.setPosition(Math.round(glide.pos.x), Math.round(glide.pos.y));
  // setPosition entre monitores con distinta escala puede cambiarle el tamaño a la ventana
  const [w, h] = win.getSize();
  if (w !== SIZE || h !== SIZE) win.setSize(SIZE, SIZE);
}

function setDir(d) {
  if (d === lastDir) return;
  lastDir = d;
  send('move', d);
}

function step() {
  if (!moving) return;
  const now = performance.now();
  const dt = (now - lastStep) / 1000;
  lastStep = now;
  const dx = glide.goal.x - glide.pos.x;
  if (Math.abs(dx) > 6) setDir(Math.sign(dx));
  const llego = glide.step(dt);
  place();
  if (!llego) return;
  moving = false;
  send('moving', false);
  setDir(0);
}

function goTo(p) {
  const g = glide.goal;
  if (Math.abs(g.x - p.x) < 1 && Math.abs(g.y - p.y) < 1) return;
  glide.setGoal(p);
  if (moving) return;
  moving = true;
  lastStep = performance.now();
  send('moving', true);
}

function setVisible(v) {
  if (v === visible) return;
  visible = v;
  send('visible', v);
  if (!v) win.setIgnoreMouseEvents(true);
}

// ── Seguir la ventana enfocada ───────────────────────────
function poll() {
  if (!win || still) return;
  if (!win32) return goTo(cornerOf(screen.getPrimaryDisplay()));

  const fg = win32.foreground();
  if (!fg || fg.kind === 'ignore' || fg.pid === process.pid) return;

  if (fg.hwnd !== lastHwnd) {
    lastHwnd = fg.hwnd;
    wake();
    win.moveTop();
  }

  if (fg.kind === 'desktop') {
    setVisible(true);
    return goTo(cornerOf(screen.getDisplayNearestPoint(screen.getCursorScreenPoint())));
  }

  const p = perchFor(fg.rect);
  if (p.hide) return setVisible(false);
  setVisible(true);
  goTo(p);
}

// ── El cursor ────────────────────────────────────────────
// La ventana deja pasar el mouse, así que no se entera sola de que el cursor está encima.
// El reenvío de Electron (forward) depende de un gancho de mouse que en Windows no llega:
// Wisp nunca veía el cursor y el clic pasaba de largo. Ahora main mira dónde está el
// cursor y le pasa la posición al renderer, que decide si cae sobre un píxel del fantasma.
let lastCursor = '';
function trackCursor() {
  if (!win || win.isDestroyed()) return;
  const p = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const inside = visible && p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height;
  const key = inside ? `${p.x - b.x},${p.y - b.y}` : '';
  if (key === lastCursor) return;
  lastCursor = key;
  send('cursor', inside ? { x: p.x - b.x, y: p.y - b.y } : null);
}

// ── Sueño ────────────────────────────────────────────────
function wake() {
  if (!asleep) return;
  asleep = false;
  send('sleep', false);
}

function checkIdle() {
  const idle = powerMonitor.getSystemIdleTime();
  // Mientras Claude Code trabaja o te necesita, Wisp se queda despierto mostrándolo
  // (y la actualización espera: reiniciarse ahora le borraría la lista de sesiones).
  if (cc) cc.recalcular();
  if (cc && cc.base !== 'idle') return wake();
  if (!asleep && idle >= SLEEP_AFTER_S) {
    // Si hay una versión nueva bajada, se instala ahora que nadie está mirando
    if (updater.installIfReady()) return;
    asleep = true;
    send('sleep', true);
  } else if (asleep && idle < 2) {
    wake();
  }
}

// ── Menú (bandeja y clic derecho sobre Wisp) ─────────────
function loginOpts() {
  return app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] };
}

function ccItems() {
  const r = cc.resumen();
  const sesiones = r.activo ? r.sesiones : [];
  return [
    { label: 'React to Claude Code', type: 'checkbox', checked: r.activo, click: (item) => activarCC(item.checked) },
    ...sesiones.map((s) => ({ label: `    ${s.nombre || 'session'}: ${ESTADO_CC[s.estado]}`, enabled: false })),
  ];
}

function activarCC(v) {
  cc.encender(v);
  writeConfig({ cc: v });
}

function buildMenu() {
  const login = app.getLoginItemSettings(loginOpts());
  const update = updater.readyVersion();
  return Menu.buildFromTemplate([
    { label: `Wisp ${app.getVersion()}`, enabled: false },
    ...(update ? [{ label: `Update now to ${update}`, click: () => updater.installIfReady() }] : []),
    { type: 'separator' },
    ...ccItems(),
    { type: 'separator' },
    { label: 'Try a state', submenu: TESTS.map(([label, name, ms]) => ({ label, click: () => send('state', { name, ms }) })) },
    { label: 'Stay still', type: 'checkbox', checked: still, click: (item) => { still = item.checked; if (!still) poll(); } },
    { label: 'Start with Windows', type: 'checkbox', checked: login.openAtLogin, click: (item) => app.setLoginItemSettings({ ...loginOpts(), openAtLogin: item.checked }) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

ipcMain.on('hit', (_e, over) => {
  if (win) win.setIgnoreMouseEvents(!over);
  dbg('hit', over, DEBUG && win32 && win ? JSON.stringify(win32.exStyle(win32.handleOf(win))) : '');
});
ipcMain.on('poke', () => {
  dbg('poke');
  wake();
  send('state', { name: 'celebrate', ms: 1400 });
});
// El menú sale por la bandeja aunque lo pidas desde Wisp: la ventana de Wisp no puede tomar
// el foco, y un menú colgado de ella no se cierra al hacer clic afuera. La bandeja sí.
ipcMain.on('dbg', (_e, msg) => dbg('renderer', msg));
ipcMain.on('frame', step);
ipcMain.on('menu', () => {
  dbg('menu');
  tray.popUpContextMenu(buildMenu(), screen.getCursorScreenPoint());
});

app.on('second-instance', () => send('state', { name: 'celebrate', ms: 1400 }));
app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  if (!primary) return;
  ui.serve();
  const pos = cornerOf(screen.getPrimaryDisplay());
  glide = glider.crear(pos);

  win = new BrowserWindow({
    x: pos.x, y: pos.y, width: SIZE, height: SIZE,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, thickFrame: false,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, focusable: false, alwaysOnTop: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  win.loadURL(ui.uiUrl('index.html'));
  // Un aviso que llegó antes de que cargue la página se perdería: se repite al cargar.
  win.webContents.on('did-finish-load', () => {
    if (cc) send('base', BASE_SPRITE[cc.base]);
    if (moving) send('moving', true);
  });
  win.once('ready-to-show', () => {
    win.showInactive();
    setInterval(poll, POLL_MS);
    setInterval(checkIdle, 1000);
    setInterval(trackCursor, 33);
    // Plazo de red: si la página deja de pintar (pantalla apagada), el viaje sigue igual
    setInterval(() => { if (moving && performance.now() - lastStep > 60) step(); }, 50);
  });

  tray = new Tray(path.join(__dirname, 'build', 'tray.ico'));
  tray.setToolTip('Wisp');

  cc = ccMod.crear({
    activo: readConfig().cc !== false,
    alCambiar: (base) => {
      send('base', BASE_SPRITE[base]);
      if (base !== 'idle') wake();
      const llaman = cc ? cc.resumen().sesiones.filter((s) => s.estado === 'needs').map((s) => s.nombre) : [];
      tray.setToolTip(base === 'needs' ? `Wisp · needs you: ${llaman.join(', ')}` : 'Wisp');
    },
    alMomento: (name) => { wake(); send('state', { name, ms: 2200 }); },
  });
  ccMod.servir(cc, { puerto: PUERTO, alActivar: (v) => writeConfig({ cc: v }), log: dbg });
  const openMenu = () => tray.popUpContextMenu(buildMenu());
  tray.on('click', openMenu);
  tray.on('right-click', openMenu);

  updater.init();
});
