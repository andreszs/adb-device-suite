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
    const match = line.trim().match(/^\[([^\]]+)]\s*:\s*\[(.*)]$/);
    if (match) properties[match[1]] = match[2];
  }
  return properties;
}

function parseKeyValueLines(output) {
  const values = {};
  for (const line of String(output || "").split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    values[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  return values;
}

function parseBatteryInfo(output) {
  const values = parseKeyValueLines(output);
  const statusNames = { 1: "unknown", 2: "charging", 3: "discharging", 4: "notCharging", 5: "full" };
  const healthNames = { 1: "unknown", 2: "good", 3: "overheat", 4: "dead", 5: "overVoltage", 6: "failure", 7: "cold" };
  const number = (key, divisor = 1) => {
    const value = Number(values[key]);
    return Number.isFinite(value) ? value / divisor : null;
  };
  const enabled = (key) => values[key] === "true";
  const sources = [];
  if (enabled("ac powered")) sources.push("AC");
  if (enabled("usb powered")) sources.push("USB");
  if (enabled("wireless powered")) sources.push("Wireless");
  const statusCode = number("status");
  const healthCode = number("health");
  return {
    level: number("level"),
    status: statusNames[statusCode] || "unknown",
    health: healthNames[healthCode] || "unknown",
    temperatureC: number("temperature", 10),
    voltageMv: number("voltage"),
    technology: values.technology || null,
    sources,
  };
}

function validateSerial(rawSerial) {
  const serial = typeof rawSerial === "string" ? rawSerial.trim() : "";
  if (!serial || serial.length > 300 || /[\u0000-\u001f\s]/.test(serial)) throw new Error("Invalid device.");
  return serial;
}

function normalizeDeviceName(value) {
  const normalized = String(value || "").trim();
  return normalized && !/^(?:null|undefined)$/i.test(normalized) ? normalized : null;
}

function selectDeviceName(model, configuredName, ...fallbackNames) {
  const normalizedModel = normalizeDeviceName(model)?.toLowerCase() || null;
  const configured = normalizeDeviceName(configuredName);
  const fallbacks = fallbackNames.map(normalizeDeviceName).filter(Boolean);
  if (configured && configured.toLowerCase() !== normalizedModel) return configured;
  const descriptiveFallback = fallbacks.find((name) => name.toLowerCase() !== normalizedModel);
  return descriptiveFallback || configured || fallbacks[0] || null;
}

function parseScreenInfo(sizeOutput, densityOutput) {
  const physicalSize = String(sizeOutput || "").match(/Physical size:\s*(\d+x\d+)/i)?.[1] || null;
  const overrideSize = String(sizeOutput || "").match(/Override size:\s*(\d+x\d+)/i)?.[1] || null;
  const physicalDensity = Number(String(densityOutput || "").match(/Physical density:\s*(\d+)/i)?.[1]);
  const overrideDensity = Number(String(densityOutput || "").match(/Override density:\s*(\d+)/i)?.[1]);
  return {
    resolution: overrideSize || physicalSize,
    densityDpi: Number.isFinite(overrideDensity) ? overrideDensity : Number.isFinite(physicalDensity) ? physicalDensity : null,
  };
}

function parseStorageInfo(output) {
  const lines = String(output || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const fields = lines.at(-1)?.split(/\s+/) || [];
  if (fields.length < 6) return { totalBytes: null, usedBytes: null, availableBytes: null, usedPercent: null };
  const totalKb = Number(fields.at(-5));
  const usedKb = Number(fields.at(-4));
  const availableKb = Number(fields.at(-3));
  const usedPercent = Number(String(fields.at(-2)).replace("%", ""));
  return {
    totalBytes: Number.isFinite(totalKb) ? totalKb * 1024 : null,
    usedBytes: Number.isFinite(usedKb) ? usedKb * 1024 : null,
    availableBytes: Number.isFinite(availableKb) ? availableKb * 1024 : null,
    usedPercent: Number.isFinite(usedPercent) ? usedPercent : null,
  };
}

function parseNetworkInterfaces(output) {
  const interfaces = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(/^\s*\d+:\s+([^\s:@]+)(?:@[^\s:]+)?\s+inet\s+(\d{1,3}(?:\.\d{1,3}){3}\/\d+)/);
    if (match && !match[2].startsWith("127.")) interfaces.push({ name: match[1], address: match[2] });
  }
  return interfaces;
}

function parseCpuInfo(output) {
  const text = String(output || "");
  const processors = text.match(/^processor\s*:/gim)?.length || 0;
  const model = text.match(/^Hardware\s*:\s*(.+)$/im)?.[1]?.trim()
    || text.match(/^model name\s*:\s*(.+)$/im)?.[1]?.trim()
    || text.match(/^Processor\s*:\s*(.+)$/m)?.[1]?.trim()
    || null;
  return { model, cores: processors || null };
}

function parseOrientation(output) {
  const rotation = Number(String(output || "").match(/SurfaceOrientation:\s*(\d+)/i)?.[1]);
  if (!Number.isFinite(rotation)) return { orientation: null, rotation: null };
  return { orientation: rotation % 2 === 0 ? "portrait" : "landscape", rotation };
}

function parseSettingBoolean(output) {
  const normalized = String(output || "").trim().toLowerCase();
  if (["1", "true", "enabled", "on"].includes(normalized)) return true;
  if (["0", "false", "disabled", "off"].includes(normalized)) return false;
  return null;
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

function mdnsSerialMatchesService(serial, service) {
  if (!serial || !service?.serviceName || !service?.serviceType) return false;
  const normalizedSerial = String(serial).replace(/\.$/, "");
  const qualifiedService = `${service.serviceName}.${service.serviceType}`.replace(/\.$/, "");
  return normalizedSerial === qualifiedService;
}

function waitForDelay(delay, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Pairing was cancelled."));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Pairing was cancelled."));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

class AdbService {
  constructor(customPath = null) {
    this.customPath = customPath;
    this.adbPath = null;
    this.adbVersion = null;
    this.metadataCache = new Map();
    this.batteryCache = new Map();
    this.batteryRequests = new Map();
  }

  setCustomPath(customPath) {
    this.customPath = customPath || null;
    this.adbPath = null;
    this.adbVersion = null;
    this.metadataCache.clear();
    this.batteryCache.clear();
    this.batteryRequests.clear();
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

    const [
      propertiesResult,
      routeResult,
      addressesResult,
      deviceNameResult,
      secureBluetoothNameResult,
      globalBluetoothNameResult,
    ] = await Promise.allSettled([
      this.run(["-s", device.serial, "shell", "getprop"], 7_000),
      this.run(["-s", device.serial, "shell", "ip", "route"], 7_000),
      this.run(["-s", device.serial, "shell", "ip", "-o", "-4", "addr", "show"], 7_000),
      this.run(["-s", device.serial, "shell", "settings", "get", "global", "device_name"], 4_000),
      this.run(["-s", device.serial, "shell", "settings", "get", "secure", "bluetooth_name"], 4_000),
      this.run(["-s", device.serial, "shell", "settings", "get", "global", "bluetooth_name"], 4_000),
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
    const model = properties["ro.product.model"] || device.model || null;
    const deviceName = selectDeviceName(
      model,
      deviceNameResult.status === "fulfilled" ? deviceNameResult.value.stdout : null,
      secureBluetoothNameResult.status === "fulfilled" ? secureBluetoothNameResult.value.stdout : null,
      globalBluetoothNameResult.status === "fulfilled" ? globalBluetoothNameResult.value.stdout : null,
    );
    const value = {
      manufacturer: properties["ro.product.manufacturer"] || null,
      model,
      deviceName,
      androidVersion: properties["ro.build.version.release"] || null,
      sdk: properties["ro.build.version.sdk"] || null,
      hardwareSerial: properties["ro.serialno"] || properties["ro.boot.serialno"] || null,
      ipAddress,
      ipAddresses,
    };
    if (propertiesResult.status === "fulfilled" && Object.keys(properties).length > 0) {
      this.metadataCache.set(device.serial, { at: Date.now(), value });
    }
    return value;
  }

  async battery(rawSerial) {
    const serial = validateSerial(rawSerial);
    const pending = this.batteryRequests.get(serial);
    if (pending) return pending;

    const request = this.run(["-s", serial, "shell", "dumpsys", "battery"], 4_000)
      .then(({ stdout }) => {
        const battery = parseBatteryInfo(stdout);
        this.batteryCache.set(serial, battery);
        return battery;
      })
      .finally(() => this.batteryRequests.delete(serial));
    this.batteryRequests.set(serial, request);
    return request;
  }

  async snapshot() {
    try {
      await this.locate();
      const [{ stdout: devicesOutput }, mdnsResult] = await Promise.all([
        this.run(["devices", "-l"], 8_000),
        this.run(["mdns", "services"], 5_000).catch(() => ({ stdout: "" })),
      ]);
      const devices = parseDevices(devicesOutput);
      const enriched = await Promise.all(devices.map(async (device) => {
        const [metadata, battery] = await Promise.all([
          this.#deviceMetadata(device),
          device.state === "device"
            ? this.battery(device.serial).catch(() => this.batteryCache.get(device.serial) || null)
            : null,
        ]);
        return { ...device, ...metadata, ...(battery ? { battery } : {}) };
      }));
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

  async deviceInfo(rawSerial) {
    const serial = validateSerial(rawSerial);
    const { stdout: state } = await this.run(["-s", serial, "get-state"], 5_000);
    if (state.trim() !== "device") throw new Error("The device is not connected or authorized.");

    const commands = {
      properties: ["getprop"],
      battery: ["dumpsys", "battery"],
      screenSize: ["wm", "size"],
      screenDensity: ["wm", "density"],
      storage: ["df", "-k", "/data"],
      memory: ["cat", "/proc/meminfo"],
      cpuInfo: ["cat", "/proc/cpuinfo"],
      kernel: ["uname", "-a"],
      uptime: ["cat", "/proc/uptime"],
      addresses: ["ip", "-o", "-4", "addr", "show"],
      routes: ["ip", "route"],
      selinux: ["getenforce"],
      orientation: ["dumpsys", "input"],
      developerOptions: ["settings", "get", "global", "development_settings_enabled"],
      wifiOn: ["settings", "get", "global", "wifi_on"],
      airplaneMode: ["settings", "get", "global", "airplane_mode_on"],
      features: ["pm", "list", "features"],
    };
    const entries = await Promise.all(Object.entries(commands).map(async ([key, args]) => {
      try {
        const { stdout } = await this.run(["-s", serial, "shell", ...args], 7_000);
        return [key, stdout];
      } catch {
        return [key, ""];
      }
    }));
    const output = Object.fromEntries(entries);
    const properties = parseProperties(output.properties);
    const screen = parseScreenInfo(output.screenSize, output.screenDensity);
    const memTotalKb = Number(String(output.memory).match(/^MemTotal:\s+(\d+)\s+kB/im)?.[1]);
    const memAvailableKb = Number(String(output.memory).match(/^MemAvailable:\s+(\d+)\s+kB/im)?.[1]);
    const uptimeSeconds = Number(String(output.uptime).match(/^([\d.]+)/)?.[1]);
    const cpu = parseCpuInfo(output.cpuInfo);
    const orientation = parseOrientation(output.orientation);
    const routes = String(output.routes).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const features = String(output.features).split(/\r?\n/)
      .map((line) => line.trim().replace(/^feature:/, ""))
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));

    return {
      serial,
      identity: {
        brand: properties["ro.product.brand"] || null,
        manufacturer: properties["ro.product.manufacturer"] || null,
        model: properties["ro.product.model"] || null,
        product: properties["ro.product.name"] || null,
        device: properties["ro.product.device"] || null,
        hardwareSerial: properties["ro.serialno"] || properties["ro.boot.serialno"] || null,
      },
      system: {
        androidVersion: properties["ro.build.version.release"] || null,
        sdk: properties["ro.build.version.sdk"] || null,
        skinName: properties["ro.miui.ui.version.name"] ? "MIUI"
          : properties["ro.build.version.opporom"] ? "ColorOS"
            : properties["ro.build.version.emui"] ? "EMUI"
              : null,
        skinVersion: properties["ro.miui.ui.version.name"] || properties["ro.build.version.opporom"] || properties["ro.build.version.emui"] || null,
        securityPatch: properties["ro.build.version.security_patch"] || null,
        buildId: properties["ro.build.version.incremental"] || properties["ro.build.id"] || null,
        buildType: properties["ro.build.type"] || null,
        buildTags: properties["ro.build.tags"] || null,
        buildFingerprint: properties["ro.build.fingerprint"] || null,
        kernel: output.kernel || null,
        uptimeSeconds: Number.isFinite(uptimeSeconds) ? uptimeSeconds : null,
        locale: properties["persist.sys.locale"] || properties["ro.product.locale"] || null,
        timeZone: properties["persist.sys.timezone"] || null,
        bootReason: properties["ro.boot.bootreason"] || properties["sys.boot.reason"] || null,
        developerOptions: parseSettingBoolean(output.developerOptions),
      },
      hardware: {
        platform: properties["ro.board.platform"] || properties["ro.hardware"] || null,
        cpuModel: cpu.model,
        cpuCores: cpu.cores,
        cpuAbis: (properties["ro.product.cpu.abilist"] || "").split(",").filter(Boolean),
        ramTotalBytes: Number.isFinite(memTotalKb) ? memTotalKb * 1024 : null,
        ramAvailableBytes: Number.isFinite(memAvailableKb) ? memAvailableKb * 1024 : null,
        screen: { ...screen, ...orientation },
        storage: parseStorageInfo(output.storage),
      },
      battery: parseBatteryInfo(output.battery),
      network: {
        interfaces: parseNetworkInterfaces(output.addresses),
        routes,
        wifiEnabled: parseSettingBoolean(output.wifiOn),
        airplaneMode: parseSettingBoolean(output.airplaneMode),
      },
      security: {
        encryption: properties["ro.crypto.state"] || null,
        encryptionType: properties["ro.crypto.type"] || null,
        verifiedBoot: properties["ro.boot.verifiedbootstate"] || null,
        bootloader: properties["ro.boot.vbmeta.device_state"]
          || (properties["ro.boot.flash.locked"] === "1" ? "locked" : properties["ro.boot.flash.locked"] === "0" ? "unlocked" : null),
        selinux: output.selinux || null,
        adbSecure: parseSettingBoolean(properties["ro.adb.secure"]),
      },
      features,
    };
  }

  async connect(rawEndpoint, options = {}) {
    const endpoint = validateEndpoint(rawEndpoint);
    const { stdout, stderr } = await this.run(["connect", endpoint], 15_000);
    const output = stdout || stderr;
    if (/failed|cannot|unable|refused|timed out/i.test(output)) throw new Error(output);
    this.metadataCache.delete(endpoint);
    const verificationDelays = options.verificationDelays || [0, 250, 500, 750, 1_000, 1_500];
    let lastState = "";
    for (const delay of verificationDelays) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const { stdout: state } = await this.run(["-s", endpoint, "get-state"], 3_000);
        lastState = state.trim();
        if (lastState === "device") {
          return { endpoint, verified: true, message: output || `Connected to ${endpoint}` };
        }
      } catch (error) {
        lastState = error instanceof Error ? error.message : String(error);
      }
    }
    throw new Error(`ADB enabled the network transport, but could not verify ${endpoint} as connected${lastState ? ` (${lastState})` : ""}.`);
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

  async pair(rawEndpoint, pairingCode, options = {}) {
    const code = String(pairingCode || "").trim();
    if (!/^\d{6}$/.test(code)) throw new Error("The pairing code must contain 6 digits.");
    const pairingResult = await this.#pairWithSecret(rawEndpoint, code);
    if (options.signal?.aborted) throw new Error("Pairing was cancelled.");
    options.onPaired?.({ endpoint: pairingResult.endpoint });
    const connectionResult = await this.#connectAfterPairing(pairingResult.endpoint, options.signal);
    return {
      ...connectionResult,
      pairingEndpoint: pairingResult.endpoint,
      message: `${pairingResult.message} ${connectionResult.message}`.trim(),
    };
  }

  async pairByQr(rawServiceName, rawPassword, options = {}) {
    const { signal, timeout = 120_000 } = options;
    const { serviceName, password } = validateQrPairingCredentials(rawServiceName, rawPassword);
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("Pairing was cancelled.");
      const { stdout } = await this.run(["mdns", "services"], 5_000);
      const service = parseMdnsServices(stdout).find((item) => (
        item.type === "pairing" && item.serviceName === serviceName
      ));
      if (service) {
        const pairingResult = await this.#pairWithSecret(service.endpoint, password);
        if (signal?.aborted) throw new Error("Pairing was cancelled.");
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

  async #connectAfterPairing(pairingEndpoint, signal) {
    const host = endpointHost(pairingEndpoint);
    if (signal?.aborted) throw new Error("Pairing was cancelled.");
    const [{ stdout: devicesOutput }, mdnsResult] = await Promise.all([
      this.run(["devices", "-l"], 8_000),
      this.run(["mdns", "services"], 5_000).catch(() => ({ stdout: "" })),
    ]);
    const connectionServices = parseMdnsServices(mdnsResult.stdout).filter((item) => (
      item.type === "connect" && endpointHost(item.endpoint) === host
    ));
    const connectedDevice = parseDevices(devicesOutput).find((device) => (
      device.connection === "wifi"
      && device.state === "device"
      && (endpointHost(device.serial) === host || connectionServices.some((service) => mdnsSerialMatchesService(device.serial, service)))
    ));
    if (connectedDevice) {
      return { endpoint: connectedDevice.serial, message: `Connected to ${connectedDevice.serial}` };
    }

    return {
      endpoint: null,
      pendingConnection: true,
      message: "Pairing succeeded. Android will connect automatically when its wireless debugging service is ready.",
    };
  }

  async enableWireless(serial, options = {}) {
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
    await new Promise((resolve) => setTimeout(resolve, options.restartDelay ?? 900));
    const failures = [];
    for (const address of candidates) {
      try {
        const result = await this.connect(`${address}:5555`, options.connectOptions);
        const endpoint = result.endpoint;
        this.metadataCache.set(endpoint, {
          at: Date.now(),
          value: {
            manufacturer: device.manufacturer || null,
            model: device.model || null,
            deviceName: device.deviceName || null,
            androidVersion: device.androidVersion || null,
            sdk: device.sdk || null,
            hardwareSerial: device.hardwareSerial || serial,
            ipAddress: address,
            ipAddresses: [...new Set([address, ...candidates])],
          },
        });
        return { ...result, hardwareSerial: device.hardwareSerial || serial };
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
    this.batteryCache.clear();
    this.batteryRequests.clear();
    return { message: stdout || stderr || "ADB server restarted." };
  }
}

module.exports = {
  AdbService,
  parseDevices,
  parseBatteryInfo,
  parseCpuInfo,
  parseIpAddress,
  parseIpAddresses,
  parseMdnsServices,
  parseNetworkInterfaces,
  parseOrientation,
  parseProperties,
  parseScreenInfo,
  parseStorageInfo,
  parseSettingBoolean,
  validateEndpoint,
  validateSerial,
  normalizeDeviceName,
  selectDeviceName,
};
