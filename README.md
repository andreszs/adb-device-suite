![GitHub package.json version](https://img.shields.io/github/package-json/v/andreszs/adb-device-suite?color=FF6D00&label=main&logo=github) [![CI](https://github.com/andreszs/adb-device-suite/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/andreszs/adb-device-suite/actions/workflows/ci.yml) ![GitHub license](https://img.shields.io/github/license/andreszs/adb-device-suite)

# ADB Device Suite

**Manage Android devices without the terminal.**

ADB Device Suite is a local-first desktop application for discovering, pairing, connecting and reconnecting Android devices over ADB. It is designed for developers who want the convenience of Android Studio's device connection tools without keeping an IDE or terminal open.

> [!NOTE]
> This project is under active development. The current `0.1.x` release line focuses on reliable device discovery and wireless ADB connections.

## Table of contents

- [Screenshots](#screenshots)
- [Features](#features)
- [Requirements](#requirements)
- [Development](#development)
- [How wireless connections work](#how-wireless-connections-work)
  - [Android 11 and newer](#android-11-and-newer)
  - [Classic USB-to-Wi-Fi flow](#classic-usb-to-wi-fi-flow)
- [Packaging and releases](#packaging-and-releases)
- [Security](#security)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Screenshots

![ADB Device Suite main window showing connected Android devices](docs/screenshots/main-window.png)

![ADB Device Suite settings dialog](docs/screenshots/settings-dialog.png)

## Features

- Pair devices for wireless debugging by QR code or pairing code.
- Discover wireless devices automatically through mDNS.
- Switch authorized USB devices to ADB over Wi-Fi with one click.
- Combine each device's USB and Wi-Fi connections in one card.
- Reconnect saved devices after IP address or port changes.
- Monitor connection, Android version, IP address, battery and charging source.
- Inspect detailed hardware, software, security and network information for every device.
- Reconnect, disconnect, rename and remove devices from the main window.
- Copy IP addresses or export diagnostics as JSON.

## Requirements

- Android SDK Platform-Tools (`adb`). The app detects common Android Studio SDK locations automatically, or you can select the executable manually.
- USB debugging or Wireless debugging enabled in Android Developer options.
- For wireless connections, the computer and Android device must be able to reach one another on the same local network.

mDNS discovery depends on multicast traffic being allowed by the network. Guest Wi-Fi, client isolation, VLAN boundaries and some corporate access points may block it. The suite falls back to the last known endpoint when discovery is unavailable. Classic `adb tcpip 5555` may be disabled by a device reboot, in which case USB is required to enable it again.

Download Platform-Tools from the [official Android developer site](https://developer.android.com/tools/releases/platform-tools).

## Development

Requires Node.js 22 or later.

```bash
npm install
npm run dev
```

Other useful commands:

```bash
npm test        # parser and validation tests
npm run build   # type-check and build the renderer
npm run dist    # create a package for the current operating system
npm run dist:store # create the Windows Store package
```

## How wireless connections work

### Android 11 and newer

1. Open **Developer options → Wireless debugging** on the Android device.
2. Choose **Pair device with pairing code**.
3. In ADB Device Suite, select **Pair device** and enter the pairing endpoint and six-digit code.
4. Connect using the endpoint advertised by the device. Pairing and connection ports are usually different.

### Classic USB-to-Wi-Fi flow

1. Connect and authorize the Android device over USB.
2. Select **Use over Wi-Fi** in its device card.
3. The suite asks ADB to listen on TCP port 5555 and reconnects using the device's current Wi-Fi address.

## Packaging and releases

Pushing a version tag such as `v0.1.0` runs the release workflow for:

- Windows x64 (`.exe` installer)
- Microsoft Store x64 (`.appx`, accepted by the Store's MSIX submission flow)
- macOS Apple Silicon (`.dmg`)
- macOS Intel (`.dmg`)

The Store package uses the identity reserved for ADB Device Suite in Partner Center. Microsoft signs it during Store certification, so no separate Windows code-signing certificate is required. The standalone Windows installer remains unsigned, and macOS builds should be signed and notarized before they are promoted as stable downloads.

## Security

ADB Device Suite invokes the local `adb` executable with structured argument arrays and never interpolates device values into a shell command. Android's existing ADB keys and authorization flow remain in control. Saved connection endpoints and optional device aliases are stored only in Electron's local application-data directory.

Only enable wireless debugging on networks you trust.

## Roadmap

- Richer hardware information
- APK installation and package management
- File transfer
- Logcat viewer and export
- Screenshots and screen recording
- Common reboot and developer actions

## Contributing

Contributions are welcome. You can help improve ADB Device Suite by:

- Reporting reproducible bugs through [GitHub Issues](https://github.com/andreszs/adb-device-suite/issues).
- Suggesting focused features that keep the application practical and developer-oriented.
- Improving documentation, platform compatibility and automated tests.
- Submitting pull requests with a clear description of the change and how it was tested.

Before opening a pull request, run `npm test` and `npm run build` locally.

UI translations live in `src/locales/<locale>/ui.json`. English is the reference catalog; `npm test` reports any missing key in the other languages.

### Support development ☕💙

If ADB Device Suite is useful to you, consider supporting ongoing development and maintenance. Contributions help cover development tools and resources, enabling faster debugging, testing and quality-of-life improvements. 🛠️⚡

<p align="left">
  <a href="https://ko-fi.com/D1D716OLPM" target="_blank" rel="noopener noreferrer"><img alt="Ko-fi" src="https://img.shields.io/badge/Ko--fi-SUPPORT-ff4d4d?style=for-the-badge&labelColor=2b2b2b&logo=kofi&logoColor=white"></a>
  <a href="https://www.paypal.com/ncp/payment/GEEM324PDD9NC" target="_blank" rel="noopener noreferrer"><img alt="PayPal" src="https://img.shields.io/badge/PayPal-DONATE-3b82f6?style=for-the-badge&labelColor=2b2b2b&logo=paypal&logoColor=white"></a>
  <a href="#usdc-arbitrum" rel="noopener noreferrer"><img alt="USDC (Arbitrum)" src="https://img.shields.io/badge/USDC-ARBITRUM-fbbf24?style=for-the-badge&labelColor=2b2b2b&logo=usdcoin&logoColor=white"></a>
</p>

> [!NOTE]
> If you cannot contribute financially, starring the repository is greatly appreciated. ⭐

<a id="usdc-arbitrum"></a>

#### USDC (Arbitrum network) address 🪙

```text
0xe36a336fC6cc9Daae657b4A380dA492AB9601e73
```

## License

[MIT](LICENSE) © Andrés Zsögön.

ADB Device Suite is an independent open-source project and is not affiliated with or endorsed by Google. Android and ADB are referenced solely to describe compatibility with Android SDK Platform-Tools.
