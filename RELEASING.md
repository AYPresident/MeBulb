# Building and releasing MeBulb

MeBulb ships as **portable** builds — no installer, no admin rights. The user
unzips (or untars) and runs the app in place, which suits locked-down site PCs
and USB/Egnyte distribution.

## Prerequisites

- Node.js 18+ and the repo's dev dependencies (`npm ci`).
- Electron 44.10.0 binaries for each target, placed where the build expects
  them (overridable by env var):

  | Target        | Default path                      | Env var              |
  |---------------|-----------------------------------|----------------------|
  | Windows x64   | `/tmp/dl/electron-win.zip`        | `ELECTRON_WIN`       |
  | Linux x64     | `/tmp/dl/electron-linux.zip`      | `ELECTRON_LINUX_ZIP` |
  | macOS arm64   | `/tmp/dl/electron-darwin-arm64.zip` | `ELECTRON_MAC_ARM64` |
  | macOS x64     | `/tmp/dl/electron-darwin-x64.zip` | `ELECTRON_MAC_X64`   |

  Download them from the Electron releases:
  `https://github.com/electron/electron/releases/tag/v44.10.0`
  (files named `electron-v44.10.0-<platform>-<arch>.zip`).

- `convert` (ImageMagick) — used once to regenerate the macOS icon.

## Build

```sh
node build.js                       # web build -> dist/mebulb.html
node desktop/make-icns.js           # (re)generate desktop/assets/icon.icns from icon.png
node desktop/build-desktop.js --all # win + mac (arm64, x64) + linux -> dist/
```

Individual targets: `--win`, `--mac`, `--linux`. Output:

- `dist/MeBulb-<ver>-portable-win-x64.zip`
- `dist/MeBulb-<ver>-portable-mac-arm64.zip`
- `dist/MeBulb-<ver>-portable-mac-x64.zip`
- `dist/MeBulb-<ver>-portable-linux-x64.tar.gz`

The version comes from `desktop/package.json`.

## What each package contains

- **Windows** — `MeBulb.exe` (icon and version info patched in) plus the
  Electron runtime and `resources/app`. Run `MeBulb.exe`.
- **macOS** — `MeBulb.app`, renamed from Electron with the Info.plist and icon
  rebranded. The app is **unsigned and un-notarized**, so first launch needs
  right-click ▸ Open (or `xattr -dr com.apple.quarantine MeBulb.app`). Ship both
  arm64 (Apple Silicon) and x64 (Intel).
- **Linux** — a `MeBulb/` folder with the `mebulb` binary, a `MeBulb` launcher
  script (passes `--no-sandbox`, since the portable build has no setuid
  chrome-sandbox), a `.desktop` file and icon. Extract and run `./MeBulb/MeBulb`.

## Release

1. Build with `--all` and confirm `xvfb-run -a node test/desktop.js` passes.
2. Tag and create the GitHub release, attaching the four files from `dist/`:

```sh
gh release create v<ver> \
  dist/MeBulb-<ver>-portable-win-x64.zip \
  dist/MeBulb-<ver>-portable-mac-arm64.zip \
  dist/MeBulb-<ver>-portable-mac-x64.zip \
  dist/MeBulb-<ver>-portable-linux-x64.tar.gz \
  --title "MeBulb <ver>" --notes-file <notes>
```

## Signing (not yet done)

The macOS and Windows builds are unsigned. For wider distribution:

- **Windows**: an Authenticode certificate (OV or EV) to avoid SmartScreen
  warnings.
- **macOS**: an Apple Developer ID plus notarization to avoid Gatekeeper
  blocking the app.

Both require the respective OS (and paid certificates) and are out of scope for
the current cross-built portable packages.
