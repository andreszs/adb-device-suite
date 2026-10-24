function normalized(value) {
  return value?.trim().toLowerCase() || null;
}

export function savedConnectionMatchesDevice(saved, device) {
  const savedHardwareSerial = normalized(saved.hardwareSerial)
    || (saved.id.startsWith("serial:") ? normalized(saved.id.slice("serial:".length)) : null);
  const deviceHardwareSerial = normalized(device.hardwareSerial);

  if (savedHardwareSerial && deviceHardwareSerial) {
    return savedHardwareSerial === deviceHardwareSerial;
  }

  return device.connection === "wifi"
    && normalized(saved.endpoint) === normalized(device.serial);
}

export function mdnsServiceMatchesDevice(service, device) {
  if (device.connection !== "wifi") return false;
  if (normalized(service.endpoint) === normalized(device.serial)) return true;

  const hardwareSerial = normalized(device.hardwareSerial);
  const serviceName = normalized(service.serviceName);
  if (!hardwareSerial || !serviceName) return false;

  const prefix = `adb-${hardwareSerial}`;
  return serviceName === prefix || serviceName.startsWith(`${prefix}-`);
}
