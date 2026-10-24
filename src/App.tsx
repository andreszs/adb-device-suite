import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  MdBrightnessAuto,
  MdCheckCircle,
  MdClose,
  MdDarkMode,
  MdDeleteOutline,
  MdErrorOutline,
  MdHourglassTop,
  MdLightMode,
  MdLink,
  MdPhoneAndroid,
  MdRefresh,
  MdSettings,
  MdSystemUpdateAlt,
  MdUsb,
  MdWifi,
} from "react-icons/md";
import { FaGithub } from "react-icons/fa6";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { APP_LANGUAGES, systemLanguage } from "./i18n/languages";
import { mdnsServiceMatchesDevice, savedConnectionMatchesDevice } from "./device-identity.mjs";

const EMPTY_SNAPSHOT: AdbSnapshot = {
  adb: { available: false, path: null, version: null, error: null },
  devices: [],
  services: [],
  refreshedAt: new Date(0).toISOString(),
};

const EMPTY_SETTINGS: AppSettings = { adbPath: null, autoReconnect: true, deviceAliases: {}, savedConnections: [], themePreference: "light", languagePreference: "system" };

type ModalMode = "connect" | "pair" | null;
type Toast = { type: "success" | "error"; message: string } | null;
type ResolvedTheme = "light" | "dark";
type ThemePreference = ResolvedTheme | "auto";
type DeviceGroup = {
  key: string;
  identifier: string;
  devices: AdbDevice[];
  primary: AdbDevice;
  usb: AdbDevice | null;
  wifi: AdbDevice | null;
};

const Icons = {
  Refresh: () => <MdRefresh aria-hidden="true" className="ui-icon" />,
  Usb: () => <MdUsb aria-hidden="true" className="ui-icon" />,
  Wifi: () => <MdWifi aria-hidden="true" className="ui-icon" />,
  Link: () => <MdLink aria-hidden="true" className="ui-icon" />,
  Settings: () => <MdSettings aria-hidden="true" className="ui-icon" />,
  Phone: () => <MdPhoneAndroid aria-hidden="true" className="ui-icon phone-glyph" />,
  Close: () => <MdClose aria-hidden="true" className="ui-icon" />,
  Trash: () => <MdDeleteOutline aria-hidden="true" className="ui-icon" />,
  LightMode: () => <MdLightMode aria-hidden="true" className="ui-icon" />,
  DarkMode: () => <MdDarkMode aria-hidden="true" className="ui-icon" />,
  AutoTheme: () => <MdBrightnessAuto aria-hidden="true" className="ui-icon" />,
  Hourglass: () => <MdHourglassTop aria-hidden="true" className="ui-icon" />,
  Success: () => <MdCheckCircle aria-hidden="true" className="ui-icon" />,
  Error: () => <MdErrorOutline aria-hidden="true" className="ui-icon" />,
  Update: () => <MdSystemUpdateAlt aria-hidden="true" className="ui-icon" />,
};

const THEME_STORAGE_KEY = "adb-device-suite:theme";

function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "dark" || stored === "auto" ? stored : "light";
  } catch {
    return "light";
  }
}

function readSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function nextThemePreference(theme: ThemePreference): ThemePreference {
  if (theme === "light") return "dark";
  if (theme === "dark") return "auto";
  return "light";
}

function themeName(theme: ThemePreference, t: TFunction) {
  return t(`theme.${theme}`);
}

function busyMessage(busy: string, t: TFunction) {
  if (busy.startsWith("connect:")) return t("busy.connect", { endpoint: busy.slice("connect:".length) });
  if (busy.startsWith("disconnect:")) return t("busy.disconnect");
  if (busy.startsWith("wifi:")) return t("busy.wifi");
  if (busy.startsWith("alias:")) return t("busy.alias");
  if (busy.startsWith("settings:")) return t("busy.settings");
  if (busy === "restart") return t("busy.restart");
  if (busy === "choose-adb") return t("busy.chooseAdb");
  if (busy === "check-updates") return t("busy.updates");
  if (busy.startsWith("modal:")) return t("busy.adb");
  return t("busy.default");
}

function friendlyError(error: unknown, t: TFunction) {
  const raw = error instanceof Error ? error.message : String(error);
  const clean = raw.replace(/^Error invoking remote method '[^']+': Error:\s*/, "");
  const known: Record<string, string> = {
    "Enter a valid IP address or hostname and port.": "errors.invalidEndpoint",
    "The port must be between 1 and 65535.": "errors.invalidPort",
    "The pairing code must contain six digits.": "errors.invalidCode",
    "Pairing failed.": "errors.pairFailed",
    "Invalid device.": "errors.invalidDevice",
    "The USB device is no longer connected.": "errors.usbDisconnected",
    "Authorize USB debugging on the device.": "errors.authorize",
    "Could not determine the Wi-Fi address.": "errors.noWifiAddress",
    "The selected file is not a working ADB executable.": "errors.invalidAdb",
    "A valid device identifier is required.": "errors.invalidAlias",
    "The alias must be text.": "errors.aliasText",
    "Aliases can contain up to 32 characters.": "errors.aliasLong",
  };
  return known[clean] ? t(known[clean]) : clean || t("errors.unknown");
}

function formatDeviceName(device: AdbDevice, t: TFunction) {
  const pieces = [device.manufacturer, device.model || device.device]
    .filter(Boolean)
    .map((part) => String(part).trim());
  return pieces.filter((part, index) => index === 0 || part.toLowerCase() !== pieces[0]?.toLowerCase()).join(" ") || t("common.androidDevice");
}

function stateLabel(state: string, t: TFunction) {
  if (state === "device") return t("common.connected");
  if (state === "unauthorized") return t("device.authorization");
  if (state === "offline") return t("device.offline");
  return state;
}

function actionMessage(key: string, result: ActionResult, t: TFunction) {
  if (key.startsWith("connect:")) return t("status.connectedTo", { endpoint: result.endpoint || key.slice(8) });
  if (key.startsWith("disconnect:")) return t("status.disconnected");
  if (key.startsWith("wifi:")) return t("status.wifiEnabled");
  if (key === "restart") return t("status.serverRestarted");
  if (key === "modal:pair") return t("status.paired");
  if (key === "modal:connect") return t("status.connectedTo", { endpoint: result.endpoint || "ADB" });
  return result.message;
}

function groupDevices(devices: AdbDevice[]): DeviceGroup[] {
  const grouped = new Map<string, AdbDevice[]>();
  for (const device of devices) {
    const hardwareSerial = device.hardwareSerial?.trim();
    const key = hardwareSerial
      ? `serial:${hardwareSerial}`
      : `transport:${device.connection}:${device.serial}`;
    const existing = grouped.get(key);
    if (existing) existing.push(device);
    else grouped.set(key, [device]);
  }

  return [...grouped.entries()].map(([key, transports]) => {
    const usb = transports.find((device) => device.connection === "usb" && device.state === "device")
      || transports.find((device) => device.connection === "usb")
      || null;
    const wifi = transports.find((device) => device.connection === "wifi" && device.state === "device")
      || transports.find((device) => device.connection === "wifi")
      || null;
    const primary = transports.find((device) => device.model || device.manufacturer)
      || usb
      || wifi
      || transports[0];
    const identifier = transports.find((device) => device.hardwareSerial)?.hardwareSerial
      || primary.serial;
    return { key, identifier, devices: transports, primary, usb, wifi };
  });
}

function DeviceCard({
  alias,
  busy,
  group,
  onEnableWireless,
  onDisconnect,
  onSetAlias,
}: {
  alias: string | null;
  busy: string | null;
  group: DeviceGroup;
  onEnableWireless: (serial: string) => void;
  onDisconnect: (device: AdbDevice) => void;
  onSetAlias: (identifier: string, alias: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const { devices, identifier, primary, usb, wifi } = group;
  const ready = devices.some((device) => device.state === "device");
  const statusDevice = devices.find((device) => device.state === "device")
    || devices.find((device) => device.state === "unauthorized")
    || devices[0];
  const modelName = formatDeviceName(primary, t);
  const androidVersion = devices.find((device) => device.androidVersion)?.androidVersion;
  const ipAddress = wifi?.ipAddress || devices.find((device) => device.ipAddress)?.ipAddress;
  const ipAddresses = [...new Set(devices.flatMap((device) => device.ipAddresses || (device.ipAddress ? [device.ipAddress] : [])))];
  const connectionLabel = usb && wifi ? "USB + Wi-Fi" : usb ? "USB" : "Wi-Fi";
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasDraft, setAliasDraft] = useState(alias || "");

  useEffect(() => {
    if (!editingAlias) setAliasDraft(alias || "");
  }, [alias, editingAlias]);

  async function submitAlias(event: FormEvent) {
    event.preventDefault();
    if (await onSetAlias(identifier, aliasDraft)) setEditingAlias(false);
  }

  function cancelAlias() {
    setAliasDraft(alias || "");
    setEditingAlias(false);
  }

  return (
    <article className="device-card">
      <div className={`device-icon ${wifi ? "wifi" : "usb"}`}>
        <Icons.Phone />
        <span className="connection-minis" aria-hidden="true">
          {usb && <span className="connection-mini usb"><Icons.Usb /></span>}
          {wifi && <span className="connection-mini wifi"><Icons.Wifi /></span>}
        </span>
      </div>
      <div className="device-main">
        <div className="device-title-row">
          {editingAlias ? (
            <form className="alias-editor" onSubmit={submitAlias}>
              <input
                aria-label={t("device.aliasFor", { name: modelName })}
                autoFocus
                maxLength={32}
                placeholder={t("device.aliasPlaceholder")}
                value={aliasDraft}
                onChange={(event) => setAliasDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") cancelAlias();
                }}
              />
              <button className="alias-action" disabled={busy !== null} title={t("device.saveAlias", { name: modelName })} type="submit">{t("common.save")}</button>
              <button className="alias-action muted" disabled={busy !== null} onClick={cancelAlias} title={t("device.cancelAlias")} type="button">{t("common.cancel")}</button>
            </form>
          ) : (
            <>
              <h3 title={alias ? `${alias} · ${modelName}` : modelName}>
                {alias && <><span className="device-alias">{alias}</span><span className="title-separator">·</span></>}
                <span className={alias ? "device-model secondary" : "device-model"}>{modelName}</span>
              </h3>
              <button
                className="alias-action"
                onClick={() => setEditingAlias(true)}
                title={alias ? t("device.editAlias", { name: modelName }) : t("device.setAlias", { name: modelName })}
                type="button"
              >{alias ? t("device.editAliasText") : t("device.setAliasText")}</button>
            </>
          )}
          <span className={`status-pill ${ready ? "online" : "warning"}`}>
            <span className="status-dot" />{stateLabel(ready ? "device" : statusDevice.state, t)}
          </span>
        </div>
        <div className="device-details">
          <span>{connectionLabel}</span>
          {androidVersion && <><i /> <span>Android {androidVersion}</span></>}
          {ipAddress && <><i /> <span title={ipAddresses.join(" · ")}>{ipAddress}</span></>}
          <i /> <code className="device-id">{identifier}</code>
        </div>
      </div>
      <div className="device-actions">
        {wifi ? (
          <button
            className="button ghost-danger"
            disabled={busy !== null}
            onClick={() => onDisconnect(wifi)}
            title={t("device.disconnectTooltip", { name: alias || modelName })}
          >
            {t("device.disconnect")}
          </button>
        ) : usb ? (
          <button
            className="button secondary has-icon"
            disabled={!ready || busy !== null}
            onClick={() => onEnableWireless(usb.serial)}
            title={t("device.enableTooltip", { name: alias || modelName })}
          >
            <Icons.Wifi /> {busy === `wifi:${usb.serial}` ? t("device.connecting") : t("device.useWifi")}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function ConnectionModal({
  mode,
  initialEndpoint,
  busy,
  onClose,
  onSubmit,
}: {
  mode: Exclude<ModalMode, null>;
  initialEndpoint: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (endpoint: string, code?: string) => void;
}) {
  const { t } = useTranslation();
  const [endpoint, setEndpoint] = useState(initialEndpoint);
  const [code, setCode] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(endpoint.trim(), mode === "pair" ? code.trim() : undefined);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal" aria-modal="true" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="eyebrow">{t("connection.wirelessDebugging")}</span>
            <h2>{mode === "pair" ? t("connection.pairDevice") : t("connection.connectManually")}</h2>
          </div>
          <button aria-label={t("common.close")} className="icon-button" onClick={onClose} title={t("connection.closeDialog")}><Icons.Close /></button>
        </div>
        <form onSubmit={submit}>
          <label>
            {t("connection.endpoint")}
            <input
              autoFocus
              placeholder="192.168.1.20:37123"
              required
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
            />
          </label>
          {mode === "pair" && (
            <label>
              {t("connection.pairCode")}
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]{6}"
                placeholder="123456"
                required
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              />
            </label>
          )}
          <p className="form-help">
            {mode === "pair"
              ? t("connection.pairHelp")
              : t("connection.connectHelp")}
          </p>
          <div className="modal-actions">
            <button className="button text" onClick={onClose} title={t("connection.cancelTooltip")} type="button">{t("common.cancel")}</button>
            <button className="button primary" disabled={busy} title={mode === "pair" ? t("connection.pairTooltip") : t("connection.connectTooltip")} type="submit">
              {busy ? t("common.working") : mode === "pair" ? t("connection.pairButton") : t("common.connect")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function reconnectLabel(connection: SavedConnection, t: TFunction) {
  const status = connection.reconnect?.status;
  if (status === "connected") return t("common.connected");
  if (status === "reconnecting") return t("reconnect.reconnecting");
  if (status === "needs-usb") return t("reconnect.needsUsb");
  if (status === "paused") return t("reconnect.paused");
  return t("reconnect.waiting");
}

function Toggle({ checked, disabled = false, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? "on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      title={label}
      type="button"
    >
      <span />
    </button>
  );
}

function AdbControls({
  adb,
  loading,
  onRefresh,
  onSettings,
}: {
  adb: AdbSnapshot["adb"];
  loading: boolean;
  onRefresh: () => void;
  onSettings: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="adb-controls">
      <div className={`adb-badge ${adb.available ? "ready" : "missing"}`}>
        <span className="status-dot" />
        <div>
          <strong>{adb.available ? `ADB ${adb.version}` : t("adb.notFound")}</strong>
          {!adb.available && <span>{t("adb.required")}</span>}
        </div>
      </div>
      <button aria-label={t("adb.refresh")} className={`icon-button refresh ${loading ? "spinning" : ""}`} onClick={onRefresh} title={t("adb.refreshTooltip")}><Icons.Refresh /></button>
      <button aria-label={t("adb.settings")} className="icon-button" onClick={onSettings} title={t("adb.settings")}><Icons.Settings /></button>
    </div>
  );
}

function SettingsModal({
  adbPath,
  busy,
  settings,
  onChooseAdb,
  onClose,
  onLanguageChange,
  onToggleConnection,
  onToggleGlobal,
}: {
  adbPath: string | null;
  busy: boolean;
  settings: AppSettings;
  onChooseAdb: () => void;
  onClose: () => void;
  onLanguageChange: (language: LanguagePreference) => void;
  onToggleConnection: (id: string, enabled: boolean) => void;
  onToggleGlobal: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const systemLanguageName = APP_LANGUAGES.find(({ code }) => code === systemLanguage())?.name || "English";
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal settings-modal" aria-modal="true" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header settings-header">
          <div><span className="eyebrow">{t("settings.application")}</span><h2>{t("settings.title")}</h2></div>
          <button aria-label={t("settings.close")} className="icon-button" onClick={onClose} title={t("settings.close")}><Icons.Close /></button>
        </div>

        <div className="setting-row primary-setting">
          <div><strong>{t("settings.autoReconnect")}</strong><span>{t("settings.autoReconnectDescription")}</span></div>
          <Toggle checked={settings.autoReconnect} label={t("settings.autoReconnectToggle")} onChange={onToggleGlobal} />
        </div>

        <div className="setting-row language-setting">
          <div><strong>{t("settings.language")}</strong><span>{t("settings.languageDescription")}</span></div>
          <select
            aria-label={t("settings.languageTooltip")}
            disabled={busy}
            onChange={(event) => onLanguageChange(event.target.value as LanguagePreference)}
            title={t("settings.languageTooltip")}
            value={settings.languagePreference}
          >
            <option value="system">{t("settings.systemDefault", { language: systemLanguageName })}</option>
            {APP_LANGUAGES.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
          </select>
        </div>

        {settings.savedConnections.length > 0 && (
          <div className="known-device-settings">
            <span className="settings-caption">{t("settings.knownDevices")}</span>
            {settings.savedConnections.map((connection) => {
              const identifier = connection.hardwareSerial || connection.endpoint;
              const alias = settings.deviceAliases[identifier] || null;
              return (
                <div className="setting-device" key={connection.id}>
                  <div>
                    <strong>{alias ? `${alias} · ${connection.label || t("common.androidDevice")}` : connection.label || t("common.androidDevice")}</strong>
                    <span>{connection.endpoint} · {reconnectLabel(connection, t)}</span>
                  </div>
                  <Toggle
                    checked={connection.autoReconnect && !connection.manuallyDisconnected}
                    disabled={!settings.autoReconnect}
                    label={t("settings.deviceToggle", { name: connection.label || connection.endpoint })}
                    onChange={(enabled) => onToggleConnection(connection.id, enabled)}
                  />
                </div>
              );
            })}
          </div>
        )}

        <div className="setting-row adb-setting">
          <div><strong>{t("settings.adbExecutable")}</strong><code title={settings.adbPath || adbPath || undefined}>{settings.adbPath || adbPath || t("settings.notDetected")}</code></div>
          <button className="button secondary small" disabled={busy} onClick={onChooseAdb} title={t("settings.adbTooltip")}>{t("common.change")}</button>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const { i18n, t } = useTranslation();
  const [appVersion, setAppVersion] = useState("");
  const [availableUpdate, setAvailableUpdate] = useState<UpdateCheckResult | null>(null);
  const [snapshot, setSnapshot] = useState<AdbSnapshot>(EMPTY_SNAPSHOT);
  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS);
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(readSystemTheme);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [modal, setModal] = useState<ModalMode>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modalEndpoint, setModalEndpoint] = useState("");

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await window.adbSuite.getSnapshot());
    } catch (error) {
      setToast({ type: "error", message: friendlyError(error, t) });
    } finally {
      setLoading(false);
    }
  }, [t]);

  const resolvedTheme = themePreference === "auto" ? systemTheme : themePreference;
  const upcomingTheme = nextThemePreference(themePreference);
  const themeTooltip = themePreference === "auto"
    ? t("theme.autoTooltip", { current: themeName(resolvedTheme, t) })
    : t("theme.tooltip", { current: themeName(themePreference, t), next: themeName(upcomingTheme, t) });

  useEffect(() => {
    const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? "dark" : "light");
    };
    setSystemTheme(systemThemeQuery.matches ? "dark" : "light");
    systemThemeQuery.addEventListener("change", updateSystemTheme);
    return () => systemThemeQuery.removeEventListener("change", updateSystemTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themePreference = themePreference;
    document.documentElement.style.colorScheme = resolvedTheme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", resolvedTheme === "dark" ? "#0b1020" : "#ffffff");
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    } catch {
      // The selected theme still applies for this session if storage is unavailable.
    }
  }, [resolvedTheme, themePreference]);

  useEffect(() => {
    Promise.all([window.adbSuite.getSnapshot(), window.adbSuite.getSettings(), window.adbSuite.getAppVersion()])
      .then(([nextSnapshot, nextSettings, nextAppVersion]) => {
        setSnapshot(nextSnapshot);
        setSettings(nextSettings);
        setAppVersion(nextAppVersion);
        setThemePreference(nextSettings.themePreference);
      })
      .catch((error) => setToast({ type: "error", message: friendlyError(error, t) }))
      .finally(() => setLoading(false));
    const removeSnapshotListener = window.adbSuite.onSnapshot(setSnapshot);
    const removeSettingsListener = window.adbSuite.onSettings((nextSettings) => {
      setSettings(nextSettings);
      setThemePreference(nextSettings.themePreference);
    });
    return () => {
      removeSnapshotListener();
      removeSettingsListener();
    };
  }, [t]);

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage || "en";
  }, [i18n.resolvedLanguage]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const connectedEndpoints = useMemo(
    () => new Set(snapshot.devices.filter((device) => device.connection === "wifi").map((device) => device.serial)),
    [snapshot.devices],
  );

  const discoveredServices = useMemo(() => {
    const unique = new Map<string, MdnsService>();
    for (const service of snapshot.services) {
      if (snapshot.devices.some((device) => mdnsServiceMatchesDevice(service, device))) continue;
      if (!unique.has(`${service.type}:${service.endpoint}`)) unique.set(`${service.type}:${service.endpoint}`, service);
    }
    return [...unique.values()];
  }, [snapshot.devices, snapshot.services]);

  const deviceGroups = useMemo(() => groupDevices(snapshot.devices), [snapshot.devices]);

  const disconnectedSavedConnections = useMemo(
    () => settings.savedConnections.filter((saved) => (
      !snapshot.devices.some((device) => savedConnectionMatchesDevice(saved, device))
    )),
    [settings.savedConnections, snapshot.devices],
  );

  async function action(key: string, operation: () => Promise<ActionResult>) {
    setBusy(key);
    try {
      const result = await operation();
      if (result.settings) setSettings(result.settings);
      setToast({ type: "success", message: actionMessage(key, result, t) });
      setModal(null);
      await refresh();
    } catch (error) {
      setToast({ type: "error", message: friendlyError(error, t) });
    } finally {
      setBusy(null);
    }
  }

  function openModal(mode: Exclude<ModalMode, null>, endpoint = "") {
    setModalEndpoint(endpoint);
    setModal(mode);
  }

  async function chooseAdb() {
    setBusy("choose-adb");
    try {
      const result = await window.adbSuite.chooseAdb();
      if (result) {
        setSettings(result.settings);
        setSnapshot(result.snapshot);
        setToast({ type: "success", message: t("status.adbSelected") });
      }
    } catch (error) {
      setToast({ type: "error", message: friendlyError(error, t) });
    } finally {
      setBusy(null);
    }
  }

  async function forgetConnection(endpoint: string) {
    try {
      setSettings(await window.adbSuite.forgetConnection(endpoint));
    } catch (error) {
      setToast({ type: "error", message: friendlyError(error, t) });
    }
  }

  async function setAutoReconnect(enabled: boolean) {
    setBusy("settings:auto-reconnect");
    try {
      setSettings(await window.adbSuite.setAutoReconnect(enabled));
    } catch (error) {
      setToast({ type: "error", message: friendlyError(error, t) });
    } finally {
      setBusy(null);
    }
  }

  async function changeThemePreference() {
    const previousTheme = themePreference;
    const nextTheme = nextThemePreference(previousTheme);
    setThemePreference(nextTheme);
    try {
      setSettings(await window.adbSuite.setThemePreference(nextTheme));
    } catch (error) {
      setThemePreference(previousTheme);
      setToast({ type: "error", message: friendlyError(error, t) });
    }
  }

  async function changeLanguagePreference(languagePreference: LanguagePreference) {
    setBusy("settings:language");
    try {
      const result = await window.adbSuite.setLanguagePreference(languagePreference);
      setSettings(result.settings);
      await i18n.changeLanguage(result.resolvedLanguage);
    } catch (error) {
      setToast({ type: "error", message: friendlyError(error, t) });
    } finally {
      setBusy(null);
    }
  }

  async function checkForUpdates() {
    setBusy("check-updates");
    setToast(null);
    try {
      const result = await window.adbSuite.checkForUpdates();
      if (result.status === "available") {
        setAvailableUpdate(result);
      } else {
        setAvailableUpdate(null);
        setToast({ type: result.status === "current" ? "success" : "error", message: result.status === "current" ? t("status.upToDate") : t("status.updateUnavailable") });
      }
    } catch (error) {
      setAvailableUpdate(null);
      setToast({ type: "error", message: friendlyError(error, t) });
    } finally {
      setBusy(null);
    }
  }

  async function setConnectionAutoReconnect(id: string, enabled: boolean) {
    setBusy(`settings:${id}`);
    try {
      setSettings(await window.adbSuite.setConnectionAutoReconnect(id, enabled));
    } catch (error) {
      setToast({ type: "error", message: friendlyError(error, t) });
    } finally {
      setBusy(null);
    }
  }

  async function setDeviceAlias(identifier: string, alias: string) {
    setBusy(`alias:${identifier}`);
    try {
      const normalized = alias.trim();
      setSettings(await window.adbSuite.setDeviceAlias(identifier, normalized));
      setToast({ type: "success", message: normalized ? t("status.aliasSaved") : t("status.aliasRemoved") });
      return true;
    } catch (error) {
      setToast({ type: "error", message: friendlyError(error, t) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const isEmpty = deviceGroups.length === 0;
  const statusKind = busy ? "busy" : toast?.type || (availableUpdate ? "update" : "idle");
  const statusMessage = busy
    ? busyMessage(busy, t)
    : toast?.message || (availableUpdate ? t("status.updateAvailable", { version: availableUpdate.latestVersion }) : null) || (loading ? t("status.refreshing") : snapshot.adb.available ? t("status.ready") : t("status.adbRequired"));

  return (
    <div aria-busy={busy !== null} className={`app-shell${busy ? " is-busy" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="96 136 832 832">
              <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                <path d="M366 294Q512 168 658 294" strokeWidth="62"/>
                <path d="M421 407Q512 329 603 407" strokeWidth="62"/>
                <path d="M350 541 276 411M674 541l74-130" strokeWidth="68"/>
              </g>
              <path d="M144 872A368 368 0 0 1 880 872Q880 904 848 904H176Q144 904 144 872ZM386 735a48 48 0 1 0 96 0 48 48 0 1 0-96 0ZM542 735a48 48 0 1 0 96 0 48 48 0 1 0-96 0Z" fill="currentColor" fillRule="evenodd"/>
            </svg>
          </div>
          <div><strong>ADB Device Suite</strong><span>{t("brand.subtitle")}</span></div>
        </div>
        <div className="top-actions">
          <button
            aria-label={themeTooltip}
            className="icon-button theme-toggle"
            data-theme-preference={themePreference}
            title={themeTooltip}
            onClick={changeThemePreference}
          >
            {themePreference === "light"
              ? <Icons.LightMode />
              : themePreference === "dark"
                ? <Icons.DarkMode />
                : <Icons.AutoTheme />}
          </button>
          <button className="button text has-icon" disabled={busy !== null} onClick={() => openModal("connect")} title={t("header.connectTooltip")}><Icons.Link /> {t("common.connect")}</button>
          <button className="button primary has-icon" disabled={busy !== null} onClick={() => openModal("pair")} title={t("header.pairTooltip")}><Icons.Wifi /> {t("header.pair")}</button>
        </div>
      </header>

      <main>
        {!snapshot.adb.available ? (
          <>
            <section className="setup-toolbar">
              <AdbControls adb={snapshot.adb} loading={loading} onRefresh={refresh} onSettings={() => setSettingsOpen(true)} />
            </section>
            <section className="setup-panel">
              <div className="setup-illustration"><span>ADB</span></div>
              <div>
                <span className="eyebrow">{t("setup.oneTime")}</span>
                <h2>{t("setup.title")}</h2>
                <p>{snapshot.adb.error ? friendlyError(snapshot.adb.error, t) : t("setup.description")}</p>
                <div className="button-row">
                  <button className="button primary" onClick={chooseAdb} title={t("setup.selectTooltip")}>{t("setup.select")}</button>
                  <button className="button secondary" onClick={() => window.adbSuite.openExternal("https://developer.android.com/tools/releases/platform-tools")} title={t("setup.downloadTooltip")}>{t("setup.download")}</button>
                </div>
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="section-block">
              <div className="section-heading device-section-heading">
                <div><h2>{t("devices.heading")}</h2><span>{t("devices.count", { count: deviceGroups.length })}</span></div>
                <div className="device-section-tools">
                  <AdbControls adb={snapshot.adb} loading={loading} onRefresh={refresh} onSettings={() => setSettingsOpen(true)} />
                  <span className="auto-refresh"><span className="pulse" /> {t("devices.live")}</span>
                </div>
              </div>

              {isEmpty && !loading ? (
                <div className="empty-state">
                  <div className="empty-rings"><Icons.Phone /></div>
                  <h3>{t("devices.emptyTitle")}</h3>
                  <p>{t("devices.emptyDescription")}</p>
                  <button className="button secondary has-icon" onClick={() => openModal("pair")} title={t("devices.pairWifiTooltip")}><Icons.Wifi /> {t("devices.pairWifi")}</button>
                </div>
              ) : (
                <div className="device-list">
                  {deviceGroups.map((group) => (
                    <DeviceCard
                      alias={settings.deviceAliases[group.identifier] || null}
                      busy={busy}
                      group={group}
                      key={group.key}
                      onDisconnect={(target) => {
                        const saved = settings.savedConnections.find((connection) => (
                          connection.endpoint === target.serial
                          || (target.hardwareSerial && connection.hardwareSerial === target.hardwareSerial)
                        ));
                        const endpoint = saved?.endpoint || target.serial;
                        action(`disconnect:${endpoint}`, () => window.adbSuite.disconnect(endpoint));
                      }}
                      onEnableWireless={(serial) => action(`wifi:${serial}`, () => window.adbSuite.enableWireless(serial))}
                      onSetAlias={setDeviceAlias}
                    />
                  ))}
                </div>
              )}
            </section>

            {discoveredServices.length > 0 && (
              <section className="section-block compact-section">
                <div className="section-heading">
                  <div><h2>{t("nearby.heading")}</h2><span>{t("nearby.description")}</span></div>
                </div>
                <div className="connection-grid">
                  {discoveredServices.map((service) => (
                    <article className="connection-card" key={`${service.type}:${service.endpoint}`}>
                      <div className={`small-icon ${service.type}`}><Icons.Wifi /></div>
                      <div><strong>{service.type === "pairing" ? t("nearby.readyPair") : t("nearby.readyConnect")}</strong><code>{service.endpoint}</code></div>
                      <button
                        className="button small secondary"
                        disabled={busy !== null || connectedEndpoints.has(service.endpoint)}
                        onClick={() => service.type === "pairing"
                          ? openModal("pair", service.endpoint)
                          : action(`connect:${service.endpoint}`, () => window.adbSuite.connect(service.endpoint))}
                        title={service.type === "pairing" ? t("nearby.pairTooltip", { endpoint: service.endpoint }) : t("nearby.connectTooltip", { endpoint: service.endpoint })}
                      >
                        {connectedEndpoints.has(service.endpoint) ? t("common.connected") : service.type === "pairing" ? t("common.pair") : t("common.connect")}
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {disconnectedSavedConnections.length > 0 && (
              <section className="section-block compact-section">
                <div className="section-heading">
                  <div><h2>{t("saved.heading")}</h2><span>{t("saved.description")}</span></div>
                </div>
                <div className="connection-grid">
                  {disconnectedSavedConnections.map((saved) => {
                    const savedIdentifier = saved.hardwareSerial || saved.endpoint;
                    const savedAlias = settings.deviceAliases[savedIdentifier] || null;
                    const reconnecting = busy === `connect:${saved.endpoint}`;
                    const connected = snapshot.devices.some((device) => (
                      device.connection === "wifi"
                      && device.state === "device"
                      && (device.serial === saved.endpoint
                        || (saved.hardwareSerial && device.hardwareSerial === saved.hardwareSerial))
                    ));
                    return (
                      <article className="connection-card" key={saved.endpoint}>
                        <div className="small-icon"><Icons.Link /></div>
                        <div><strong>{savedAlias ? `${savedAlias} · ${saved.label || t("common.androidDevice")}` : saved.label || t("common.androidDevice")}</strong><code>{saved.endpoint}</code></div>
                        <button
                          className={`button small secondary reconnect-button${reconnecting ? " working" : ""}`}
                          disabled={connected || busy !== null}
                          onClick={() => action(`connect:${saved.endpoint}`, () => window.adbSuite.connect(saved.endpoint))}
                          title={t("reconnect.tooltip", { name: savedAlias || saved.label || saved.endpoint })}
                        >{connected ? t("common.connected") : reconnecting ? t("reconnect.working") : t("reconnect.button")}</button>
                        <button aria-label={t("reconnect.forget", { endpoint: saved.endpoint })} className="icon-button subtle" onClick={() => forgetConnection(saved.id)} title={t("reconnect.forgetTooltip", { endpoint: saved.endpoint })}><Icons.Trash /></button>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="troubleshoot-row">
              <div><strong>{t("troubleshoot.title")}</strong><span>{t("troubleshoot.description")}</span></div>
              <button className="button text" disabled={busy !== null} onClick={() => action("restart", () => window.adbSuite.restartServer())} title={t("troubleshoot.tooltip")}>
                {busy === "restart" ? t("troubleshoot.restarting") : t("troubleshoot.restart")}
              </button>
            </section>
          </>
        )}
      </main>

      <footer>
        <div className={`status-message ${statusKind}`} role="status" aria-live="polite">
          {statusKind === "busy" ? <Icons.Hourglass /> : statusKind === "success" ? <Icons.Success /> : statusKind === "error" ? <Icons.Error /> : statusKind === "update" ? <Icons.Update /> : <span className="status-ready-dot" />}
          <span>{statusMessage}</span>
          {statusKind === "update" && availableUpdate?.releaseUrl && (
            <button
              className="status-action"
              onClick={() => void window.adbSuite.openExternal(availableUpdate.releaseUrl || "")}
              title={t("footer.downloadTooltip", { version: availableUpdate.latestVersion })}
              type="button"
            >{t("footer.download")}</button>
          )}
        </div>
        <button
          className="app-version"
          disabled={busy !== null || !appVersion}
          onClick={checkForUpdates}
          title={appVersion ? t("footer.updatesTooltip", { version: appVersion }) : t("footer.loadingVersion")}
          type="button"
        >
          {appVersion ? `v${appVersion}` : "v—"}
        </button>
        <a
          className="footer-github"
          href="https://github.com/andreszs"
          onClick={(event) => {
            event.preventDefault();
            void window.adbSuite.openExternal(event.currentTarget.href);
          }}
          title={t("footer.githubTooltip")}
        >
          <FaGithub aria-hidden="true" className="ui-icon" />
          <span>andreszs</span>
        </a>
      </footer>

      {busy && (
        <div aria-hidden="true" className="busy-layer" />
      )}

      {modal && (
        <ConnectionModal
          busy={busy?.startsWith("modal:") || false}
          initialEndpoint={modalEndpoint}
          key={`${modal}:${modalEndpoint}`}
          mode={modal}
          onClose={() => setModal(null)}
          onSubmit={(endpoint, code) => action(`modal:${modal}`, () => modal === "pair"
            ? window.adbSuite.pair(endpoint, code || "")
            : window.adbSuite.connect(endpoint))}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          adbPath={snapshot.adb.path}
          busy={busy !== null}
          settings={settings}
          onChooseAdb={chooseAdb}
          onClose={() => setSettingsOpen(false)}
          onLanguageChange={changeLanguagePreference}
          onToggleConnection={setConnectionAutoReconnect}
          onToggleGlobal={setAutoReconnect}
        />
      )}

    </div>
  );
}
