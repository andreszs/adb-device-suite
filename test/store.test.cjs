const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Store = require("../electron/store.cjs");

test("device aliases persist by stable identifier and can be removed", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "adb-device-suite-store-"));
  try {
    const store = new Store(directory);
    store.setDeviceAlias("R9MNA00VMTJ", "Daily test phone");

    assert.equal(store.get().deviceAliases.R9MNA00VMTJ, "Daily test phone");
    assert.equal(new Store(directory).get().deviceAliases.R9MNA00VMTJ, "Daily test phone");

    store.setDeviceAlias("R9MNA00VMTJ", "   ");
    assert.equal(store.get().deviceAliases.R9MNA00VMTJ, undefined);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("device aliases are trimmed and constrained to 32 characters", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "adb-device-suite-store-"));
  try {
    const store = new Store(directory);
    store.setDeviceAlias("serial", "  Lab phone  ");
    assert.equal(store.get().deviceAliases.serial, "Lab phone");
    assert.throws(() => store.setDeviceAlias("serial", "x".repeat(33)), /up to 32 characters/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("theme preference persists and invalid values fall back to light", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "adb-device-suite-store-"));
  try {
    const store = new Store(directory);
    assert.equal(store.get().themePreference, "light");

    store.setThemePreference("auto");
    assert.equal(new Store(directory).get().themePreference, "auto");
    assert.throws(() => store.setThemePreference("sepia"), /light, dark or auto/);

    const stored = JSON.parse(fs.readFileSync(path.join(directory, "settings.json"), "utf8"));
    stored.themePreference = "sepia";
    fs.writeFileSync(path.join(directory, "settings.json"), JSON.stringify(stored));
    assert.equal(new Store(directory).get().themePreference, "light");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("language preference defaults to system and persists supported choices", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "adb-device-suite-store-"));
  try {
    const store = new Store(directory);
    assert.equal(store.get().languagePreference, "system");
    store.setLanguagePreference("zh-TW");
    assert.equal(new Store(directory).get().languagePreference, "zh-TW");
    assert.throws(() => store.setLanguagePreference("xx"), /Unsupported language/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("charging animation defaults to enabled and persists its preference", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "adb-device-suite-store-"));
  try {
    const store = new Store(directory);
    assert.equal(store.get().chargingAnimation, true);
    store.setChargingAnimation(false);
    assert.equal(new Store(directory).get().chargingAnimation, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
