const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, nativeTheme, powerMonitor, shell } = require("electron");
const { AdbService } = require("./adb-service.cjs");
const { ReconnectManager, metadataFor } = require("./reconnect-manager.cjs");
const { checkForUpdates } = require("./update-service.cjs");
const Store = require("./store.cjs");
const { resolveLanguage } = require("./language.cjs");

if (process.platform === "win32") {
  app.setAppUserModelId("com.andreszs.adbdevicesuite");
}

let mainWindow;
let adbService;
let store;
let reconnectManager;
let pollTimer;
let pollRunning = false;
let qrPairingController = null;

function createWindow() {
  const savedSettings = store.get();
  const themePreference = savedSettings.themePreference;
  const systemLocale = resolveLanguage("system", app.getPreferredSystemLanguages());
  const locale = resolveLanguage(savedSettings.languagePreference, app.getPreferredSystemLanguages());
  const useDarkTheme = themePreference === "dark"
    || (themePreference === "auto" && nativeTheme.shouldUseDarkColors);
  mainWindow = new BrowserWindow({
    width: 900,
    height: 660,
    minWidth: 900,
    minHeight: 660,
    show: false,
    backgroundColor: useDarkTheme ? "#070b14" : "#f4f7fb",
    title: "ADB Device Suite",
    icon: path.join(__dirname, "..", "build", process.platform === "win32" ? "icon.ico" : "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.removeMenu();
  mainWindow.once("ready-to-show", () => mainWindow.show());

  if (process.env.VITE_DEV_SERVER_URL) {
    const developmentUrl = new URL(process.env.VITE_DEV_SERVER_URL);
    developmentUrl.searchParams.set("theme", themePreference);
    developmentUrl.searchParams.set("platform", process.platform);
    developmentUrl.searchParams.set("locale", locale);
    developmentUrl.searchParams.set("systemLocale", systemLocale);
    mainWindow.loadURL(developmentUrl.toString());
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"), {
      query: { platform: process.platform, theme: themePreference, locale, systemLocale },
    });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function currentSettings() {
  return reconnectManager ? reconnectManager.settings() : store.get();
}

function sendSettings() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("settings:changed", currentSettings());
  }
}

function sendSnapshot(snapshot) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("devices:changed", snapshot);
  }
}

function rememberFromSnapshot(endpoint, snapshot, fallback = {}) {
  const device = snapshot.devices.find((item) => item.connection === "wifi" && item.serial === endpoint);
  const service = snapshot.services.find((item) => item.endpoint === endpoint);
  const metadata = device
    ? metadataFor(device, service, fallback.mode || "legacy")
    : {
        label: fallback.label || null,
        hardwareSerial: fallback.hardwareSerial || null,
        mdnsServiceName: service?.serviceName || fallback.mdnsServiceName || null,
        mode: service?.type === "connect" ? "tls" : fallback.mode || "legacy",
      };
  store.rememberConnection(endpoint, metadata);
  const saved = store.get().savedConnections.find((item) => item.endpoint === endpoint);
  if (saved) reconnectManager.reset(saved.id);
  sendSettings();
}

async function pollDevices() {
  if (pollRunning) return;
  pollRunning = true;
  try {
    let snapshot = await adbService.snapshot();
    const result = await reconnectManager.process(snapshot);
    if (result.reconnected) {
      snapshot = await adbService.snapshot();
      await reconnectManager.process(snapshot);
    }
    sendSnapshot(snapshot);
    if (result.settingsChanged) sendSettings();
  } finally {
    pollRunning = false;
  }
}

function registerIpc() {
  ipcMain.handle("app:get-version", () => app.getVersion());
  ipcMain.handle("app:check-for-updates", () => checkForUpdates(app.getVersion()));
  ipcMain.handle("devices:snapshot", () => adbService.snapshot());
  ipcMain.handle("settings:get", () => currentSettings());

  ipcMain.handle("adb:connect", async (_event, endpoint) => {
    const result = await adbService.connect(endpoint);
    const snapshot = await adbService.snapshot();
    rememberFromSnapshot(result.endpoint, snapshot);
    sendSnapshot(snapshot);
    return { ...result, settings: currentSettings() };
  });

  ipcMain.handle("adb:disconnect", async (_event, endpoint) => {
    const result = await adbService.disconnect(endpoint);
    store.markDisconnected(endpoint);
    const saved = store.get().savedConnections.find((item) => item.endpoint === endpoint);
    if (saved) reconnectManager.reset(saved.id);
    sendSettings();
    await pollDevices();
    return result;
  });

  ipcMain.handle("adb:pair", async (_event, { endpoint, code }) => {
    const result = await adbService.pair(endpoint, code);
    await pollDevices();
    return result;
  });

  ipcMain.handle("adb:pair-qr", async (event, { serviceName, password }) => {
    qrPairingController?.abort();
    const controller = new AbortController();
    qrPairingController = controller;
    try {
      const result = await adbService.pairByQr(serviceName, password, {
        signal: controller.signal,
        onPaired: ({ endpoint }) => event.sender.send("adb:qr-pairing-progress", {
          phase: "connecting",
          pairingEndpoint: endpoint,
          connectionTimeoutSeconds: 20,
        }),
      });
      const snapshot = await adbService.snapshot();
      rememberFromSnapshot(result.endpoint, snapshot, { mode: "tls" });
      sendSnapshot(snapshot);
      return { ...result, settings: currentSettings() };
    } finally {
      if (qrPairingController === controller) qrPairingController = null;
    }
  });

  ipcMain.handle("adb:cancel-pair-qr", () => {
    qrPairingController?.abort();
    qrPairingController = null;
  });

  ipcMain.handle("adb:enable-wireless", async (_event, serial) => {
    const before = await adbService.snapshot();
    const usbDevice = before.devices.find((item) => item.serial === serial && item.connection === "usb");
    const result = await adbService.enableWireless(serial);
    const snapshot = await adbService.snapshot();
    rememberFromSnapshot(result.endpoint, snapshot, {
      label: usbDevice ? metadataFor(usbDevice).label : null,
      hardwareSerial: usbDevice?.hardwareSerial || serial,
      mode: "legacy",
    });
    sendSnapshot(snapshot);
    return { ...result, settings: currentSettings() };
  });

  ipcMain.handle("adb:restart-server", async () => {
    const result = await adbService.restartServer();
    await pollDevices();
    return result;
  });

  ipcMain.handle("settings:choose-adb", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select the ADB executable",
      properties: ["openFile"],
      filters: process.platform === "win32"
        ? [{ name: "ADB executable", extensions: ["exe"] }]
        : [{ name: "All files", extensions: ["*"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const selectedPath = result.filePaths[0];
    const previousPath = store.get().adbPath;
    adbService.setCustomPath(selectedPath);
    const snapshot = await adbService.snapshot();
    if (!snapshot.adb.available) {
      adbService.setCustomPath(previousPath);
      throw new Error("The selected file is not a working ADB executable.");
    }
    store.setAdbPath(selectedPath);
    await pollDevices();
    return { settings: currentSettings(), snapshot };
  });

  ipcMain.handle("settings:set-auto-reconnect", (_event, enabled) => {
    store.setAutoReconnect(enabled);
    reconnectManager.wake();
    sendSettings();
    return currentSettings();
  });

  ipcMain.handle("settings:set-theme-preference", (_event, themePreference) => {
    store.setThemePreference(themePreference);
    sendSettings();
    return currentSettings();
  });

  ipcMain.handle("settings:set-language-preference", (_event, languagePreference) => {
    store.setLanguagePreference(languagePreference);
    sendSettings();
    return {
      settings: currentSettings(),
      resolvedLanguage: resolveLanguage(languagePreference, app.getPreferredSystemLanguages()),
    };
  });

  ipcMain.handle("settings:set-connection-auto-reconnect", (_event, { id, enabled }) => {
    store.setConnectionAutoReconnect(id, enabled);
    reconnectManager.reset(id);
    sendSettings();
    return currentSettings();
  });

  ipcMain.handle("settings:set-device-alias", (_event, { identifier, alias }) => {
    store.setDeviceAlias(identifier, alias);
    sendSettings();
    return currentSettings();
  });

  ipcMain.handle("settings:forget-connection", (_event, identifier) => {
    reconnectManager.reset(identifier);
    store.forgetConnection(identifier);
    sendSettings();
    return currentSettings();
  });

  ipcMain.handle("app:open-external", async (_event, rawUrl) => {
    const url = new URL(rawUrl);
    const allowedHosts = new Set(["developer.android.com", "github.com"]);
    if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) {
      throw new Error("This link is not allowed.");
    }
    await shell.openExternal(url.toString());
  });
}

app.whenReady().then(() => {
  store = new Store(app.getPath("userData"));
  adbService = new AdbService(store.get().adbPath);
  reconnectManager = new ReconnectManager(adbService, store, sendSettings);
  registerIpc();
  createWindow();
  pollTimer = setInterval(pollDevices, 4_000);
  pollDevices();

  powerMonitor.on("resume", () => {
    reconnectManager.wake();
    pollDevices();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (pollTimer) clearInterval(pollTimer);
  qrPairingController?.abort();
  if (process.platform !== "darwin") app.quit();
});
