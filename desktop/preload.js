// Bridge between the MeBulb page and the desktop shell. Only these calls are exposed.
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch) => (cb) => { const f = (_e, ...a) => cb(...a); ipcRenderer.on(ch, f); return () => ipcRenderer.removeListener(ch, f); };
contextBridge.exposeInMainWorld('mebulbHost', {
  platform: process.platform,
  info: call('app:info'),
  // files
  openDialog: call('file:openDialog'), openPath: call('file:openPath'), read: call('file:read'), close: call('file:close'), stat: call('file:stat'),
  append: call('file:append'), writeFile: call('file:write'), saveDialog: call('file:saveDialog'), saveOther: call('file:saveOther'), reveal: call('file:reveal'),
  pathForFile: (f) => { try { return webUtils.getPathForFile(f) || ''; } catch { return ''; } },
  getRecent: call('recent:get'), addRecent: call('recent:add'), removeRecent: call('recent:remove'),
  // fonts
  listFonts: call('fonts:list'), fontBytes: call('fonts:bytes'),
  // live sharing folder + local outbox
  sessDir: call('sess:dir'), sessList: call('sess:list'), sessRead: call('sess:read'), sessAppend: call('sess:append'), sessWrite: call('sess:write'), sessRm: call('sess:rm'), sessWatch: call('sess:watch'), sessUnwatch: call('sess:unwatch'), outboxDir: call('outbox:dir'),
  onSessChanged: on('sess:changed'),
  // stamps
  stampList: call('stamps:list'), stampRead: call('stamps:read'), stampAdd: call('stamps:add'), stampRemove: call('stamps:remove'), pickFolder: call('dialog:folder'),
  // printing
  printers: call('print:printers'), print: call('print:run'),
  // window
  setTitleBar: call('win:titlebar'), setTitle: call('win:title'), toggleFullscreen: call('win:fullscreen'), devtools: call('win:devtools'),
  onOpenFiles: on('app:open'), onCloseRequest: on('app:close-request'), closeOk: () => ipcRenderer.send('app:close-ok'),
});
