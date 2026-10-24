const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseDevices,
  parseIpAddress,
  parseIpAddresses,
  parseMdnsServices,
  parseProperties,
  validateEndpoint,
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
  const properties = parseProperties(`[ro.build.version.release]: [16]
[ro.build.version.sdk]: [36]
[ro.product.manufacturer]: [Google]
[ro.product.model]: [Pixel 9]
`);
  assert.equal(properties["ro.product.model"], "Pixel 9");
  assert.equal(properties["ro.build.version.sdk"], "36");
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
