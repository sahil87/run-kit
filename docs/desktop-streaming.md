# Desktop Streaming

run-kit can stream graphical desktops to the browser alongside terminal windows, using Xvfb + x11vnc + noVNC.

## Requirements

**Required packages:**
- `xvfb` — virtual framebuffer (fake X display)
- `x11vnc` — VNC server that streams an X display

**Optional (for desktop environments):**
- `dbus-run-session` — provides isolated D-Bus session (needed for Plasma, GNOME, Xfce)
- A window manager or desktop environment (KDE Plasma, GNOME, Xfce, Openbox, i3, etc.)
- `websockify` — not required (run-kit has a built-in WebSocket-to-TCP relay)

**Linux only.** macOS does not have Xvfb. See [macOS Support](#macos-support) for alternatives.

Install on Ubuntu/Debian:
```bash
sudo apt install xvfb x11vnc
```

## How It Works

### Architecture

```
Browser ──WebSocket──▸ run-kit (Go relay) ──TCP──▸ x11vnc ──X11──▸ Xvfb
                             │
                      reads @rk_vnc_port
                      from tmux window option
```

1. **Xvfb** creates a virtual X display (e.g., `:33757` at 1920x1080)
2. **Desktop environment** (Plasma, GNOME, etc.) runs on that display
3. **x11vnc** captures the display and serves it over VNC protocol on a dynamic port
4. **run-kit's Go relay** bridges the browser's WebSocket to x11vnc's TCP port
5. **noVNC** (JavaScript VNC client) renders the desktop in the browser

### Window Type Detection

Desktop windows are identified by the `desktop:` name prefix in tmux (convention over configuration). Any window named `desktop:*` is treated as a desktop; everything else is a terminal.

The VNC port is stored as a tmux user window option (`@rk_vnc_port`) so the relay can discover it without any database or file-based state.

## What Happens When You Create a Desktop

### 1. API Call

Frontend sends `POST /api/sessions/{session}/windows` with `{type: "desktop"}`.

### 2. Port Allocation

The Go server allocates a free TCP port using `net.Listen("tcp", ":0")` and derives a display number from it. This avoids port collisions.

### 3. Tmux Window Creation

A tmux window named `desktop:N` is created. The VNC port is stored as `@rk_vnc_port` on the window.

### 4. Startup Script

A bash script is written to `/tmp/rk-desktop-{port}.sh` and executed via tmux `send-keys`. The script runs these steps in order:

#### a. Virtual Display
```bash
export DISPLAY=:33757
Xvfb :33757 -screen 0 1920x1080x24 &
```

#### b. Per-Desktop Isolation
```bash
DESKTOP_ID=desktop-33757
export XDG_RUNTIME_DIR=/run/user/1001/desktop-33757
export XDG_CONFIG_HOME=~/.config/desktop-33757
export XDG_DATA_HOME=~/.local/share/desktop-33757
export XDG_CACHE_HOME=~/.cache/desktop-33757
export XDG_STATE_HOME=~/.local/state/desktop-33757
```

This isolates app state per desktop — browsers, file managers, etc. each get their own config. Without this, opening Chrome on desktop 2 would show up on desktop 1 (single-instance detection via lock files in shared `$HOME`).

#### c. KDE Wallet Disable
```bash
cat > $XDG_CONFIG_HOME/kwalletrc << EOF
[Wallet]
Enabled=false
First Use=false
EOF
```

Virtual sessions have no PAM login, so KDE Wallet can't unlock. Without this, browsers block waiting for wallet timeout before loading any websites.

#### d. Chrome/Chromium Wrappers

Chrome ignores `XDG_CONFIG_HOME` — it hardcodes `~/.config/google-chrome/`. The script creates wrapper scripts that add `--user-data-dir` and `--password-store=basic`, plus patches `.desktop` files in `$XDG_DATA_HOME/applications/` so KDE's app launcher uses the wrappers.

#### e. Window Manager Detection

```bash
# Priority order:
1. x-session-manager (system default — often symlinks to startplasma-x11, gnome-session, etc.)
2. startplasma-x11 (KDE Plasma)
3. Probe list: kwin_x11, openbox, fluxbox, i3, xfwm4, mutter, kwin
```

If the resolved binary is a full desktop session (`startplasma-x11`, `gnome-session`, `xfce4-session`), it's wrapped with `dbus-run-session` for an isolated D-Bus.

#### f. VNC Server
```bash
x11vnc -display :33757 -rfbport 39657 -nopw -forever -shared -noxdamage
```

### 5. Browser Connection

noVNC connects to `wss://host/relay/{session}/{window}?server=rk-dev`. The Go relay reads `@rk_vnc_port` from the tmux window, dials the TCP port, and bridges WebSocket ↔ raw VNC.

## Desktop Environment Support

### KDE Plasma
- **Detected via**: `x-session-manager` → `startplasma-x11`, or `startplasma-x11` directly
- **Requires**: `dbus-run-session` (full session manager needs D-Bus)
- **Known issues**: `org.freedesktop.systemd1` activation fails (cosmetic — no systemd user scope), KDE Wallet disabled via config
- **Install**: `sudo apt install kde-plasma-desktop`

### GNOME
- **Detected via**: `x-session-manager` → `gnome-session`, or `mutter` in probe list
- **Requires**: `dbus-run-session`
- **Notes**: GNOME Shell requires a compositor. `mutter` works standalone as a window manager. Full `gnome-session` may need additional D-Bus services.
- **Install**: `sudo apt install gnome-session` (full) or `sudo apt install mutter` (WM only)

### Xfce
- **Detected via**: `x-session-manager` → `xfce4-session`, or `xfwm4` in probe list
- **Requires**: `dbus-run-session` for full session, bare `xfwm4` works without
- **Install**: `sudo apt install xfce4`

### Openbox
- **Detected via**: probe list
- **Requires**: nothing extra — lightweight, no D-Bus needed
- **Notes**: Minimal window manager. No taskbar, no desktop icons. Right-click for app menu.
- **Install**: `sudo apt install openbox`

### i3
- **Detected via**: probe list
- **Requires**: nothing extra
- **Notes**: Tiling window manager. Keyboard-driven. No desktop icons or taskbar by default.
- **Install**: `sudo apt install i3`

### No Window Manager
- If nothing is detected, the desktop runs bare X11
- Apps can be launched but have no window decorations (no title bars, no move/resize)
- Useful for single full-screen apps (e.g., a browser in kiosk mode)

### Adding Support for Other DEs

The detection logic is in `app/backend/api/windows.go` in the `desktopStartupScript` function. To add a new DE:

1. Add it to the probe list: `for wm in ... your-wm ...`
2. If it needs D-Bus, add its resolved path to the `NEEDS_DBUS` case pattern
3. Rebuild and restart

## Resolution Management

- Default: 1920x1080
- Changed via command palette or bottom bar resolution picker
- Portrait resolutions available for mobile viewing (720x1280, 1080x1920, 1440x2560)
- Resolution change sends C-c to kill the running session, then re-executes the startup script at the new size
- noVNC uses `scaleViewport` to fit the desktop to the browser with correct aspect ratio

## Per-Desktop Isolation

Each desktop gets isolated directories keyed by display number:

| Variable | Path | Purpose |
|----------|------|---------|
| `XDG_RUNTIME_DIR` | `/run/user/{uid}/desktop-{N}` | D-Bus sockets, pid files |
| `XDG_CONFIG_HOME` | `~/.config/desktop-{N}` | App configs, KDE settings |
| `XDG_DATA_HOME` | `~/.local/share/desktop-{N}` | App data, .desktop overrides |
| `XDG_CACHE_HOME` | `~/.cache/desktop-{N}` | App caches |
| `XDG_STATE_HOME` | `~/.local/state/desktop-{N}` | App state |

**What's isolated:** app configs, browser profiles (via wrappers), D-Bus sessions, KDE Wallet

**What's shared:** network (all desktops see the same ports), filesystem (`$HOME` itself), processes (can see each other via `ps`)

## Naming Convention

- Tmux window name: `desktop:{label}` (e.g., `desktop:1`, `desktop:browser`)
- The `desktop:` prefix is required for type detection
- Users can rename via the existing window rename feature — just keep the `desktop:` prefix
- Auto-numbered on creation: `desktop:1`, `desktop:2`, etc.

## macOS Support

macOS does not have Xvfb or X11. run-kit uses the built-in Screen Sharing VNC server instead.

### Current: Screen Sharing (Option 1)

macOS has a built-in VNC server. run-kit connects to it on port 5900 — you see your real Mac screen in the browser.

**Setup:**

1. Open **System Settings → General → Sharing**
2. Enable **Screen Sharing**
3. (Optional) Under Screen Sharing options, set a VNC password if you want authentication

That's it. When you create a desktop window on a Mac, run-kit detects macOS and connects to port 5900 instead of starting Xvfb.

**Limitations:**
- One screen — you see the real Mac display, not a virtual one
- No multiple isolated desktops (all desktop windows show the same screen)
- Resolution change not supported (it's the physical display)
- No per-desktop app isolation (there's only one desktop)

### Future: Docker-based Linux desktops (Option 2)

Run a lightweight Linux container with Xvfb + x11vnc inside it. Reuses the entire Linux desktop stack.

```bash
# Conceptual — not yet implemented
docker run -d --name desktop-1 \
  -e DISPLAY=:1 \
  ubuntu-desktop-vnc  # hypothetical image with Xvfb + x11vnc + DE
```

**What this gives you:**
- Multiple isolated desktops on Mac (each container = one desktop)
- Full isolation (network, filesystem, ports)
- Same Xvfb + x11vnc stack as Linux
- Works on any Mac with Docker

**What it costs:**
- Docker Desktop required
- Heavier (VM overhead)
- More complex lifecycle management

### Future: Native virtual displays (Option 3)

macOS 14+ has `CGVirtualDisplay` — a private API for creating virtual displays without hardware. Used by apps like BetterDisplay.

**What this would need:**
- A Swift/ObjC helper binary that creates virtual displays
- Screen capture via `ScreenCaptureKit` (macOS 12.3+) + VNC encoding
- Screen Recording permission from the user

**What it gives you:**
- Native performance, no VM
- Multiple virtual displays possible
- True macOS desktop experience per desktop

**What it costs:**
- Significant native code (Swift/Rust)
- Private APIs may break across macOS versions
- macOS 14+ only for virtual displays, 12.3+ for screen capture

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Black screen | Xvfb or x11vnc not installed | `sudo apt install xvfb x11vnc` |
| Black screen, processes running | noVNC canvas has zero dimensions | Check that the DesktopClient container has `w-full h-full` |
| Desktop appears then disappears | activeWindow sync navigating away | Check that `isDesktopRef.current` check is working |
| Browser opens on wrong desktop | Single-instance detection via shared profile | Ensure XDG isolation is working, check Chrome `--user-data-dir` |
| KDE Wallet timeout, browser won't load | No PAM session to unlock wallet | `kwalletrc` should have `Enabled=false` |
| Plasma not starting | Startup script too long for tmux send-keys | Script should be written to temp file, not sent inline |
| `x11vnc: not found` | x11vnc not installed | `sudo apt install x11vnc` |
| `x11vnc -ws` error | Old x11vnc version doesn't support WebSocket | run-kit uses raw TCP relay, `-ws` flag not needed |
| Renamed desktop shows terminal | Name lost `desktop:` prefix | Rename back to `desktop:{name}` |
