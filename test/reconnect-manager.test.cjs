const test = require("node:test");
const assert = require("node:assert/strict");
const {
  deviceMatchesConnection,
  endpointHost,
  serviceMatchesConnection,
} = require("../electron/reconnect-manager.cjs");

test("service matching follows a known device after its endpoint changes", () => {
  const connection = {
    endpoint: "192.168.1.20:5555",
    hardwareSerial: "R5CT123456",
    mdnsServiceName: "adb-R5CT123456",
    mode: "legacy",
  };
  const service = {
    serviceName: "adb-R5CT123456",
    endpoint: "192.168.1.77:5555",
    type: "legacy",
  };
  assert.equal(serviceMatchesConnection(service, connection), true);
});

test("endpointHost extracts the address used to correlate migrated USB records", () => {
  assert.equal(endpointHost("10.5.47.59:5555"), "10.5.47.59");
  assert.equal(endpointHost("[fe80::1234]:5555"), "fe80::1234");
});

test("secure mDNS matching accepts a new random suffix for the same serial", () => {
  const connection = {
    endpoint: "192.168.1.20:37123",
    hardwareSerial: "R5CT123456",
    mdnsServiceName: "adb-R5CT123456-old",
    mode: "tls",
  };
  const service = {
    serviceName: "adb-R5CT123456-new",
    endpoint: "192.168.1.88:40001",
    type: "connect",
  };
  assert.equal(serviceMatchesConnection(service, connection), true);
});

test("connected Wi-Fi devices match by stable hardware serial", () => {
  assert.equal(deviceMatchesConnection({
    connection: "wifi",
    state: "device",
    serial: "192.168.1.77:5555",
    hardwareSerial: "R5CT123456",
  }, {
    endpoint: "192.168.1.20:5555",
    hardwareSerial: "R5CT123456",
  }), true);
});
