const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("adbSuite", {
  getAppVersion: () => ipcRenderer.invoke("app:get-version"),
  checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates"),
  getSnapshot: () => ipcRenderer.invoke("devices:snapshot"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  connect: (endpoint) => ipcRenderer.invoke("adb:connect", endpoint),
  disconnect: (endpoint) => ipcRenderer.invoke("adb:disconnect", endpoint),
  pair: (endpoint, code) => ipcRenderer.invoke("adb:pair", { endpoint, code }),
  pairByQr: (serviceName, password) => ipcRenderer.invoke("adb:pair-qr", { serviceName, password }),
  cancelQrPairing: () => ipcRenderer.invoke("adb:cancel-pair-qr"),
  enableWireless: (serial) => ipcRenderer.invoke("adb:enable-wireless", serial),
  restartServer: () => ipcRenderer.invoke("adb:restart-server"),
  chooseAdb: () => ipcRenderer.invoke("settings:choose-adb"),
  setAutoReconnect: (enabled) => ipcRenderer.invoke("settings:set-auto-reconnect", enabled),
  setThemePreference: (themePreference) => ipcRenderer.invoke("settings:set-theme-preference", themePreference),
  setLanguagePreference: (languagePreference) => ipcRenderer.invoke("settings:set-language-preference", languagePreference),
  setConnectionAutoReconnect: (id, enabled) => ipcRenderer.invoke("settings:set-connection-auto-reconnect", { id, enabled }),
  setDeviceAlias: (identifier, alias) => ipcRenderer.invoke("settings:set-device-alias", { identifier, alias }),
  forgetConnection: (identifier) => ipcRenderer.invoke("settings:forget-connection", identifier),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  onSnapshot: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on("devices:changed", listener);
    return () => ipcRenderer.removeListener("devices:changed", listener);
  },
  onSettings: (callback) => {
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on("settings:changed", listener);
    return () => ipcRenderer.removeListener("settings:changed", listener);
  },
  onQrPairingProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("adb:qr-pairing-progress", listener);
    return () => ipcRenderer.removeListener("adb:qr-pairing-progress", listener);
  },
});
