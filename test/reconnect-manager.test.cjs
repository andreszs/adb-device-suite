const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ReconnectManager,
  deviceMatchesConnection,
  endpointHost,
  isTlsConnection,
  reconnectCandidates,
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

test("stable serial matching repairs a connection saved with the wrong legacy mode", () => {
  const connection = {
    endpoint: "adb-RF8M61577AZ-old._adb-tls-connect._tcp",
    hardwareSerial: "RF8M61577AZ",
    mdnsServiceName: "adb-RF8M61577AZ-old",
    mode: "legacy",
  };
  const service = {
    serviceName: "adb-RF8M61577AZ-new",
    endpoint: "192.168.0.6:41521",
    type: "connect",
  };
  assert.equal(serviceMatchesConnection(service, connection), true);
  assert.equal(isTlsConnection(connection), true);
});

test("reconnect candidates prefer current mDNS endpoint before the saved IP", () => {
  const connection = {
    endpoint: "192.168.0.6:37123",
    hardwareSerial: "RF8M61577AZ",
    mdnsServiceName: "adb-RF8M61577AZ-old",
    mode: "tls",
  };
  const snapshot = {
    services: [{
      serviceName: "adb-RF8M61577AZ-new",
      endpoint: "192.168.0.44:41521",
      type: "connect",
    }],
  };
  assert.deepEqual(reconnectCandidates(connection, snapshot).map(({ endpoint, source }) => ({ endpoint, source })), [
    { endpoint: "192.168.0.44:41521", source: "mdns" },
    { endpoint: "192.168.0.6:37123", source: "saved" },
  ]);
});

test("manual reconnect falls back to the saved IP when the mDNS endpoint fails", async () => {
  let connection = {
    id: "serial:RF8M61577AZ",
    endpoint: "192.168.0.6:37123",
    hardwareSerial: "RF8M61577AZ",
    mdnsServiceName: "adb-RF8M61577AZ-old",
    mode: "tls",
    autoReconnect: true,
    manuallyDisconnected: false,
  };
  const attempts = [];
  const store = {
    get: () => ({ autoReconnect: true, savedConnections: [structuredClone(connection)] }),
    rememberConnection: (endpoint, metadata) => {
      connection = { ...connection, ...metadata, endpoint };
    },
  };
  const adbService = {
    connect: async (endpoint) => {
      attempts.push(endpoint);
      if (attempts.length === 1) throw new Error("mDNS endpoint unavailable");
      return { endpoint, verified: true, message: `Connected to ${endpoint}` };
    },
  };
  const manager = new ReconnectManager(adbService, store);
  const result = await manager.reconnect(connection.id, {
    devices: [],
    services: [{
      serviceName: "adb-RF8M61577AZ-new",
      endpoint: "192.168.0.44:41521",
      type: "connect",
    }],
  });

  assert.deepEqual(attempts, ["192.168.0.44:41521", "192.168.0.6:37123"]);
  assert.equal(result.connectionSource, "saved");
  assert.equal(connection.endpoint, "192.168.0.6:37123");
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
