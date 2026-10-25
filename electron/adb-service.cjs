const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

function parseDevices(output) {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\S+)\s+(\S+)(?:\s+(.*))?$/);
      if (!match) return null;
      const [, serial, state, details = ""] = match;
      const properties = {};
      for (const token of details.split(/\s+/)) {
        const separator = token.indexOf(":");
        if (separator > 0) {
          properties[token.slice(0, separator)] = token.slice(separator + 1);
        }
      }
      return {
        serial,
        state,
        product: properties.product || null,
        model: properties.model?.replaceAll("_", " ") || null,
        device: properties.device || null,
        transportId: properties.transport_id || null,
        connection: /:\d+$/.test(serial) || serial.endsWith("._adb-tls-connect._tcp")
          ? "wifi"
          : "usb",
      };
    })
    .filter(Boolean);
}

function parseProperties(output) {
  const properties = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\[([^\]]+)]\s*:\s*\[(.*)]$/);
    if (match) properties[match[1]] = match[2];
  }
  return properties;
}

function parseIpAddress(output) {
  return parseIpAddresses(output)[0] || null;
}

function interfacePriority(name) {
  if (/^(?:wlan|wifi)/i.test(name)) return 0;
  if (/^(?:eth|en)/i.test(name)) return 1;
  if (/^(?:tun|tap|zt|vpn)/i.test(name)) return 2;
  return 3;
}

function isUsableIpv4(address) {
  return !address.startsWith("127.")
    && !address.startsWith("169.254.")
    && address !== "0.0.0.0";
}

function parseIpAddresses(...outputs) {
  const candidates = [];
  let order = 0;

  function add(address, interfaceName = "") {
    if (!isUsableIpv4(address) || candidates.some((item) => item.address === address)) return;
    candidates.push({
      address,
      priority: interfacePriority(interfaceName),
      order: order++,
    });
  }

  for (const output of outputs) {
    for (const line of String(output || "").split(/\r?\n/)) {
      const interfaceMatch = line.match(/^\s*\d+:\s+([^\s:@]+)(?:@[^\s:]+)?\s+inet\s+(\d{1,3}(?:\.\d{1,3}){3})\//);
      if (interfaceMatch) {
        add(interfaceMatch[2], interfaceMatch[1]);
        continue;
      }

      const simpleInterfaceMatch = line.match(/\binet\s+(\d{1,3}(?:\.\d{1,3}){3})\/.*?\s([^\s]+)\s*$/);
      if (simpleInterfaceMatch) {
        add(simpleInterfaceMatch[1], simpleInterfaceMatch[2]);
        continue;
      }

      const routeMatch = line.match(/\bdev\s+(\S+).*?\bsrc\s+(\d{1,3}(?:\.\d{1,3}){3})\b/);
      if (routeMatch) add(routeMatch[2], routeMatch[1]);
    }
  }

  return candidates
    .sort((left, right) => left.priority - right.priority || left.order - right.order)
    .map((item) => item.address);
}

function parseMdnsServices(output) {
  const services = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^List of discovered/.test(line)) continue;
    const tokens = line.split(/\s+/);
    const endpoint = tokens.at(-1);
    if (!endpoint || !/^\S+:\d+$/.test(endpoint)) continue;

    let serviceName;
    let serviceType;
    if (tokens.length >= 3 && /^_adb(?:-tls-(?:pairing|connect))?\._tcp\.?$/.test(tokens.at(-2))) {
      serviceName = tokens.at(-3).replace(/\.$/, "");
      serviceType = tokens.at(-2).replace(/\.$/, "");
    } else {
      const qualified = tokens[0];
      const match = qualified.match(/^(.*?)\.(_adb(?:-tls-(?:pairing|connect))?\._tcp)\.?$/);
      if (!match) continue;
      serviceName = match[1];
      serviceType = match[2];
    }

    const type = serviceType.includes("_adb-tls-pairing._tcp")
      ? "pairing"
      : serviceType.includes("_adb-tls-connect._tcp")
        ? "connect"
        : "legacy";
    services.push({ serviceName, serviceType, endpoint, type });
  }
  return services;
}

function validateEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length > 300) {
    throw new Error("Enter a valid IP address or hostname and port.");
  }
  const normalized = endpoint.trim();
  const match = normalized.match(/^(\[[0-9a-fA-F:]+]|[a-zA-Z0-9._-]+):(\d{1,5})$/);
  if (!match) throw new Error("Use the format 192.168.1.20:5555.");
  const port = Number(match[2]);
  if (port < 1 || port > 65535) throw new Error("The port must be between 1 and 65535.");
  return normalized;
}

function validateQrPairingCredentials(serviceName, password) {
  if (typeof serviceName !== "string" || !/^studio-[a-zA-Z0-9]{10,32}$/.test(serviceName)) {
    throw new Error("Invalid QR pairing credentials.");
  }
  if (typeof password !== "string" || !/^[a-zA-Z0-9]{16,64}$/.test(password)) {
    throw new Error("Invalid QR pairing credentials.");
  }
  return { serviceName, password };
}

function endpointHost(endpoint) {
  const match = String(endpoint || "").match(/^\[?([^\]]+?)]?:\d+$/);
  return match?.[1] || null;
}

function waitForDelay(delay, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("QR pairing was cancelled."));
      return;
    }
    const timer = setTimeout(resolve, delay);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("QR pairing was cancelled."));
    }, { once: true });
  });
}

class AdbService {
  constructor(customPath = null) {
    this.customPath = customPath;
    this.adbPath = null;
    this.adbVersion = null;
    this.metadataCache = new Map();
  }

  setCustomPath(customPath) {
    this.customPath = customPath || null;
    this.adbPath = null;
    this.adbVersion = null;
    this.metadataCache.clear();
  }

  #candidates() {
    const home = os.homedir();
    const candidates = [this.customPath];
    if (process.platform === "win32") {
      if (process.env.ANDROID_HOME) {
        candidates.push(path.join(process.env.ANDROID_HOME, "platform-tools", "adb.exe"));
      }
      if (process.env.ANDROID_SDK_ROOT) {
        candidates.push(path.join(process.env.ANDROID_SDK_ROOT, "platform-tools", "adb.exe"));
      }
      if (process.env.LOCALAPPDATA) {
        candidates.push(path.join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", "adb.exe"));
      }
    } else {
      candidates.push(
        path.join(home, "Library", "Android", "sdk", "platform-tools", "adb"),
        path.join(home, "Android", "Sdk", "platform-tools", "adb"),
        "/opt/homebrew/bin/adb",
        "/usr/local/bin/adb",
        "/usr/bin/adb",
      );
    }
    candidates.push("adb");
    return [...new Set(candidates.filter(Boolean))];
  }

  async #execute(executable, args, timeout = 10_000) {
    return new Promise((resolve, reject) => {
      execFile(executable, args, {
        windowsHide: true,
        timeout,
        maxBuffer: 2 * 1024 * 1024,
        encoding: "utf8",
      }, (error, stdout = "", stderr = "") => {
        if (error) {
          const message = (stderr || stdout || error.message).trim();
          const wrapped = new Error(message || "ADB command failed.");
          wrapped.code = error.code;
          return reject(wrapped);
        }
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      });
    });
  }

  async locate() {
    if (this.adbPath) return this.adbPath;
    for (const candidate of this.#candidates()) {
      if (candidate !== "adb" && !fs.existsSync(candidate)) continue;
      try {
        const { stdout } = await this.#execute(candidate, ["version"], 4_000);
        this.adbPath = candidate;
        this.adbVersion = stdout.match(/Version\s+([^\s]+)/)?.[1] || "Unknown";
        return candidate;
      } catch {
        // Keep checking known locations.
      }
    }
    throw new Error("ADB was not found. Install Android SDK Platform-Tools or select the adb executable.");
  }

  async run(args, timeout) {
    const executable = await this.locate();
    return this.#execute(executable, args, timeout);
  }

  async #deviceMetadata(device) {
    if (device.state !== "device") return {};
    const cached = this.metadataCache.get(device.serial);
    if (cached && Date.now() - cached.at < 30_000) return cached.value;

    const [propertiesResult, routeResult, addressesResult] = await Promise.allSettled([
      this.run(["-s", device.serial, "shell", "getprop"], 7_000),
      this.run(["-s", device.serial, "shell", "ip", "route"], 7_000),
      this.run(["-s", device.serial, "shell", "ip", "-o", "-4", "addr", "show"], 7_000),
    ]);
    const properties = propertiesResult.status === "fulfilled"
      ? parseProperties(propertiesResult.value.stdout)
      : {};
    const routeOutput = routeResult.status === "fulfilled" ? routeResult.value.stdout : "";
    const addressesOutput = addressesResult.status === "fulfilled" ? addressesResult.value.stdout : "";
    const detectedAddresses = parseIpAddresses(addressesOutput, routeOutput);
    const connectedAddress = device.connection === "wifi"
      ? device.serial.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/)?.[1] || null
      : null;
    const ipAddresses = [...new Set([connectedAddress, ...detectedAddresses].filter(Boolean))];
    const ipAddress = ipAddresses[0] || null;
    const value = {
      manufacturer: properties["ro.product.manufacturer"] || null,
      model: properties["ro.product.model"] || device.model || null,
      androidVersion: properties["ro.build.version.release"] || null,
      sdk: properties["ro.build.version.sdk"] || null,
      hardwareSerial: properties["ro.serialno"] || properties["ro.boot.serialno"] || null,
      ipAddress,
      ipAddresses,
    };
    this.metadataCache.set(device.serial, { at: Date.now(), value });
    return value;
  }

  async snapshot() {
    try {
      await this.locate();
      const [{ stdout: devicesOutput }, mdnsResult] = await Promise.all([
        this.run(["devices", "-l"], 8_000),
        this.run(["mdns", "services"], 5_000).catch(() => ({ stdout: "" })),
      ]);
      const devices = parseDevices(devicesOutput);
      const enriched = await Promise.all(devices.map(async (device) => ({
        ...device,
        ...(await this.#deviceMetadata(device)),
      })));
      return {
        adb: {
          available: true,
          path: this.adbPath,
          version: this.adbVersion,
          error: null,
        },
        devices: enriched,
        services: parseMdnsServices(mdnsResult.stdout),
        refreshedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        adb: {
          available: false,
          path: this.customPath,
          version: null,
          error: error.message,
        },
        devices: [],
        services: [],
        refreshedAt: new Date().toISOString(),
      };
    }
  }

  async connect(rawEndpoint) {
    const endpoint = validateEndpoint(rawEndpoint);
    const { stdout, stderr } = await this.run(["connect", endpoint], 15_000);
    const output = stdout || stderr;
    if (/failed|cannot|unable|refused|timed out/i.test(output)) throw new Error(output);
    this.metadataCache.delete(endpoint);
    return { endpoint, message: output || `Connected to ${endpoint}` };
  }

  async disconnect(rawEndpoint) {
    const endpoint = validateEndpoint(rawEndpoint);
    const { stdout, stderr } = await this.run(["disconnect", endpoint], 10_000);
    this.metadataCache.delete(endpoint);
    return { endpoint, message: stdout || stderr || `Disconnected from ${endpoint}` };
  }

  async #pairWithSecret(rawEndpoint, pairingSecret) {
    const endpoint = validateEndpoint(rawEndpoint);
    const secret = String(pairingSecret || "").trim();
    const { stdout, stderr } = await this.run(["pair", endpoint, secret], 20_000);
    const output = stdout || stderr;
    if (!/successfully paired/i.test(output)) throw new Error(output || "Pairing failed.");
    return { endpoint, message: output };
  }

  async pair(rawEndpoint, pairingCode) {
    const code = String(pairingCode || "").trim();
    if (!/^\d{6}$/.test(code)) throw new Error("The pairing code must contain 6 digits.");
    return this.#pairWithSecret(rawEndpoint, code);
  }

  async pairByQr(rawServiceName, rawPassword, options = {}) {
    const { signal, timeout = 120_000 } = options;
    const { serviceName, password } = validateQrPairingCredentials(rawServiceName, rawPassword);
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("QR pairing was cancelled.");
      const { stdout } = await this.run(["mdns", "services"], 5_000);
      const service = parseMdnsServices(stdout).find((item) => (
        item.type === "pairing" && item.serviceName === serviceName
      ));
      if (service) {
        const pairingResult = await this.#pairWithSecret(service.endpoint, password);
        options.onPaired?.({ endpoint: pairingResult.endpoint });
        const connectionResult = await this.#connectAfterPairing(service.endpoint, signal);
        return {
          ...connectionResult,
          pairingEndpoint: pairingResult.endpoint,
          message: `${pairingResult.message} ${connectionResult.message}`.trim(),
        };
      }
      await waitForDelay(Math.min(1_000, deadline - Date.now()), signal);
    }

    throw new Error("No Android device responded to the QR code before it expired.");
  }

  async #connectAfterPairing(pairingEndpoint, signal, timeout = 20_000) {
    const host = endpointHost(pairingEndpoint);
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("QR pairing was cancelled.");
      const [{ stdout: devicesOutput }, mdnsResult] = await Promise.all([
        this.run(["devices", "-l"], 8_000),
        this.run(["mdns", "services"], 5_000).catch(() => ({ stdout: "" })),
      ]);
      const connectedDevice = parseDevices(devicesOutput).find((device) => (
        device.connection === "wifi" && endpointHost(device.serial) === host && device.state === "device"
      ));
      if (connectedDevice) {
        return { endpoint: connectedDevice.serial, message: `Connected to ${connectedDevice.serial}` };
      }

      const connectionService = parseMdnsServices(mdnsResult.stdout).find((item) => (
        item.type === "connect" && endpointHost(item.endpoint) === host
      ));
      if (connectionService) {
        try {
          return await this.connect(connectionService.endpoint);
        } catch {
          // Keep retrying until the connection deadline.
        }
      }
      await waitForDelay(Math.min(750, deadline - Date.now()), signal);
    }

    throw new Error("Pairing succeeded, but ADB could not connect to the wireless debugging port within 20 seconds.");
  }

  async enableWireless(serial) {
    if (typeof serial !== "string" || !serial.trim()) throw new Error("Invalid device.");
    const current = await this.snapshot();
    const device = current.devices.find((item) => item.serial === serial && item.connection === "usb");
    if (!device) throw new Error("The USB device is no longer connected.");
    if (device.state !== "device") throw new Error("Authorize USB debugging on the Android device first.");
    const candidates = device.ipAddresses?.length
      ? device.ipAddresses
      : device.ipAddress ? [device.ipAddress] : [];
    if (!candidates.length) throw new Error("Could not determine a reachable device network address.");

    await this.run(["-s", serial, "tcpip", "5555"], 15_000);
    await new Promise((resolve) => setTimeout(resolve, 900));
    const failures = [];
    for (const address of candidates) {
      try {
        return await this.connect(`${address}:5555`);
      } catch (error) {
        failures.push(`${address}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`Could not connect through any device address. Tried ${failures.join("; ")}`);
  }

  async restartServer() {
    await this.run(["kill-server"], 8_000).catch(() => null);
    const { stdout, stderr } = await this.run(["start-server"], 12_000);
    this.metadataCache.clear();
    return { message: stdout || stderr || "ADB server restarted." };
  }
}

module.exports = {
  AdbService,
  parseDevices,
  parseIpAddress,
  parseIpAddresses,
  parseMdnsServices,
  parseProperties,
  validateEndpoint,
};
