const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function openingTags(source, tagName) {
  const tags = [];
  let cursor = 0;
  while ((cursor = source.indexOf(`<${tagName}`, cursor)) !== -1) {
    const boundary = source[cursor + tagName.length + 1];
    if (boundary && /[A-Za-z0-9:_-]/.test(boundary)) {
      cursor += tagName.length + 1;
      continue;
    }
    const start = cursor;
    let braces = 0;
    let quote = null;
    let escaped = false;
    for (; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") quote = character;
      else if (character === "{") braces += 1;
      else if (character === "}") braces -= 1;
      else if (character === ">" && braces === 0) {
        tags.push({ start, source: source.slice(start, cursor + 1) });
        cursor += 1;
        break;
      }
    }
  }
  return tags;
}

test("every button and link declares a tooltip", () => {
  const filePath = path.join(__dirname, "..", "src", "App.tsx");
  const sourceText = fs.readFileSync(filePath, "utf8");
  const missing = [];

  for (const tagName of ["button", "a"]) {
    for (const tag of openingTags(sourceText, tagName)) {
      if (!/\btitle\s*=/.test(tag.source)) {
        const line = sourceText.slice(0, tag.start).split("\n").length;
        missing.push(`${tagName} at line ${line}`);
      }
    }
  }

  assert.deepEqual(missing, []);
});
