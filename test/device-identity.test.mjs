import assert from "node:assert/strict";
import test from "node:test";
import { mdnsServiceMatchesDevice, savedConnectionMatchesDevice } from "../src/device-identity.mjs";

const saved = {
  id: "serial:R9MNA00VMTJ",
  endpoint: "10.5.47.19:5555",
  hardwareSerial: "R9MNA00VMTJ",
};

test("a saved connection matches its physical USB device despite IP changes", () => {
  const usbDevice = {
    serial: "R9MNA00VMTJ",
    hardwareSerial: "r9mna00vmtj",
    connection: "usb",
  };
  assert.equal(savedConnectionMatchesDevice(saved, usbDevice), true);
});

test("devices with the same model are not merged without a matching serial", () => {
  const otherDevice = {
    serial: "OTHER-SERIAL",
    hardwareSerial: "OTHER-SERIAL",
    connection: "usb",
    model: "SM-A107M",
  };
  assert.equal(savedConnectionMatchesDevice(saved, otherDevice), false);
});

test("legacy records can still match an active Wi-Fi endpoint", () => {
  const legacySaved = { id: "endpoint:10.5.47.19:5555", endpoint: "10.5.47.19:5555", hardwareSerial: null };
  const wifiDevice = { serial: "10.5.47.19:5555", hardwareSerial: null, connection: "wifi" };
  assert.equal(savedConnectionMatchesDevice(legacySaved, wifiDevice), true);
});

test("mDNS announcements for an already connected Wi-Fi endpoint are hidden", () => {
  const service = {
    serviceName: "adb-R9MNA00VMTJ",
    endpoint: "192.168.100.87:5555",
  };
  const wifiDevice = {
    serial: "192.168.100.87:5555",
    hardwareSerial: "R9MNA00VMTJ",
    connection: "wifi",
  };
  assert.equal(mdnsServiceMatchesDevice(service, wifiDevice), true);
});

test("mDNS announcements match a connected device across LAN and VPN endpoints", () => {
  const service = {
    serviceName: "adb-ce071717857a9b3003-random",
    endpoint: "192.168.100.3:5555",
  };
  const wifiDevice = {
    serial: "10.5.47.59:5555",
    hardwareSerial: "CE071717857A9B3003",
    connection: "wifi",
  };
  assert.equal(mdnsServiceMatchesDevice(service, wifiDevice), true);
});

test("an mDNS service remains actionable while the same device is connected only by USB", () => {
  const service = {
    serviceName: "adb-R9MNA00VMTJ",
    endpoint: "192.168.100.87:5555",
  };
  const usbDevice = {
    serial: "R9MNA00VMTJ",
    hardwareSerial: "R9MNA00VMTJ",
    connection: "usb",
  };
  assert.equal(mdnsServiceMatchesDevice(service, usbDevice), false);
});
