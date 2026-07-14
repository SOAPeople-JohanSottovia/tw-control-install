<p align="center"><img src="assets/logo.png" width="340" alt="SOA People — IP Team"></p>

<h1 align="center">TW Control — one command, fully installed</h1>

<p align="center">
  <a href="#install"><img alt="install" src="https://img.shields.io/badge/install-one%20command-F6851F"></a>
  <img alt="platforms" src="https://img.shields.io/badge/platforms-Windows%20%7C%20macOS-254177">
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A5%2018%20LTS-339933">
  <img alt="dependencies" src="https://img.shields.io/badge/dependencies-zero-373064">
  <img alt="compiler" src="https://img.shields.io/badge/compiler%20needed-none-403359">
</p>

**TW Control** is the SOA People desktop console that pilots every *team workspace* from one
place: the consolidated multi-workspace board, the ticket workbench, interactive Claude
terminals, sprint planning — one native app, all your workspaces.

This repository is the **public installer** for it. It contains no secrets and no business
logic — only the guided-install script. The application itself lives in the private
`SOAPeople/team-workspace` repository; **access to that repo is what gates the install**.

## Install

Open a terminal and paste **one line**. It checks the machine, installs anything missing
(Node.js and Git included), then installs and launches TW Control.

**Windows** — open **PowerShell** and paste:

```powershell
irm https://raw.githubusercontent.com/SOAPeople-JohanSottovia/tw-control-install/main/bootstrap.ps1 | iex
```

**macOS / Linux** — open **Terminal** and paste:

```sh
curl -fsSL https://raw.githubusercontent.com/SOAPeople-JohanSottovia/tw-control-install/main/bootstrap.sh | bash
```

When a browser window opens, **sign in to GitHub** (first run only). That's it — the
**TW Control** icon appears on your desktop and the app launches.

> **Already have Node.js *and* Git?** You can skip the bootstrap and run the installer directly:
> ```sh
> npx github:SOAPeople-JohanSottovia/tw-control-install
> ```
> Use the one-liners above on a **fresh machine** — `npx github:…` asks npm to `git clone` the
> installer, so it fails with `spawn git ENOENT` when Git is not installed yet. The bootstrap
> installs Git first, so it works from a clean Windows/macOS install.

## Already installed? The same command becomes a real installer

When the script detects an existing installation (checkout, app, settings or shortcut), it
shows what it found — including whether a **new version is available** — and offers a menu:

| Choice | What it does |
|---|---|
| **Update** *(default)* | pulls the latest version, refreshes the required tools, re-stages the app |
| **Repair** | removes the binaries (staged app, `node_modules`) and reinstalls them — your **settings and registered workspaces are kept**. Only allowed when you are already on the latest version. |
| **Uninstall** | removes the app, launcher, shortcut, checkout, settings **and the whole `TWControl` data folder** (workspaces, worktrees, presets, plugin studio). Your cloned **workspace repositories are listed one by one — the ones you choose to keep survive the sweep**. Asks you to type `UNINSTALL`. |

Scripted equivalents: `--update`, `--repair`, `--uninstall` (with `--yes` to skip
confirmations). Every path is idempotent — the script never breaks an existing installation.

> 🔄 **You rarely need Update by hand**: TW Control checks for updates itself (at launch and
> every 6 hours), installs them silently, and shows a banner in the app — *"Update installed —
> restart TW Control to apply it"* — with a one-click Restart button.

## What you need

| Requirement | Why |
|---|---|
| A GitHub account **with access to the private `SOAPeople/team-workspace` repo** | it's the app's source — ask the AI Architect for an invitation |
| Windows 10/11 or macOS 11+ | the two supported desktops |

The bootstrap installs the software prerequisites for you — you no longer install Node.js by
hand. For reference, these are the tools it verifies and, where possible, installs automatically:

| Software | Role | Handled by |
|---|---|---|
| Node.js LTS (≥ 18) + npm | runs the installer, the app runtime and the embedded servers | auto (winget `OpenJS.NodeJS.LTS` / Homebrew / apt-dnf); else nodejs.org |
| Git | npm needs it to fetch the installer, and to clone the workspace repo | auto (winget `Git.Git` / `xcode-select --install` / apt-dnf); else git-scm.com |
| Claude CLI | plugin preflight + the in-app terminals | best-effort auto; the app guides you later if still missing |
| Electron runtime | the desktop app itself | auto-downloaded once by the installer (~120 MB) |
| node-pty | the interactive terminals | ships **prebuilt** — no compiler ever needed |

No compiler, no Visual Studio Build Tools, no Xcode, no front-end toolchain: the only native
module (`node-pty`) ships prebuilt binaries for `win32-x64`, `win32-arm64`, `darwin-x64` and
`darwin-arm64`, and the app's UI ships **prebuilt** inside the checkout — any Node LTS from
18 up works (the Angular CLI's stricter Node requirement applies to developers only).

## What the command actually does

Full transparency — the script runs exactly these steps, in this order, and tells you about
each one as it goes:

| # | Step | Windows | macOS |
|---|---|---|---|
| 0 | **Bootstrap** (git-free entry) | `bootstrap.ps1` installs Node.js LTS + Git via `winget` if either is missing, then calls the installer | `bootstrap.sh` verifies Node + Git (installs via Homebrew/apt where it safely can), then calls the installer |
| 1 | **Check Node + npm** | refuses to continue below Node 18; verifies npm | same |
| 2 | **git** | installed silently via `winget install Git.Git` if missing (a Windows confirmation may appear); PATH refreshed from the registry so the new binary is seen immediately | guidance if missing (`xcode-select --install`) |
| 3 | **Claude CLI** | official installer (`irm https://claude.ai/install.ps1`), `npm -g` fallback; *best-effort* — the app guides you later if still missing | official installer (`curl https://claude.ai/install.sh`), same fallback |
| 4 | **GitHub sign-in + checkout** | `git clone` of the private repo into `~/SOAPeople/team-workspace` — Git Credential Manager (ships with Git for Windows) opens the browser sign-in; `gh` CLI as fallback. Already cloned? `git pull --ff-only` instead. | same; the `gh` CLI device flow is the smoothest sign-in |
| 5 | **Install the app** | hands over to `control/install.mjs` inside the checkout: installs the app dependencies (Electron + the embedded server's `express` and `node-pty`), uses the **prebuilt** UI shipped in the checkout (no Angular build on your machine), stages a launcher in `%LOCALAPPDATA%\TW Control`, puts a shortcut on the desktop, launches | same, staged as a real `TW Control.app` bundle in `~/Applications` |

The app deliberately lives **inside the git checkout**: updating the checkout *is* updating
the app — one version mechanism, no separate auto-updater.

## Options

```
npx github:SOAPeople-JohanSottovia/tw-control-install [options]

--update         pull the latest version and re-stage the app (skips the menu)
--repair         reinstall binaries, keep settings & registered workspaces (latest version only)
--uninstall      remove app + checkout + settings + the whole TWControl data folder; you pick
                 which cloned workspace repos to keep — kept folders survive the sweep
--yes | -y       non-interactive: skip menus and confirmations

--dir <path>     where to clone the workspace repo   (default: ~/SOAPeople/team-workspace)
--repo <url>     repository to clone                 (default: SOAPeople/team-workspace)
--branch <name>  branch to clone                     (default: the repo's default branch)
--clone-only     prepare the checkout, skip the app build/install
--path <dir>     custom app staging directory        (forwarded to control/install.mjs)
--no-shortcut    skip the desktop shortcut           (forwarded)
--no-launch      do not launch the app at the end    (forwarded)
```

## Troubleshooting

- **`npm error syscall spawn git` / `spawn git ENOENT` / `errno -4058`** — Git is not installed,
  so `npx github:…` cannot fetch the installer. Use the **bootstrap one-liner** at the top of this
  page instead (`irm …bootstrap.ps1 | iex` on Windows) — it installs Git first, then continues.
- **"could not clone …" / permission denied** — your GitHub account has no access to the
  private repo yet. Ask the AI Architect for an invitation, then re-run the command.
  Smoothest sign-in path: install the [GitHub CLI](https://cli.github.com), run
  `gh auth login`, then re-run.
- **A Windows confirmation (UAC) pops up** — that's winget installing Git machine-wide.
  Accept it once; the script continues by itself.
- **"git is missing and winget is unavailable"** — install Git manually from
  <https://git-scm.com/download/win>, then re-run.
- **"claude CLI still missing" warning at the end** — the app installs and runs fine; it
  will guide you through the Claude CLI setup the first time a feature needs it.
- **Corporate network/proxy** — the script downloads from `github.com`, `claude.ai` and
  `registry.npmjs.org` only. If those are blocked, run it from a network where they are not.

## Uninstall

The built-in flow does it for you (and asks, folder by folder, which workspace repos to keep —
everything else, including the whole `TWControl` data folder, is removed):

```sh
npx github:SOAPeople-JohanSottovia/tw-control-install --uninstall
```

Manual equivalent — delete five things (no registry entries, no services):

| What | Windows | macOS |
|---|---|---|
| App launcher | `%LOCALAPPDATA%\TW Control` | `~/Applications/TW Control.app` |
| Desktop shortcut | `Desktop\TW Control.lnk` | `Desktop/TW Control.app` |
| Settings | `%APPDATA%\TW Control` | `~/Library/Application Support/TW Control` |
| Data folder (workspaces, worktrees, presets, plugin studio) | `%USERPROFILE%\TWControl` | `~/TWControl` |
| Checkout | `%USERPROFILE%\SOAPeople\team-workspace` | `~/SOAPeople/team-workspace` |

## Security & privacy

- This package is **three files and zero dependencies** — read `bin/install.mjs`, it's short.
- It stores **no credentials**: the GitHub sign-in is handled by Git Credential Manager or the
  `gh` CLI, exactly as if you had typed the commands yourself.
- It sends **no telemetry** and downloads only from github.com, claude.ai and the npm registry.

## For maintainers

The **source of truth** is `control/installer/` in the private `SOAPeople/team-workspace`
repository — edit there, then mirror to this public repo:

```sh
# from the private repo root
cp control/installer/package.json control/installer/README.md <mirror>/
cp control/installer/bootstrap.ps1 control/installer/bootstrap.sh <mirror>/
cp control/installer/bin/install.mjs <mirror>/bin/
cp control/installer/assets/logo.png <mirror>/assets/
cd <mirror> && git add -A && git commit -m "sync installer" && git push
```

> The `bootstrap.ps1` / `bootstrap.sh` one-liners are fetched from the mirror over
> `raw.githubusercontent.com`, so they only work once these files are pushed to the mirror's
> `main`. Always sync them together with `bin/install.mjs`.

Publishing to the npm registry later (for a `npx @soapeople/tw-control` short form) only
requires the `soapeople` npm organisation and `npm publish` from this folder — the package
is already scoped-public via `publishConfig`.

---

<p align="center">© SOA People — IP Team. Proprietary; all rights reserved.<br>
The installer may be freely run to install TW Control.</p>
