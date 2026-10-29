const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('studio', {
  info: () => invoke('app:info'),
  keepAwake: (on) => invoke('app:keepAwake', on),
  openExternal: (url) => invoke('app:openExternal', url),
  restart: () => invoke('app:restart'),
  gpu: {
    info: () => invoke('gpu:info'),
    openSettings: () => invoke('gpu:openSettings'),
  },

  settings: {
    get: () => invoke('settings:get'),
    save: (patch) => invoke('settings:save', patch),
  },

  model: {
    status: () => invoke('model:status'),
    download: (options) => invoke('model:download', options),
    cancel: () => invoke('model:cancel'),
    clear: (options) => invoke('model:clear', options),
    verify: () => invoke('model:verify'),
    importFolder: () => invoke('model:import'),
  },

  voices: {
    download: (id) => invoke('voices:download', { id }),
    downloadAll: (ids) => invoke('voices:downloadAll', { ids }),
    cancel: () => invoke('voices:cancel'),
    clear: () => invoke('voices:clear'),
    listCustom: () => invoke('voices:listCustom'),
    importCustom: () => invoke('voices:importCustom'),
    renameCustom: (id, name) => invoke('voices:renameCustom', { id, name }),
    deleteCustom: (id) => invoke('voices:deleteCustom', { id }),
  },

  clone: {
    keyStatus: () => invoke('clone:keyStatus'),
    setKey: (key) => invoke('clone:setKey', { key }),
    create: (payload) => invoke('clone:create', payload),
  },

  history: {
    list: () => invoke('history:list'),
    upsert: (entry) => invoke('history:upsert', entry),
    patch: (id, patch) => invoke('history:patch', { id, patch }),
    remove: (id, deleteFile = true) => invoke('history:remove', { id, deleteFile }),
    clear: (deleteFiles = true) => invoke('history:clear', { deleteFiles }),
  },

  audio: {
    save: (payload) => invoke('audio:save', payload),
    read: (filePath) => invoke('audio:read', { filePath }),
    exists: (filePath) => invoke('audio:exists', { filePath }),
    export: (payload) => invoke('audio:export', payload),
    exportMany: (files) => invoke('audio:exportMany', { files }),
    reveal: (filePath) => invoke('audio:reveal', { filePath }),
    open: (filePath) => invoke('audio:open', { filePath }),
  },

  paths: {
    reveal: (target) => invoke('paths:reveal', { target }),
    chooseOutputDir: () => invoke('paths:chooseOutputDir'),
  },

  storage: {
    stats: () => invoke('storage:stats'),
  },

  ui: {
    confirm: (options) => invoke('ui:confirm', options),
    openTextFile: () => invoke('ui:openTextFile'),
    saveText: (payload) => invoke('ui:saveText', payload),
    copy: (text) => invoke('clipboard:write', text),
  },

  onDownloadProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('download:progress', listener);
    return () => ipcRenderer.removeListener('download:progress', listener);
  },

  onCloneProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('clone:progress', listener);
    return () => ipcRenderer.removeListener('clone:progress', listener);
  },

  onMenuAction: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
});
