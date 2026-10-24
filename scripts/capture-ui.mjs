import fs from "node:fs";
import path from "node:path";

const outputPath = path.resolve(process.argv[2] || "ui-capture.png");
const debuggingPort = Number(process.argv[3] || 9222);
const previewAction = process.argv[4] || null;
const targets = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page" && item.title === "ADB Device Suite");

if (!target?.webSocketDebuggerUrl) {
  throw new Error("ADB Device Suite was not found on the Electron debugging port.");
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

await command("Page.enable");
await command("Page.bringToFront");
let originalWindow = null;
let originalThemePreference = null;
let originalPlatform = null;
let originalLanguagePreference = null;
if (previewAction === "minimum" || previewAction === "minimum-five") {
  const dimensions = await command("Runtime.evaluate", {
    expression: `JSON.stringify({ width: window.outerWidth, height: window.outerHeight })`,
    returnByValue: true,
  });
  originalWindow = JSON.parse(dimensions.result.value);
  await command("Runtime.evaluate", { expression: `window.resizeTo(900, 620)` });
  await new Promise(resolve => setTimeout(resolve, 400));
}
if (previewAction === "pair") {
  await command("Runtime.evaluate", {
    expression: `[...document.querySelectorAll("button")]
      .find(button => button.textContent?.trim() === "Pair device")?.click()`,
  });
}
if (previewAction === "reconnect") {
  await command("Runtime.evaluate", {
    expression: `[...document.querySelectorAll(".connection-card button")]
      .filter(button => button.textContent?.trim() === "Reconnect").at(-1)?.click()`,
  });
}
if (previewAction === "update-check") {
  await command("Runtime.evaluate", {
    expression: `document.querySelector(".app-version")?.click()`,
  });
}
const requestedThemePreference = previewAction === "dark"
  ? "dark"
  : previewAction?.match(/^theme-(light|dark|auto)$/)?.[1] || null;
if (requestedThemePreference) {
  const themeResult = await command("Runtime.evaluate", {
    expression: `document.querySelector(".theme-toggle")?.dataset.themePreference || "light"`,
    returnByValue: true,
  });
  if (previewAction === "dark") originalThemePreference = themeResult.result.value;
  await command("Runtime.evaluate", {
    expression: `(async () => {
      const button = document.querySelector(".theme-toggle");
      for (let index = 0; button && button.dataset.themePreference !== ${JSON.stringify(requestedThemePreference)} && index < 3; index += 1) {
        button.click();
        await new Promise(resolve => setTimeout(resolve, 75));
      }
    })()`,
    awaitPromise: true,
  });
}
if (previewAction === "system-dark") {
  await command("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  });
}
if (previewAction === "mac-statusbar") {
  const platformResult = await command("Runtime.evaluate", {
    expression: `document.documentElement.dataset.platform || "other"`,
    returnByValue: true,
  });
  originalPlatform = platformResult.result.value;
  await command("Runtime.evaluate", {
    expression: `document.documentElement.dataset.platform = "darwin"`,
  });
}
if (previewAction === "five" || previewAction === "minimum-five") {
  await command("Runtime.evaluate", {
    expression: `(() => {
      const list = document.querySelector(".device-list");
      const cards = list ? [...list.children] : [];
      if (!list || !cards.length) return;
      while (list.children.length < 5) {
        list.append(cards[(list.children.length - cards.length) % cards.length].cloneNode(true));
      }
      const count = document.querySelector(".section-heading h2 + span");
      if (count) count.textContent = "5 devices";
    })()`,
  });
}
if (["settings", "settings-open", "settings-toggle", "settings-ja"].includes(previewAction)) {
  await command("Runtime.evaluate", {
    expression: `document.querySelector('.adb-controls .icon-button:last-child')?.click()`,
  });
}
if (previewAction === "settings-ja") {
  const languageResult = await command("Runtime.evaluate", {
    expression: `document.querySelector('.language-setting select')?.value || "system"`,
    returnByValue: true,
  });
  originalLanguagePreference = languageResult.result.value;
  await command("Runtime.evaluate", {
    expression: `(async () => {
      const select = document.querySelector('.language-setting select');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(select, "ja");
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 500));
    })()`,
    awaitPromise: true,
  });
}
if (previewAction === "settings-toggle") {
  await command("Runtime.evaluate", {
    expression: `document.querySelector('.primary-setting .toggle')?.click()`,
  });
}
if (previewAction === "alias-edit" || previewAction === "alias-sample") {
  await command("Runtime.evaluate", {
    expression: `(() => {
      const action = [...document.querySelectorAll(".device-card .alias-action")]
        .find(button => button.textContent?.trim() === "Set alias");
      action?.click();
    })()`,
  });
}
if (previewAction === "alias-sample") {
  await command("Runtime.evaluate", {
    expression: `(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      const input = document.querySelector(".device-card .alias-editor input");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "QA phone");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 100));
      input.closest("form").requestSubmit();
      await new Promise(resolve => setTimeout(resolve, 500));
    })()`,
    awaitPromise: true,
  });
}
await command("Runtime.evaluate", {
  expression: "document.fonts.ready.then(() => new Promise(resolve => setTimeout(resolve, 500)))",
  awaitPromise: true,
});
const inspection = await command("Runtime.evaluate", {
  expression: `JSON.stringify({
    title: document.title,
    bodyText: document.body?.innerText?.slice(0, 500) || "",
    bodyHtml: document.body?.innerHTML?.slice(0, 500) || "",
    hasBridge: Boolean(window.adbSuite),
    theme: document.documentElement.dataset.theme,
    themePreference: document.documentElement.dataset.themePreference,
    platform: document.documentElement.dataset.platform,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    controlsWithoutTooltip: [...document.querySelectorAll("button, a[href], select")]
      .filter(control => !control.getAttribute("title"))
      .map(control => control.getAttribute("aria-label") || control.textContent?.trim() || control.tagName),
    viewportHeight: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
    hasVerticalOverflow: document.documentElement.scrollHeight > window.innerHeight,
    ariaBusy: document.querySelector(".app-shell")?.getAttribute("aria-busy"),
    statusMessage: document.querySelector(".status-message")?.textContent?.trim() || null,
    statusKind: [...(document.querySelector(".status-message")?.classList || [])]
      .find(name => ["idle", "busy", "success", "error"].includes(name)) || null,
    busyCursor: getComputedStyle(document.querySelector(".app-shell")).cursor,
    deviceCount: document.querySelectorAll(".device-card").length,
    connectionIndicatorSizes: [...document.querySelectorAll(".connection-mini")].map(indicator => ({
      indicatorWidth: getComputedStyle(indicator).width,
      indicatorHeight: getComputedStyle(indicator).height,
      iconWidth: getComputedStyle(indicator.querySelector(".ui-icon")).width,
      iconHeight: getComputedStyle(indicator.querySelector(".ui-icon")).height,
    })),
    iconSizes: [...document.querySelectorAll("button .ui-icon")].map(icon => ({
      width: getComputedStyle(icon).width,
      height: getComputedStyle(icon).height,
    })),
    styleSheets: [...document.styleSheets].map(sheet => sheet.href || "inline"),
  })`,
  returnByValue: true,
});
const { data } = await command("Page.captureScreenshot", {
  format: "png",
  fromSurface: false,
  captureBeyondViewport: false,
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, Buffer.from(data, "base64"));
if (previewAction === "pair") {
  await command("Runtime.evaluate", {
    expression: `document.querySelector('button[aria-label="Close"]')?.click()`,
  });
}
if (previewAction === "dark" && originalThemePreference) {
  await command("Runtime.evaluate", {
    expression: `(async () => {
      const button = document.querySelector(".theme-toggle");
      for (let index = 0; button && button.dataset.themePreference !== ${JSON.stringify(originalThemePreference)} && index < 3; index += 1) {
        button.click();
        await new Promise(resolve => setTimeout(resolve, 75));
      }
    })()`,
    awaitPromise: true,
  });
}
if (previewAction === "system-dark") {
  await command("Emulation.setEmulatedMedia", { features: [] });
}
if (previewAction === "mac-statusbar" && originalPlatform) {
  await command("Runtime.evaluate", {
    expression: `document.documentElement.dataset.platform = ${JSON.stringify(originalPlatform)}`,
  });
}
if (previewAction === "settings-toggle") {
  await command("Runtime.evaluate", {
    expression: `(() => {
      document.querySelector('.primary-setting .toggle')?.click();
      return new Promise(resolve => setTimeout(resolve, 400));
    })()`,
    awaitPromise: true,
  });
}
if (previewAction === "settings-ja" && originalLanguagePreference) {
  await command("Runtime.evaluate", {
    expression: `(async () => {
      const select = document.querySelector('.language-setting select');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(select, ${JSON.stringify(originalLanguagePreference)});
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 400));
    })()`,
    awaitPromise: true,
  });
}
if (["settings", "settings-toggle", "settings-ja"].includes(previewAction)) {
  await command("Runtime.evaluate", {
    expression: `document.querySelector('.settings-header .icon-button')?.click()`,
  });
}
if (previewAction === "alias-edit") {
  await command("Runtime.evaluate", {
    expression: `[...document.querySelectorAll(".device-card .alias-action")]
      .find(button => button.textContent?.trim() === "Cancel")?.click()`,
  });
}
if (previewAction === "alias-sample") {
  await command("Runtime.evaluate", {
    expression: `(async () => {
      const identifier = document.querySelector(".device-card .device-id")?.textContent?.trim();
      if (identifier) await window.adbSuite.setDeviceAlias(identifier, "");
      await new Promise(resolve => setTimeout(resolve, 300));
    })()`,
    awaitPromise: true,
  });
}
if (originalWindow) {
  await command("Runtime.evaluate", {
    expression: `window.resizeTo(${originalWindow.width}, ${originalWindow.height})`,
  });
}
socket.close();
console.log(inspection.result?.value || "No page inspection result");
console.log(outputPath);
