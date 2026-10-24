export const APP_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "de", name: "Deutsch" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "hi", name: "हिन्दी" },
  { code: "pt", name: "Português" },
  { code: "ru", name: "Русский" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "zh-CN", name: "简体中文" },
  { code: "zh-TW", name: "繁體中文" },
] as const satisfies ReadonlyArray<{ code: AppLanguage; name: string }>;

export function initialLanguage(): AppLanguage {
  const requested = new URLSearchParams(window.location.search).get("locale");
  return APP_LANGUAGES.some(({ code }) => code === requested) ? requested as AppLanguage : "en";
}

export function systemLanguage(): AppLanguage {
  const requested = new URLSearchParams(window.location.search).get("systemLocale");
  return APP_LANGUAGES.some(({ code }) => code === requested) ? requested as AppLanguage : "en";
}
