const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appSource = fs.readFileSync(path.join(__dirname, "..", "src", "App.tsx"), "utf8");

test("QR pairing keeps modal controls interactive while waiting", () => {
  const qrHandler = appSource.match(/async function pairByQr[\s\S]*?async function chooseAdb/)?.[0] || "";
  assert.ok(qrHandler, "pairByQr handler should exist");
  assert.doesNotMatch(qrHandler, /setBusy\(/);
  assert.match(appSource, /busy && !busy\.startsWith\("modal:"\)/);
});
