#!/usr/bin/env node
// TW Control — one-command bootstrap.
//   npx github:SOAPeople-JohanSottovia/tw-control-install   (public mirror — the live channel)
//   npx @soapeople/tw-control                               (npm registry — if published later)
//
// Zero-dependency by design. Running under npx guarantees Node + npm are present;
// this script provides everything else, in order:
//   1. git         — installed silently through winget on Windows; guidance on macOS/Linux
//   2. claude CLI  — official installer script, npm -g fallback; best-effort (the console
//                    guides the user later if it is still missing)
//   3. the repo    — clone or fast-forward the private team-workspace checkout
//                    (Git Credential Manager / the gh CLI handle the GitHub sign-in)
//   4. the app     — hand over to control/install.mjs inside the checkout
//                    (dependencies, renderer build, launcher, desktop shortcut, launch)
//
// The script is safe to re-run: it updates the checkout and re-stages the app.
//
// Usage: npx @soapeople/tw-control [--dir <path>] [--repo <url>] [--branch <name>]
//                                  [--clone-only] [--no-shortcut] [--no-launch]

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const HOME = os.homedir();

const DEFAULT_REPO = 'https://github.com/SOAPeople/team-workspace.git';
const DEFAULT_DIR = path.join(HOME, 'SOAPeople', 'team-workspace');

const log = (m) => process.stdout.write(`  ${m}\n`);
const step = (m) => process.stdout.write(`\n▸ ${m}\n`);
const fail = (m) => { process.stderr.write(`\n✖ ${m}\n`); process.exit(1); };

function parseArgs(argv) {
  const a = { dir: DEFAULT_DIR, repo: DEFAULT_REPO, branch: null, cloneOnly: false, forward: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--dir') a.dir = path.resolve(argv[++i]);
    else if (x === '--repo') a.repo = argv[++i];
    else if (x === '--branch') a.branch = argv[++i];
    else if (x === '--clone-only') a.cloneOnly = true;
    else if (x === '--no-shortcut' || x === '--no-launch') a.forward.push(x);
    else if (x === '--path') a.forward.push(x, argv[++i]); // app staging dir, handled by control/install.mjs
    else if (x === '--help' || x === '-h') a.help = true;
  }
  return a;
}

// PATH lookup with Windows executable extensions.
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

function ensureNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) fail(`Node ${process.versions.node} is too old. Install the LTS from https://nodejs.org (18 or newer), then re-run this command.`);
  log(`Node ${process.versions.node}: OK`);
}

function ensureGit() {
  if (which('git')) { log('git: found'); return; }
  if (isWin) {
    step('Installing Git (one-time, via winget — a Windows confirmation may appear)');
    if (!which('winget')) fail('git is missing and winget is unavailable.\n  Install Git from https://git-scm.com/download/win then re-run this command.');
    spawnSync('winget', ['install', '--id', 'Git.Git', '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements', '--silent'], { stdio: 'inherit' });
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean)) {
      prependPath(path.join(root, 'Git', 'cmd'));
    }
    if (which('git')) return;
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

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) {
    process.stdout.write('TW Control bootstrap — options:\n' +
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
  ensureNode();
  ensureGit();
  ensureClaude();
  cloneOrUpdate(a.repo, a.dir, a.branch);
  if (a.cloneOnly) { process.stdout.write(`\n✅ Checkout ready at ${a.dir} (clone-only mode).\n`); return; }
  runAppInstaller(a.dir, a.forward);
}

main();
