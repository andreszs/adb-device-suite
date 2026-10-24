const assert = require("node:assert/strict");
const test = require("node:test");
const { checkForUpdates, compareVersions, parseVersion } = require("../electron/update-service.cjs");

test("semantic versions accept a v prefix and compare prereleases", () => {
  assert.deepEqual(parseVersion("v1.2.3"), { major: 1, minor: 2, patch: 3, prerelease: [] });
  assert.equal(compareVersions("1.2.4", "1.2.3"), 1);
  assert.equal(compareVersions("1.2.3-beta.2", "1.2.3-beta.1"), 1);
  assert.equal(compareVersions("1.2.3-beta.1", "1.2.3"), -1);
  assert.equal(compareVersions("invalid", "1.2.3"), null);
});

test("a newer published release exposes its GitHub download page", async () => {
  const result = await checkForUpdates("0.1.0", {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        tag_name: "v0.2.0",
        html_url: "https://github.com/andreszs/adb-device-suite/releases/tag/v0.2.0",
      }),
    }),
  });
  assert.equal(result.status, "available");
  assert.equal(result.latestVersion, "0.2.0");
  assert.match(result.releaseUrl, /v0\.2\.0$/);
});

test("a repository without releases reports that the check is unavailable", async () => {
  const result = await checkForUpdates("0.1.0", {
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.deepEqual(result, {
    status: "unavailable",
    currentVersion: "0.1.0",
    latestVersion: null,
    releaseUrl: null,
    message: "Could not check whether a newer version is available.",
  });
});
