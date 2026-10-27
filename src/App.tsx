import { CSSProperties, FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  MdBrightnessAuto,
  MdBattery0Bar,
  MdBattery20,
  MdBattery30,
  MdBattery50,
  MdBattery60,
  MdBattery80,
  MdBattery90,
  MdBatteryCharging20,
  MdBatteryCharging30,
  MdBatteryCharging50,
  MdBatteryCharging60,
  MdBatteryCharging80,
  MdBatteryCharging90,
  MdBatteryChargingFull,
  MdBatteryFull,
  MdCheckCircle,
  MdClose,
  MdContentCopy,
  MdDarkMode,
  MdDeleteOutline,
  MdErrorOutline,
  MdHourglassTop,
  MdInfoOutline,
  MdLightMode,
  MdLink,
  MdPhoneAndroid,
  MdRefresh,
  MdSettings,
  MdSystemUpdateAlt,
  MdUsb,
  MdWifi,
  MdWifiOff,
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

const EMPTY_SETTINGS: AppSettings = { adbPath: null, autoReconnect: true, chargingAnimation: true, deviceAliases: {}, savedConnections: [], themePreference: "light", languagePreference: "system" };

type ModalMode = "connect" | "pair" | null;
type PairMethod = "code" | "qr";
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
  WifiOff: () => <MdWifiOff aria-hidden="true" className="ui-icon" />,
  Link: () => <MdLink aria-hidden="true" className="ui-icon" />,
  Settings: () => <MdSettings aria-hidden="true" className="ui-icon" />,
  Phone: () => <MdPhoneAndroid aria-hidden="true" className="ui-icon phone-glyph" />,
  Close: () => <MdClose aria-hidden="true" className="ui-icon" />,
  Copy: () => <MdContentCopy aria-hidden="true" className="ui-icon" />,
  Trash: () => <MdDeleteOutline aria-hidden="true" className="ui-icon" />,
  LightMode: () => <MdLightMode aria-hidden="true" className="ui-icon" />,
  DarkMode: () => <MdDarkMode aria-hidden="true" className="ui-icon" />,
  AutoTheme: () => <MdBrightnessAuto aria-hidden="true" className="ui-icon" />,
  Hourglass: () => <MdHourglassTop aria-hidden="true" className="ui-icon" />,
  Success: () => <MdCheckCircle aria-hidden="true" className="ui-icon" />,
  Error: () => <MdErrorOutline aria-hidden="true" className="ui-icon" />,
  Info: () => <MdInfoOutline aria-hidden="true" className="ui-icon" />,
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
    "Invalid QR pairing credentials.": "errors.invalidQr",
    "No Android device responded to the QR code before it expired.": "errors.qrTimeout",
    "Pairing succeeded, but ADB could not connect to the wireless debugging port within 20 seconds.": "errors.qrConnectTimeout",
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
  if (state === "unauthorized") return "unauthorized";
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

function pendingConnectionMessage(t: TFunction) {
  return `${t("connection.qrPairedTitle")}. ${t("connection.qrConnectingHelp")}`;
}

function randomHex(bytes: number) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return [...values].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function createQrPairingCredentials() {
  const serviceName = `studio-${randomHex(5)}`;
  const password = randomHex(10);
  return {
    serviceName,
    password,
    payload: `WIFI:T:ADB;S:${serviceName};P:${password};;`,
  };
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

function BatteryIndicator({ battery }: { battery: NonNullable<AdbDevice["battery"]> }) {
  const { t } = useTranslation();
  const level = battery.level === null ? 0 : Math.max(0, Math.min(100, battery.level));
  const charging = battery.status === "charging";
  const status = t(`deviceInfo.batteryStatus.${battery.status}`);
  const tooltip = `${level}% · ${status}`;
  const tone = battery.status === "charging" || battery.status === "full" ? "charging" : level <= 20 ? "low" : "";
  const BatteryIcon = charging
    ? level <= 20 ? MdBatteryCharging20
      : level <= 30 ? MdBatteryCharging30
        : level <= 50 ? MdBatteryCharging50
          : level <= 60 ? MdBatteryCharging60
            : level <= 80 ? MdBatteryCharging80
              : level <= 90 ? MdBatteryCharging90
                : MdBatteryChargingFull
    : level <= 5 ? MdBattery0Bar
      : level <= 20 ? MdBattery20
        : level <= 30 ? MdBattery30
          : level <= 50 ? MdBattery50
            : level <= 60 ? MdBattery60
              : level <= 80 ? MdBattery80
                : level <= 90 ? MdBattery90
                  : MdBatteryFull;

  return (
    <div aria-label={tooltip} className={`battery-indicator ${tone}`} role="img" title={tooltip}>
      <span className="battery-glyph"><BatteryIcon aria-hidden="true" className="ui-icon" /></span>
    </div>
  );
}

function DeviceCard({
  alias,
  busy,
  chargingAnimation,
  group,
  onConnect,
  onEnableWireless,
  onDisconnect,
  onInfo,
  onSetAlias,
}: {
  alias: string | null;
  busy: string | null;
  chargingAnimation: boolean;
  group: DeviceGroup;
  onConnect: (device: AdbDevice) => void;
  onEnableWireless: (serial: string) => void;
  onDisconnect: (device: AdbDevice) => void;
  onInfo: (device: AdbDevice, name: string) => void;
  onSetAlias: (identifier: string, alias: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const { devices, identifier, primary, usb, wifi } = group;
  const ready = devices.some((device) => device.state === "device");
  const wifiConnected = wifi?.state === "device";
  const statusDevice = devices.find((device) => device.state === "device")
    || devices.find((device) => device.state === "unauthorized")
    || devices[0];
  const modelName = formatDeviceName(primary, t);
  const androidVersion = devices.find((device) => device.androidVersion)?.androidVersion;
  const ipAddress = wifi?.ipAddress || devices.find((device) => device.ipAddress)?.ipAddress;
  const ipAddresses = [...new Set(devices.flatMap((device) => device.ipAddresses || (device.ipAddress ? [device.ipAddress] : [])))];
  const connectionLabel = usb && wifi ? "USB + Wi-Fi" : usb ? "USB" : "Wi-Fi";
  const infoDevice = devices.find((device) => device.connection === "usb" && device.state === "device")
    || devices.find((device) => device.state === "device")
    || null;
  const cardBattery = infoDevice?.battery;
  const hasBattery = cardBattery?.level !== null && cardBattery?.level !== undefined;
  const charging = cardBattery?.status === "charging";
  const batteryLevel = cardBattery?.level === null || cardBattery?.level === undefined
    ? 0
    : Math.max(0, Math.min(100, cardBattery.level));
  const batteryStyle = hasBattery
    ? ({ "--battery-level": `${batteryLevel}%` } as CSSProperties)
    : undefined;
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
    <article className={`device-card${hasBattery ? " has-battery" : ""}${charging ? " is-charging" : ""}${charging && chargingAnimation ? " animate-charging" : ""}`} style={batteryStyle}>
      {charging && chargingAnimation && (
        <span aria-hidden="true" className="charging-effects">
          <i className="charge-sheen" />
        </span>
      )}
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
        {infoDevice?.battery?.level !== null && infoDevice?.battery && <BatteryIndicator battery={infoDevice.battery} />}
        <button
          aria-label={t("deviceInfo.buttonTooltip", { name: alias || modelName })}
          className="icon-button device-action-icon"
          disabled={!infoDevice || busy !== null}
          onClick={() => infoDevice && onInfo(infoDevice, alias || modelName)}
          title={t("deviceInfo.buttonTooltip", { name: alias || modelName })}
          type="button"
        >
          <Icons.Info />
        </button>
        {wifiConnected && wifi ? (
          <button
            aria-label={t("device.disconnectTooltip", { name: alias || modelName })}
            className="icon-button device-action-icon danger"
            disabled={busy !== null}
            onClick={() => onDisconnect(wifi)}
            title={t("device.disconnectTooltip", { name: alias || modelName })}
            type="button"
          >
            <Icons.WifiOff />
          </button>
        ) : wifi ? (
          <>
            <button
              className="button secondary"
              disabled={busy !== null}
              onClick={() => onConnect(wifi)}
              title={t("device.reconnectOfflineTooltip", { name: alias || modelName })}
            >
              {busy === `connect:${wifi.serial}` ? t("device.connecting") : t("device.reconnectOffline")}
            </button>
            <button
              className="button ghost-danger"
              disabled={busy !== null}
              onClick={() => onDisconnect(wifi)}
              title={t("device.removeOfflineTooltip", { name: alias || modelName })}
            >
              {t("device.removeOffline")}
            </button>
          </>
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

function formatBytes(value: number | null, unavailable: string) {
  if (value === null || !Number.isFinite(value)) return unavailable;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: unit > 2 ? 2 : 1 })} ${units[unit]}`;
}

function formatUptime(value: number | null, unavailable: string) {
  if (value === null || !Number.isFinite(value)) return unavailable;
  const days = Math.floor(value / 86_400);
  const hours = Math.floor((value % 86_400) / 3_600);
  const minutes = Math.floor((value % 3_600) / 60);
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", `${minutes}m`].filter(Boolean).join(" ");
}

function connectionAddress(serial: string) {
  const bracketed = serial.match(/^\[([^\]]+)\]:\d+$/);
  if (bracketed) return bracketed[1];
  const endpoint = serial.match(/^(.+):\d+$/);
  return endpoint?.[1] || serial;
}

function InfoField({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="info-field">
      <dt>{label}</dt>
      <dd className={mono ? "mono" : ""}>{value}</dd>
    </div>
  );
}

function StatusValue({ children, tone = "neutral" }: { children: ReactNode; tone?: "positive" | "warning" | "neutral" }) {
  return <span className={`status-value ${tone}`}>{children}</span>;
}

type DeviceInfoTab = "summary" | "hardware" | "system" | "network";

function MetricCard({ label, value, detail, progress }: { label: string; value: string; detail?: string; progress?: number | null }) {
  const safeProgress = progress === null || progress === undefined ? null : Math.max(0, Math.min(100, progress));
  return (
    <article className="info-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
      {safeProgress !== null && <div className="metric-track"><i style={{ width: `${safeProgress}%` }} /></div>}
    </article>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="info-metric info-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function ResourceBar({ label, value, detail, progress }: { label: string; value: string; detail: string; progress: number | null }) {
  const safeProgress = progress === null ? 0 : Math.max(0, Math.min(100, progress));
  return (
    <div className="info-resource">
      <div><span>{label}</span><strong>{value}</strong></div>
      <div className="metric-track"><i style={{ width: `${safeProgress}%` }} /></div>
      <small>{detail}</small>
    </div>
  );
}

function DeviceInfoModal({ name, serial, onClose }: { name: string; serial: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DeviceInfoTab>("summary");
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);
  const requestId = useRef(0);

  const loadInfo = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const result = await window.adbSuite.getDeviceInfo(serial);
      if (requestId.current !== currentRequest) return;
      setInfo(result);
      setRefreshedAt(new Date());
    } catch (reason) {
      if (requestId.current !== currentRequest) return;
      const message = friendlyError(reason, t);
      setError(message === "The device is not connected or authorized." ? t("deviceInfo.connectionError") : message);
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  }, [serial, t]);

  useEffect(() => {
    void loadInfo();
    return () => { requestId.current += 1; };
  }, [loadInfo]);

  const copyInfo = useCallback(async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(info, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch {
      setError(t("deviceInfo.copyFailed"));
    }
  }, [info, t]);

  const address = connectionAddress(serial);
  const copyAddress = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address);
      setAddressCopied(true);
      window.setTimeout(() => setAddressCopied(false), 1_800);
    } catch {
      setError(t("deviceInfo.copyFailed"));
    }
  }, [address, t]);

  const unavailable = t("deviceInfo.unavailable");
  const value = (candidate: string | number | null | undefined) => candidate ?? unavailable;
  const yesNo = (candidate: boolean | null) => candidate === null ? unavailable : t(candidate ? "deviceInfo.enabled" : "deviceInfo.disabled");
  const securityValue = (candidate: string | null) => candidate
    ? t(`deviceInfo.securityValues.${candidate.toLowerCase()}`, { defaultValue: candidate })
    : unavailable;
  const batteryStatus = info ? t(`deviceInfo.batteryStatus.${info.battery.status}`) : unavailable;
  const batteryHealth = info ? t(`deviceInfo.batteryHealth.${info.battery.health}`) : unavailable;
  const batteryStatusTone = info?.battery.status === "charging" || info?.battery.status === "full"
    ? "positive"
    : info?.battery.status === "notCharging" ? "warning" : "neutral";
  const powerSources = info?.battery.sources.map((source) => source === "Wireless" ? t("deviceInfo.wireless") : source).join(", ") || unavailable;
  const connectionType = serial.includes(":") ? "Wi-Fi" : "USB";
  const ramUsed = info && info.hardware.ramTotalBytes !== null && info.hardware.ramAvailableBytes !== null
    ? info.hardware.ramTotalBytes - info.hardware.ramAvailableBytes
    : null;
  const ramPercent = ramUsed !== null && info?.hardware.ramTotalBytes
    ? (ramUsed / info.hardware.ramTotalBytes) * 100
    : null;
  const orientation = info?.hardware.screen.orientation
    ? t(`deviceInfo.orientation.${info.hardware.screen.orientation}`)
    : unavailable;
  const skinLabel = info?.system.skinVersion
    ? `${info.system.skinName || t("deviceInfo.systemLayer")} ${info.system.skinVersion}`
    : null;
  const identitySummary = info
    ? [info.identity.brand || info.identity.manufacturer, info.identity.model].filter(Boolean).join(" · ") || unavailable
    : unavailable;
  const identityDetail = info
    ? [info.identity.device, info.identity.product].filter(Boolean).join(" · ") || unavailable
    : unavailable;
  const softwareSummary = info?.system.androidVersion
    ? `Android ${info.system.androidVersion} · API ${info.system.sdk || "—"}`
    : unavailable;
  const softwareDetail = info
    ? [skinLabel, info.system.securityPatch, info.system.buildId].filter(Boolean).join(" · ") || unavailable
    : unavailable;
  const tabs: Array<{ id: DeviceInfoTab; label: string }> = [
    { id: "summary", label: t("deviceInfo.tabs.summary") },
    { id: "hardware", label: t("deviceInfo.tabs.hardware") },
    { id: "system", label: t("deviceInfo.tabs.system") },
    { id: "network", label: t("deviceInfo.tabs.network") },
  ];

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal device-info-modal" aria-modal="true" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header info-modal-header">
          <div className="info-title-block">
            <span className="eyebrow">{t("deviceInfo.eyebrow")}</span>
            <h2>{name}</h2>
            <div className={`info-address-pill${addressCopied ? " copied" : ""}`}>
              <code>{address}</code>
              <button aria-label={`${t("deviceInfo.copy")} ${address}`} onClick={() => void copyAddress()} title={`${t("deviceInfo.copy")} ${address}`} type="button"><Icons.Copy /></button>
            </div>
          </div>
          <div className="info-header-actions">
            <button className="button small secondary has-icon" disabled={loading} onClick={() => void loadInfo()} title={t("deviceInfo.refreshTooltip")} type="button"><Icons.Refresh /> {t("deviceInfo.refresh")}</button>
            <button className="button small secondary" disabled={!info || loading} onClick={() => void copyInfo()} title={t("deviceInfo.copyTooltip")} type="button">{copied ? t("deviceInfo.copied") : t("deviceInfo.copy")}</button>
            <button aria-label={t("common.close")} className="icon-button" onClick={onClose} title={t("deviceInfo.closeTooltip")}><Icons.Close /></button>
          </div>
        </div>

        {info && (
          <div aria-label={t("deviceInfo.tabs.label")} className="info-tabs" role="tablist">
            {tabs.map((tab) => (
              <button aria-selected={activeTab === tab.id} className={activeTab === tab.id ? "active" : ""} key={tab.id} onClick={() => setActiveTab(tab.id)} role="tab" title={tab.label} type="button">{tab.label}</button>
            ))}
          </div>
        )}

        {!info && loading && <div className="info-loading" role="status"><span />{t("deviceInfo.loading")}</div>}
        {error && !info && <div className="info-error" role="alert"><Icons.Error /><span>{error}</span></div>}
        {info && (
          <div className={`device-info-content tab-${activeTab}${loading ? " refreshing" : ""}`}>
            {error && <div className="info-inline-error" role="alert"><Icons.Error /><span>{error}</span></div>}

            {activeTab === "summary" && (
              <>
                <div className="info-summary-columns">
                  <SummaryCard label={t("deviceInfo.identity")} value={identitySummary} detail={identityDetail} />
                  <SummaryCard label={t("deviceInfo.software")} value={softwareSummary} detail={softwareDetail} />
                </div>
                <div className="info-metrics-grid">
                  <MetricCard label={t("deviceInfo.battery")} value={info.battery.level === null ? unavailable : `${info.battery.level}%`} detail={`${batteryStatus} · ${info.battery.temperatureC ?? "—"} °C`} progress={info.battery.level} />
                  <MetricCard label={t("deviceInfo.screen")} value={value(info.hardware.screen.resolution) as string} detail={`${info.hardware.screen.densityDpi ?? "—"} dpi · ${orientation}`} />
                  <MetricCard label={t("deviceInfo.ram")} value={formatBytes(info.hardware.ramAvailableBytes, unavailable)} detail={t("deviceInfo.availableOf", { total: formatBytes(info.hardware.ramTotalBytes, unavailable) })} progress={ramPercent} />
                  <MetricCard label={t("deviceInfo.storageAvailable")} value={formatBytes(info.hardware.storage.availableBytes, unavailable)} detail={t("deviceInfo.availableOf", { total: formatBytes(info.hardware.storage.totalBytes, unavailable) })} progress={info.hardware.storage.usedPercent} />
                  <MetricCard label={t("deviceInfo.connection")} value={connectionType} detail={serial} />
                  <MetricCard label={t("deviceInfo.uptime")} value={formatUptime(info.system.uptimeSeconds, unavailable)} detail={info.system.timeZone || unavailable} />
                </div>
              </>
            )}

            {activeTab === "hardware" && (
              <div className="info-two-columns">
                <section className="info-section">
                  <h3>{t("deviceInfo.processor")}</h3>
                  <dl>
                    <InfoField label={t("deviceInfo.cpuModel")} value={value(info.hardware.cpuModel)} />
                    <InfoField label={t("deviceInfo.cpuCores")} value={value(info.hardware.cpuCores)} />
                    <InfoField label={t("deviceInfo.cpuAbis")} value={info.hardware.cpuAbis.join(", ") || unavailable} />
                  </dl>
                </section>
                <section className="info-section">
                  <h3>{t("deviceInfo.screen")}</h3>
                  <dl>
                    <InfoField label={t("deviceInfo.resolution")} value={value(info.hardware.screen.resolution)} />
                    <InfoField label={t("deviceInfo.density")} value={info.hardware.screen.densityDpi === null ? unavailable : `${info.hardware.screen.densityDpi} dpi`} />
                    <InfoField label={t("deviceInfo.currentOrientation")} value={orientation} />
                  </dl>
                </section>
                <section className="info-section">
                  <h3>{t("deviceInfo.memory")}</h3>
                  <div className="info-resource-list">
                    <ResourceBar
                      label={t("deviceInfo.ram")}
                      value={`${formatBytes(ramUsed, unavailable)} / ${formatBytes(info.hardware.ramTotalBytes, unavailable)}`}
                      detail={`${t("deviceInfo.ramAvailable")}: ${formatBytes(info.hardware.ramAvailableBytes, unavailable)}`}
                      progress={ramPercent}
                    />
                    <ResourceBar
                      label={t("deviceInfo.storageUsed")}
                      value={`${formatBytes(info.hardware.storage.usedBytes, unavailable)} / ${formatBytes(info.hardware.storage.totalBytes, unavailable)}`}
                      detail={`${t("deviceInfo.storageAvailable")}: ${formatBytes(info.hardware.storage.availableBytes, unavailable)}`}
                      progress={info.hardware.storage.usedPercent}
                    />
                  </div>
                </section>
                <section className="info-section">
                  <h3>{t("deviceInfo.battery")}<StatusValue tone={batteryStatusTone}>{batteryStatus}</StatusValue></h3>
                  <dl>
                    <InfoField label={t("deviceInfo.level")} value={info.battery.level === null ? unavailable : `${info.battery.level}%`} />
                    <InfoField label={t("deviceInfo.health")} value={batteryHealth} />
                    <InfoField label={t("deviceInfo.temperature")} value={info.battery.temperatureC === null ? unavailable : `${info.battery.temperatureC} °C`} />
                    <InfoField label={t("deviceInfo.voltage")} value={info.battery.voltageMv === null ? unavailable : `${(info.battery.voltageMv / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} V`} />
                    <InfoField label={t("deviceInfo.powerSource")} value={powerSources} />
                  </dl>
                </section>
              </div>
            )}

            {activeTab === "system" && (
              <div className="info-two-columns">
                <section className="info-section">
                  <h3>{t("deviceInfo.system")}</h3>
                  <dl>
                    <InfoField label={t("deviceInfo.androidVersion")} value={value(info.system.androidVersion)} />
                    <InfoField label={t("deviceInfo.apiLevel")} value={value(info.system.sdk)} />
                    <InfoField label={info.system.skinName || t("deviceInfo.systemLayer")} value={value(info.system.skinVersion)} />
                    <InfoField label={t("deviceInfo.securityPatch")} value={value(info.system.securityPatch)} />
                    <InfoField label={t("deviceInfo.buildId")} value={value(info.system.buildId)} mono />
                    <InfoField label={t("deviceInfo.buildType")} value={[info.system.buildType, info.system.buildTags].filter(Boolean).join(" · ") || unavailable} mono />
                  </dl>
                </section>
                <section className="info-section">
                  <h3>{t("deviceInfo.security")}</h3>
                  <dl>
                    <InfoField label={t("deviceInfo.encryption")} value={[info.security.encryption, info.security.encryptionType].filter(Boolean).map((item) => securityValue(item)).join(" · ") || unavailable} />
                    <InfoField label={t("deviceInfo.verifiedBoot")} value={<StatusValue tone={info.security.verifiedBoot?.toLowerCase() === "green" ? "positive" : "warning"}>{securityValue(info.security.verifiedBoot)}</StatusValue>} />
                    <InfoField label={t("deviceInfo.bootloader")} value={<StatusValue tone={info.security.bootloader?.toLowerCase() === "locked" ? "positive" : "warning"}>{securityValue(info.security.bootloader)}</StatusValue>} />
                    <InfoField label="SELinux" value={<StatusValue tone={info.security.selinux?.toLowerCase() === "enforcing" ? "positive" : "warning"}>{securityValue(info.security.selinux)}</StatusValue>} />
                    <InfoField label={t("deviceInfo.adbSecure")} value={<StatusValue tone={info.security.adbSecure ? "positive" : "warning"}>{yesNo(info.security.adbSecure)}</StatusValue>} />
                    <InfoField label={t("deviceInfo.developerOptions")} value={<StatusValue tone="neutral">{yesNo(info.system.developerOptions)}</StatusValue>} />
                  </dl>
                </section>
                <section className="info-section info-wide">
                  <h3>{t("deviceInfo.environment")}</h3>
                  <dl>
                    <InfoField label={t("deviceInfo.locale")} value={value(info.system.locale)} />
                    <InfoField label={t("deviceInfo.timeZone")} value={value(info.system.timeZone)} />
                    <InfoField label={t("deviceInfo.uptime")} value={formatUptime(info.system.uptimeSeconds, unavailable)} />
                  </dl>
                </section>
                <details className="info-advanced info-wide">
                  <summary>{t("deviceInfo.technicalDetails")}</summary>
                  <dl>
                    <InfoField label={t("deviceInfo.serial")} value={value(info.identity.hardwareSerial || info.serial)} mono />
                    <InfoField label={t("deviceInfo.bootReason")} value={value(info.system.bootReason)} mono />
                    <InfoField label={t("deviceInfo.fingerprint")} value={value(info.system.buildFingerprint)} mono />
                  </dl>
                </details>
              </div>
            )}

            {activeTab === "network" && (
              <div className="info-two-columns">
                <section className="info-section">
                  <h3>{t("deviceInfo.connection")}</h3>
                  <dl>
                    <InfoField label="ADB" value={`${connectionType}: ${serial}`} mono />
                    <InfoField label="Wi-Fi" value={yesNo(info.network.wifiEnabled)} />
                    <InfoField label={t("deviceInfo.airplaneMode")} value={yesNo(info.network.airplaneMode)} />
                  </dl>
                </section>
                <section className="info-section">
                  <h3>{t("deviceInfo.interfaces")}</h3>
                  <dl>
                    {info.network.interfaces.length
                      ? info.network.interfaces.map((item) => <InfoField key={`${item.name}:${item.address}`} label={item.name} value={item.address} mono />)
                      : <InfoField label={t("deviceInfo.addresses")} value={unavailable} />}
                  </dl>
                </section>
                <details className="info-advanced info-wide">
                  <summary>{t("deviceInfo.routes")} <span>{info.network.routes.length}</span></summary>
                  <div className="route-list">{info.network.routes.length ? info.network.routes.map((route) => <code key={route}>{route}</code>) : unavailable}</div>
                </details>
              </div>
            )}
          </div>
        )}
        <div className="info-modal-footer">
          <span>{refreshedAt ? t("deviceInfo.updatedAt", { time: refreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }) : ""}</span>
          <button className="button secondary" onClick={onClose} title={t("deviceInfo.closeTooltip")} type="button">{t("common.close")}</button>
        </div>
      </section>
    </div>
  );
}

function ConnectionModal({
  mode,
  initialEndpoint,
  busy,
  onClose,
  onCancelPairing,
  onQrPair,
  onSubmit,
}: {
  mode: Exclude<ModalMode, null>;
  initialEndpoint: string;
  busy: boolean;
  onClose: () => void;
  onCancelPairing: () => Promise<void>;
  onQrPair: (serviceName: string, password: string) => Promise<ActionResult>;
  onSubmit: (endpoint: string, code?: string) => void;
}) {
  const { t } = useTranslation();
  const [endpoint, setEndpoint] = useState(initialEndpoint);
  const [code, setCode] = useState("");
  const [pairMethod, setPairMethod] = useState<PairMethod>("code");
  const [qrCredentials, setQrCredentials] = useState(createQrPairingCredentials);
  const [qrStatus, setQrStatus] = useState<"idle" | "waiting" | "connecting" | "pending" | "error">("idle");
  const [qrPaired, setQrPaired] = useState(false);
  const [qrError, setQrError] = useState("");
  const [codePaired, setCodePaired] = useState(false);
  const [codePending, setCodePending] = useState(false);
  const qrAttempt = useRef(0);

  useEffect(() => window.adbSuite.onPairingProgress((progress) => {
    if (progress.method === "qr") {
      setQrPaired(true);
      setQrStatus(progress.phase === "pending" ? "pending" : "connecting");
    } else {
      setCodePaired(true);
      setCodePending(progress.phase === "pending");
    }
  }), []);

  function submit(event: FormEvent) {
    event.preventDefault();
    setCodePaired(false);
    setCodePending(false);
    onSubmit(endpoint.trim(), mode === "pair" ? code.trim() : undefined);
  }

  async function beginQrPairing() {
    const attempt = ++qrAttempt.current;
    const credentials = createQrPairingCredentials();
    setQrCredentials(credentials);
    setQrPaired(false);
    setQrError("");
    setQrStatus("waiting");
    try {
      await onQrPair(credentials.serviceName, credentials.password);
    } catch (error) {
      if (qrAttempt.current !== attempt) return;
      setQrError(friendlyError(error, t));
      setQrStatus("error");
    }
  }

  function changePairMethod(nextMethod: PairMethod) {
    if (nextMethod === pairMethod || busy) return;
    qrAttempt.current += 1;
    if (qrStatus === "waiting" || qrStatus === "connecting") void onCancelPairing();
    setPairMethod(nextMethod);
    setCodePaired(false);
    setCodePending(false);
    setQrStatus("idle");
    setQrPaired(false);
    setQrError("");
    if (nextMethod === "qr") void beginQrPairing();
  }

  function closeModal() {
    qrAttempt.current += 1;
    if ((mode === "pair" && busy) || qrStatus === "waiting" || qrStatus === "connecting") {
      void onCancelPairing();
    }
    onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={closeModal}>
      <section className="modal" aria-modal="true" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="eyebrow">{t("connection.wirelessDebugging")}</span>
            <h2>{mode === "pair" ? t("connection.pairDevice") : t("connection.connectManually")}</h2>
          </div>
          <button aria-label={t("common.close")} className="icon-button" onClick={closeModal} title={t("connection.closeDialog")}><Icons.Close /></button>
        </div>

        {mode === "pair" && (
          <div aria-label={t("connection.pairMethod")} className="pair-method-tabs" role="tablist">
            <button
              aria-selected={pairMethod === "code"}
              className={pairMethod === "code" ? "active" : ""}
              disabled={busy}
              onClick={() => changePairMethod("code")}
              role="tab"
              title={t("connection.codeTooltip")}
              type="button"
            >{t("connection.codeTab")}</button>
            <button
              aria-selected={pairMethod === "qr"}
              className={pairMethod === "qr" ? "active" : ""}
              disabled={busy}
              onClick={() => changePairMethod("qr")}
              role="tab"
              title={t("connection.qrTooltip")}
              type="button"
            >{t("connection.qrTab")}</button>
          </div>
        )}

        {mode === "pair" && pairMethod === "qr" ? (
          <div className="qr-pairing-panel">
            <div className={`qr-code-frame${qrStatus === "error" ? " expired" : qrStatus === "connecting" || qrStatus === "pending" ? " paired" : ""}`}>
              {qrStatus === "error" ? (
                <div className="qr-expired-state">
                  <Icons.Error />
                  <strong>{t(qrPaired ? "connection.qrConnectionFailed" : "connection.qrExpired")}</strong>
                </div>
              ) : qrStatus === "connecting" || qrStatus === "pending" ? (
                <div className="qr-paired-state">
                  <Icons.Success />
                  <strong>{t("connection.qrPaired")}</strong>
                </div>
              ) : (
                <QRCodeSVG bgColor="#ffffff" fgColor="#111827" level="M" marginSize={2} size={216} value={qrCredentials.payload} />
              )}
            </div>
            <strong>{t(qrPaired ? "connection.qrPairedTitle" : "connection.qrTitle")}</strong>
            <p className="form-help">{t(qrPaired ? "connection.qrConnectingHelp" : "connection.qrHelp")}</p>
            <p aria-live="polite" className={`qr-status ${qrStatus}`}>
              {qrStatus === "error"
                ? qrError
                : qrStatus === "pending" ? pendingConnectionMessage(t) : t(qrStatus === "connecting" ? "connection.qrConnecting" : "connection.qrWaiting")}
            </p>
            <div className="modal-actions">
              <button className="button text" onClick={closeModal} title={qrStatus === "pending" ? t("connection.closeDialog") : t("connection.cancelTooltip")} type="button">{t(qrStatus === "pending" ? "common.close" : "common.cancel")}</button>
              {qrStatus === "error" && !qrPaired && (
                <button className="button primary" onClick={() => void beginQrPairing()} title={t("connection.qrRetryTooltip")} type="button">{t("connection.qrRetry")}</button>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
          <label>
            {t("connection.endpoint")}
            <input
              autoFocus
              disabled={busy}
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
                disabled={busy}
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
          {mode === "pair" && busy && (
            <div aria-live="polite" className={`code-pairing-status ${codePaired ? "connecting" : "pairing"}`}>
              <strong>{codePaired ? t("connection.qrPairedTitle") : t("common.working")}</strong>
              <span>{codePending ? pendingConnectionMessage(t) : codePaired ? t("connection.qrConnecting") : t("connection.pairHelp")}</span>
            </div>
          )}
          {mode === "pair" && codePending && !busy && (
            <div aria-live="polite" className="code-pairing-status pending">
              <strong>{t("connection.qrPairedTitle")}</strong>
              <span>{pendingConnectionMessage(t)}</span>
            </div>
          )}
          <div className="modal-actions">
            <button className="button text" onClick={closeModal} title={codePending ? t("connection.closeDialog") : t("connection.cancelTooltip")} type="button">{t(codePending ? "common.close" : "common.cancel")}</button>
            {!codePending && <button className="button primary" disabled={busy} title={mode === "pair" ? t("connection.pairTooltip") : t("connection.connectTooltip")} type="submit">
              {busy
                ? codePaired ? t("device.connecting") : t("common.working")
                : mode === "pair" ? t("connection.pairButton") : t("common.connect")}
            </button>}
          </div>
          </form>
        )}
      </section>
    </div>
  );
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
  onToggleChargingAnimation,
  onToggleGlobal,
}: {
  adbPath: string | null;
  busy: boolean;
  settings: AppSettings;
  onChooseAdb: () => void;
  onClose: () => void;
  onLanguageChange: (language: LanguagePreference) => void;
  onToggleChargingAnimation: (enabled: boolean) => void;
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

        <div className="setting-row">
          <div><strong>{t("settings.chargingAnimation")}</strong><span>{t("settings.chargingAnimationDescription")}</span></div>
          <Toggle checked={settings.chargingAnimation} label={t("settings.chargingAnimationToggle")} onChange={onToggleChargingAnimation} />
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
  const [infoTarget, setInfoTarget] = useState<{ serial: string; name: string } | null>(null);
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
      if (result.pendingConnection && key === "modal:pair") {
        setToast({ type: "success", message: pendingConnectionMessage(t) });
        await refresh();
        return result;
      }
      setToast({ type: "success", message: actionMessage(key, result, t) });
      setModal(null);
      await refresh();
      return result;
    } catch (error) {
      const message = friendlyError(error, t);
      if (!(key === "modal:pair" && message === "Pairing was cancelled.")) {
        setToast({ type: "error", message });
      }
    } finally {
      setBusy(null);
    }
  }

  function openModal(mode: Exclude<ModalMode, null>, endpoint = "") {
    setModalEndpoint(endpoint);
    setModal(mode);
  }

  async function pairByQr(serviceName: string, password: string) {
    const result = await window.adbSuite.pairByQr(serviceName, password);
    if (result.pendingConnection) {
      setToast({ type: "success", message: pendingConnectionMessage(t) });
      await refresh();
      return result;
    }
    setToast({ type: "success", message: t("status.paired") });
    setModal(null);
    await refresh();
    return result;
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

  async function setChargingAnimation(enabled: boolean) {
    setBusy("settings:charging-animation");
    try {
      setSettings(await window.adbSuite.setChargingAnimation(enabled));
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
    <div
      aria-busy={busy !== null && !busy.startsWith("modal:")}
      className={`app-shell${busy !== null && !busy.startsWith("modal:") ? " is-busy" : ""}`}
    >
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
                      chargingAnimation={settings.chargingAnimation}
                      group={group}
                      key={group.key}
                      onConnect={(target) => action(`connect:${target.serial}`, () => window.adbSuite.connect(target.serial))}
                      onDisconnect={(target) => {
                        const saved = settings.savedConnections.find((connection) => (
                          connection.endpoint === target.serial
                          || (target.hardwareSerial && connection.hardwareSerial === target.hardwareSerial)
                        ));
                        const endpoint = saved?.endpoint || target.serial;
                        action(`disconnect:${endpoint}`, () => window.adbSuite.disconnect(endpoint));
                      }}
                      onEnableWireless={(serial) => action(`wifi:${serial}`, () => window.adbSuite.enableWireless(serial))}
                      onInfo={(target, name) => setInfoTarget({ serial: target.serial, name })}
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

      {busy && !busy.startsWith("modal:") && (
        <div aria-hidden="true" className="busy-layer" />
      )}

      {modal && (
        <ConnectionModal
          busy={busy?.startsWith("modal:") || false}
          initialEndpoint={modalEndpoint}
          key={`${modal}:${modalEndpoint}`}
          mode={modal}
          onCancelPairing={() => window.adbSuite.cancelPairing()}
          onClose={() => setModal(null)}
          onQrPair={pairByQr}
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
          onToggleChargingAnimation={setChargingAnimation}
          onToggleGlobal={setAutoReconnect}
        />
      )}

      {infoTarget && (
        <DeviceInfoModal
          name={infoTarget.name}
          serial={infoTarget.serial}
          onClose={() => setInfoTarget(null)}
        />
      )}

    </div>
  );
}
