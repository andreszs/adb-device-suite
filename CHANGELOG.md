# Changelog

All notable changes to ADB Device Suite will be documented in this file.

## [Unreleased]

### Changed

- Connected devices and saved connections are sorted naturally by device name, case-insensitively.

### Fixed

- USB and Wi-Fi transports remain grouped when USB metadata is temporarily unavailable but its ADB serial matches the device hardware serial.

## [0.1.5] - 2026-10-28

### Fixed

- Saved devices reconnect through their current mDNS endpoint first and fall back to the last valid IP address.
- TLS service names are no longer treated as manual `IP:port` endpoints, and affected saved records migrate automatically after discovery.
- The latest status-bar error remains visible instead of disappearing after five seconds.

### Added

- Device cards use Android's configured device name as their primary name, with Bluetooth name and model fallbacks.

### Changed

- The charging indicator now uses a continuous succession of longer, slower waves.
- Battery-level fills are inset from device-card edges and model names use a darker, more legible tone.

### Removed

- Manual device aliases and their local persistence, now superseded by Android's dynamically reported device name.

## [0.1.4] - 2026-10-28

### Added

- Connected devices now refresh battery level and charging state every five seconds while the application is visible.
- Device cards highlight batteries at or below Android's 15% low-battery threshold and show the remaining percentage on hover.
- Charging cards use a mint battery-level background with an optional electric-green activity sweep.

### Changed

- Battery readings are collected independently from cached device metadata for faster charging-state updates.
- Battery icons are green only while Android reports active charging; full and non-charging batteries remain gray.
- Battery polling pauses while the window is hidden or minimized and resumes immediately when it regains focus.

### Fixed

- Use over Wi-Fi now reports success only after ADB verifies the network transport as connected.
- Older Android devices with CRCRLF-formatted `getprop` output are parsed correctly and group their USB and Wi-Fi transports into one device card.
- Temporary metadata failures are retried instead of being cached as incomplete device identities.

## [0.1.3] - 2026-10-26

### Added

- Connected device cards now provide an Info action with an on-demand, organized overview of identity, Android build, hardware, storage, battery, networking, security and platform features.
- Connected device cards visualize battery level and charging state, with an optional animated highlight over the charging bar.
- ADB transport tracking refreshes the device list immediately when USB or Wi-Fi connections change, with periodic polling retained as a fallback.

### Changed

- Successful wireless pairing now returns control immediately while ADB completes its automatic Wi-Fi connection in the background.
- Device cards use clearer typography, compact battery indicators and borderless action buttons with hover feedback.
- Settings focuses on global reconnection, charging animation, language and ADB executable preferences; saved devices remain managed from the main window.
- The main content scrolls independently while the native-style status bar remains fixed and visible.
- The README now includes concise features, a table of contents, repository badges and updated application screenshots.

### Fixed

- The QR pairing dialog remains responsive while waiting for a device and no longer presents a false connection failure after pairing succeeds.
- USB attach and detach events are reflected without waiting for the fallback polling interval or requiring a manual refresh.
- Offline Wi-Fi devices no longer expose actions that imply an active connection.
- Device information collection tolerates manufacturer-specific command failures and reports unavailable fields without failing the entire dialog.

## [0.1.2] - 2026-10-26

### Changed

- Pairing by six-digit code now continues through discovery and connection of the final ADB TLS endpoint before reporting success.
- The pairing dialog remains open with explicit paired-and-connecting feedback until the device is connected or the 20-second timeout expires.
- Pairing, connection and method controls remain disabled while a wireless pairing operation is active.

### Fixed

- A second pairing operation can no longer start while another pairing or post-pairing connection is still in progress.
- Pairing-code users are no longer returned to an actionable Nearby pairing entry while ADB is still establishing the final connection.
- Abort listeners used while polling mDNS are released after each completed delay instead of accumulating during longer pairing attempts.

## [0.1.1] - 2026-10-25

### Added

- Android 11+ wireless pairing through scannable QR codes with temporary credentials.
- Explicit pairing and connection progress states, including a connection activity indicator and timeout feedback.
- Localized QR pairing messages across every supported application language.

### Changed

- QR pairing now continues from successful authentication to the separate ADB wireless connection step before reporting completion.
- The QR code expires after 120 seconds, and the post-pairing connection attempt stops after 20 seconds.
- The minimum window height is increased to 660 px so the QR dialog fits with balanced vertical margins.
- Offline wireless transports are presented as saved connections with separate reconnect and remove actions.
- The device-list heading now describes all ADB transports instead of implying that every listed transport is connected.

### Fixed

- Expired QR codes are removed instead of remaining visible and scannable after their pairing service has stopped.
- A successful QR pairing no longer closes the dialog before ADB has attempted to connect to the device.
- Offline devices no longer display a misleading Disconnect Wi-Fi action.

## [0.1.0] - 2026-10-24

### Added

- Initial Electron and React desktop application.
- Automatic ADB discovery on Windows and macOS.
- USB and Wi-Fi device listing with Android metadata.
- Android 11+ pairing-code workflow and mDNS discovery.
- Classic USB-to-TCP/IP connection workflow.
- Saved wireless endpoints and one-click reconnection.
- Persistent light, dark and system-following theme modes, with light as the first-run default.
- Material icons rendered at their native square aspect ratio.
- Compact device layout sized to show five connected devices without vertical scrolling at the default window size.
- Flat interaction styling with restrained shadows and position-stable hover states.
- Compact borderless uppercase status badges with sharp text and restrained electric-green accents.
- Technical monospaced typography for device names.
- Automatic reconnection with a disconnect grace period and bounded retry backoff.
- mDNS identity tracking for devices whose IP address or connection port changes.
- Global and per-device auto-reconnect controls in a dedicated Settings dialog.
- Reconnect states for connected, waiting, paused and USB-required devices.
- Support for legacy and official three-column `adb mdns services` output.
- Two-line device cards with unified, larger metadata typography and a subdued device ID.
- Connected devices are omitted from the redundant Saved connections section and remain manageable in Settings.
- Inline local device aliases shared across USB and Wi-Fi without hiding the hardware model.
- Horizontal overflow is suppressed at every supported window size, without triggering a redundant vertical scrollbar.
- Settings cards use consistent, more legible typography and keep alias editing on device cards only.
- The main view shows only ADB status and version; the executable path is reserved for Settings.
- Every button, toggle and action link includes a descriptive tooltip.
- The default window width is reduced to 980 px for a denser layout while preserving room for five devices.
- USB and Wi-Fi transports belonging to the same physical device are grouped into one card and counted once.
- USB and Wi-Fi indicators occupy opposite lower corners with larger, undistorted square glyphs.
- New windows open at the supported minimum size of 900 × 620 px by default.
- The landing-style workspace hero is removed so the solid application header and device list lead the visual hierarchy.
- The application icon now combines a compact Android-inspired head with two subtle Wi-Fi signal arcs.
- A persistent footer link provides direct access to the maintainer's GitHub profile.
- The footer is now a legible, flat native-style status bar with platform typography for Windows and macOS.
- Blocking ADB actions now display an operation indicator, prevent duplicate interaction, and use the native wait cursor across the window.
- The two-panel status bar now carries ready, progress, success, and error messages alongside the persistent GitHub link.
- A compact status-bar panel displays the running application version reported by Electron.
- Clicking the version panel checks the latest published GitHub release and exposes a download link when an update is available.
- Local release packaging for Windows and macOS.
- Microsoft Store AppX packaging with the reserved Partner Center identity and Store-managed signing.
- Store builds exclude renderer dependencies already bundled by Vite and retain only supported Chromium locales, substantially reducing download and installed size.
