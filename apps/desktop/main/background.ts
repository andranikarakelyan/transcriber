import path from 'path'
import { app, ipcMain, dialog, shell, BrowserWindow, Menu } from 'electron'
import serve from 'electron-serve'
import { createWindow } from './helpers'
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import * as os from 'os'
import * as fs from 'fs'
import { ChildProcess } from 'child_process'

const execAsync = promisify(exec)

const isProd = process.env.NODE_ENV === 'production'

if (isProd) {
  serve({ directory: 'app' })
} else {
  app.setPath('userData', `${app.getPath('userData')} (development)`)
}

let mainWindow: BrowserWindow | null = null
let currentTranscriptionProcess: ChildProcess | null = null
let isCancelling = false // Track if we're manually cancelling

// Dev-only: resolved path to the system Python with whisper installed.
// In production, getBundledPython() is used instead.
let pythonCmd = 'python'

// ---------------------------------------------------------------------------
// Bundled Python helpers
// ---------------------------------------------------------------------------

/**
 * Returns the path to the embedded python.exe that ships with the app.
 * In production this lives at  <resourcesPath>/python/python.exe
 * In dev we fall back to the system Python (pythonCmd resolved at startup).
 */
function getBundledPython(): string {
  if (isProd) {
    const exe = path.join(process.resourcesPath, 'python',
      process.platform === 'win32' ? 'python.exe' : 'python3')
    if (fs.existsSync(exe)) return exe
  }
  return pythonCmd   // dev fallback
}

/**
 * Run a Python script given as an array of source lines.
 * Writes to a temp file and executes it — avoids ALL shell-quoting nightmares
 * with inline -c strings (especially multiline try/except blocks).
 */
async function runPythonScript(lines: string[], pyBin?: string): Promise<string> {
  const py  = pyBin ?? getBundledPython()
  const tmp = path.join(os.tmpdir(), `transcriber_${Date.now()}_${Math.random().toString(36).slice(2)}.py`)
  fs.writeFileSync(tmp, lines.join('\n'), 'utf8')
  try {
    const { stdout } = await execAsync(`"${py}" "${tmp}"`)
    return stdout.trim()
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
}



// Resolve path to the bundled transcribe.py script
const getScriptPath = (): string => {
  if (isProd) {
    return path.join(process.resourcesPath, 'transcribe.py')
  }
  return path.join(__dirname, 'transcribe.py')
}

// Get the output directory for transcriptions
const getOutputDirectory = (): string => {
  const platform = os.platform()
  let baseDir: string
  
  if (platform === 'win32') {
    baseDir = path.join(os.homedir(), 'Downloads')
  } else if (platform === 'darwin') {
    baseDir = path.join(os.homedir(), 'Downloads')
  } else {
    baseDir = path.join(os.homedir(), 'Downloads')
  }
  
  const outputDir = path.join(baseDir, 'Transcriber')
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
    sendLog('info', `Created output directory: ${outputDir}`)
  }
  
  return outputDir
}

// Logging utility
const sendLog = (level: 'info' | 'error' | 'warn' | 'debug', message: string) => {
  const timestamp = new Date().toLocaleTimeString()
  const log = { timestamp, level, message }
  
  console[level](message)
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', log)
  }
}

// Kill the current transcription process (shared by cancel and app-quit)
const killCurrentProcess = () => {
  if (!currentTranscriptionProcess) return

  const platform = os.platform()
  const pid = currentTranscriptionProcess.pid

  if (!pid) {
    sendLog('warn', '[Queue] killCurrentProcess: no PID available')
    currentTranscriptionProcess = null
    return
  }

  sendLog('info', `[Queue] Killing Python process (PID ${pid})...`)

  try {
    if (platform === 'win32') {
      exec(`taskkill /pid ${pid} /T /F`, (err) => {
        if (err) {
          sendLog('warn', `[Queue] taskkill error: ${err.message}`)
        } else {
          sendLog('info', `[Queue] Python process tree terminated (PID ${pid})`)
        }
      })
    } else {
      try {
        process.kill(-pid, 'SIGTERM')
        sendLog('info', `[Queue] Sent SIGTERM to process group (PID ${pid})`)
        setTimeout(() => {
          try {
            process.kill(-pid, 'SIGKILL')
            sendLog('info', `[Queue] Sent SIGKILL to process group (PID ${pid})`)
          } catch (_) { /* already dead */ }
        }, 2000)
      } catch {
        currentTranscriptionProcess.kill('SIGTERM')
        sendLog('info', `[Queue] Sent SIGTERM to process (PID ${pid}, fallback)`)
        setTimeout(() => {
          try {
            currentTranscriptionProcess?.kill('SIGKILL')
            sendLog('info', `[Queue] Sent SIGKILL to process (PID ${pid}, fallback)`)
          } catch (_) { /* already dead */ }
        }, 2000)
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    sendLog('warn', `[Queue] Error killing process: ${msg}`)
  }

  currentTranscriptionProcess = null
}

// Create application menu
const createMenu = () => {
  const isMac = process.platform === 'darwin'
  
  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { 
          label: `About ${app.name}`,
          click: async () => {
            await shell.openExternal('https://github.com/andranikarakelyan/transcriber')
          }
        },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const }
      ]
    }] : []),
    // File menu
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' as const } : { role: 'quit' as const }
      ]
    },
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' as const },
          { role: 'delete' as const },
          { role: 'selectAll' as const }
        ] : [
          { role: 'delete' as const },
          { type: 'separator' as const },
          { role: 'selectAll' as const }
        ])
      ]
    },
    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const }
      ]
    },
    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const },
          { type: 'separator' as const },
          { role: 'window' as const }
        ] : [
          { role: 'close' as const }
        ])
      ]
    },
    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'GitHub Repository',
          click: async () => {
            await shell.openExternal('https://github.com/andranikarakelyan/transcriber')
          }
        },
        {
          label: 'Whisper Setup Guide',
          click: async () => {
            await shell.openExternal('https://github.com/openai/whisper#setup')
          }
        },
        {
          label: 'Dependencies & Setup Wizard',
          click: () => navigateTo('setup')
        },
        {
          label: 'CUDA Setup Guide',
          click: async () => {
            await shell.openExternal('https://pytorch.org/get-started/locally/')
          }
        },
        { type: 'separator' as const },
        {
          label: 'Contact & Support',
          submenu: [
            {
              label: 'Report Issue or Request Feature',
              click: async () => {
                await shell.openExternal('mailto:andranik.arakelyan.work@gmail.com?subject=Transcriber%20App%20Feedback')
              }
            },
            {
              label: 'Email: andranik.arakelyan.work@gmail.com',
              click: async () => {
                await shell.openExternal('mailto:andranik.arakelyan.work@gmail.com')
              }
            }
          ]
        },
        { type: 'separator' as const },
        ...(isMac ? [] : [{
          label: `About ${app.name}`,
          click: async () => {
            await shell.openExternal('https://github.com/andranikarakelyan/transcriber')
          }
        }])
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// Helper: check if whisper is available, set pythonCmd as side-effect (dev only)
const checkWhisperAvailable = async (): Promise<boolean> => {
  // Production: always use the bundled Python — if it has whisper, we're good
  if (isProd) {
    const py = getBundledPython()
    if (!fs.existsSync(py)) {
      sendLog('error', `Bundled Python not found at ${py} — rebuild with: pnpm setup:python`)
      return false
    }
    try {
      const ver = await runPythonScript(['import whisper; print(whisper.__version__)'], py)
      sendLog('info', `Bundled whisper ${ver} ready`)
      return true
    } catch (e) {
      sendLog('error', `Bundled Python found but whisper not importable: ${e}`)
      return false
    }
  }

  // Dev: find system Python that has whisper; resolve to real exe via sys.executable
  for (const cmd of ['python', 'python3']) {
    try {
      const { stdout: ver } = await execAsync(`${cmd} -c "import whisper; print(whisper.__version__)"`)
      const { stdout: exe } = await execAsync(`${cmd} -c "import sys; print(sys.executable)"`)
      pythonCmd = exe.trim()
      sendLog('info', `[Dev] Whisper ${ver.trim()} found — using ${pythonCmd}`)
      return true
    } catch { /* try next */ }
  }
  sendLog('error', '[Dev] Whisper not found. Run: pip install openai-whisper')
  return false
}

;(async () => {
  await app.whenReady()

  // Create application menu
  createMenu()

  mainWindow = createWindow('main', {
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  // Maximize the window
  mainWindow.maximize()

  // Check whisper BEFORE loading the window so we can open the right page
  const whisperReady = await checkWhisperAvailable()
  const startPage = whisperReady ? 'home' : 'setup'

  if (isProd) {
    await mainWindow.loadURL(`app://./${startPage}`)
  } else {
    const port = process.argv[2]
    await mainWindow.loadURL(`http://localhost:${port}/${startPage}`)
    mainWindow.webContents.openDevTools()
  }

  sendLog('info', `Application started — opening ${startPage}`)
})()

// Navigate main window to a page (used by IPC and menu)
const navigateTo = (page: 'home' | 'setup') => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (isProd) {
    mainWindow.loadURL(`app://./${page}`)
  } else {
    // dev port is baked into the process args
    const port = process.argv[2]
    mainWindow.loadURL(`http://localhost:${port}/${page}`)
  }
}

app.on('window-all-closed', () => {
  app.quit()
})

// Kill any running transcription when the app is about to quit
app.on('before-quit', () => {
  if (currentTranscriptionProcess) {
    sendLog('info', '[Queue] App quitting — killing active transcription process...')
    isCancelling = true
    killCurrentProcess()
  }
})

// ---------------------------------------------------------------------------
// Check if Whisper is available (used by home page on load)
// ---------------------------------------------------------------------------
ipcMain.on('check-whisper', async (event) => {
  sendLog('info', 'Checking Whisper installation...')

  if (isProd) {
    const py = getBundledPython()
    if (fs.existsSync(py)) {
      try {
        const ver = await runPythonScript(['import whisper; print(whisper.__version__)'], py)
        sendLog('info', `Bundled whisper ${ver} ready`)
        event.reply('whisper-status', true)
        return
      } catch { /* fall through */ }
    }
    sendLog('error', 'Bundled Python / whisper not found')
    event.reply('whisper-status', false)
    return
  }

  // Dev mode: scan system Python
  for (const cmd of ['python', 'python3']) {
    try {
      const { stdout: ver } = await execAsync(`${cmd} -c "import whisper; print(whisper.__version__)"`)
      const { stdout: exe } = await execAsync(`${cmd} -c "import sys; print(sys.executable)"`)
      pythonCmd = exe.trim()
      sendLog('info', `[Dev] Whisper ${ver.trim()} found — using ${pythonCmd}`)
      event.reply('whisper-status', true)
      return
    } catch { /* try next */ }
  }

  sendLog('error', 'Whisper not found')
  event.reply('whisper-status', false)
})

// ---------------------------------------------------------------------------
// Select audio / video file
// ---------------------------------------------------------------------------
ipcMain.on('select-audio-files', async (event) => {
  sendLog('info', 'Opening file dialog...')
  
  try {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { 
          name: 'Audio & Video Files', 
          extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma', 'mp4', 'mov', 'avi', 'mkv'] 
        },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (!result.canceled && result.filePaths.length > 0) {
      const filePaths = result.filePaths
      sendLog('info', `${filePaths.length} file(s) selected`)
      event.reply('audio-files-selected', filePaths)
    } else {
      sendLog('info', 'File selection cancelled')
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    sendLog('error', `Error selecting files: ${errorMsg}`)
  }
})

// ---------------------------------------------------------------------------
// Transcribe audio/video file using bundled transcribe.py
// ---------------------------------------------------------------------------
ipcMain.on('transcribe-audio', (event, data: { id: string; filePath: string; model: string; language: string | null; format: string; device: string }) => {
  const { id, filePath, model, language, format, device } = data

  sendLog('info', `[Queue] Starting transcription for: ${path.basename(filePath)}`)
  sendLog('info', `[Queue] Model: ${model}, Language: ${language || 'auto'}, Format: ${format}, Device: ${device || 'auto'}`)

  try {
    // Save output file in the same directory as the input file
    const outputDir = path.dirname(filePath)
    const scriptPath = getScriptPath()

    // Build args array — no shell escaping needed with spawn
    const args: string[] = [
      scriptPath,
      filePath,
      '--model', model,
      '--output_format', format,
      '--output_dir', outputDir,
    ]

    if (language) {
      args.push('--language', language)
    }

    // ROCm uses the same 'cuda' device string in PyTorch (Linux only).
    // DirectML and cpu pass through unchanged.
    const pyDevice = device === 'rocm' ? 'cuda' : device
    if (pyDevice && pyDevice !== 'auto') {
      args.push('--device', pyDevice)
    }

    const pyExe = getBundledPython()
    sendLog('debug', `[Queue] Spawning: ${pyExe} ${args.join(' ')}`)

    const proc = spawn(pyExe, args, {
      windowsHide: true,
    })

    currentTranscriptionProcess = proc

    let outputPath: string | null = null
    let scriptError: string | null = null  // ERROR: line from stdout
    let stderrBuffer = ''
    let lastLoggedProgress = -1  // track last % we logged to avoid spam

    // tqdm progress line regex:  " 45%|████▌     | 45/100 [00:05<00:06, 8.52it/s]"
    // captures: [1] percent, [2] ETA string (MM:SS or HH:MM:SS)
    const tqdmRe = /^\s*(\d+)%\|.*\[[\d:]+<([\d:]+)/

    // Parse structured stdout lines
    proc.stdout.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n')
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue

        if (line.startsWith('STATUS:')) {
          const status = line.slice('STATUS:'.length)
          const statusMessages: Record<string, string> = {
            loading_model: 'Loading model...',
            transcribing: 'Transcribing...',
            writing: 'Writing output file...',
            done: 'Done.',
          }
          if (statusMessages[status]) {
            sendLog('info', `[Queue] ${statusMessages[status]}`)
          }
        } else if (line.startsWith('STATUS_DEVICE:')) {
          const detected = line.slice('STATUS_DEVICE:'.length)
          const deviceLabels: Record<string, string> = {
            cuda: 'CUDA (NVIDIA GPU)',
            directml: 'DirectML (AMD/Intel GPU)',
            cpu: 'CPU',
          }
          sendLog('info', `[Queue] Auto-detected device: ${deviceLabels[detected] ?? detected}`)
        } else if (line.startsWith('OUTPUT:')) {
          outputPath = line.slice('OUTPUT:'.length)
        } else if (line.startsWith('ERROR:')) {
          scriptError = line.slice('ERROR:'.length)
          sendLog('error', `[Queue] Script error: ${scriptError}`)
        } else {
          sendLog('debug', `[Queue] stdout: ${line}`)
        }
      }
    })

    // Parse stderr: collect for error reporting AND extract tqdm progress lines
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderrBuffer += text

      // Process each line for tqdm progress
      const lines = text.split('\n')
      for (const raw of lines) {
        // tqdm uses \r to overwrite the same line in a terminal;
        // split on \r too so we catch the latest value
        const parts = raw.split('\r')
        for (const part of parts) {
          const line = part.trim()
          if (!line) continue

          const m = tqdmRe.exec(line)
          if (m) {
            const pct = parseInt(m[1], 10)
            const eta = m[2]   // e.g. "14:37" or "01:14:37"
            event.reply('transcription-progress', { id, progress: pct, eta })
            // Log every 5% increment to keep logs informative without spamming
            if (pct >= lastLoggedProgress + 5 || pct === 100) {
              lastLoggedProgress = pct
              sendLog('info', `[Queue] Progress: ${pct}%${eta ? ` | ETA: ${eta}` : ''}`)
            }
          } else {
            // Log non-tqdm stderr lines (warnings, etc.)
            sendLog('debug', `[Queue] stderr: ${line.substring(0, 300)}`)
          }
        }
      }
    })

    proc.on('close', (code, signal) => {
      const wasCancelling = isCancelling
      currentTranscriptionProcess = null
      isCancelling = false

      if (wasCancelling || signal === 'SIGTERM' || signal === 'SIGKILL') {
        sendLog('warn', `[Queue] ⊗ Transcription cancelled: ${path.basename(filePath)}`)
        event.reply('transcription-cancelled', { id })
        return
      }

      if (code !== 0) {
        // Prefer the explicit ERROR: message from the script, then stderr, then generic
        const errDetail = scriptError || stderrBuffer.trim().substring(0, 500) || `exit code ${code}`
        sendLog('error', `[Queue] ✗ Transcription error: ${errDetail}`)
        event.reply('transcription-error', { id, error: errDetail })
        return
      }

      // Success — verify output file exists
      if (outputPath && fs.existsSync(outputPath)) {
        sendLog('info', `[Queue] ✓ Transcription completed: ${path.basename(outputPath)}`)
        event.reply('transcription-complete', { id, outputPath })
      } else {
        // Fallback: guess path the same way the old code did
        const baseFileName = path.basename(filePath, path.extname(filePath))
        const guessedPath = path.join(outputDir, `${baseFileName}.${format}`)
        if (fs.existsSync(guessedPath)) {
          sendLog('info', `[Queue] ✓ Transcription completed: ${path.basename(guessedPath)}`)
          event.reply('transcription-complete', { id, outputPath: guessedPath })
        } else {
          sendLog('error', `[Queue] ✗ Output file not found. Expected: ${outputPath ?? guessedPath}`)
          event.reply('transcription-error', { id, error: 'Output file not created' })
        }
      }
    })

    proc.on('error', (err) => {
      currentTranscriptionProcess = null
      sendLog('error', `[Queue] ✗ Failed to spawn process: ${err.message}`)
      event.reply('transcription-error', { id, error: err.message })
    })

  } catch (error) {
    currentTranscriptionProcess = null
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    sendLog('error', `[Queue] ✗ Transcription error: ${errorMsg}`)
    event.reply('transcription-error', { id, error: errorMsg })
  }
})

// ---------------------------------------------------------------------------
// Cancel current transcription
// ---------------------------------------------------------------------------
ipcMain.on('cancel-transcription', () => {
  if (currentTranscriptionProcess) {
    sendLog('info', '[Queue] Cancelling current transcription...')
    isCancelling = true
    killCurrentProcess()
  }
})

// ---------------------------------------------------------------------------
// Open file location in system file explorer
// ---------------------------------------------------------------------------
ipcMain.on('open-file-location', async (event, filePath: string) => {
  sendLog('info', `Opening file location: ${filePath}`)
  
  try {
    await shell.showItemInFolder(filePath)
    sendLog('info', `Opened file location: ${path.dirname(filePath)}`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    sendLog('error', `Error opening file location: ${errorMsg}`)
  }
})

// Open output folder
ipcMain.on('open-output-folder', async () => {
  sendLog('info', 'Opening output folder...')
  
  try {
    const outputDir = getOutputDirectory()
    await shell.openPath(outputDir)
    sendLog('info', `Opened folder: ${outputDir}`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    sendLog('error', `Error opening folder: ${errorMsg}`)
  }
})

// Open external URL
ipcMain.on('open-external', async (event, url: string) => {
  sendLog('info', `Opening external URL: ${url}`)
  
  try {
    await shell.openExternal(url)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    sendLog('error', `Error opening URL: ${errorMsg}`)
  }
})

// Keep the old message handler for compatibility
ipcMain.on('message', async (event, arg) => {
  event.reply('message', `${arg} World!`)
})

// Navigate the main window to a page from the renderer
ipcMain.on('navigate-to', (_event, page: 'home' | 'setup') => {
  navigateTo(page)
})

// ---------------------------------------------------------------------------
// GPU / accelerator availability check (fast — single Python invocation)
// ---------------------------------------------------------------------------
ipcMain.on('check-gpu-status', async (event) => {
  sendLog('info', '[GPU] Checking GPU/accelerator availability...')

  const checkLines = [
    'import sys, json',
    'r = {"cuda": False, "rocm": False, "directml": False, "platform": sys.platform}',
    'try:',
    '    import torch',
    '    r["cuda"] = torch.cuda.is_available()',
    '    r["rocm"] = bool(getattr(torch.version, "hip", None))',
    'except Exception:',
    '    pass',
    'try:',
    '    import torch_directml',
    '    r["directml"] = True',
    'except Exception:',
    '    pass',
    'print(json.dumps(r))',
  ]

  let status = { cuda: false, rocm: false, directml: false, platform: process.platform as string }

  try {
    const py = getBundledPython()
    const out = await runPythonScript(checkLines, py)
    status = { ...status, ...JSON.parse(out) }
    sendLog('info', `[GPU] status: ${JSON.stringify(status)}`)
  } catch (err) {
    sendLog('warn', `[GPU] check failed: ${err}`)
  }

  event.reply('gpu-status', status)
})

// ---------------------------------------------------------------------------
// Setup wizard: check installed dependencies
// ---------------------------------------------------------------------------
ipcMain.on('check-dependencies', async (event) => {
  sendLog('info', '[Setup] Checking dependencies...')

  // In production, everything is bundled — just query the bundled Python.
  if (isProd) {
    const py = getBundledPython()
    if (!fs.existsSync(py)) {
      sendLog('error', `[Setup] Bundled Python not found at ${py}`)
      event.reply('dep-status', { python: null, whisper: null, torchDirectml: null, torchCuda: null, isBundled: true })
      return
    }

    const checkLines = [
      'import sys, json',
      'r = {"python": None, "whisper": None, "torchDirectml": None, "torchCuda": None}',
      'r["python"] = "%d.%d.%d" % sys.version_info[:3]',
      'try:',
      '    import whisper; r["whisper"] = whisper.__version__',
      'except Exception: pass',
      'try:',
      '    import torch_directml',
      '    v = getattr(torch_directml, "__version__", None) or getattr(torch_directml, "version", None)',
      '    r["torchDirectml"] = str(v) if v else "installed"',
      'except Exception: pass',
      'try:',
      '    import torch',
      '    if torch.cuda.is_available(): r["torchCuda"] = torch.__version__',
      'except Exception: pass',
      'print(json.dumps(r))',
    ]

    try {
      const out = await runPythonScript(checkLines, py)
      const r = JSON.parse(out)
      sendLog('info', `[Setup] bundled dep status: ${JSON.stringify(r)}`)
      event.reply('dep-status', { ...r, isBundled: true })
    } catch (err) {
      sendLog('error', `[Setup] bundled dep check failed: ${err}`)
      event.reply('dep-status', { python: null, whisper: null, torchDirectml: null, torchCuda: null, isBundled: true })
    }
    return
  }

  // Dev mode: simple system Python check (no pyenv scanning needed)
  const result = {
    python: null as string | null,
    whisper: null as string | null,
    torchDirectml: null as string | null,
    torchCuda: null as string | null,
    isBundled: false,
  }

  for (const cmd of ['python', 'python3']) {
    try {
      const { stdout: vOut } = await execAsync(`${cmd} --version`)
      result.python = vOut.trim().replace(/^Python\s+/i, '')
      const { stdout: exe }  = await execAsync(`${cmd} -c "import sys; print(sys.executable)"`)
      pythonCmd = exe.trim()
      sendLog('info', `[Setup][dev] python: ${pythonCmd} (${result.python})`)
      break
    } catch { /* try next */ }
  }

  if (!result.python) {
    sendLog('error', '[Setup][dev] Python not found')
    event.reply('dep-status', result)
    return
  }

  try {
    const { stdout } = await execAsync(`"${pythonCmd}" -c "import whisper; print(whisper.__version__)"`)
    result.whisper = stdout.trim()
  } catch { /* not installed */ }

  try {
    const { stdout } = await execAsync(`"${pythonCmd}" -c "import torch_directml; print(torch_directml.__version__)"`)
    result.torchDirectml = stdout.trim()
  } catch { /* not installed */ }

  try {
    const { stdout } = await execAsync(`"${pythonCmd}" -c "import torch; print(torch.__version__ if torch.cuda.is_available() else exit(1))"`)
    result.torchCuda = stdout.trim()
  } catch { /* not installed / no CUDA */ }

  sendLog('info', `[Setup][dev] dep status: ${JSON.stringify(result)}`)
  event.reply('dep-status', result)
})

// ---------------------------------------------------------------------------
// Setup wizard: install GPU packages into the bundled Python on demand
// ---------------------------------------------------------------------------
ipcMain.on('start-install', async (event, data: { target: 'directml' | 'cuda' }) => {
  const py = getBundledPython()

  const sendLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    event.reply('install-log', trimmed)
    sendLog('info', `[Install] ${trimmed.substring(0, 200)}`)
  }

  const runPip = (packages: string[]): Promise<{ code: number; stderr: string }> =>
    new Promise(resolve => {
      let stderrBuf = ''
      const args = ['-m', 'pip', 'install', ...packages]
      sendLine(`> "${py}" ${args.join(' ')}`)
      const proc = spawn(py, args, { windowsHide: true })
      proc.stdout.on('data', (c: Buffer) => c.toString().split('\n').forEach(sendLine))
      proc.stderr.on('data', (c: Buffer) => {
        const text = c.toString()
        stderrBuf += text
        text.split('\n').forEach(sendLine)
      })
      proc.on('close', code => {
        sendLine(`> exit code ${code}`)
        resolve({ code: code ?? 1, stderr: stderrBuf })
      })
      proc.on('error', (err: NodeJS.ErrnoException) => {
        const msg = err.code === 'ENOENT'
          ? `Python not found at "${py}". Run: pnpm setup:python`
          : `Spawn error: ${err.message}`
        sendLine(`✗ ${msg}`)
        sendLog('error', `[Install] ${msg}`)
        resolve({ code: 1, stderr: err.message })
      })
    })

  if (data.target === 'directml') {
    // torch-directml 0.2.5 requires torch==2.4.1 + torchvision==0.19.1 exactly.
    // Step 1: install torch/torchvision CPU builds from the PyTorch whl index.
    // Step 2: install torch-directml from PyPI (it's not on the whl index).
    sendLine('--- Step 1/2: Installing torch 2.4.1 (CPU) + torchvision 0.19.1 ---')
    sendLine('Downloading ~205 MB from PyTorch index...')
    const r1 = await runPip([
      'torch==2.4.1',
      'torchvision==0.19.1',
      '--index-url', 'https://download.pytorch.org/whl/cpu',
      '--trusted-host', 'download.pytorch.org',
      '--trusted-host', 'download-r2.pytorch.org',
    ])
    if (r1.code !== 0) {
      const msg = 'Failed to install torch 2.4.1 — see log above.'
      sendLine(`✗ ${msg}`)
      event.reply('install-error', msg)
      return
    }
    sendLine('✓ torch 2.4.1 + torchvision 0.19.1 installed')

    sendLine('--- Step 2/2: Installing torch-directml from PyPI ---')
    const r2 = await runPip(['torch-directml'])
    if (r2.code !== 0) {
      const msg = r2.stderr.toLowerCase().includes('no matching distribution')
        ? 'torch-directml has no release for this Python version (requires 3.10–3.12).'
        : 'torch-directml installation failed — see log above.'
      sendLine(`✗ ${msg}`)
      event.reply('install-error', msg)
      return
    }
    sendLine('✓ torch-directml installed successfully!')

  } else if (data.target === 'cuda') {
    sendLine('--- Installing torch + CUDA (NVIDIA GPU support) ---')
    sendLine('Downloading ~2.5 GB — this may take a while...')
    const r = await runPip([
      'torch', 'torchvision',
      '--upgrade',
      '--index-url', 'https://download.pytorch.org/whl/cu121',
      '--trusted-host', 'download.pytorch.org',
      '--trusted-host', 'download-r2.pytorch.org',
    ])
    if (r.code !== 0) {
      const msg = 'CUDA torch installation failed — see log above.'
      sendLine(`✗ ${msg}`)
      event.reply('install-error', msg)
      return
    }
    sendLine('✓ torch (CUDA) installed successfully!')
  }

  event.reply('install-complete', data.target)
})
