#!/usr/bin/env node
// TW Control — one-command bootstrap AND lifecycle manager.
//   npx github:SOAPeople-JohanSottovia/tw-control-install   (public mirror — the live channel)
//   npx @soapeople/tw-control                               (npm registry — if published later)
//
// Zero-dependency by design. Running under npx guarantees Node + npm are present.
//
// Like a real installer, it inspects the machine first:
//   - nothing detected           → straight install
//   - anything already installed → menu: Update / Repair / Uninstall
//     · Update    — fast-forward the checkout + refresh tools, re-stage the app
//     · Repair    — wipe binaries (staged app, node_modules) and reinstall; SETTINGS AND
//                   REGISTERED WORKSPACES ARE KEPT (userData untouched). Latest version only.
//     · Uninstall — remove the app, launcher, shortcut, checkout and userData (settings,
//                   secrets, workspace registrations). Cloned workspace REPOS stay on disk.
//
// The script is safe to re-run: every path is idempotent.
//
// Usage: npx … [--update|--repair|--uninstall] [--yes] [--dir <path>] [--repo <url>]
//              [--branch <name>] [--clone-only] [--no-shortcut] [--no-launch] [--path <dir>]

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const HOME = os.homedir();

const DEFAULT_REPO = 'https://github.com/SOAPeople/team-workspace.git';
const DEFAULT_DIR = path.join(HOME, 'SOAPeople', 'team-workspace');
const BRANCH = 'main';

const log = (m) => process.stdout.write(`  ${m}\n`);
const step = (m) => process.stdout.write(`\n▸ ${m}\n`);
const fail = (m) => { process.stderr.write(`\n✖ ${m}\n`); process.exit(1); };

function parseArgs(argv) {
  const a = { dir: DEFAULT_DIR, repo: DEFAULT_REPO, branch: null, cloneOnly: false, forward: [], mode: null, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--dir') a.dir = path.resolve(argv[++i]);
    else if (x === '--repo') a.repo = argv[++i];
    else if (x === '--branch') a.branch = argv[++i];
    else if (x === '--clone-only') a.cloneOnly = true;
    else if (x === '--update') a.mode = 'update';
    else if (x === '--repair') a.mode = 'repair';
    else if (x === '--uninstall') a.mode = 'uninstall';
    else if (x === '--yes' || x === '-y') a.yes = true;
    else if (x === '--no-shortcut' || x === '--no-launch') a.forward.push(x);
    else if (x === '--path') a.forward.push(x, argv[++i]); // app staging dir, handled by control/install.mjs
    else if (x === '--help' || x === '-h') a.help = true;
  }
  return a;
}

// ── machine inventory ───────────────────────────────────────────────────────────────────────────
// These paths MIRROR control/install.mjs (stage/shortcut) and Electron's userData for
// app.setName('TW Control'). Env overrides exist for tests only.
function installPaths(a) {
  const stage = process.env.TWCONTROL_STAGE_DIR
    || (isWin ? path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'TW Control')
      : isMac ? path.join(HOME, 'Applications', 'TW Control.app')
        : path.join(HOME, '.local', 'share', 'tw-control'));
  const userData = process.env.TWCONTROL_USERDATA_DIR
    || (isWin ? path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'TW Control')
      : isMac ? path.join(HOME, 'Library', 'Application Support', 'TW Control')
        : path.join(HOME, '.config', 'TW Control'));
  const desktop = process.env.TWCONTROL_DESKTOP_DIR || path.join(HOME, 'Desktop');
  const shortcuts = isWin ? [path.join(desktop, 'TW Control.lnk')]
    : isMac ? [path.join(desktop, 'TW Control.app'), path.join(desktop, 'TW Control.command')]
      : [path.join(desktop, 'tw-control.desktop'), path.join(HOME, '.local', 'share', 'applications', 'tw-control.desktop')];
  return { checkout: a.dir, stage, userData, shortcuts };
}

function detect(p) {
  const has = (x) => { try { return fs.existsSync(x); } catch { return false; } };
  const d = {
    checkout: has(path.join(p.checkout, '.git')),
    stage: has(p.stage),
    userData: has(p.userData),
    shortcut: p.shortcuts.some(has),
  };
  d.any = d.checkout || d.stage || d.userData || d.shortcut;
  return d;
}

function gitQuiet(dir, args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return r.status === 0 ? r.stdout.trim() : null;
}

// Version state of the checkout: current sha, whether origin/main is ahead, and the guards
// (branch, dirty) that make repair unsafe on a developer machine.
function versionState(dir) {
  const branch = gitQuiet(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = gitQuiet(dir, ['rev-parse', '--short', 'HEAD']);
  const dirty = (gitQuiet(dir, ['status', '--porcelain']) || '') !== '';
  const fetched = gitQuiet(dir, ['fetch', '--quiet', 'origin', BRANCH]) !== null;
  const remote = fetched ? gitQuiet(dir, ['rev-parse', '--short', `origin/${BRANCH}`]) : null;
  return { branch, head, dirty, fetched, remote, updateAvailable: !!(remote && head && remote !== head) };
}

// ── interaction (zero-dep) ──────────────────────────────────────────────────────────────────────
function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); });
  });
}

async function chooseAction(state, yes) {
  const canRepair = state.checkout && state.fetched && !state.updateAvailable && !state.dirty && state.branch === BRANCH;
  process.stdout.write('\nTW Control is already on this machine:\n');
  log(`checkout:  ${state.checkout ? `yes (${state.head || '?'}${state.branch && state.branch !== BRANCH ? `, branch ${state.branch}` : ''}${state.dirty ? ', local changes' : ''})` : 'no'}`);
  log(`app:       ${state.stage ? 'yes' : 'no'}    shortcut: ${state.shortcut ? 'yes' : 'no'}    settings: ${state.userData ? 'yes' : 'no'}`);
  log(`version:   ${!state.checkout ? 'n/a' : !state.fetched ? 'could not reach GitHub' : state.updateAvailable ? `UPDATE AVAILABLE (${state.head} → ${state.remote})` : 'up to date'}`);
  process.stdout.write('\n');
  process.stdout.write(`  [1] Update     — ${state.updateAvailable ? 'install the new version' : 'reinstall the latest version'} (recommended)\n`);
  process.stdout.write(`  [2] Repair     — reinstall binaries, KEEP settings & registered workspaces${canRepair ? '' : '  (needs an up-to-date, clean checkout)'}\n`);
  process.stdout.write('  [3] Uninstall  — remove the app, checkout and settings\n');
  process.stdout.write('  [4] Quit\n');
  if (yes || !process.stdin.isTTY) { log('(non-interactive: Update)'); return 'update'; }
  const ans = await ask('\nChoice [1]: ');
  const map = { '': 'update', 1: 'update', 2: 'repair', 3: 'uninstall', 4: 'quit' };
  return map[ans] ?? 'quit';
}

// ── prerequisite tooling ────────────────────────────────────────────────────────────────────────
function which(cmd) {
  const exts = isWin ? ['.exe', '.cmd', '.bat'] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext);
      try { if (fs.existsSync(p)) return p; } catch { /* next */ }
    }
  }
  return null;
}

// Tools installed mid-run (git, claude) are not on this process's PATH yet — prepend their
// directory so the remaining steps and every child process can see them.
function prependPath(dir) {
  if (dir && fs.existsSync(dir)) process.env.PATH = dir + path.delimiter + (process.env.PATH || '');
}

// Windows: winget writes a tool's location into the REGISTRY PATH, which the running process
// never inherits. Re-read Machine + User PATH from the registry so a just-installed tool (git)
// becomes visible without us having to guess its install directory.
function refreshWindowsPath() {
  if (!isWin) return;
  const read = (hive) => {
    const r = spawnSync('reg', ['query', hive, '/v', 'Path'], { encoding: 'utf8' });
    if (r.status !== 0) return '';
    const m = (r.stdout || '').match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
    return m ? m[1].trim() : '';
  };
  const machine = read('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment');
  const user = read('HKCU\\Environment');
  const merged = [machine, user, process.env.PATH || ''].filter(Boolean).join(path.delimiter);
  const expanded = merged.replace(/%([^%]+)%/g, (_, v) => process.env[v] || `%${v}%`);
  if (expanded) process.env.PATH = expanded;
}

function ensureNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) fail(`Node ${process.versions.node} is too old. Install the LTS from https://nodejs.org (18 or newer), then re-run this command.`);
  log(`Node ${process.versions.node}: OK`);
}

// npm ships inside Node, but verify it explicitly so a broken PATH surfaces here with clear
// guidance rather than as an opaque failure deep inside the app build.
function ensureNpm() {
  if (which('npm')) { log('npm: found'); return; }
  fail('npm was not found next to Node. Reinstall Node.js LTS from https://nodejs.org (it bundles npm), then re-run this command.');
}

function ensureGit() {
  if (which('git')) { log('git: found'); return; }
  if (isWin) {
    step('Installing Git (one-time, via winget — a Windows confirmation may appear)');
    if (!which('winget')) fail('git is missing and winget is unavailable.\n  Install Git from https://git-scm.com/download/win then re-run this command.');
    spawnSync('winget', ['install', '--id', 'Git.Git', '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements', '--silent'], { stdio: 'inherit' });
    refreshWindowsPath(); // pick up git from the registry PATH winget just wrote
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean)) {
      prependPath(path.join(root, 'Git', 'cmd'));
    }
    if (which('git')) { log('git: installed'); return; }
    fail('Git installation did not complete.\n  Install it from https://git-scm.com/download/win then re-run this command.');
  }
  if (isMac) fail('git is missing. Run `xcode-select --install` (or `brew install git`), then re-run this command.');
  fail('git is missing. Install it with your package manager (e.g. `sudo apt install git`), then re-run this command.');
}

// Best-effort: the console needs `claude` for the plugin preflight and the terminal tabs,
// but the app itself installs and launches fine without it — so warn instead of failing.
function ensureClaude() {
  if (which('claude')) { log('claude CLI: found'); return; }
  step('Installing the Claude CLI');
  try {
    if (isWin) {
      spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'], { stdio: 'inherit' });
    } else {
      spawnSync('bash', ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'], { stdio: 'inherit' });
    }
  } catch { /* fall through */ }
  prependPath(path.join(HOME, '.local', 'bin')); // where the official installer puts it
  if (which('claude')) return;
  log('official installer unavailable — falling back to npm…');
  spawnSync('npm', ['install', '-g', '@anthropic-ai/claude-code'], { stdio: 'inherit', shell: isWin });
  if (!which('claude')) log('⚠ claude CLI still missing — TW Control will guide you when it needs it.');
}

function cloneOrUpdate(repo, dir, branch) {
  if (fs.existsSync(path.join(dir, '.git'))) {
    step(`Updating the existing checkout at ${dir}`);
    const r = spawnSync('git', ['-C', dir, 'pull', '--ff-only'], { stdio: 'inherit' });
    if (r.status !== 0) log('⚠ could not fast-forward (local changes or a diverged branch) — continuing with the current checkout.');
    return;
  }
  step(`Cloning ${repo}`);
  log('a browser window may open so you can sign in to GitHub — that is expected.');
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const args = ['clone', ...(branch ? ['--branch', branch] : []), repo, dir];
  let r = spawnSync('git', args, { stdio: 'inherit' });
  if (r.status !== 0 && which('gh')) {
    // plain https clone failed (no credential helper signed in) — the gh CLI has the
    // friendliest sign-in (device flow in the browser), so try that path before giving up
    log('git clone failed — retrying through the GitHub CLI (gh)…');
    const slug = repo.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
    const authed = spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' }).status === 0;
    if (!authed) spawnSync('gh', ['auth', 'login', '--web', '--git-protocol', 'https'], { stdio: 'inherit' });
    r = spawnSync('gh', ['repo', 'clone', slug, dir, ...(branch ? ['--', '--branch', branch] : [])], { stdio: 'inherit' });
  }
  if (r.status !== 0) {
    fail(`could not clone ${repo}.\n` +
      '  You need access to the private repository — ask the AI Architect to invite your GitHub account.\n' +
      '  Tip: installing the GitHub CLI (https://cli.github.com) and running `gh auth login` first\n' +
      '  makes the sign-in the easiest, then re-run this command.');
  }
}

function runAppInstaller(dir, forward) {
  const installer = path.join(dir, 'control', 'install.mjs');
  if (!fs.existsSync(installer)) fail(`control/install.mjs not found in ${dir} — is this the right repository?`);
  step('Handing over to the TW Control installer');
  const r = spawnSync(process.execPath, [installer, ...forward], { stdio: 'inherit', cwd: dir });
  if ((r.status ?? 1) !== 0) fail('the TW Control installer reported an error (see the output above).');
}

// ── lifecycle actions ───────────────────────────────────────────────────────────────────────────
function rmrf(target) {
  try { fs.rmSync(target, { recursive: true, force: true }); return true; }
  catch (e) { log(`⚠ could not remove ${target}: ${e.message}`); return false; }
}

// Verify EVERY tool the whole pipeline relies on, up front, before anything is installed.
// Auto-install what we can (git, Claude CLI); give a precise manual procedure for what we cannot;
// note the tools handled downstream so the user sees the full picture in one place.
function preflight() {
  step('Checking prerequisites');
  ensureNode();                 // node runtime (≥18)
  ensureNpm();                  // npm (bundled with Node) — used for every dependency install
  ensureGit();                  // git — auto via winget on Windows, guidance elsewhere
  ensureClaude();               // Claude CLI — best-effort; the app guides the user if still absent
  log('Electron runtime + node-pty: handled by the app installer (auto-downloaded / prebuilt — no compiler needed).');
}

function doInstallOrUpdate(a, fresh) {
  preflight();
  cloneOrUpdate(a.repo, a.dir, a.branch);
  if (a.cloneOnly) { process.stdout.write(`\n✅ Checkout ready at ${a.dir} (clone-only mode).\n`); return; }
  runAppInstaller(a.dir, a.forward);
  if (!fresh) process.stdout.write('\n✅ Update complete.\n');
}

function doRepair(a, p, state) {
  if (!state.checkout) { log('no checkout found — running a fresh install instead.'); return doInstallOrUpdate(a, true); }
  if (state.branch !== BRANCH || state.dirty || state.updateAvailable || !state.fetched) {
    fail('Repair only runs on the LATEST version with a clean checkout.\n' +
      `${state.updateAvailable ? `  An update is available (${state.head} → ${state.remote}) — run Update first.\n` : ''}` +
      `${!state.fetched ? '  GitHub is unreachable, so the latest version cannot be verified.\n' : ''}` +
      `${state.dirty ? '  The checkout has local changes — commit/stash/discard them first.\n' : ''}` +
      `${state.branch !== BRANCH ? `  The checkout is on branch ${state.branch} — switch to ${BRANCH} first.\n` : ''}`);
  }
  ensureNode(); ensureNpm(); // repair rebuilds node_modules — verify the toolchain first
  step('Repairing — removing binaries (settings & registered workspaces are kept)');
  for (const s of [p.stage, ...p.shortcuts]) if (fs.existsSync(s)) { log(`removing ${s}`); rmrf(s); }
  for (const nm of [
    path.join(p.checkout, 'control', 'node_modules'),
    path.join(p.checkout, 'control', 'renderer', 'node_modules'),
    path.join(p.checkout, 'ui', 'server', 'node_modules'),
  ]) if (fs.existsSync(nm)) { log(`removing ${nm}`); rmrf(nm); }
  runAppInstaller(p.checkout, a.forward);
  process.stdout.write('\n✅ Repair complete — settings and registered workspaces were preserved.\n');
}

async function doUninstall(a, p, yes) {
  step('Uninstall — this removes:');
  log(`app:        ${p.stage}`);
  for (const s of p.shortcuts) log(`shortcut:   ${s}`);
  log(`settings:   ${p.userData}  (config, secrets, workspace registrations)`);
  log(`checkout:   ${p.checkout}`);
  // The registry knows the cloned workspace repos — they are the user's WORK, never deleted.
  const workspaces = [];
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(p.userData, 'registry.json'), 'utf8'));
    const repos = Array.isArray(reg) ? reg : reg.repos || reg.workspaces || [];
    for (const r of repos) for (const t of r.trees || [r]) if (t && t.path) workspaces.push(t.path);
  } catch { /* no registry */ }
  if (workspaces.length) {
    process.stdout.write('\n  Your cloned workspace repositories stay on disk (remove them yourself if wanted):\n');
    for (const w of [...new Set(workspaces)]) log(`• ${w}`);
  }
  if (!yes) {
    if (!process.stdin.isTTY) fail('uninstall needs --yes when not run interactively.');
    const ans = await ask('\nType UNINSTALL to confirm: ');
    if (ans !== 'UNINSTALL') { log('aborted — nothing was removed.'); return; }
  }
  step('Removing');
  let okAll = true;
  for (const t of [p.stage, ...p.shortcuts, p.userData, p.checkout]) {
    if (!fs.existsSync(t)) continue;
    log(`removing ${t}`);
    okAll = rmrf(t) && okAll;
  }
  if (!okAll && isWin) log('⚠ some files were locked — close TW Control and re-run uninstall.');
  process.stdout.write(okAll ? '\n✅ TW Control was uninstalled.\n' : '\n⚠ Uninstall finished with warnings (see above).\n');
}

// ── entry ───────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) {
    process.stdout.write('TW Control bootstrap — lifecycle:\n' +
      '  (no flag)       detect: fresh machine → install; existing → interactive menu\n' +
      '  --update        pull the latest version and re-stage the app\n' +
      '  --repair        reinstall binaries, keep settings & registered workspaces (latest version only)\n' +
      '  --uninstall     remove app + checkout + settings (cloned workspace repos stay); asks to type UNINSTALL\n' +
      '  --yes | -y      skip confirmations / menus (non-interactive)\n' +
      'install options:\n' +
      '  --dir <path>    where to clone the workspace repo (default: ~/SOAPeople/team-workspace)\n' +
      '  --repo <url>    repository to clone (default: SOAPeople/team-workspace)\n' +
      '  --branch <name> branch to clone (default: the repository default branch)\n' +
      '  --clone-only    prepare the checkout but do not build/install the app\n' +
      '  --no-shortcut   forwarded to the app installer\n' +
      '  --no-launch     forwarded to the app installer\n' +
      '  --path <dir>    forwarded to the app installer (custom app staging directory)\n');
    return;
  }
  process.stdout.write('\n╺╸ TW Control — guided install ╺╸\n');

  const p = installPaths(a);
  const found = detect(p);
  const state = { ...found, ...(found.checkout ? versionState(p.checkout) : { branch: null, head: null, dirty: false, fetched: false, remote: null, updateAvailable: false }) };

  let mode = a.mode;
  if (!mode) mode = found.any ? await chooseAction(state, a.yes) : 'install';

  if (mode === 'quit') { log('nothing changed.'); return; }
  if (mode === 'install' || mode === 'update') return doInstallOrUpdate(a, mode === 'install');
  if (mode === 'repair') return doRepair(a, p, state);
  if (mode === 'uninstall') return doUninstall(a, p, a.yes);
}

main();
