export {};

declare global {
  interface Window {
    adbSuite: {
      getAppVersion: () => Promise<string>;
      checkForUpdates: () => Promise<UpdateCheckResult>;
      getSnapshot: () => Promise<AdbSnapshot>;
      getSettings: () => Promise<AppSettings>;
      connect: (endpoint: string) => Promise<ActionResult>;
      disconnect: (endpoint: string) => Promise<ActionResult>;
      pair: (endpoint: string, code: string) => Promise<ActionResult>;
      pairByQr: (serviceName: string, password: string) => Promise<ActionResult>;
      cancelQrPairing: () => Promise<void>;
      enableWireless: (serial: string) => Promise<ActionResult>;
      restartServer: () => Promise<ActionResult>;
      chooseAdb: () => Promise<{ settings: AppSettings; snapshot: AdbSnapshot } | null>;
      setAutoReconnect: (enabled: boolean) => Promise<AppSettings>;
      setThemePreference: (themePreference: "light" | "dark" | "auto") => Promise<AppSettings>;
      setLanguagePreference: (languagePreference: LanguagePreference) => Promise<{ settings: AppSettings; resolvedLanguage: AppLanguage }>;
      setConnectionAutoReconnect: (id: string, enabled: boolean) => Promise<AppSettings>;
      setDeviceAlias: (identifier: string, alias: string) => Promise<AppSettings>;
      forgetConnection: (identifier: string) => Promise<AppSettings>;
      openExternal: (url: string) => Promise<void>;
      onSnapshot: (callback: (snapshot: AdbSnapshot) => void) => () => void;
      onSettings: (callback: (settings: AppSettings) => void) => () => void;
      onQrPairingProgress: (callback: (progress: QrPairingProgress) => void) => () => void;
    };
  }

  interface QrPairingProgress {
    phase: "connecting";
    pairingEndpoint: string;
    connectionTimeoutSeconds: number;
  }

  interface AdbDevice {
    serial: string;
    state: string;
    connection: "usb" | "wifi";
    product: string | null;
    model: string | null;
    device: string | null;
    transportId: string | null;
    manufacturer?: string | null;
    androidVersion?: string | null;
    sdk?: string | null;
    hardwareSerial?: string | null;
    ipAddress?: string | null;
    ipAddresses?: string[];
  }

  interface UpdateCheckResult {
    status: "available" | "current" | "unavailable";
    currentVersion: string;
    latestVersion: string | null;
    releaseUrl: string | null;
    message: string;
  }

  interface MdnsService {
    serviceName: string;
    serviceType: string;
    endpoint: string;
    type: "pairing" | "connect" | "legacy";
  }

  interface AdbSnapshot {
    adb: {
      available: boolean;
      path: string | null;
      version: string | null;
      error: string | null;
    };
    devices: AdbDevice[];
    services: MdnsService[];
    refreshedAt: string;
  }

  interface SavedConnection {
    id: string;
    endpoint: string;
    label: string | null;
    hardwareSerial: string | null;
    mdnsServiceName: string | null;
    mode: "legacy" | "tls";
    autoReconnect: boolean;
    manuallyDisconnected: boolean;
    lastConnectedAt: string;
    lastSeenAt: string;
    reconnect?: {
      status: "connected" | "waiting" | "reconnecting" | "needs-usb" | "paused";
      attempts: number;
      nextAttemptAt: string | null;
      lastError: string | null;
    };
  }

  interface AppSettings {
    adbPath: string | null;
    autoReconnect: boolean;
    deviceAliases: Record<string, string>;
    savedConnections: SavedConnection[];
    themePreference: "light" | "dark" | "auto";
    languagePreference: LanguagePreference;
  }

  type AppLanguage = "en" | "de" | "es" | "fr" | "hi" | "pt" | "ru" | "ja" | "ko" | "zh-CN" | "zh-TW";
  type LanguagePreference = AppLanguage | "system";

  interface ActionResult {
    endpoint?: string;
    message: string;
    settings?: AppSettings;
  }
}
