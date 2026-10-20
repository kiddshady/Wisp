'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['state', 'base', 'sleep', 'move', 'moving', 'visible', 'cursor'];

contextBridge.exposeInMainWorld('wisp', {
  on(channel, fn) {
    if (CHANNELS.includes(channel)) ipcRenderer.on(channel, (_e, value) => fn(value));
  },
  hit: (over) => ipcRenderer.send('hit', !!over),
  poke: () => ipcRenderer.send('poke'),
  menu: () => ipcRenderer.send('menu'),
  frame: () => ipcRenderer.send('frame'),
  dbg: (msg) => ipcRenderer.send('dbg', String(msg)),
});
