#!/bin/sh
# TW Control — git-free bootstrap for macOS / Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/SOAPeople-JohanSottovia/tw-control-install/main/bootstrap.sh | bash
#
# WHY THIS EXISTS
#   `npx github:...` asks npm to `git clone` the installer package, so a machine WITHOUT git fails
#   before any of our Node code runs (npm error: spawn git ENOENT). This bootstrap is fetched over
#   plain HTTPS (curl), verifies the prerequisites (Node + git), installs what it safely can, and
#   hands over to the real installer via npx. It is safe to re-run.

set -eu
REPO='github:SOAPeople-JohanSottovia/tw-control-install'

info() { printf '  %s\n' "$1"; }
step() { printf '\n> %s\n' "$1"; }
die()  { printf '\nX %s\n' "$1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

os="$(uname -s 2>/dev/null || echo unknown)"

printf '\n== TW Control - guided install ==\n'
info 'Verifying prerequisites (Node.js, git) before installing.'

# 1) Node.js — provides node + npm + npx. The installer (install.mjs) enforces the EXACT floor
#    (^22.22.3 || ^24.15.0 || >=26 — Electron 43 + Angular 22 workspaces). Here we do a coarse major
#    check and install/upgrade an obviously-too-old Node so the common case works in one shot.
node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'; }
node_ok() { local m; m="$(node_major)"; [ -n "$m" ] && [ "$m" -ge 22 ]; }
if have node && node_ok; then
  info "Node.js $(node -v): found"
else
  have node && info "Node.js $(node -v) is too old (need 22.22.3+) — installing a newer LTS"
  case "$os" in
    Darwin)
      if have brew; then
        step 'Installing/upgrading Node.js LTS via Homebrew (one-time)'
        brew install node || brew upgrade node || true
      fi ;;
    Linux)
      if have apt-get; then step 'Installing Node.js via apt (one-time; sudo may prompt)'; sudo apt-get update -y && sudo apt-get install -y nodejs npm || true
      elif have dnf; then step 'Installing Node.js via dnf (one-time)'; sudo dnf install -y nodejs || true
      fi ;;
  esac
  node_ok || die "Node.js 22.22.3+ is required (found: $(node -v 2>/dev/null || echo none)).
  macOS:  install it from https://nodejs.org  (or: brew install node)
  Linux:  use nvm (https://github.com/nvm-sh/nvm) or a distro package that provides Node 22.22.3+
  Then re-run this command."
  info "Node.js $(node -v): ready"
fi

# 2) git — needed by npx to fetch the installer, and again to clone the workspace repo.
if have git; then
  info 'git: found'
else
  case "$os" in
    Darwin)
      # `xcode-select --install` opens a GUI dialog that must finish before git exists — it cannot
      # be forced through silently, so guide the user rather than pretend to auto-install.
      die "git is missing.
  Run:  xcode-select --install   (accept the dialog, wait for it to finish)
  or:   brew install git
  Then re-run this command." ;;
    Linux)
      if have apt-get; then step 'Installing git via apt (one-time; sudo may prompt)'; sudo apt-get install -y git || true
      elif have dnf; then step 'Installing git via dnf (one-time)'; sudo dnf install -y git || true
      fi
      have git || die "git is missing. Install it with your package manager (e.g. sudo apt install git), then re-run." ;;
    *) die "git is missing. Install git for your platform, then re-run this command." ;;
  esac
  info 'git: installed'
fi

# 3) Hand over to the real installer (git now present → npm's github: clone works).
step 'Launching the TW Control installer'
exec npx --yes "$REPO" "$@"
