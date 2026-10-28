const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, dialog, ipcMain, nativeTheme, powerMonitor, shell } = require("electron");
const { AdbService } = require("./adb-service.cjs");
const {
  ReconnectManager,
  isNetworkEndpoint,
  mdnsServiceNameFromSerial,
  metadataFor,
  serviceMatchesConnection,
} = require("./reconnect-manager.cjs");
const { checkForUpdates } = require("./update-service.cjs");
const Store = require("./store.cjs");
const { resolveLanguage } = require("./language.cjs");

if (process.platform === "win32") {
  app.setAppUserModelId("com.andreszs.adbdevicesuite");
}

const FALLBACK_POLL_INTERVAL_MS = 15_000;
const DEVICE_PROBE_INTERVAL_MS = 1_000;
const BATTERY_POLL_INTERVAL_MS = 5_000;

let mainWindow;
let adbService;
let store;
let reconnectManager;
let pollTimer;
let pollRunning = false;
let pollQueued = false;
let reconnectProcessing = false;
let pendingReconnectSnapshot = null;
let pairingController = null;
let deviceTracker = null;
let deviceTrackerRestartTimer = null;
let deviceTrackerRefreshTimer = null;
let deviceProbeTimer = null;
let deviceProbeRunning = false;
let batteryPollTimer = null;
let batteryPollRunning = false;
let lastDeviceTransportList = null;
let latestSnapshot = null;
let shuttingDown = false;

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
  mainWindow.on("focus", () => void pollBatteries());
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
  latestSnapshot = snapshot;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("devices:changed", snapshot);
  }
}

function sameBattery(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

async function pollBatteries() {
  if (batteryPollRunning || shuttingDown || !latestSnapshot?.adb.available) return;
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || mainWindow.isMinimized()) return;
  const serials = [...new Set(latestSnapshot.devices
    .filter((device) => device.state === "device")
    .map((device) => device.serial))];
  if (!serials.length) return;

  batteryPollRunning = true;
  try {
    const results = await Promise.all(serials.map(async (serial) => {
      try {
        return [serial, await adbService.battery(serial)];
      } catch {
        return [serial, null];
      }
    }));
    const readings = new Map(results.filter(([, battery]) => battery));
    if (!latestSnapshot || !readings.size) return;

    let changed = false;
    const devices = latestSnapshot.devices.map((device) => {
      const battery = readings.get(device.serial);
      if (!battery || sameBattery(device.battery, battery)) return device;
      changed = true;
      return { ...device, battery };
    });
    if (changed) {
      sendSnapshot({ ...latestSnapshot, devices, refreshedAt: new Date().toISOString() });
    }
  } finally {
    batteryPollRunning = false;
  }
}

function rememberFromSnapshot(endpoint, snapshot, fallback = {}) {
  const device = snapshot.devices.find((item) => item.connection === "wifi" && item.serial === endpoint);
  const identity = {
    endpoint,
    hardwareSerial: device?.hardwareSerial || fallback.hardwareSerial || null,
    mdnsServiceName: fallback.mdnsServiceName || mdnsServiceNameFromSerial(endpoint),
    mode: fallback.mode || "legacy",
  };
  const service = snapshot.services.find((item) => item.endpoint === endpoint)
    || snapshot.services.find((item) => serviceMatchesConnection(item, identity));
  const detected = device ? metadataFor(device, service, fallback.mode || "legacy") : null;
  const metadata = detected
    ? {
        ...detected,
        label: detected.label || fallback.label || null,
        hardwareSerial: detected.hardwareSerial || fallback.hardwareSerial || null,
        mdnsServiceName: detected.mdnsServiceName || identity.mdnsServiceName,
      }
    : {
        label: fallback.label || null,
        hardwareSerial: fallback.hardwareSerial || null,
        mdnsServiceName: service?.serviceName || identity.mdnsServiceName,
        mode: service?.type === "connect" ? "tls" : fallback.mode || "legacy",
      };
  const existing = store.get().savedConnections.find((item) => (
    (metadata.hardwareSerial && item.hardwareSerial === metadata.hardwareSerial)
    || (metadata.mdnsServiceName && item.mdnsServiceName === metadata.mdnsServiceName)
  ));
  const resolvedEndpoint = [service?.endpoint, endpoint, existing?.endpoint].find(isNetworkEndpoint);
  if (!resolvedEndpoint) return;
  store.rememberConnection(resolvedEndpoint, metadata);
  const saved = store.get().savedConnections.find((item) => (
    item.endpoint === resolvedEndpoint
    || (metadata.hardwareSerial && item.hardwareSerial === metadata.hardwareSerial)
  ));
  if (saved) reconnectManager.reset(saved.id);
  sendSettings();
}

async function pollDevices() {
  if (pollRunning) {
    pollQueued = true;
    return;
  }
  pollRunning = true;
  try {
    do {
      pollQueued = false;
      const snapshot = await adbService.snapshot();
      sendSnapshot(snapshot);
      queueReconnectProcessing(snapshot);
    } while (pollQueued);
  } finally {
    pollRunning = false;
  }
}

function queueReconnectProcessing(snapshot) {
  pendingReconnectSnapshot = snapshot;
  if (reconnectProcessing || shuttingDown) return;
  reconnectProcessing = true;
  void (async () => {
    try {
      while (pendingReconnectSnapshot && !shuttingDown) {
        const current = pendingReconnectSnapshot;
        pendingReconnectSnapshot = null;
        const result = await reconnectManager.process(current);
        if (result.settingsChanged) sendSettings();
        if (result.reconnected) {
          const refreshed = await adbService.snapshot();
          sendSnapshot(refreshed);
          pendingReconnectSnapshot = refreshed;
        }
      }
    } catch {
      // Device polling must remain independent from reconnect failures.
    } finally {
      reconnectProcessing = false;
      if (pendingReconnectSnapshot && !shuttingDown) queueReconnectProcessing(pendingReconnectSnapshot);
    }
  })();
}

function requestTrackedRefresh() {
  if (deviceTrackerRefreshTimer) clearTimeout(deviceTrackerRefreshTimer);
  deviceTrackerRefreshTimer = setTimeout(() => {
    deviceTrackerRefreshTimer = null;
    void pollDevices();
  }, 120);
}

async function probeDeviceTransports() {
  if (deviceProbeRunning || shuttingDown) return;
  deviceProbeRunning = true;
  try {
    const { stdout } = await adbService.run(["devices", "-l"], 3_000);
    const current = stdout.trim();
    if (lastDeviceTransportList !== null && current !== lastDeviceTransportList) {
      requestTrackedRefresh();
    }
    lastDeviceTransportList = current;
  } catch {
    // The 15-second full poll remains the recovery path while ADB restarts.
  } finally {
    deviceProbeRunning = false;
  }
}

function stopDeviceTracker() {
  if (deviceTrackerRestartTimer) clearTimeout(deviceTrackerRestartTimer);
  if (deviceTrackerRefreshTimer) clearTimeout(deviceTrackerRefreshTimer);
  deviceTrackerRestartTimer = null;
  deviceTrackerRefreshTimer = null;
  const tracker = deviceTracker;
  deviceTracker = null;
  tracker?.kill();
}

async function startDeviceTracker() {
  stopDeviceTracker();
  lastDeviceTransportList = null;
  if (shuttingDown) return;
  try {
    const executable = await adbService.locate();
    if (shuttingDown) return;
    const tracker = spawn(executable, ["track-devices", "-l"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    deviceTracker = tracker;
    let pending = Buffer.alloc(0);

    tracker.stdout.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      let changed = false;
      while (pending.length >= 4) {
        const prefix = pending.subarray(0, 4).toString("ascii");
        if (!/^[0-9a-fA-F]{4}$/.test(prefix)) {
          pending = Buffer.alloc(0);
          break;
        }
        const length = Number.parseInt(prefix, 16);
        if (pending.length < length + 4) break;
        pending = pending.subarray(length + 4);
        changed = true;
      }
      if (changed) requestTrackedRefresh();
    });

    tracker.once("error", () => {});
    tracker.once("exit", () => {
      if (deviceTracker !== tracker) return;
      deviceTracker = null;
      if (!shuttingDown) {
        deviceTrackerRestartTimer = setTimeout(() => {
          deviceTrackerRestartTimer = null;
          void startDeviceTracker();
        }, 1_000);
      }
    });
  } catch {
    if (!shuttingDown) {
      deviceTrackerRestartTimer = setTimeout(() => {
        deviceTrackerRestartTimer = null;
        void startDeviceTracker();
      }, 2_000);
    }
  }
}

function registerIpc() {
  ipcMain.handle("app:get-version", () => app.getVersion());
  ipcMain.handle("app:check-for-updates", () => checkForUpdates(app.getVersion()));
  ipcMain.handle("devices:snapshot", () => adbService.snapshot());
  ipcMain.handle("devices:info", (_event, serial) => adbService.deviceInfo(serial));
  ipcMain.handle("settings:get", () => currentSettings());

  ipcMain.handle("adb:connect", async (_event, endpoint) => {
    const result = await adbService.connect(endpoint);
    const snapshot = await adbService.snapshot();
    rememberFromSnapshot(result.endpoint, snapshot);
    sendSnapshot(snapshot);
    return { ...result, settings: currentSettings() };
  });

  ipcMain.handle("adb:reconnect", async (_event, id) => {
    const before = await adbService.snapshot();
    const result = await reconnectManager.reconnect(id, before);
    const snapshot = await adbService.snapshot();
    sendSnapshot(snapshot);
    sendSettings();
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
    if (pairingController) throw new Error("A pairing operation is already in progress.");
    const controller = new AbortController();
    pairingController = controller;
    try {
      const result = await adbService.pair(endpoint, code, {
        signal: controller.signal,
        onPaired: ({ endpoint: pairingEndpoint }) => _event.sender.send("adb:pairing-progress", {
          method: "code",
          phase: "pending",
          pairingEndpoint,
          connectionTimeoutSeconds: 0,
        }),
      });
      const snapshot = await adbService.snapshot();
      if (result.pendingConnection) {
        _event.sender.send("adb:pairing-progress", {
          method: "code",
          phase: "pending",
          pairingEndpoint: result.pairingEndpoint,
          connectionTimeoutSeconds: 0,
        });
        sendSnapshot(snapshot);
        return { ...result, settings: currentSettings() };
      }
      rememberFromSnapshot(result.endpoint, snapshot, { mode: "tls" });
      sendSnapshot(snapshot);
      return { ...result, settings: currentSettings() };
    } finally {
      if (pairingController === controller) pairingController = null;
    }
  });

  ipcMain.handle("adb:pair-qr", async (event, { serviceName, password }) => {
    if (pairingController) throw new Error("A pairing operation is already in progress.");
    const controller = new AbortController();
    pairingController = controller;
    try {
      const result = await adbService.pairByQr(serviceName, password, {
        signal: controller.signal,
        onPaired: ({ endpoint }) => event.sender.send("adb:pairing-progress", {
          method: "qr",
          phase: "pending",
          pairingEndpoint: endpoint,
          connectionTimeoutSeconds: 0,
        }),
      });
      const snapshot = await adbService.snapshot();
      if (result.pendingConnection) {
        event.sender.send("adb:pairing-progress", {
          method: "qr",
          phase: "pending",
          pairingEndpoint: result.pairingEndpoint,
          connectionTimeoutSeconds: 0,
        });
        sendSnapshot(snapshot);
        return { ...result, settings: currentSettings() };
      }
      rememberFromSnapshot(result.endpoint, snapshot, { mode: "tls" });
      sendSnapshot(snapshot);
      return { ...result, settings: currentSettings() };
    } finally {
      if (pairingController === controller) pairingController = null;
    }
  });

  ipcMain.handle("adb:cancel-pairing", () => {
    pairingController?.abort();
  });

  ipcMain.handle("adb:enable-wireless", async (_event, serial) => {
    const before = await adbService.snapshot();
    const usbDevice = before.devices.find((item) => item.serial === serial && item.connection === "usb");
    const result = await adbService.enableWireless(serial);
    const snapshot = await adbService.snapshot();
    rememberFromSnapshot(result.endpoint, snapshot, {
      label: usbDevice ? metadataFor(usbDevice).label : null,
      hardwareSerial: result.hardwareSerial || usbDevice?.hardwareSerial || serial,
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
    void startDeviceTracker();
    await pollDevices();
    return { settings: currentSettings(), snapshot };
  });

  ipcMain.handle("settings:set-auto-reconnect", (_event, enabled) => {
    store.setAutoReconnect(enabled);
    reconnectManager.wake();
    sendSettings();
    return currentSettings();
  });

  ipcMain.handle("settings:set-charging-animation", (_event, enabled) => {
    store.setChargingAnimation(enabled);
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
  pollTimer = setInterval(pollDevices, FALLBACK_POLL_INTERVAL_MS);
  deviceProbeTimer = setInterval(probeDeviceTransports, DEVICE_PROBE_INTERVAL_MS);
  batteryPollTimer = setInterval(pollBatteries, BATTERY_POLL_INTERVAL_MS);
  pollDevices();
  void probeDeviceTransports();
  void startDeviceTracker();

  powerMonitor.on("resume", () => {
    reconnectManager.wake();
    pollDevices();
    void pollBatteries();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  shuttingDown = true;
  if (pollTimer) clearInterval(pollTimer);
  if (deviceProbeTimer) clearInterval(deviceProbeTimer);
  if (batteryPollTimer) clearInterval(batteryPollTimer);
  stopDeviceTracker();
  pairingController?.abort();
});
