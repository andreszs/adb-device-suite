const fs = require("node:fs");
const path = require("node:path");
const { normalizeLanguagePreference } = require("./language.cjs");

const DEFAULT_DATA = Object.freeze({
  adbPath: null,
  autoReconnect: true,
  chargingAnimation: true,
  savedConnections: [],
  themePreference: "light",
  languagePreference: "system",
});

function normalizeThemePreference(value) {
  return value === "dark" || value === "auto" ? value : "light";
}

function connectionId(endpoint, metadata = {}) {
  if (metadata.hardwareSerial) return `serial:${metadata.hardwareSerial}`;
  if (metadata.mdnsServiceName) return `mdns:${metadata.mdnsServiceName}`;
  return `endpoint:${endpoint}`;
}

function normalizeConnection(item) {
  if (!item || typeof item.endpoint !== "string") return null;
  return {
    id: typeof item.id === "string" ? item.id : connectionId(item.endpoint, item),
    endpoint: item.endpoint,
    label: typeof item.label === "string" ? item.label : null,
    hardwareSerial: typeof item.hardwareSerial === "string" ? item.hardwareSerial : null,
    mdnsServiceName: typeof item.mdnsServiceName === "string" ? item.mdnsServiceName : null,
    mode: item.mode === "tls" ? "tls" : "legacy",
    autoReconnect: item.autoReconnect !== false,
    manuallyDisconnected: item.manuallyDisconnected === true,
    lastConnectedAt: item.lastConnectedAt || new Date(0).toISOString(),
    lastSeenAt: item.lastSeenAt || item.lastConnectedAt || new Date(0).toISOString(),
  };
}

class Store {
  constructor(directory) {
    this.filePath = path.join(directory, "settings.json");
    this.data = this.#read();
  }

  #read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      const current = { ...parsed };
      delete current.deviceAliases;
      const data = {
        ...DEFAULT_DATA,
        ...current,
        autoReconnect: parsed.autoReconnect !== false,
        chargingAnimation: parsed.chargingAnimation !== false,
        savedConnections: Array.isArray(parsed.savedConnections)
          ? parsed.savedConnections.map(normalizeConnection).filter(Boolean)
          : [],
        themePreference: normalizeThemePreference(parsed.themePreference),
        languagePreference: normalizeLanguagePreference(parsed.languagePreference),
      };
      if (Object.hasOwn(parsed, "deviceAliases")) {
        fs.writeFileSync(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      }
      return data;
    } catch {
      return { ...DEFAULT_DATA, savedConnections: [] };
    }
  }

  #write() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
  }

  get() {
    return structuredClone(this.data);
  }

  setAdbPath(adbPath) {
    this.data.adbPath = adbPath || null;
    this.#write();
  }

  setAutoReconnect(enabled) {
    this.data.autoReconnect = Boolean(enabled);
    this.#write();
    return this.get();
  }

  setChargingAnimation(enabled) {
    this.data.chargingAnimation = Boolean(enabled);
    this.#write();
    return this.get();
  }

  setThemePreference(themePreference) {
    if (!["light", "dark", "auto"].includes(themePreference)) {
      throw new Error("Theme preference must be light, dark or auto.");
    }
    this.data.themePreference = themePreference;
    this.#write();
    return this.get();
  }

  setLanguagePreference(languagePreference) {
    const normalized = normalizeLanguagePreference(languagePreference);
    if (languagePreference !== "system" && normalized === "system") {
      throw new Error("Unsupported language preference.");
    }
    this.data.languagePreference = normalized;
    this.#write();
    return this.get();
  }

  setConnectionAutoReconnect(id, enabled) {
    const connection = this.data.savedConnections.find((item) => item.id === id);
    if (!connection) return this.get();
    connection.autoReconnect = Boolean(enabled);
    if (enabled) connection.manuallyDisconnected = false;
    this.#write();
    return this.get();
  }

  rememberConnection(endpoint, metadata = {}) {
    const nextId = connectionId(endpoint, metadata);
    let existing = this.data.savedConnections.find((item) => (
      item.id === nextId
      || item.endpoint === endpoint
      || (metadata.hardwareSerial && item.hardwareSerial === metadata.hardwareSerial)
    ));
    const now = new Date().toISOString();
    if (existing) {
      existing.id = nextId;
      existing.endpoint = endpoint;
      existing.lastConnectedAt = now;
      existing.lastSeenAt = now;
      existing.manuallyDisconnected = false;
      if (metadata.label) existing.label = metadata.label;
      if (metadata.hardwareSerial) existing.hardwareSerial = metadata.hardwareSerial;
      if (metadata.mdnsServiceName) existing.mdnsServiceName = metadata.mdnsServiceName;
      if (metadata.mode) existing.mode = metadata.mode;
    } else {
      existing = normalizeConnection({
        id: nextId,
        endpoint,
        label: metadata.label || null,
        hardwareSerial: metadata.hardwareSerial || null,
        mdnsServiceName: metadata.mdnsServiceName || null,
        mode: metadata.mode || "legacy",
        autoReconnect: true,
        manuallyDisconnected: false,
        lastConnectedAt: now,
        lastSeenAt: now,
      });
      this.data.savedConnections.unshift(existing);
    }
    this.data.savedConnections = this.data.savedConnections.slice(0, 30);
    this.#write();
    return this.get();
  }

  observeConnection(endpoint, metadata = {}) {
    const nextId = connectionId(endpoint, metadata);
    const existing = this.data.savedConnections.find((item) => (
      item.id === nextId
      || item.endpoint === endpoint
      || (metadata.hardwareSerial && item.hardwareSerial === metadata.hardwareSerial)
    ));
    if (!existing) return false;
    const before = JSON.stringify(existing);
    const lastSeen = Date.parse(existing.lastSeenAt || 0);
    existing.id = nextId;
    existing.endpoint = endpoint;
    if (!Number.isFinite(lastSeen) || Date.now() - lastSeen >= 30_000) {
      existing.lastSeenAt = new Date().toISOString();
    }
    if (metadata.label) existing.label = metadata.label;
    if (metadata.hardwareSerial) existing.hardwareSerial = metadata.hardwareSerial;
    if (metadata.mdnsServiceName) existing.mdnsServiceName = metadata.mdnsServiceName;
    if (metadata.mode) existing.mode = metadata.mode;
    if (before === JSON.stringify(existing)) return false;
    this.#write();
    return true;
  }

  markDisconnected(endpoint) {
    const existing = this.data.savedConnections.find((item) => item.endpoint === endpoint);
    if (!existing) return this.get();
    existing.manuallyDisconnected = true;
    this.#write();
    return this.get();
  }

  forgetConnection(identifier) {
    this.data.savedConnections = this.data.savedConnections.filter(
      (item) => item.id !== identifier && item.endpoint !== identifier,
    );
    this.#write();
    return this.get();
  }
}

module.exports = Store;
module.exports.connectionId = connectionId;
module.exports.normalizeConnection = normalizeConnection;
module.exports.normalizeThemePreference = normalizeThemePreference;
module.exports.normalizeLanguagePreference = normalizeLanguagePreference;
