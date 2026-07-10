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

**1.** Install **Node.js LTS** from <https://nodejs.org> — the standard "next → next → finish"
installer. This is the *only* manual prerequisite.

**2.** Open a terminal — **PowerShell** on Windows, **Terminal** on macOS — and paste:

```sh
npx github:SOAPeople-JohanSottovia/tw-control-install
```

**3.** When a browser window opens, **sign in to GitHub** (first run only).

That's it. The **TW Control** icon appears on your desktop and the app launches.

> 🔄 **Updating** is the same command: re-running it pulls the latest version and rebuilds.
> Every step is idempotent — the script never breaks an existing installation.

## What you need

| Requirement | Why |
|---|---|
| Node.js LTS (≥ 18) | runs the installer, the app runtime and the embedded servers |
| A GitHub account **with access to the private `SOAPeople/team-workspace` repo** | it's the app's source — ask the AI Architect for an invitation |
| Windows 10/11 or macOS 11+ | the two supported desktops |

No compiler, no Visual Studio Build Tools, no Xcode: the only native module (`node-pty`)
ships prebuilt binaries for `win32-x64`, `win32-arm64`, `darwin-x64` and `darwin-arm64`.

## What the command actually does

Full transparency — the script runs exactly these steps, in this order, and tells you about
each one as it goes:

| # | Step | Windows | macOS |
|---|---|---|---|
| 1 | **Check Node** | refuses to continue below Node 18 | same |
| 2 | **git** | installed silently via `winget install Git.Git` if missing (a Windows confirmation may appear) | guidance if missing (`xcode-select --install`) |
| 3 | **Claude CLI** | official installer (`irm https://claude.ai/install.ps1`), `npm -g` fallback; *best-effort* — the app guides you later if still missing | official installer (`curl https://claude.ai/install.sh`), same fallback |
| 4 | **GitHub sign-in + checkout** | `git clone` of the private repo into `~/SOAPeople/team-workspace` — Git Credential Manager (ships with Git for Windows) opens the browser sign-in; `gh` CLI as fallback. Already cloned? `git pull --ff-only` instead. | same; the `gh` CLI device flow is the smoothest sign-in |
| 5 | **Build & install the app** | hands over to `control/install.mjs` inside the checkout: installs the app dependencies (Electron, the Angular renderer, the embedded server's `express` + `node-pty`), builds the renderer, stages a launcher in `%LOCALAPPDATA%\TW Control`, puts a shortcut on the desktop, launches | same, staged as a real `TW Control.app` bundle in `~/Applications` |

The app deliberately lives **inside the git checkout**: updating the checkout *is* updating
the app — one version mechanism, no separate auto-updater.

## Options

```
npx github:SOAPeople-JohanSottovia/tw-control-install [options]

--dir <path>     where to clone the workspace repo   (default: ~/SOAPeople/team-workspace)
--repo <url>     repository to clone                 (default: SOAPeople/team-workspace)
--branch <name>  branch to clone                     (default: the repo's default branch)
--clone-only     prepare the checkout, skip the app build/install
--path <dir>     custom app staging directory        (forwarded to control/install.mjs)
--no-shortcut    skip the desktop shortcut           (forwarded)
--no-launch      do not launch the app at the end    (forwarded)
```

## Troubleshooting

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

Delete three things (no registry entries, no services):

| What | Windows | macOS |
|---|---|---|
| App launcher | `%LOCALAPPDATA%\TW Control` | `~/Applications/TW Control.app` |
| Desktop shortcut | `Desktop\TW Control.lnk` | `Desktop/TW Control.app` |
| Checkout (your choice) | `%USERPROFILE%\SOAPeople\team-workspace` | `~/SOAPeople/team-workspace` |

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
cp control/installer/bin/install.mjs <mirror>/bin/
cd <mirror> && git commit -am "sync installer" && git push
```

Publishing to the npm registry later (for a `npx @soapeople/tw-control` short form) only
requires the `soapeople` npm organisation and `npm publish` from this folder — the package
is already scoped-public via `publishConfig`.

---

<p align="center">© SOA People — IP Team. Proprietary; all rights reserved.<br>
The installer may be freely run to install TW Control.</p>
