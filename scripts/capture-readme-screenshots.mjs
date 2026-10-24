import fs from "node:fs/promises";
import path from "node:path";

const port = process.env.ADB_SUITE_DEBUG_PORT || "9222";
const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const page = pages.find((candidate) => candidate.title === "ADB Device Suite");

if (!page?.webSocketDebuggerUrl) {
  throw new Error(`ADB Device Suite was not found on the local debugging port ${port}.`);
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let commandId = 0;

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
    const id = ++commandId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function capture(destination) {
  const result = await command("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await fs.writeFile(destination, Buffer.from(result.data, "base64"));
}

async function anonymizeVisibleData() {
  await evaluate(`(() => {
    const replacements = new Map([
      ['R9MNA00VMTJ', 'RF8N20ABCDE'],
      ['ce071717857a9b3003', 'R58M123ABCD'],
      ['192.168.100.87', '192.168.1.42'],
      ['192.168.100.3', '192.168.1.73'],
      ['C:\\\\Users\\\\Andres', 'C:\\\\Users\\\\developer'],
    ]);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      let value = walker.currentNode.nodeValue;
      for (const [source, replacement] of replacements) value = value.replaceAll(source, replacement);
      walker.currentNode.nodeValue = value;
    }
  })()`);
}

const outputDirectory = path.resolve("docs", "screenshots");
await fs.mkdir(outputDirectory, { recursive: true });
await command("Page.bringToFront");

await evaluate(`document.querySelector('[role="dialog"] button[aria-label]')?.click()`);
await new Promise((resolve) => setTimeout(resolve, 300));
await anonymizeVisibleData();
await capture(path.join(outputDirectory, "main-window.png"));

const settingsOpened = await evaluate(`(() => {
  const button = document.querySelector('.device-section-tools .icon-button:last-of-type, .setup-toolbar .icon-button:last-of-type');
  if (!button) return false;
  button.click();
  return true;
})()`);

if (!settingsOpened) throw new Error("The Settings button was not found.");
await new Promise((resolve) => setTimeout(resolve, 300));
await anonymizeVisibleData();
await capture(path.join(outputDirectory, "settings-dialog.png"));

socket.close();
console.log(`Saved README screenshots to ${outputDirectory}`);
