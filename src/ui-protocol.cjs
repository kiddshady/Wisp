'use strict';
// La interfaz se sirve por un esquema propio (wisp-ui://app/…), como en Prism.
// El instalador apaga los privilegios de file:// (el fuse grantFileProtocolExtraPrivileges)
// y con eso loadFile ya no puede leer adentro del app.asar.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { protocol, net } = require('electron');

const SCHEME = 'wisp-ui';
const HOST = 'app';
const ROOT = path.join(__dirname, '..', 'renderer');

// Antes de que la app esté lista
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

// Con la app lista: sirve los archivos de renderer/ y nada que quede afuera
function serve() {
  protocol.handle(SCHEME, async (req) => {
    let url;
    try { url = new URL(req.url); } catch { return new Response(null, { status: 400 }); }
    if (url.host !== HOST) return new Response(null, { status: 404 });
    const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT + path.sep)) return new Response(null, { status: 404 });
    try {
      return await net.fetch(pathToFileURL(file).href);
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

const uiUrl = (page) => `${SCHEME}://${HOST}/${page}`;

module.exports = { registerScheme, serve, uiUrl };
