'use strict';
// Lo poco de Win32 que necesita Wisp: cuál es la ventana enfocada y dónde está.
// Los rectángulos salen en píxeles físicos; main.cjs los pasa a DIP.
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const dwmapi = koffi.load('dwmapi.dll');

const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });

const GetForegroundWindow = user32.func('intptr_t __stdcall GetForegroundWindow()');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(intptr_t hWnd, _Out_ RECT *lpRect)');
const IsIconic = user32.func('bool __stdcall IsIconic(intptr_t hWnd)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(intptr_t hWnd)');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(intptr_t hWnd, void *lpClassName, int nMaxCount)');
const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32_t *lpdwProcessId)');
const DwmGetWindowAttribute = dwmapi.func('long __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t dwAttribute, _Out_ RECT *pvAttribute, uint32_t cbAttribute)');

const DWMWA_EXTENDED_FRAME_BOUNDS = 9;

// El escritorio: Wisp se va a descansar a la esquina
const DESKTOP = new Set(['Progman', 'WorkerW']);
// Cosas que toman el foco un rato (barra de tareas, Inicio, Alt+Tab, menús): Wisp se queda donde está
const IGNORE = new Set([
  'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Windows.UI.Core.CoreWindow', 'XamlExplorerHostIslandWindow',
  'MultitaskingViewFrame', 'ForegroundStaging', 'TaskListThumbnailWnd', 'NotifyIconOverflowWindow',
  'TopLevelWindowForOverflowXamlIsland', 'Xaml_WindowedPopupClass', '#32768',
]);

const nameBuf = Buffer.alloc(512);

function className(hwnd) {
  const n = GetClassNameW(hwnd, nameBuf, 256);
  return nameBuf.toString('utf16le', 0, n * 2);
}

// Los bordes visibles, sin la sombra invisible que Windows 10/11 le suma a GetWindowRect
function bounds(hwnd) {
  const r = {};
  if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, r, koffi.sizeof(RECT)) !== 0 && !GetWindowRect(hwnd, r)) return null;
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
}

function foreground() {
  const hwnd = Number(GetForegroundWindow());
  if (!hwnd) return null;
  const cls = className(hwnd);
  const pid = [0];
  GetWindowThreadProcessId(hwnd, pid);
  const base = { hwnd, cls, pid: pid[0] };
  if (DESKTOP.has(cls)) return { ...base, kind: 'desktop' };
  if (IGNORE.has(cls) || !IsWindowVisible(hwnd)) return { ...base, kind: 'ignore' };
  if (IsIconic(hwnd)) return { ...base, kind: 'desktop' };
  const rect = bounds(hwnd);
  if (!rect || rect.width < 160 || rect.height < 80) return { ...base, kind: 'ignore' };
  return { ...base, kind: 'window', rect };
}

function handleOf(browserWindow) {
  return Number(browserWindow.getNativeWindowHandle().readBigUInt64LE(0));
}

module.exports = { foreground, handleOf };
