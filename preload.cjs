'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['state', 'sleep', 'move', 'visible'];

contextBridge.exposeInMainWorld('wisp', {
  on(channel, fn) {
    if (CHANNELS.includes(channel)) ipcRenderer.on(channel, (_e, value) => fn(value));
  },
  hit: (over) => ipcRenderer.send('hit', !!over),
  poke: () => ipcRenderer.send('poke'),
  menu: () => ipcRenderer.send('menu'),
});
