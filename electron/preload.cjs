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

  models: {
    snapshot: (options) => invoke('models:snapshot', options),
    hardware: () => invoke('models:hardware'),
    download: (options) => invoke('models:download', options),
    cancel: () => invoke('models:cancel'),
    verify: (id) => invoke('models:verify', { id }),
    uninstall: (id) => invoke('models:uninstall', { id }),
    activate: (id) => invoke('models:activate', { id }),
    acknowledge: (id) => invoke('models:acknowledge', { id }),
    importFolder: (id) => invoke('models:import', { id }),
    openFolder: (id, target) => invoke('models:openFolder', { id, target }),
    openReferences: () => invoke('models:openReferences'),
    sidecar: {
      start: (id, device) => invoke('models:sidecar:start', { id, device }),
      stop: (id) => invoke('models:sidecar:stop', { id }),
      status: (id) => invoke('models:sidecar:status', { id }),
      logs: (id) => invoke('models:sidecar:logs', { id }),
    },
  },

  runtimes: {
    download: (id) => invoke('runtimes:download', { id }),
    cancel: () => invoke('runtimes:cancel'),
    verify: (id) => invoke('runtimes:verify', { id }),
    uninstall: (id) => invoke('runtimes:uninstall', { id }),
    importFolder: (id) => invoke('runtimes:import', { id }),
    openFolder: (id) => invoke('runtimes:openFolder', { id }),
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

  huggingface: {
    tokenStatus: () => invoke('hf:tokenStatus'),
    setToken: (token) => invoke('hf:setToken', { token }),
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

  onModelsProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('models:progress', listener);
    return () => ipcRenderer.removeListener('models:progress', listener);
  },

  onModelsChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('models:changed', listener);
    return () => ipcRenderer.removeListener('models:changed', listener);
  },

  onSidecarLog: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('sidecar:log', listener);
    return () => ipcRenderer.removeListener('sidecar:log', listener);
  },

  onSidecarStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('sidecar:status', listener);
    return () => ipcRenderer.removeListener('sidecar:status', listener);
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
