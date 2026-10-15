# Wisp

Mascota de escritorio en pixel art: un fantasmita que vive arriba de la ventana enfocada.

```bash
npm start        # correr en desarrollo
npm run icons    # regenerar build/icon.png, icon.ico y tray.ico desde los sprites
npm run build    # instalador en dist/Wisp-Setup-<versión>.exe
npm run release  # compila, sube a GitHub (kiddshady/Wisp) y publica; las instalaciones se actualizan solas
```

Antes de `npm run release`: `npm version <patch|minor>` y `git push origin main --follow-tags`.

## Qué hace

- Se sienta sobre la barra de título de la ventana enfocada y se desliza cuando cambiás de ventana.
- Si la ventana está maximizada o enfocás el escritorio, se va a descansar a la esquina de abajo a la derecha.
- Se esconde con un fundido cuando algo está en pantalla completa.
- Se duerme después de 60 s sin tocar el mouse ni el teclado y se despierta con cualquier actividad.
- Clic: festeja. Clic derecho (sobre él o en la bandeja): el menú.
- Fuera de sus píxeles, la ventana deja pasar el mouse.
- Se actualiza solo: busca en los releases de GitHub al arrancar y cada 6 h, baja la versión nueva
  y la instala en silencio la próxima vez que se duerme. El registro queda en `%APPDATA%\Wisp\updater.log`.

## Estados

`idle` (flotando), `waiting` (esperando), `celebrate` (festejo), `scared` (susto) y `sleep` (durmiendo).
Se prueban desde el menú, en «Probar un estado».

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

## Pendiente

- Conexión con NTX: que avise cuando corre un comando largo y con qué exit code termina.
