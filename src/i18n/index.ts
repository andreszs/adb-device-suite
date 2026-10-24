import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import de from "../locales/de/ui.json";
import en from "../locales/en/ui.json";
import es from "../locales/es/ui.json";
import fr from "../locales/fr/ui.json";
import hi from "../locales/hi/ui.json";
import ja from "../locales/ja/ui.json";
import ko from "../locales/ko/ui.json";
import pt from "../locales/pt/ui.json";
import ru from "../locales/ru/ui.json";
import zhCN from "../locales/zh-CN/ui.json";
import zhTW from "../locales/zh-TW/ui.json";
import { initialLanguage } from "./languages";

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en }, de: { translation: de }, es: { translation: es },
    fr: { translation: fr }, hi: { translation: hi }, pt: { translation: pt },
    ru: { translation: ru }, ja: { translation: ja }, ko: { translation: ko },
    "zh-CN": { translation: zhCN }, "zh-TW": { translation: zhTW },
  },
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});

export default i18n;
