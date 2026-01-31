import path from 'path'
import { app, ipcMain, dialog, shell, BrowserWindow, Menu } from 'electron'
import serve from 'electron-serve'
import { createWindow } from './helpers'
import { exec } from 'child_process'
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

// Get the output directory for transcriptions
const getOutputDirectory = (): string => {
  const platform = os.platform()
  let baseDir: string
  
  if (platform === 'win32') {
    // Windows: Downloads folder
    baseDir = path.join(os.homedir(), 'Downloads')
  } else if (platform === 'darwin') {
    // macOS: Downloads folder
    baseDir = path.join(os.homedir(), 'Downloads')
  } else {
    // Linux: Downloads folder
    baseDir = path.join(os.homedir(), 'Downloads')
  }
  
  const outputDir = path.join(baseDir, 'Transcriber')
  
  // Create directory if it doesn't exist
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

  if (isProd) {
    await mainWindow.loadURL('app://./home')
  } else {
    const port = process.argv[2]
    await mainWindow.loadURL(`http://localhost:${port}/home`)
    mainWindow.webContents.openDevTools()
  }

  sendLog('info', 'Application started')
})()

app.on('window-all-closed', () => {
  app.quit()
})

// Check if Whisper CLI is installed
ipcMain.on('check-whisper', async (event) => {
  sendLog('info', 'Checking Whisper CLI installation...')
  
  try {
    const { stdout, stderr } = await execAsync('whisper --version')
    
    // Check if output contains "not found" or similar error messages
    const output = (stdout + stderr).toLowerCase()
    if (output.includes('not found') || output.includes('command not found')) {
      sendLog('error', 'Whisper CLI not found in PATH')
      event.reply('whisper-status', false)
    } else {
      sendLog('info', `Whisper CLI is installed`)
      event.reply('whisper-status', true)
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    const errorOutput = (errorMsg || '').toLowerCase()
    
    // Check if the error message contains "not found" (command doesn't exist)
    // or contains "usage: whisper" (command exists but needs arguments)
    if (errorOutput.includes('not found') || errorOutput.includes('command not found')) {
      sendLog('error', 'Whisper CLI not found in PATH')
      event.reply('whisper-status', false)
    } else if (errorOutput.includes('usage: whisper') || errorOutput.includes('whisper: error:')) {
      // If we see usage or error from whisper itself, it means whisper is installed
      sendLog('info', 'Whisper CLI is installed')
      event.reply('whisper-status', true)
    } else {
      sendLog('error', `Whisper CLI check failed: ${errorMsg}`)
      event.reply('whisper-status', false)
    }
  }
})

// Select audio file
ipcMain.on('select-audio-files', async (event) => {
  sendLog('info', 'Opening file dialog...')
  
  try {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { 
          name: 'Audio Files', 
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

// Transcribe audio file
ipcMain.on('transcribe-audio', async (event, data: { id: string; filePath: string; model: string; language: string | null; format: string; useCuda: boolean }) => {
  const { id, filePath, model, language, format, useCuda } = data
  
  sendLog('info', `[Queue] Starting transcription for: ${path.basename(filePath)}`)
  sendLog('info', `[Queue] Model: ${model}, Language: ${language || 'auto'}, Format: ${format}, CUDA: ${useCuda ? 'enabled' : 'disabled'}`)
  
  try {
    const outputDir = getOutputDirectory()
    const baseFileName = path.basename(filePath, path.extname(filePath))
    
    // Escape file path for shell command
    const escapedInputPath = filePath.replace(/"/g, '\\"')
    const escapedOutputDir = outputDir.replace(/"/g, '\\"')
    
    // Build whisper command
    // Note: Whisper automatically names output files as "{input_basename}.{format}"
    let command = `whisper "${escapedInputPath}" --model ${model} --output_format ${format} --output_dir "${escapedOutputDir}"`
    
    if (language) {
      command += ` --language ${language}`
    }
    
    // Add device parameter for CUDA
    if (useCuda) {
      command += ` --device cuda`
    }
    
    sendLog('debug', `[Queue] Executing: ${command}`)
    
    // Execute transcription with ability to kill
    // On Unix systems, spawn with detached: false to be part of process group
    currentTranscriptionProcess = exec(command, {
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large outputs
      windowsHide: true, // Hide window on Windows
    }, (error, stdout, stderr) => {
      const wasCancelling = isCancelling
      currentTranscriptionProcess = null
      isCancelling = false
      
      if (error) {
        // Check if it was manually cancelled by user
        if (wasCancelling) {
          sendLog('warn', `[Queue] ⊗ Transcription cancelled: ${path.basename(filePath)}`)
          event.reply('transcription-cancelled', { id })
          return
        }
        
        // Check if it was killed by signal (Unix systems)
        if (error.killed || error.signal === 'SIGTERM' || error.signal === 'SIGKILL') {
          sendLog('warn', `[Queue] ⊗ Transcription cancelled: ${path.basename(filePath)}`)
          event.reply('transcription-cancelled', { id })
          return
        }
        
        const errorMsg = error.message
        sendLog('error', `[Queue] ✗ Transcription error: ${errorMsg}`)
        event.reply('transcription-error', { id, error: errorMsg })
        return
      }

      if (stderr && !stderr.toLowerCase().includes('warning')) {
        sendLog('warn', `[Queue] Whisper output: ${stderr.substring(0, 500)}`)
      }

      // Whisper saves output as "{input_basename}.{format}"
      const outputPath = path.join(outputDir, `${baseFileName}.${format}`)
      
      // Check if output file exists
      if (fs.existsSync(outputPath)) {
        sendLog('info', `[Queue] ✓ Transcription completed: ${path.basename(outputPath)}`)
        event.reply('transcription-complete', { id, outputPath })
      } else {
        sendLog('error', `[Queue] ✗ Output file not found: ${outputPath}`)
        event.reply('transcription-error', { id, error: 'Output file not created' })
      }
    })
    
  } catch (error) {
    currentTranscriptionProcess = null
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    sendLog('error', `[Queue] ✗ Transcription error: ${errorMsg}`)
    event.reply('transcription-error', { id, error: errorMsg })
  }
})

// Cancel current transcription
ipcMain.on('cancel-transcription', () => {
  if (currentTranscriptionProcess) {
    sendLog('info', '[Queue] Cancelling current transcription...')
    isCancelling = true // Set the flag before killing
    
    try {
      // For Windows, we need to kill the entire process tree
      const platform = os.platform()
      const pid = currentTranscriptionProcess.pid
      
      if (!pid) {
        sendLog('warn', '[Queue] No PID found for current process')
        currentTranscriptionProcess = null
        return
      }
      
      if (platform === 'win32') {
        // Windows: Use taskkill to kill the process tree forcefully
        exec(`taskkill /pid ${pid} /T /F`, (error) => {
          if (error) {
            sendLog('warn', `[Queue] Error killing process tree: ${error.message}`)
          } else {
            sendLog('info', '[Queue] ⊗ Process tree terminated (Windows)')
          }
        })
      } else {
        // Unix-like systems: Try to kill process group first
        try {
          process.kill(-pid, 'SIGTERM')
          sendLog('info', '[Queue] ⊗ Sent SIGTERM to process group (Unix)')
          
          // After 2 seconds, send SIGKILL if process still exists
          setTimeout(() => {
            try {
              process.kill(-pid, 'SIGKILL')
              sendLog('info', '[Queue] ⊗ Sent SIGKILL to process group (Unix)')
            } catch (e) {
              // Process already dead, ignore
            }
          }, 2000)
        } catch (error) {
          // Fallback to killing just the process
          currentTranscriptionProcess.kill('SIGTERM')
          sendLog('info', '[Queue] ⊗ Sent SIGTERM to process (Unix fallback)')
          
          // After 2 seconds, send SIGKILL
          setTimeout(() => {
            try {
              if (currentTranscriptionProcess) {
                currentTranscriptionProcess.kill('SIGKILL')
                sendLog('info', '[Queue] ⊗ Sent SIGKILL to process (Unix fallback)')
              }
            } catch (e) {
              // Process already dead, ignore
            }
          }, 2000)
        }
      }
      
      currentTranscriptionProcess = null
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      sendLog('error', `[Queue] Error cancelling transcription: ${errorMsg}`)
      currentTranscriptionProcess = null
      isCancelling = false // Reset flag on error
    }
  }
})

// Open file location in system file explorer
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
