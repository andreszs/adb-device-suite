const BACKOFF_MS = [2_000, 5_000, 10_000, 20_000, 30_000, 60_000];
const MISSING_GRACE_MS = 8_000;

function deviceLabel(device) {
  return device.deviceName || [device.manufacturer, device.model || device.device]
    .filter(Boolean)
    .map((part) => String(part).trim())
    .filter((part, index, parts) => index === 0 || part.toLowerCase() !== parts[0]?.toLowerCase())
    .join(" ") || "Android device";
}

function serviceMatchesConnection(service, connection) {
  if (!service || service.type === "pairing") return false;
  if (service.endpoint === connection.endpoint) return true;
  if (connection.mdnsServiceName && service.serviceName === connection.mdnsServiceName) return true;
  if (connection.hardwareSerial) {
    const prefix = `adb-${connection.hardwareSerial}`.toLowerCase();
    if (service.serviceName.toLowerCase() === prefix
      || service.serviceName.toLowerCase().startsWith(`${prefix}-`)) return true;
  }
  return false;
}

function deviceMatchesConnection(device, connection) {
  return device.connection === "wifi" && device.state === "device" && (
    device.serial === connection.endpoint
    || (connection.hardwareSerial && device.hardwareSerial === connection.hardwareSerial)
  );
}

function metadataFor(device, service = null, fallbackMode = "legacy") {
  return {
    label: deviceLabel(device),
    hardwareSerial: device.hardwareSerial || null,
    mdnsServiceName: service?.serviceName || null,
    mode: service?.type === "connect" ? "tls" : fallbackMode,
  };
}

function endpointHost(endpoint) {
  const match = String(endpoint).match(/^\[?([^\]]+?)]?:\d+$/);
  return match?.[1] || null;
}

function isNetworkEndpoint(endpoint) {
  const match = String(endpoint || "").trim().match(/^(?:\[[0-9a-fA-F:]+]|[a-zA-Z0-9._-]+):(\d{1,5})$/);
  if (!match) return false;
  const port = Number(match[1]);
  return port >= 1 && port <= 65535;
}

function mdnsServiceNameFromSerial(serial) {
  return String(serial || "").match(/^(.+)\._adb(?:-tls-connect)?\._tcp\.?$/i)?.[1] || null;
}

function reconnectCandidates(connection, snapshot) {
  const candidates = [];
  const discovered = snapshot.services.find((service) => serviceMatchesConnection(service, connection));
  if (discovered && isNetworkEndpoint(discovered.endpoint)) {
    candidates.push({ endpoint: discovered.endpoint, service: discovered, source: "mdns" });
  }
  if (isNetworkEndpoint(connection.endpoint)
    && !candidates.some((candidate) => candidate.endpoint === connection.endpoint)) {
    candidates.push({ endpoint: connection.endpoint, service: null, source: "saved" });
  }
  return candidates;
}

function isTlsConnection(connection) {
  return connection.mode === "tls"
    || Boolean(connection.mdnsServiceName)
    || /\._adb-tls-connect\._tcp\.?$/i.test(String(connection.endpoint || ""));
}

class ReconnectManager {
  constructor(adbService, store, onStateChanged = () => {}) {
    this.adbService = adbService;
    this.store = store;
    this.onStateChanged = onStateChanged;
    this.states = new Map();
    this.running = false;
  }

  #state(id) {
    if (!this.states.has(id)) {
      this.states.set(id, {
        status: "waiting",
        attempts: 0,
        missingSince: null,
        nextAttemptAt: 0,
        lastError: null,
      });
    }
    return this.states.get(id);
  }

  #update(id, changes) {
    const state = this.#state(id);
    const before = JSON.stringify(state);
    Object.assign(state, changes);
    if (before !== JSON.stringify(state)) this.onStateChanged();
    return state;
  }

  reset(id) {
    this.states.delete(id);
    this.onStateChanged();
  }

  wake() {
    for (const state of this.states.values()) state.nextAttemptAt = 0;
  }

  statusFor(connection) {
    if (!this.store.get().autoReconnect || !connection.autoReconnect || connection.manuallyDisconnected) {
      return { status: "paused", attempts: 0, nextAttemptAt: null, lastError: null };
    }
    const state = this.states.get(connection.id);
    if (!state) return { status: "waiting", attempts: 0, nextAttemptAt: null, lastError: null };
    return {
      status: state.status,
      attempts: state.attempts,
      nextAttemptAt: state.nextAttemptAt ? new Date(state.nextAttemptAt).toISOString() : null,
      lastError: state.lastError,
    };
  }

  settings() {
    const settings = this.store.get();
    return {
      ...settings,
      savedConnections: settings.savedConnections.map((connection) => ({
        ...connection,
        reconnect: this.statusFor(connection),
      })),
    };
  }

  async #connectConnection(connection, snapshot) {
    const candidates = reconnectCandidates(connection, snapshot);
    if (!candidates.length) {
      throw new Error("The device is not currently advertised through mDNS and has no valid saved IP address.");
    }

    const failures = [];
    for (const candidate of candidates) {
      try {
        const result = await this.adbService.connect(candidate.endpoint);
        this.store.rememberConnection(candidate.endpoint, {
          label: connection.label,
          hardwareSerial: connection.hardwareSerial,
          mdnsServiceName: candidate.service?.serviceName || connection.mdnsServiceName,
          mode: candidate.service?.type === "connect" ? "tls" : connection.mode,
        });
        return { ...result, connectionSource: candidate.source };
      } catch (error) {
        failures.push(`${candidate.source}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`Could not reconnect to the device (${failures.join("; ")}).`);
  }

  async reconnect(id, snapshot) {
    const connection = this.store.get().savedConnections.find((item) => item.id === id);
    if (!connection) throw new Error("The saved connection no longer exists.");

    const connectedDevice = snapshot.devices.find((device) => deviceMatchesConnection(device, connection));
    if (connectedDevice) {
      return { endpoint: connectedDevice.serial, verified: true, message: `Connected to ${connectedDevice.serial}` };
    }

    this.#update(connection.id, { status: "reconnecting", lastError: null });
    try {
      const result = await this.#connectConnection(connection, snapshot);
      this.#update(connection.id, {
        status: "connected",
        attempts: 0,
        missingSince: null,
        nextAttemptAt: 0,
        lastError: null,
      });
      return result;
    } catch (error) {
      this.#update(connection.id, {
        status: "waiting",
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async process(snapshot) {
    if (this.running || !snapshot.adb.available) return { reconnected: false, settingsChanged: false };
    const now = Date.now();
    const wifiDevices = snapshot.devices.filter((device) => device.connection === "wifi" && device.state === "device");
    let settingsChanged = false;

    for (const connection of this.store.get().savedConnections) {
      if (connection.hardwareSerial) continue;
      const usbDevice = snapshot.devices.find((device) => (
        device.connection === "usb"
        && device.state === "device"
        && (device.ipAddresses || (device.ipAddress ? [device.ipAddress] : []))
          .includes(endpointHost(connection.endpoint))
      ));
      if (usbDevice) {
        settingsChanged = this.store.observeConnection(
          connection.endpoint,
          metadataFor(usbDevice, null, connection.mode),
        ) || settingsChanged;
      }
    }

    for (const device of wifiDevices) {
      const service = snapshot.services.find((item) => item.endpoint === device.serial)
        || snapshot.services.find((item) => (
          device.hardwareSerial
          && item.serviceName.toLowerCase().startsWith(`adb-${device.hardwareSerial}`.toLowerCase())
        ));
      const existing = this.store.get().savedConnections.find((connection) => (
        connection.endpoint === device.serial
        || (device.hardwareSerial && connection.hardwareSerial === device.hardwareSerial)
      ));
      const endpoint = [service?.endpoint, device.serial, existing?.endpoint].find(isNetworkEndpoint);
      if (!endpoint) continue;
      const metadata = {
        ...metadataFor(device, service, service?.type === "connect" ? "tls" : "legacy"),
        mdnsServiceName: service?.serviceName || mdnsServiceNameFromSerial(device.serial),
      };
      const known = Boolean(existing);
      if (known) {
        settingsChanged = this.store.observeConnection(endpoint, metadata) || settingsChanged;
      } else {
        this.store.rememberConnection(endpoint, metadata);
        settingsChanged = true;
      }
    }

    const settings = this.store.get();
    for (const connection of settings.savedConnections) {
      const state = this.#state(connection.id);
      const connectedDevice = wifiDevices.find((device) => deviceMatchesConnection(device, connection));
      if (connectedDevice) {
        this.#update(connection.id, {
          status: "connected",
          attempts: 0,
          missingSince: null,
          nextAttemptAt: 0,
          lastError: null,
        });
        continue;
      }

      if (!settings.autoReconnect || !connection.autoReconnect || connection.manuallyDisconnected) {
        this.#update(connection.id, { status: "paused", missingSince: null, nextAttemptAt: 0 });
        continue;
      }

      if (!state.missingSince) {
        this.#update(connection.id, { status: "waiting", missingSince: now });
        continue;
      }
      if (now - state.missingSince < MISSING_GRACE_MS || now < state.nextAttemptAt) continue;

      this.running = true;
      this.#update(connection.id, { status: "reconnecting", lastError: null });
      try {
        await this.#connectConnection(connection, snapshot);
        this.#update(connection.id, {
          status: "connected",
          attempts: 0,
          missingSince: null,
          nextAttemptAt: 0,
          lastError: null,
        });
        return { reconnected: true, settingsChanged: true };
      } catch (error) {
        const attempts = state.attempts + 1;
        this.#update(connection.id, {
          status: !isTlsConnection(connection) && attempts >= 5 ? "needs-usb" : "waiting",
          attempts,
          nextAttemptAt: now + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)],
          lastError: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.running = false;
      }
    }

    return { reconnected: false, settingsChanged };
  }
}

module.exports = {
  ReconnectManager,
  deviceMatchesConnection,
  metadataFor,
  endpointHost,
  isNetworkEndpoint,
  isTlsConnection,
  mdnsServiceNameFromSerial,
  reconnectCandidates,
  serviceMatchesConnection,
};
