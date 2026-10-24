const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { SUPPORTED_LANGUAGES, normalizeLanguage, resolveLanguage } = require("../electron/language.cjs");

test("language resolver handles regional and Chinese script variants", () => {
  assert.equal(normalizeLanguage("es-AR"), "es");
  assert.equal(normalizeLanguage("pt_BR"), "pt");
  assert.equal(normalizeLanguage("zh-Hant-HK"), "zh-TW");
  assert.equal(normalizeLanguage("zh-Hans-SG"), "zh-CN");
  assert.equal(resolveLanguage("system", ["xx-ZZ", "de-DE"]), "de");
  assert.equal(resolveLanguage("system", ["xx-ZZ"]), "en");
  assert.equal(resolveLanguage("ja", ["es-AR"]), "ja");
});

function leafKeys(value, prefix = "") {
  return Object.entries(value).flatMap(([key, child]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === "object" ? leafKeys(child, next) : [next];
  });
}

test("every supported locale has the complete UI catalog", () => {
  const localeRoot = path.join(__dirname, "..", "src", "locales");
  const reference = leafKeys(JSON.parse(fs.readFileSync(path.join(localeRoot, "en", "ui.json"), "utf8"))).sort();
  assert.deepEqual(SUPPORTED_LANGUAGES, ["en", "de", "es", "fr", "hi", "pt", "ru", "ja", "ko", "zh-CN", "zh-TW"]);
  for (const locale of SUPPORTED_LANGUAGES) {
    const catalog = JSON.parse(fs.readFileSync(path.join(localeRoot, locale, "ui.json"), "utf8"));
    const translated = new Set(leafKeys(catalog));
    const missing = reference.filter((key) => !translated.has(key));
    assert.deepEqual(missing, [], `${locale} must contain every English catalog key`);
  }
});
