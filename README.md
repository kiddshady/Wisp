# Wisp

Mascota de escritorio en pixel art: un fantasmita que vive arriba de la ventana enfocada.

```bash
npm start        # correr en desarrollo
npm test         # la conexión con Claude Code (src/cc.cjs), sin Electron
npm run icons    # regenerar build/icon.png, icon.ico y tray.ico desde los sprites
npm run build    # instalador en dist/Wisp-Setup-<versión>.exe
npm run release  # compila, sube a GitHub (kiddshady/Wisp) y publica; las instalaciones se actualizan solas
```

Antes de `npm run release`: `npm version <patch|minor>` y `git push origin main --follow-tags`.

Con `WISP_DEBUG=1` en el entorno, Wisp anota en `%APPDATA%\Wisp\debug.log` lo que pasa con el
cursor, los clics y los estados.

## Qué hace

- Se sienta sobre la barra de título de la ventana enfocada y se desliza cuando cambiás de ventana.
- Si la ventana está maximizada o enfocás el escritorio, se va a descansar a la esquina de abajo a la derecha.
- Se esconde con un fundido cuando algo está en pantalla completa.
- Se duerme después de 60 s sin tocar el mouse ni el teclado y se despierta con cualquier actividad.
- Clic: festeja. Clic derecho (sobre él o en la bandeja): el menú.
- Reacciona a Claude Code (ver abajo), y mientras Claude Code trabaja o te necesita no se duerme.
- Fuera de sus píxeles, la ventana deja pasar el mouse.
- Se actualiza solo: busca en los releases de GitHub al arrancar y cada 6 h, baja la versión nueva
  y la instala en silencio la próxima vez que se duerme. El registro queda en `%APPDATA%\Wisp\updater.log`.

## Estados

`idle` (flotando), `waiting` (esperando), `celebrate` (festejo), `scared` (susto), `sleep` (durmiendo)
y `calling` (te llama: saltitos y un «!»). Se prueban desde el menú, en «Probar un estado».

## Claude Code

Cada sesión de Claude Code le avisa a Wisp qué está haciendo, con el mod de `cc-mod/`, por HTTP en
`127.0.0.1:4790`. Wisp junta todas las sesiones y muestra lo más urgente:

| Alguna sesión… | Wisp |
|---|---|
| te pide un permiso o te hace una pregunta | te llama (`calling`) |
| está trabajando | esperando (`waiting`, el de los puntitos) |
| ninguna hace nada | flotando (`idle`) |

Al terminar un turno de más de 20 s festeja, y si se corta o falla, se asusta. Una sesión que pasa
150 s sin avisar (el mod repite su estado cada 60) se olvida, por si se cerró sin despedirse.

- Se apaga y se prende con el tilde «Reaccionar a Claude Code» del menú, o desde Claude Code con
  `/wisp off` y `/wisp on`; `/wisp` solo dice cómo está. El menú lista las sesiones que avisaron.
- Para cargar el mod en todos los Claude Code de la máquina, `S:\tools\Wisp\cc-mod` va en
  `CLAUDE_CODE_PLUGIN_DIRS` (en el `env` de `~/.claude/settings.json`, separado con `;`).
- El servidor pide `Content-Type: application/json` y un `Host` local: una página web no puede
  mandarle avisos. `GET /cc` devuelve el estado; `POST /cc` es un aviso
  (`{ session, name, state: idle|working|needs|gone, moment?: celebrate|scared }`);
  `POST /cc/activo` con `{ activo }` lo prende o lo apaga.
- `npm start` corre como «Wisp Dev», al lado del instalado; con `WISP_PORT=4791` escucha en otro
  puerto, y el mod lee la misma variable. `claude plugin test cc-mod` prueba el mod.

## Estructura

- `main.cjs`: la ventana transparente, el seguimiento, el sueño y el menú.
- `src/win32.cjs`: la ventana enfocada y sus bordes, con koffi (sin compilar nada).
- `src/updater.cjs`: la actualización silenciosa con electron-updater.
- `tools/release.mjs`: publica un release completo o nada (la receta de Prism).
- `src/ui-protocol.cjs`: sirve `renderer/` por `wisp-ui://` (el instalador apaga los privilegios de `file://`).
- `tools/icons.cjs`: genera los íconos en la baldosa estándar, escalando el pixel art solo por enteros.
- `docs/prueba-sprites.html`: la página de prueba original de los sprites.
- `renderer/sprites.js`: los sprites y las animaciones (lienzo de 24 × 24, escala 4).
- `renderer/wisp.js`: el bucle de dibujo y la detección del mouse sobre los píxeles.
- `src/cc.cjs`: la lista de sesiones de Claude Code y su servidor local; `test/cc.test.cjs` la prueba.
- `cc-mod/`: el mod de Claude Code que le avisa a Wisp.

## Pendiente

- Conexión con NTX: que avise cuando corre un comando largo y con qué exit code termina. Puede usar
  el mismo servidor de Claude Code (`POST /cc`, cada pestaña como una sesión).
