# TW Control — git-free bootstrap for Windows.
#
#   irm https://raw.githubusercontent.com/SOAPeople-JohanSottovia/tw-control-install/main/bootstrap.ps1 | iex
#
# WHY THIS EXISTS
#   `npx github:...` asks npm to `git clone` the installer package, so a machine WITHOUT git
#   fails before any of our Node code runs — the tell-tale error is:
#       npm error syscall spawn git
#       npm error enoent An unknown git error occurred
#   The installer's own ensureGit() would install git via winget, but it can't run because npm
#   could not fetch the installer without git in the first place. This bootstrap breaks that
#   chicken-and-egg: it is fetched over plain HTTPS (Invoke-RestMethod, always present), verifies
#   and installs the prerequisites (Node + git), then hands over to the real installer via npx.
#
# It needs NOTHING but Windows PowerShell. It is safe to re-run.

$ErrorActionPreference = 'Stop'
$Repo = 'github:SOAPeople-JohanSottovia/tw-control-install'

function Info($m) { Write-Host "  $m" }
function Note($m) { Write-Host "  $m" -ForegroundColor DarkGray }
function Step($m) { Write-Host "`n> $m" -ForegroundColor Cyan }
function Die($m)  { Write-Host "`nX $m" -ForegroundColor Red; exit 1 }

function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

# A tool installed mid-run by winget updates the *registry* PATH, not this live process — so the
# current session still cannot see it. Rebuild $env:Path from the Machine + User registry values
# and prepend the tool's known install dir as a belt-and-braces fallback.
function Refresh-Path($extra) {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = (@($extra, $machine, $user) | Where-Object { $_ }) -join ';'
}

Write-Host "`n== TW Control - guided install =="
Note 'Verifying prerequisites (Node.js, git) and installing whatever is missing.'

$haveWinget = Have 'winget'

# 1) Node.js LTS — provides node + npm + npx (the engine for everything that follows).
if (Have 'node') {
  Info "Node.js $(node -v): found"
} else {
  Step 'Installing Node.js LTS (one-time)'
  if (-not $haveWinget) {
    Die ("Node.js is missing and winget is unavailable on this machine.`n" +
         "  Install Node.js LTS from https://nodejs.org (the standard next -> next -> finish`n" +
         "  installer), close this window, then re-run this command.")
  }
  winget install --id OpenJS.NodeJS.LTS -e --source winget `
    --accept-package-agreements --accept-source-agreements --silent
  Refresh-Path "$env:ProgramFiles\nodejs"
  if (-not (Have 'node')) {
    Die ("Node.js installation did not complete.`n" +
         "  Install it from https://nodejs.org, close this window, then re-run this command.")
  }
  Info "Node.js $(node -v): installed"
}

# 2) git — the tool the failing machine lacked. npx needs it to fetch the installer package, and
#    the installer needs it again to clone the private workspace repository.
if (Have 'git') {
  Info 'git: found'
} else {
  Step 'Installing Git (one-time; a Windows confirmation may appear)'
  if (-not $haveWinget) {
    Die ("git is missing and winget is unavailable on this machine.`n" +
         "  Install Git from https://git-scm.com/download/win (accept the defaults),`n" +
         "  close this window, then re-run this command.")
  }
  winget install --id Git.Git -e --source winget `
    --accept-package-agreements --accept-source-agreements --silent
  Refresh-Path "$env:ProgramFiles\Git\cmd"
  if (-not (Have 'git')) {
    Die ("Git installation did not complete.`n" +
         "  Install it from https://git-scm.com/download/win, close this window, then re-run.")
  }
  Info 'git: installed'
}

# 3) Hand over to the real installer. git now exists AND is visible to this session, so npm's
#    `github:` clone succeeds; from here install.mjs takes over (Claude CLI, repo clone, app build).
Step 'Launching the TW Control installer'
$npx = (Get-Command npx -ErrorAction SilentlyContinue).Source
if (-not $npx) { $npx = 'npx' }
& $npx --yes $Repo @args
exit $LASTEXITCODE
