'use strict';
const { app, BrowserWindow, Tray, Menu, screen, powerMonitor, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const ui = require('./src/ui-protocol.cjs');
const updater = require('./src/updater.cjs');

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
const EASE = 0.16;            // cuánto del camino que falta recorre por cuadro

const TESTS = [
  ['Flotando', 'idle', 0],
  ['Esperando', 'waiting', 4000],
  ['Festejo', 'celebrate', 2200],
  ['Susto', 'scared', 2200],
  ['Durmiendo', 'sleep', 5000],
];

const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
else ui.registerScheme();

let win = null;
let tray = null;
let pos = null;
let goal = null;
let mover = null;
let lastDir = 0;
let lastHwnd = 0;
let visible = true;
let asleep = false;
let still = false;

// Con WISP_DEBUG=1 anota lo que pasa con el mouse y los estados en %APPDATA%\Wisp\debug.log
const DEBUG = !!process.env.WISP_DEBUG;
function dbg(...parts) {
  if (!DEBUG) return;
  const line = `${new Date().toISOString()} ${parts.join(' ')}\n`;
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'debug.log'), line); } catch {}
}

function send(channel, value) {
  if (channel !== 'move' && channel !== 'cursor') dbg('send', channel, JSON.stringify(value));
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
function place() {
  win.setBounds({ x: Math.round(pos.x), y: Math.round(pos.y), width: SIZE, height: SIZE });
}

function setDir(d) {
  if (d === lastDir) return;
  lastDir = d;
  send('move', d);
}

function step() {
  const dx = goal.x - pos.x, dy = goal.y - pos.y;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
    pos = { ...goal };
    place();
    clearInterval(mover);
    mover = null;
    setDir(0);
    return;
  }
  pos.x += dx * EASE;
  pos.y += dy * EASE;
  if (Math.abs(dx) > 6) setDir(Math.sign(dx));
  place();
}

function goTo(p) {
  if (goal && Math.abs(goal.x - p.x) < 1 && Math.abs(goal.y - p.y) < 1) return;
  goal = { x: p.x, y: p.y };
  if (!mover) mover = setInterval(step, 16);
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

function buildMenu() {
  const login = app.getLoginItemSettings(loginOpts());
  const update = updater.readyVersion();
  return Menu.buildFromTemplate([
    { label: `Wisp ${app.getVersion()}`, enabled: false },
    ...(update ? [{ label: `Actualizar ahora a la ${update}`, click: () => updater.installIfReady() }] : []),
    { type: 'separator' },
    { label: 'Probar un estado', submenu: TESTS.map(([label, name, ms]) => ({ label, click: () => send('state', { name, ms }) })) },
    { label: 'Quedarse quieto', type: 'checkbox', checked: still, click: (item) => { still = item.checked; if (!still) poll(); } },
    { label: 'Iniciar con Windows', type: 'checkbox', checked: login.openAtLogin, click: (item) => app.setLoginItemSettings({ ...loginOpts(), openAtLogin: item.checked }) },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() },
  ]);
}

ipcMain.on('hit', (_e, over) => {
  dbg('hit', over);
  if (win) win.setIgnoreMouseEvents(!over);
});
ipcMain.on('poke', () => {
  dbg('poke');
  wake();
  send('state', { name: 'celebrate', ms: 1400 });
});
// El menú sale por la bandeja aunque lo pidas desde Wisp: la ventana de Wisp no puede tomar
// el foco, y un menú colgado de ella no se cierra al hacer clic afuera. La bandeja sí.
ipcMain.on('dbg', (_e, msg) => dbg('renderer', msg));
ipcMain.on('menu', () => tray.popUpContextMenu(buildMenu(), screen.getCursorScreenPoint()));

app.on('second-instance', () => send('state', { name: 'celebrate', ms: 1400 }));
app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  if (!primary) return;
  ui.serve();
  pos = cornerOf(screen.getPrimaryDisplay());
  goal = { ...pos };

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
  win.once('ready-to-show', () => {
    win.showInactive();
    setInterval(poll, POLL_MS);
    setInterval(checkIdle, 1000);
    setInterval(trackCursor, 33);
  });

  tray = new Tray(path.join(__dirname, 'build', 'tray.ico'));
  tray.setToolTip('Wisp');
  const openMenu = () => tray.popUpContextMenu(buildMenu());
  tray.on('click', openMenu);
  tray.on('right-click', openMenu);

  updater.init();
});
