const RELEASES_ENDPOINT = "https://api.github.com/repos/andreszs/adb-device-suite/releases/latest";
const RELEASES_PAGE = "https://github.com/andreszs/adb-device-suite/releases";

function parseVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrerelease(left, right) {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    if (left[index] === right[index]) continue;
    const leftNumber = /^\d+$/.test(left[index]) ? Number(left[index]) : null;
    const rightNumber = /^\d+$/.test(right[index]) ? Number(right[index]) : null;
    if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber);
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return left[index].localeCompare(right[index]);
  }
  return 0;
}

function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  if (!left || !right) return null;
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return Math.sign(left[key] - right[key]);
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function unavailable(currentVersion) {
  return {
    status: "unavailable",
    currentVersion,
    latestVersion: null,
    releaseUrl: null,
    message: "Could not check whether a newer version is available.",
  };
}

async function checkForUpdates(currentVersion, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 8_000);

  try {
    const response = await fetchImpl(options.endpoint || RELEASES_ENDPOINT, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `ADB-Device-Suite/${currentVersion}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: controller.signal,
    });
    if (!response.ok) return unavailable(currentVersion);

    const release = await response.json();
    const latestVersion = String(release.tag_name || "").replace(/^v/i, "");
    const comparison = compareVersions(latestVersion, currentVersion);
    if (comparison === null) return unavailable(currentVersion);

    const releaseUrl = typeof release.html_url === "string" && release.html_url.startsWith(`${RELEASES_PAGE}/`)
      ? release.html_url
      : RELEASES_PAGE;
    if (comparison > 0) {
      return {
        status: "available",
        currentVersion,
        latestVersion,
        releaseUrl,
        message: `Version ${latestVersion} is available.`,
      };
    }
    return {
      status: "current",
      currentVersion,
      latestVersion,
      releaseUrl,
      message: "ADB Device Suite is up to date.",
    };
  } catch {
    return unavailable(currentVersion);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { checkForUpdates, compareVersions, parseVersion };
