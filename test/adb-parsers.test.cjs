const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AdbService,
  parseBatteryInfo,
  parseCpuInfo,
  parseDevices,
  parseIpAddress,
  parseIpAddresses,
  parseMdnsServices,
  parseNetworkInterfaces,
  parseOrientation,
  parseProperties,
  parseScreenInfo,
  parseStorageInfo,
  parseSettingBoolean,
  selectDeviceName,
  validateEndpoint,
  validateSerial,
} = require("../electron/adb-service.cjs");

test("parseDevices identifies USB, Wi-Fi and unauthorized devices", () => {
  const devices = parseDevices(`List of devices attached
R5CT123456 device product:dm3qxeea model:SM_S918B device:dm3q transport_id:1
192.168.1.42:5555 device product:panther model:Pixel_7 device:panther transport_id:2
ZX1G22 unauthorized usb:1-2 transport_id:3
`);

  assert.equal(devices.length, 3);
  assert.deepEqual(devices[0], {
    serial: "R5CT123456",
    state: "device",
    product: "dm3qxeea",
    model: "SM S918B",
    device: "dm3q",
    transportId: "1",
    connection: "usb",
  });
  assert.equal(devices[1].connection, "wifi");
  assert.equal(devices[2].state, "unauthorized");
});

test("parseProperties reads Android getprop output", () => {
  const properties = parseProperties(`[ro.build.version.release]: [16]\r\r
[ro.build.version.sdk]: [36]\r\r
[ro.product.manufacturer]: [Google]
[ro.product.model]: [Pixel 9]
`);
  assert.equal(properties["ro.build.version.release"], "16");
  assert.equal(properties["ro.product.model"], "Pixel 9");
  assert.equal(properties["ro.build.version.sdk"], "36");
});

test("device information parsers normalize battery, screen, storage and network output", () => {
  assert.deepEqual(parseBatteryInfo(`AC powered: false
USB powered: true
Wireless powered: false
status: 2
health: 2
level: 87
voltage: 4210
temperature: 315
technology: Li-ion`), {
    level: 87,
    status: "charging",
    health: "good",
    temperatureC: 31.5,
    voltageMv: 4210,
    technology: "Li-ion",
    sources: ["USB"],
  });
  assert.deepEqual(parseScreenInfo("Physical size: 1080x2280\nOverride size: 1080x2160", "Physical density: 420"), {
    resolution: "1080x2160",
    densityDpi: 420,
  });
  assert.deepEqual(parseStorageInfo(`Filesystem 1K-blocks Used Available Use% Mounted on
/dev/block/dm-8 115000000 23000000 92000000 20% /data`), {
    totalBytes: 117760000000,
    usedBytes: 23552000000,
    availableBytes: 94208000000,
    usedPercent: 20,
  });
  assert.deepEqual(parseNetworkInterfaces(`1: lo    inet 127.0.0.1/8 scope host lo
12: wlan0    inet 192.168.0.6/24 brd 192.168.0.255 scope global wlan0`), [
    { name: "wlan0", address: "192.168.0.6/24" },
  ]);
  assert.deepEqual(parseCpuInfo("processor: 0\nprocessor: 1\nHardware: MT6768"), { model: "MT6768", cores: 2 });
  assert.deepEqual(parseOrientation("SurfaceOrientation: 1"), { orientation: "landscape", rotation: 1 });
  assert.equal(parseSettingBoolean("1\n"), true);
  assert.equal(parseSettingBoolean("0\n"), false);
  assert.equal(parseSettingBoolean("null\n"), null);
});

test("parseIpAddress accepts route and interface formats", () => {
  assert.equal(parseIpAddress("192.168.1.0/24 dev wlan0 src 192.168.1.81"), "192.168.1.81");
  assert.equal(parseIpAddress("inet 10.0.0.14/24 brd 10.0.0.255 scope global wlan0"), "10.0.0.14");
  assert.equal(parseIpAddress(""), null);
});

test("parseIpAddresses keeps every usable address and prioritizes physical Wi-Fi over VPN routes", () => {
  const addresses = `14: wlan0    inet 192.168.100.3/24 brd 192.168.100.255 scope global wlan0
21: tun0    inet 10.5.47.59/24 scope global tun0
1: lo    inet 127.0.0.1/8 scope host lo`;
  const routes = `10.5.47.0/24 dev tun0 proto kernel scope link src 10.5.47.59
192.168.100.0/24 dev wlan0 proto kernel scope link src 192.168.100.3`;

  assert.deepEqual(parseIpAddresses(addresses, routes), ["192.168.100.3", "10.5.47.59"]);
  assert.equal(parseIpAddress(routes), "192.168.100.3");
});

test("parseMdnsServices distinguishes pairing and connection endpoints", () => {
  const services = parseMdnsServices(`List of discovered mdns services
adb-R5CT._adb-tls-connect._tcp. 192.168.1.50:37777
adb-R5CT._adb-tls-pairing._tcp. 192.168.1.50:38888
`);
  assert.equal(services.length, 2);
  assert.equal(services[0].type, "connect");
  assert.equal(services[1].type, "pairing");
});

test("parseMdnsServices accepts the official three-column output", () => {
  const services = parseMdnsServices(`List of discovered mdns services
adb-R5CT123456-TnSdi9 _adb-tls-connect._tcp 192.168.1.51:33015
adb-R5CT123456 _adb._tcp 192.168.1.51:5555
`);
  assert.deepEqual(services[0], {
    serviceName: "adb-R5CT123456-TnSdi9",
    serviceType: "_adb-tls-connect._tcp",
    endpoint: "192.168.1.51:33015",
    type: "connect",
  });
  assert.equal(services[1].type, "legacy");
});

test("validateEndpoint normalizes safe endpoints and rejects invalid ports", () => {
  assert.equal(validateEndpoint(" 192.168.1.2:5555 "), "192.168.1.2:5555");
  assert.equal(validateEndpoint("adb-device.local:37123"), "adb-device.local:37123");
  assert.throws(() => validateEndpoint("192.168.1.2"), /format/);
  assert.throws(() => validateEndpoint("192.168.1.2:99999"), /between/);
});

test("battery readings bypass the static metadata cache and deduplicate concurrent requests", async () => {
  const adb = new AdbService();
  let calls = 0;
  adb.run = async (args) => {
    assert.deepEqual(args, ["-s", "192.168.1.2:5555", "shell", "dumpsys", "battery"]);
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { stdout: "level: 73\nstatus: 2\nusb powered: true", stderr: "" };
  };

  const [first, concurrent] = await Promise.all([
    adb.battery("192.168.1.2:5555"),
    adb.battery("192.168.1.2:5555"),
  ]);
  const next = await adb.battery("192.168.1.2:5555");

  assert.deepEqual(first, concurrent);
  assert.equal(next.level, 73);
  assert.equal(next.status, "charging");
  assert.deepEqual(next.sources, ["USB"]);
  assert.equal(calls, 2);
});

test("validateSerial rejects whitespace and control characters", () => {
  assert.equal(validateSerial(" 192.168.1.2:5555 "), "192.168.1.2:5555");
  assert.throws(() => validateSerial("device name"), /Invalid device/);
  assert.throws(() => validateSerial("device\nname"), /Invalid device/);
});

test("device names prefer a configured name and use Bluetooth when Android only returns the model", () => {
  assert.equal(selectDeviceName("SM-G973F", "Andres's S10", "Andres's S10"), "Andres's S10");
  assert.equal(selectDeviceName("M2004J19C", "M2004J19C", "Redmi 9"), "Redmi 9");
  assert.equal(selectDeviceName("SM-G930F", "null", "Galaxy S7"), "Galaxy S7");
  assert.equal(selectDeviceName("Pixel 8", "null", "undefined"), null);
});

test("connect only succeeds after ADB verifies the endpoint is a device", async () => {
  const adb = new AdbService();
  let checks = 0;
  adb.run = async (args) => {
    if (args[0] === "connect") return { stdout: "connected to 192.168.1.2:5555", stderr: "" };
    checks += 1;
    return { stdout: checks === 1 ? "offline" : "device", stderr: "" };
  };

  const result = await adb.connect("192.168.1.2:5555", { verificationDelays: [0, 0] });

  assert.equal(result.verified, true);
  assert.equal(checks, 2);
});

test("connect rejects an unverified success response", async () => {
  const adb = new AdbService();
  adb.run = async (args) => args[0] === "connect"
    ? { stdout: "connected to 192.168.1.2:5555", stderr: "" }
    : { stdout: "offline", stderr: "" };

  await assert.rejects(
    adb.connect("192.168.1.2:5555", { verificationDelays: [0] }),
    /could not verify .* as connected/i,
  );
});

test("incomplete device metadata is retried instead of cached", async () => {
  const adb = new AdbService();
  let getpropCalls = 0;
  adb.locate = async () => "adb";
  adb.run = async (args) => {
    if (args[0] === "devices") return { stdout: "List of devices attached\nSERIAL device model:Test", stderr: "" };
    if (args[0] === "mdns") return { stdout: "", stderr: "" };
    if (args.includes("getprop")) {
      getpropCalls += 1;
      throw new Error("transport restarting");
    }
    if (args.includes("battery")) return { stdout: "level: 50\nstatus: 3", stderr: "" };
    return { stdout: "", stderr: "" };
  };

  await adb.snapshot();
  await adb.snapshot();

  assert.equal(getpropCalls, 2);
});

test("pairing by code accepts a device that ADB already auto-connected", async () => {
  const adb = new AdbService();
  const calls = [];
  const progress = [];
  adb.run = async (args) => {
    calls.push(args);
    if (args[0] === "pair") {
      return { stdout: "Successfully paired to 192.168.1.87:46305", stderr: "" };
    }
    if (args[0] === "devices") {
      return {
        stdout: `List of devices attached
192.168.1.87:39421 device product:test model:Test device:test transport_id:1`,
        stderr: "",
      };
    }
    if (args[0] === "mdns") {
      return {
        stdout: `List of discovered mdns services
adb-R9MNA00VMTJ-random _adb-tls-connect._tcp 192.168.1.87:39421`,
        stderr: "",
      };
    }
    return { stdout: "", stderr: "" };
  };

  const result = await adb.pair("192.168.1.87:46305", "123456", {
    onPaired: (event) => progress.push(event),
  });

  assert.equal(result.pairingEndpoint, "192.168.1.87:46305");
  assert.equal(result.endpoint, "192.168.1.87:39421");
  assert.deepEqual(progress, [{ endpoint: "192.168.1.87:46305" }]);
  assert.deepEqual(calls.map((args) => args[0]), ["pair", "devices", "mdns"]);
});

test("pairing recognizes devices that ADB auto-connects under their mDNS service name", async () => {
  const adb = new AdbService();
  const calls = [];
  adb.run = async (args) => {
    calls.push(args);
    if (args[0] === "pair") return { stdout: "Successfully paired to 192.168.0.32:37123", stderr: "" };
    if (args[0] === "devices") {
      return {
        stdout: `List of devices attached
adb-150b17f0-dsJ1nI._adb-tls-connect._tcp device product:ginkgo model:Redmi_Note_8 device:ginkgo transport_id:25`,
        stderr: "",
      };
    }
    if (args[0] === "mdns") {
      return {
        stdout: `List of discovered mdns services
adb-150b17f0-dsJ1nI _adb-tls-connect._tcp 192.168.0.32:43461`,
        stderr: "",
      };
    }
    return { stdout: "", stderr: "" };
  };

  const result = await adb.pair("192.168.0.32:37123", "123456");

  assert.equal(result.endpoint, "adb-150b17f0-dsJ1nI._adb-tls-connect._tcp");
  assert.equal(result.pendingConnection, undefined);
  assert.equal(calls.some((args) => args[0] === "connect"), false);
});

test("pairing immediately reports a pending automatic connection instead of waiting", async () => {
  const adb = new AdbService();
  adb.run = async (args) => {
    if (args[0] === "pair") return { stdout: "Successfully paired to 192.168.0.32:37123", stderr: "" };
    if (args[0] === "devices") return { stdout: "List of devices attached", stderr: "" };
    if (args[0] === "mdns") return { stdout: "List of discovered mdns services", stderr: "" };
    return { stdout: "", stderr: "" };
  };

  const result = await adb.pair("192.168.0.32:37123", "123456");

  assert.equal(result.pendingConnection, true);
  assert.equal(result.endpoint, null);
  assert.match(result.message, /connect automatically/i);
});

test("pairByQr waits for the requested QR service and pairs with its generated secret", async () => {
  const adb = new AdbService();
  const calls = [];
  const progress = [];
  let paired = false;
  adb.run = async (args) => {
    calls.push(args);
    if (args[0] === "mdns") {
      return {
        stdout: paired
          ? `List of discovered mdns services
adb-R5CT123456-random _adb-tls-connect._tcp 192.168.1.41:41521`
          : `List of discovered mdns services
studio-other _adb-tls-pairing._tcp 192.168.1.40:37121
studio-0123456789 _adb-tls-pairing._tcp 192.168.1.41:37123`,
        stderr: "",
      };
    }
    if (args[0] === "pair") {
      paired = true;
      return { stdout: "Successfully paired to 192.168.1.41:37123", stderr: "" };
    }
    if (args[0] === "devices") {
      return {
        stdout: paired
          ? `List of devices attached
192.168.1.41:41521 device product:test model:Test device:test transport_id:2`
          : "List of devices attached",
        stderr: "",
      };
    }
    return { stdout: "", stderr: "" };
  };

  const result = await adb.pairByQr("studio-0123456789", "0123456789abcdef0123", {
    timeout: 100,
    onPaired: (event) => progress.push({ ...event, calls: calls.length }),
  });

  assert.equal(result.pairingEndpoint, "192.168.1.41:37123");
  assert.equal(result.endpoint, "192.168.1.41:41521");
  assert.deepEqual(progress, [{ endpoint: "192.168.1.41:37123", calls: 2 }]);
  assert.equal(calls.some((args) => args[0] === "connect"), false);
});

test("pairByQr rejects malformed credentials before running ADB", async () => {
  const adb = new AdbService();
  adb.run = async () => assert.fail("ADB should not run for invalid QR credentials");
  await assert.rejects(
    adb.pairByQr("not-a-studio-service", "short"),
    /Invalid QR pairing credentials/,
  );
});
