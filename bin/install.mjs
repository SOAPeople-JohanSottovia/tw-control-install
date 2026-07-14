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
//     · Uninstall — remove the app, launcher, shortcut, checkout, userData (settings, secrets,
//                   workspace registrations) AND the whole TWControl data folder (~/TWControl:
//                   workspaces, worktrees, presets, plugin studio/forks). Only the cloned
//                   workspace REPOS the user chooses to keep survive the sweep.
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
    else if (x === '--purge-workspaces') a.purgeWorkspaces = true;
    else if (x === '--keep-workspaces') a.keepWorkspaces = true;
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

// Windows: npm / claude are .cmd shims Node can only launch through a shell (CVE-2024-27980); an args
// ARRAY together with shell:true is deprecated (DEP0190, unescaped concatenation). Pass the whole command
// as ONE string on Windows (every caller passes static flags — nothing to quote), a plain args array
// elsewhere. Extra options (encoding/stdio) pass through unchanged.
function shellSync(cmd, args, opts = {}) {
  return isWin
    ? spawnSync(`${cmd} ${args.join(' ')}`, { ...opts, shell: true })
    : spawnSync(cmd, args, opts);
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
  process.stdout.write('  [3] Uninstall  — remove the app, checkout, settings and the TWControl data folder\n');
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

// Zero-dep semver: "1.2.3" → [1,2,3]; compare two triples.
function parseSemver(s) { const m = String(s).match(/(\d+)\.(\d+)\.(\d+)/); return m ? [+m[1], +m[2], +m[3]] : null; }
function cmpSemver(a, b) { for (let i = 0; i < 3; i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; }

// The Node floor is the toolchain's REAL requirement, not a guess:
//   Electron 43 (bundled with every install) → Node >= 22.12
//   Angular 22 WORKSPACES scaffolded through the console → ^22.22.3 || ^24.15.0 || >=26
// The strictest wins, so we enforce Angular's line exactly (odd/non-LTS 23/25 are excluded, as Angular does).
const NODE_FLOOR_LABEL = 'Node 22.22.3+ (or 24.15+, or 26+)';
function nodeSatisfies() {
  const [maj, min = 0, pat = 0] = process.versions.node.split('.').map(Number);
  if (maj >= 26) return true;
  if (maj === 24) return min >= 15;                       // ^24.15.0
  if (maj === 22) return min > 22 || (min === 22 && pat >= 3); // ^22.22.3
  return false;
}
function ensureNode() {
  if (nodeSatisfies()) { log(`Node ${process.versions.node}: OK`); return; }
  step(`Your Node.js (${process.versions.node}) is too old for TW Control`);
  log(`TW Control (Electron 43) and its Angular 22 workspaces need ${NODE_FLOOR_LABEL}.`);
  if (isWin && which('winget')) {
    log('Installing Node.js LTS via winget (a Windows confirmation may appear)…');
    spawnSync('winget', ['install', '--id', 'OpenJS.NodeJS.LTS', '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements', '--silent'], { stdio: 'inherit' });
    fail('Node.js LTS was installed, but THIS window is still running the old Node.\n  Close it, open a NEW terminal, and re-run the install command.');
  }
  fail('Install the latest Node.js LTS, then re-run this command:\n' +
    '  macOS:    https://nodejs.org   (or: brew install node)\n' +
    '  Windows:  https://nodejs.org   (or: winget install OpenJS.NodeJS.LTS)\n' +
    '  Linux:    use nvm or your distro package — it must provide Node 22.22.3 or newer.');
}

// npm ships inside Node, but verify it explicitly so a broken PATH surfaces here with clear
// guidance rather than as an opaque failure deep inside the app build.
function ensureNpm() {
  if (!which('npm')) fail('npm was not found next to Node. Reinstall Node.js LTS from https://nodejs.org (it bundles npm), then re-run this command.');
  // A recent Node bundles a recent npm, but a stale global npm can shadow it and choke on Angular 22's
  // lockfile/peer resolution — so verify and bump if it is behind.
  const r = shellSync('npm', ['--version'], { encoding: 'utf8' });
  const v = r.status === 0 ? parseSemver(r.stdout) : null;
  if (v && cmpSemver(v, [10, 0, 0]) < 0) {
    step(`npm ${v.join('.')} is old — updating to the latest (Angular 22 workspaces need a modern npm)`);
    shellSync('npm', ['install', '-g', 'npm@latest'], { stdio: 'inherit' });
    const r2 = shellSync('npm', ['--version'], { encoding: 'utf8' });
    log(`npm: ${(r2.stdout || '').trim() || 'updated'}`);
  } else {
    log(v ? `npm ${v.join('.')}: OK` : 'npm: found');
  }
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

// The console DRIVES `claude` for real work: it installs the team-workspace plugin into each workspace,
// runs the plugin preflight, hosts the terminal tabs, and powers the second-brain AI search. A missing or
// stale CLI is exactly what silently breaks Plugin Studio, ticket sync and the second brain — so we install
// it if absent AND keep it recent. The app still launches without it (it then guides the user), so a failed
// install warns rather than aborting the whole setup.
const MIN_CLAUDE = [2, 0, 0]; // keep users on a recent Claude Code CLI (its output is parsed by the console)
function claudeSemver() {
  const r = shellSync('claude', ['--version'], { encoding: 'utf8' });
  return r.status === 0 ? parseSemver(r.stdout) : null;
}
function installClaude() {
  step('Installing the Claude CLI');
  try {
    if (isWin) spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'], { stdio: 'inherit' });
    else spawnSync('bash', ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'], { stdio: 'inherit' });
  } catch { /* fall through to npm */ }
  prependPath(path.join(HOME, '.local', 'bin')); // where the official installer puts it
  if (which('claude')) return;
  log('official installer unavailable — falling back to npm…');
  shellSync('npm', ['install', '-g', '@anthropic-ai/claude-code'], { stdio: 'inherit' });
  prependPath(path.join(HOME, '.npm-global', 'bin'));
}
function ensureClaude() {
  if (!which('claude')) {
    installClaude();
    if (!which('claude')) {
      log('⚠ claude CLI still missing — TW Control needs it for Plugin Studio, ticket sync and the second brain, and will guide you when it does.');
      return;
    }
  }
  const v = claudeSemver();
  if (!v) { log('claude CLI: found (version unreadable)'); return; }
  if (cmpSemver(v, MIN_CLAUDE) < 0) {
    step(`claude CLI ${v.join('.')} is older than the required ${MIN_CLAUDE.join('.')} — updating to the latest`);
    shellSync('npm', ['install', '-g', '@anthropic-ai/claude-code@latest'], { stdio: 'inherit' });
    prependPath(path.join(HOME, '.npm-global', 'bin'));
    const v2 = claudeSemver();
    log(v2 ? `claude CLI: ${v2.join('.')}` : '⚠ claude update did not complete — TW Control will guide you when it needs it.');
  } else {
    log(`claude CLI ${v.join('.')}: OK`);
  }
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

// True when child IS parent or lives anywhere below it (both already resolved).
function isUnder(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Remove dir and everything below it EXCEPT the paths in keep — those folders survive untouched,
// and so do their ancestors (needed as scaffolding). Returns true when dir itself ended up removed.
function sweep(dir, keep) {
  const d = path.resolve(dir);
  if (keep.some((k) => isUnder(d, k))) return false;      // inside a kept folder — untouched
  if (!keep.some((k) => isUnder(k, d))) return rmrf(d);   // nothing kept below — whole subtree goes
  let entries;
  try { entries = fs.readdirSync(d); } catch (e) { log(`⚠ could not read ${d}: ${e.message}`); return false; }
  let removedAll = true;
  for (const e of entries) removedAll = sweep(path.join(d, e), keep) && removedAll;
  return removedAll ? rmrf(d) : false;
}

// Verify EVERY tool the whole pipeline relies on, up front, before anything is installed.
// Auto-install what we can (git, Claude CLI); give a precise manual procedure for what we cannot;
// note the tools handled downstream so the user sees the full picture in one place.
function preflight() {
  step('Checking prerequisites');
  ensureNode();                 // node runtime — Electron 43 + Angular 22 workspaces: ^22.22.3 || ^24.15.0 || >=26
  ensureNpm();                  // npm (bundled with Node) — bumped if stale; Angular 22 needs a modern npm
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
  // The DEFAULT checkout location can hold an older install when the app was later (re)installed with a
  // custom --dir — sweep it too (Windows and macOS alike) instead of leaving a stray
  // ~/SOAPeople/team-workspace behind.
  const checkouts = [p.checkout];
  if (fs.existsSync(DEFAULT_DIR) && path.resolve(DEFAULT_DIR) !== path.resolve(p.checkout)) {
    checkouts.push(DEFAULT_DIR);
    log(`checkout:   ${DEFAULT_DIR}  (default location — older install)`);
  }
  // The app's own data folder goes away too — ENTIRELY. ~/TWControl is where the app puts
  // everything it creates on disk (workspaces/, worktrees/, presets/, plugin-studio/,
  // plugin-forks/ …). Roots relocated through config.json are swept the same way. The ONLY
  // survivors are the workspace folders the user chooses to KEEP below — the sweep walks
  // around them (and their parent folders) and deletes everything else.
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(p.userData, 'config.json'), 'utf8')); } catch { /* no config */ }
  const twBase = path.resolve(HOME, 'TWControl');
  const dataRoots = [...new Set([twBase,
    ...['workspacesRoot', 'worktreesRoot', 'presetsRoot', 'studioRoot', 'forksRoot']
      .map((k) => cfg[k]).filter((v) => typeof v === 'string' && v)
      .map((v) => path.resolve(v)).filter((v) => !isUnder(v, twBase)),
  ])].filter((r) => fs.existsSync(r));
  for (const r of dataRoots) log(`app data:   ${r}  (workspaces, worktrees, presets, plugin studio — kept workspace folders survive)`);
  // The registry knows the cloned workspace repos — they are the user's WORK. registry.json stores
  // { repos: { "owner/repo": { localPath, trees: { main: { path } } } } } — BOTH repos and trees are
  // OBJECTS, so enumerate with Object.values (a for..of over an object throws → the list would silently
  // come up empty, as it did before).
  const workspaces = [];
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(p.userData, 'registry.json'), 'utf8'));
    const repos = Array.isArray(reg) ? reg : Object.values(reg.repos || reg.workspaces || {});
    for (const r of repos) {
      if (r && r.localPath) workspaces.push(r.localPath);
      const trees = r && r.trees ? (Array.isArray(r.trees) ? r.trees : Object.values(r.trees)) : [];
      for (const t of trees) if (t && t.path) workspaces.push(t.path);
    }
  } catch { /* no registry */ }
  const wsList = [...new Set(workspaces)];

  // Decide the fate of the cloned workspace repos — folder by folder, not all-or-nothing:
  //   --keep-workspaces   keep every folder, no question
  //   --purge-workspaces  delete every folder, no question
  //   --yes               fully unattended = delete them ALL (no selection round — by design)
  //   interactive         numbered selection: pick some (e.g. "1,3"), ALL, or Enter to keep everything
  let toDelete = [];
  if (wsList.length) {
    if (a && a.keepWorkspaces) toDelete = [];
    else if (a && a.purgeWorkspaces) toDelete = wsList;
    else if (yes) toDelete = wsList;
    else if (process.stdin.isTTY) {
      process.stdout.write('\n  Registered workspace repositories found:\n');
      wsList.forEach((w, i) => log(`[${i + 1}] ${w}`));
      const ans = (await ask(`\nDelete workspace folders (local changes are lost)? Enter numbers (e.g. 1,3), ALL for all ${wsList.length}, or press Enter to keep them all: `)).trim();
      if (/^all$/i.test(ans)) toDelete = wsList;
      else if (ans) {
        const picked = new Set(ans.split(/[\s,;]+/).map((n) => parseInt(n, 10)).filter((n) => n >= 1 && n <= wsList.length));
        toDelete = wsList.filter((_, i) => picked.has(i + 1));
      }
    }
    const kept = wsList.filter((w) => !toDelete.includes(w));
    if (toDelete.length) {
      process.stdout.write(`\n  ⚠ Will also delete ${toDelete.length}/${wsList.length} workspace folder(s) — any uncommitted work there is lost:\n`);
      for (const w of toDelete) log(`• ${w}`);
    }
    if (kept.length) {
      process.stdout.write('\n  These workspace repositories stay on disk (remove them yourself if wanted):\n');
      for (const w of kept) log(`• ${w}`);
    }
  }

  if (!yes) {
    if (!process.stdin.isTTY) fail('uninstall needs --yes when not run interactively.');
    const ans = await ask('\nType UNINSTALL to confirm: ');
    if (ans !== 'UNINSTALL') { log('aborted — nothing was removed.'); return; }
  }
  step('Removing');
  let okAll = true;
  const targets = [p.stage, ...p.shortcuts, p.userData, ...checkouts, ...toDelete];
  for (const t of targets) {
    if (!fs.existsSync(t)) continue;
    log(`removing ${t}`);
    okAll = rmrf(t) && okAll;
  }
  // Sweep the TWControl data folder(s) last: everything goes except the kept workspace folders.
  const keptPaths = wsList.filter((w) => !toDelete.includes(w)).map((w) => path.resolve(w));
  for (const r of dataRoots) {
    if (!fs.existsSync(r)) continue;
    const guarded = keptPaths.some((k) => isUnder(k, r));
    log(`removing ${r}${guarded ? ' (kept workspace folders stay)' : ''}`);
    okAll = (sweep(r, keptPaths) || guarded) && okAll;
  }
  if (!okAll && isWin) log('⚠ some files were locked — close TW Control and re-run uninstall.');
  process.stdout.write(okAll
    ? `\n✅ TW Control was uninstalled${wsList.length ? ` (${toDelete.length}/${wsList.length} workspace folder(s) removed)` : ''}.\n`
    : '\n⚠ Uninstall finished with warnings (see above).\n');
}

// ── entry ───────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) {
    process.stdout.write('TW Control bootstrap — lifecycle:\n' +
      '  (no flag)       detect: fresh machine → install; existing → interactive menu\n' +
      '  --update        pull the latest version and re-stage the app\n' +
      '  --repair        reinstall binaries, keep settings & registered workspaces (latest version only)\n' +
      '  --uninstall     remove app + checkout + settings + the whole TWControl data folder; asks to\n' +
      '                  type UNINSTALL. You then pick WHICH registered workspace folders to delete\n' +
      '                  (numbers, ALL, or Enter to keep them) — kept folders survive the sweep\n' +
      '  --purge-workspaces  on uninstall, delete ALL the workspace folders (destroys local work)\n' +
      '  --keep-workspaces   on uninstall, keep every workspace folder without asking\n' +
      '  --yes | -y      skip confirmations / menus (non-interactive). On uninstall this DELETES ALL the\n' +
      '                  registered workspace folders too — pass --keep-workspaces to keep them\n' +
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
