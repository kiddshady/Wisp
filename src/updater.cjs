'use strict';
// Actualizaciones silenciosas, con la receta de Prism: electron-builder sube un latest.yml a
// cada release de kiddshady/Wisp y electron-updater lo lee. Sin servidor propio.
//
// Busca al arrancar y cada 6 h, baja sola, y se instala sin preguntar cuando Wisp se duerme
// (60 s sin tocar nada), o la próxima vez que salís. El instalador corre con /S y Wisp vuelve
// a abrirse solo. Lo que pasa queda en %APPDATA%\Wisp\updater.log.
//
// Para probarlo desde el código: WISP_UPDATE_TEST=1 npm start (finge ser la 0.0.1).
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const EVERY_MS = 6 * 60 * 60 * 1000;

let autoUpdater = null;
let ready = null;

function log(level, ...parts) {
  try {
    const line = `${new Date().toISOString()} ${level} ${parts.map(String).join(' ').split('\n')[0]}\n`;
    fs.appendFileSync(path.join(app.getPath('userData'), 'updater.log'), line);
  } catch {}
}

function check() {
  if (!autoUpdater || ready) return;
  autoUpdater.checkForUpdates().catch((err) => log('error', err?.message || err));
}

function init() {
  const devTest = !app.isPackaged && process.env.WISP_UPDATE_TEST;
  if (!app.isPackaged && !devTest) return;   // desde el código fuente se actualiza con git
  if (process.env.PORTABLE_EXECUTABLE_FILE) return;

  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (...a) => log('info', ...a),
    warn: (...a) => log('warn', ...a),
    error: (...a) => log('error', ...a),
    debug: () => {},
  };
  if (devTest) {
    autoUpdater.updateConfigPath = path.join(__dirname, '..', 'dev-app-update.yml');
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.currentVersion = '0.0.1';
  }

  autoUpdater.on('update-downloaded', (info) => { ready = info?.version || 'nueva'; });
  autoUpdater.on('error', (err) => log('error', err?.message || err));

  setTimeout(check, 15000);
  setInterval(check, EVERY_MS);
}

// Cierra Wisp e instala en silencio; devuelve false si no hay nada bajado
function installIfReady() {
  if (!autoUpdater || !ready) return false;
  log('info', `instalando la ${ready}`);
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return true;
}

module.exports = { init, installIfReady, readyVersion: () => ready };
