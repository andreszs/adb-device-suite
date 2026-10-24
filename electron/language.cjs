const SUPPORTED_LANGUAGES = Object.freeze([
  "en", "de", "es", "fr", "hi", "pt", "ru", "ja", "ko", "zh-CN", "zh-TW",
]);

function normalizeLanguage(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replaceAll("_", "-");
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  if (lower === "zh-tw" || lower === "zh-hk" || lower === "zh-mo" || lower.startsWith("zh-hant")) return "zh-TW";
  if (lower === "zh" || lower === "zh-cn" || lower === "zh-sg" || lower.startsWith("zh-hans")) return "zh-CN";
  const base = lower.split("-")[0];
  return SUPPORTED_LANGUAGES.includes(base) ? base : null;
}

function normalizeLanguagePreference(value) {
  return value === "system" ? "system" : normalizeLanguage(value) || "system";
}

function resolveLanguage(preference, preferredSystemLanguages = []) {
  const normalizedPreference = normalizeLanguagePreference(preference);
  if (normalizedPreference !== "system") return normalizedPreference;
  for (const language of preferredSystemLanguages) {
    const supported = normalizeLanguage(language);
    if (supported) return supported;
  }
  return "en";
}

module.exports = { SUPPORTED_LANGUAGES, normalizeLanguage, normalizeLanguagePreference, resolveLanguage };
