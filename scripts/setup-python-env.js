#!/usr/bin/env node
/**
 * setup-python-env.js
 *
 * Downloads a portable Python 3.12 (embeddable), sets it up with pip,
 * and installs openai-whisper + torch (CPU-only) into it.
 *
 * Output: apps/desktop/resources/python/
 *
 * Supports:
 *   - Windows (native)
 *   - WSL2 (runs the Windows .exe files via WSL2 interoperability)
 *
 * Called automatically by build:win64 when resources/python/ is missing.
 * Run manually to force a rebuild:
 *   node scripts/setup-python-env.js --force
 */

const https  = require('https')
const http   = require('http')
const fs     = require('fs')
const path   = require('path')
const { execSync, spawnSync } = require('child_process')

// ── Platform detection ───────────────────────────────────────────────────────
const isWin = process.platform === 'win32'
const isWSL = !isWin &&
  process.platform === 'linux' &&
  fs.existsSync('/proc/version') &&
  fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft')

if (!isWin && !isWSL) {
  console.error('\n✗ This script only supports Windows and WSL2.')
  console.error('  Run it from a Windows terminal or a WSL2 shell.')
  process.exit(1)
}

// ── Config ───────────────────────────────────────────────────────────────────
const PYTHON_VERSION = '3.12.9'
const PYTHON_ZIP_URL =
  `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py'
const FORCE = process.argv.includes('--force')

const DESKTOP_DIR   = path.resolve(__dirname, '..', 'apps', 'desktop')
const RESOURCES_DIR = path.join(DESKTOP_DIR, 'resources')
const PYTHON_DIR    = path.join(RESOURCES_DIR, 'python')
const PYTHON_EXE    = path.join(PYTHON_DIR, 'python.exe')
const ZIP_CACHE     = path.join(RESOURCES_DIR, `python-${PYTHON_VERSION}-embed-amd64.zip`)

// ── Helpers ───────────────────────────────────────────────────────────────────
function step(msg) { console.log(`\n▶ ${msg}`) }
function ok(msg)   { console.log(`  ✓ ${msg}`) }
function info(msg) { console.log(`  ${msg}`) }

/**
 * Convert a Linux/WSL2 path to a Windows UNC path.
 * e.g. /home/user/foo → \\wsl.localhost\Ubuntu\home\user\foo
 * Only needed when passing file-system paths as arguments to Windows .exe files.
 */
function toWinPath(linuxPath) {
  if (isWin) return linuxPath
  const result = spawnSync('wslpath', ['-w', linuxPath], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`wslpath failed for: ${linuxPath}`)
  return result.stdout.trim()
}

/**
 * Run a command (Windows .exe or native Linux tool).
 *
 * On WSL2, Windows PE binaries stored in the ext4 filesystem cannot be run
 * directly (binfmt_misc only handles binaries on DrvFs /mnt/c/…), and
 * cmd.exe refuses UNC paths as the working directory.
 *
 * Solution: invoke Windows .exe files via PowerShell's call operator:
 *   powershell.exe -NoProfile -Command "& 'UNC_PATH' arg1 arg2"
 * PowerShell handles \\wsl.localhost\… UNC paths correctly.
 *
 * For native Linux commands (unzip, wslpath, etc.) we spawnSync directly.
 */
function run(cmd, args, opts = {}) {
  if (isWSL && cmd.endsWith('.exe')) {
    // Convert Linux path → Windows UNC path for PowerShell
    const winCmd = toWinPath(cmd)
    // Quote each argument; paths must already be Windows-format (use toWinPath before calling)
    const psArgs = args.map(a => `'${a.replace(/'/g, "''")}'`).join(', ')
    const psExpr = psArgs ? `& '${winCmd}' ${psArgs}` : `& '${winCmd}'`
    info(`> powershell ${path.basename(cmd)} ${args.join(' ')}`)
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', psExpr],
      { stdio: 'inherit', ...opts })
    if (r.error) throw r.error
    if (r.status !== 0 && r.status !== null)
      throw new Error(`Command failed (exit ${r.status}): ${psExpr}`)
  } else {
    const argStr = args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')
    info(`> ${path.basename(cmd)} ${argStr}`)
    const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
    if (r.error) throw r.error
    if (r.status !== 0)
      throw new Error(`Command failed (exit ${r.status}): ${cmd} ${argStr}`)
  }
}

/** Download a URL to a file with a simple progress indicator. */
function download(url, dest) {
  return new Promise((resolve, reject) => {
    info(`Downloading ${url}`)
    const file = fs.createWriteStream(dest)
    const protocol = url.startsWith('https') ? https : http

    function get(u) {
      const mod = u.startsWith('https') ? https : http
      mod.get(u, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close()
          try { fs.unlinkSync(dest) } catch {}
          return download(res.headers.location, dest).then(resolve).catch(reject)
        }
        if (res.statusCode !== 200)
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`))
        const total = parseInt(res.headers['content-length'] || '0', 10)
        let done = 0
        res.on('data', chunk => {
          done += chunk.length
          if (total > 0) {
            const pct = Math.floor(done / total * 100)
            const mb  = (done / 1024 / 1024).toFixed(1)
            const tot = (total / 1024 / 1024).toFixed(1)
            process.stdout.write(`\r  ${pct}%  ${mb} / ${tot} MB   `)
          }
        })
        res.pipe(file)
        file.on('finish', () => { process.stdout.write('\n'); file.close(resolve) })
      }).on('error', reject)
    }
    get(url)
  })
}

/** Extract a zip archive (PowerShell on Windows, unzip on Linux/WSL2). */
function extractZip(zipFile, destDir) {
  if (isWin) {
    run('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -Force '${zipFile}' '${destDir}'`,
    ])
  } else {
    // unzip is available on Ubuntu/Debian WSL2 distros
    const r = spawnSync('unzip', ['-o', zipFile, '-d', destDir], { stdio: 'inherit' })
    if (r.error?.code === 'ENOENT')
      throw new Error('unzip not found. Install it: sudo apt-get install -y unzip')
    if (r.status !== 0)
      throw new Error(`unzip failed (exit ${r.status})`)
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗')
  console.log(`║  Transcriber — Embedded Python ${PYTHON_VERSION} Setup         ║`)
  console.log(`║  Platform: ${isWSL ? 'WSL2' : 'Windows'}${' '.repeat(isWSL ? 41 : 40)}║`)
  console.log('╚══════════════════════════════════════════════════════╝')

  // ── Skip if already built ─────────────────────────────────────────────────
  if (!FORCE && fs.existsSync(PYTHON_EXE)) {
    console.log(`\n✓ Bundled Python already exists at:\n  ${PYTHON_EXE}`)
    console.log('\n  Skipping setup. Use --force to rebuild from scratch.\n')
    return
  }

  if (FORCE && fs.existsSync(PYTHON_DIR)) {
    info('--force: removing existing python/ directory...')
    fs.rmSync(PYTHON_DIR, { recursive: true, force: true })
  }

  fs.mkdirSync(RESOURCES_DIR, { recursive: true })

  // ── 1. Download Python embeddable zip ─────────────────────────────────────
  step('Downloading Python embeddable package')
  if (fs.existsSync(ZIP_CACHE) && !FORCE) {
    ok(`Already cached: ${ZIP_CACHE}`)
  } else {
    await download(PYTHON_ZIP_URL, ZIP_CACHE)
    ok('Downloaded')
  }

  // ── 2. Extract ────────────────────────────────────────────────────────────
  step(`Extracting to ${PYTHON_DIR}`)
  if (fs.existsSync(PYTHON_DIR)) {
    fs.rmSync(PYTHON_DIR, { recursive: true, force: true })
  }
  extractZip(ZIP_CACHE, PYTHON_DIR)
  ok('Extracted')

  // ── 3. Enable site-packages (edit ._pth file) ─────────────────────────────
  step('Enabling site-packages')
  const pthFiles = fs.readdirSync(PYTHON_DIR).filter(f => f.endsWith('._pth'))
  if (pthFiles.length === 0) throw new Error('No ._pth file found in extracted Python')
  const pthPath = path.join(PYTHON_DIR, pthFiles[0])
  let pth = fs.readFileSync(pthPath, 'utf8')
  if (pth.includes('#import site')) {
    pth = pth.replace('#import site', 'import site')
    fs.writeFileSync(pthPath, pth, 'utf8')
    ok(`Uncommented 'import site' in ${pthFiles[0]}`)
  } else if (pth.includes('import site')) {
    ok('site-packages already enabled')
  } else {
    fs.writeFileSync(pthPath, pth + '\nimport site\n', 'utf8')
    ok('Appended import site')
  }

  // ── 4. Bootstrap pip ──────────────────────────────────────────────────────
  step('Installing pip')
  const getPipLocal = path.join(PYTHON_DIR, 'get-pip.py')
  await download(GET_PIP_URL, getPipLocal)
  // Python.exe needs Windows paths on WSL2
  run(PYTHON_EXE, [toWinPath(getPipLocal)])
  try { fs.unlinkSync(getPipLocal) } catch {}
  ok('pip installed')

  // ── 5. Upgrade pip ────────────────────────────────────────────────────────
  step('Upgrading pip')
  run(PYTHON_EXE, ['-m', 'pip', 'install', '--upgrade', 'pip'])
  ok('pip up to date')

  // ── 6. Install openai-whisper (brings torch as a dependency) ─────────────
  step('Installing openai-whisper')
  info('This downloads ~200 MB (whisper + torch) — please wait...')
  run(PYTHON_EXE, ['-m', 'pip', 'install', 'openai-whisper'])
  ok('openai-whisper installed')

  // ── 7. Verify ─────────────────────────────────────────────────────────────
  step('Verifying')
  run(PYTHON_EXE, ['-c', 'import whisper; print("whisper", whisper.__version__)'])
  run(PYTHON_EXE, ['-c', 'import torch; print("torch", torch.__version__)'])
  ok('All packages importable')
  console.log('\n╔══════════════════════════════════════════════════════╗')
  console.log('║  ✓ Python environment ready!                         ║')
  console.log('║                                                      ║')
  console.log('║  Now run: pnpm build:win64                           ║')
  console.log('╚══════════════════════════════════════════════════════╝\n')
}

main().catch(e => {
  console.error('\n✗ Setup failed:', e.message)
  process.exit(1)
})
