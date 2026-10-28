export function stableDeviceSerial(device: AdbDevice): string | null;
export function savedConnectionMatchesDevice(saved: SavedConnection, device: AdbDevice): boolean;
export function mdnsServiceMatchesDevice(service: MdnsService, device: AdbDevice): boolean;
