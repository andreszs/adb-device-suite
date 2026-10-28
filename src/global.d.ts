export {};

declare global {
  interface Window {
    adbSuite: {
      getAppVersion: () => Promise<string>;
      checkForUpdates: () => Promise<UpdateCheckResult>;
      getSnapshot: () => Promise<AdbSnapshot>;
      getDeviceInfo: (serial: string) => Promise<DeviceInfo>;
      getSettings: () => Promise<AppSettings>;
      connect: (endpoint: string) => Promise<ActionResult>;
      disconnect: (endpoint: string) => Promise<ActionResult>;
      pair: (endpoint: string, code: string) => Promise<ActionResult>;
      pairByQr: (serviceName: string, password: string) => Promise<ActionResult>;
      cancelPairing: () => Promise<void>;
      enableWireless: (serial: string) => Promise<ActionResult>;
      restartServer: () => Promise<ActionResult>;
      chooseAdb: () => Promise<{ settings: AppSettings; snapshot: AdbSnapshot } | null>;
      setAutoReconnect: (enabled: boolean) => Promise<AppSettings>;
      setChargingAnimation: (enabled: boolean) => Promise<AppSettings>;
      setThemePreference: (themePreference: "light" | "dark" | "auto") => Promise<AppSettings>;
      setLanguagePreference: (languagePreference: LanguagePreference) => Promise<{ settings: AppSettings; resolvedLanguage: AppLanguage }>;
      setConnectionAutoReconnect: (id: string, enabled: boolean) => Promise<AppSettings>;
      setDeviceAlias: (identifier: string, alias: string) => Promise<AppSettings>;
      forgetConnection: (identifier: string) => Promise<AppSettings>;
      openExternal: (url: string) => Promise<void>;
      onSnapshot: (callback: (snapshot: AdbSnapshot) => void) => () => void;
      onSettings: (callback: (settings: AppSettings) => void) => () => void;
      onPairingProgress: (callback: (progress: PairingProgress) => void) => () => void;
    };
  }

  interface PairingProgress {
    method: "code" | "qr";
    phase: "connecting" | "pending";
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
    battery?: {
      level: number | null;
      status: "unknown" | "charging" | "discharging" | "notCharging" | "full";
      sources: string[];
    } | null;
  }

  interface DeviceInfo {
    serial: string;
    identity: {
      brand: string | null;
      manufacturer: string | null;
      model: string | null;
      product: string | null;
      device: string | null;
      hardwareSerial: string | null;
    };
    system: {
      androidVersion: string | null;
      sdk: string | null;
      skinName: string | null;
      skinVersion: string | null;
      securityPatch: string | null;
      buildId: string | null;
      buildType: string | null;
      buildTags: string | null;
      buildFingerprint: string | null;
      kernel: string | null;
      uptimeSeconds: number | null;
      locale: string | null;
      timeZone: string | null;
      bootReason: string | null;
      developerOptions: boolean | null;
    };
    hardware: {
      platform: string | null;
      cpuModel: string | null;
      cpuCores: number | null;
      cpuAbis: string[];
      ramTotalBytes: number | null;
      ramAvailableBytes: number | null;
      screen: { resolution: string | null; densityDpi: number | null; orientation: "portrait" | "landscape" | null; rotation: number | null };
      storage: { totalBytes: number | null; usedBytes: number | null; availableBytes: number | null; usedPercent: number | null };
    };
    battery: {
      level: number | null;
      status: "unknown" | "charging" | "discharging" | "notCharging" | "full";
      health: "unknown" | "good" | "overheat" | "dead" | "overVoltage" | "failure" | "cold";
      temperatureC: number | null;
      voltageMv: number | null;
      technology: string | null;
      sources: string[];
    };
    network: {
      interfaces: Array<{ name: string; address: string }>;
      routes: string[];
      wifiEnabled: boolean | null;
      airplaneMode: boolean | null;
    };
    security: {
      encryption: string | null;
      encryptionType: string | null;
      verifiedBoot: string | null;
      bootloader: string | null;
      selinux: string | null;
      adbSecure: boolean | null;
    };
    features: string[];
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
    chargingAnimation: boolean;
    deviceAliases: Record<string, string>;
    savedConnections: SavedConnection[];
    themePreference: "light" | "dark" | "auto";
    languagePreference: LanguagePreference;
  }

  type AppLanguage = "en" | "de" | "es" | "fr" | "hi" | "pt" | "ru" | "ja" | "ko" | "zh-CN" | "zh-TW";
  type LanguagePreference = AppLanguage | "system";

  interface ActionResult {
    endpoint?: string;
    hardwareSerial?: string;
    message: string;
    pendingConnection?: boolean;
    verified?: boolean;
    settings?: AppSettings;
  }
}
