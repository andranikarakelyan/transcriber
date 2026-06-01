import React, { useEffect, useMemo, useState } from 'react'
import Head from 'next/head'
import LogViewer from '../components/LogViewer'

interface QueueItem {
  id: string
  filePath: string
  fileName: string
  status: 'pending' | 'processing' | 'completed' | 'error' | 'cancelled'
  progress?: number
  eta?: string
  error?: string
  outputPath?: string
  startedAt?: number   // Date.now() when processing began
  elapsedMs?: number   // final elapsed ms, frozen once task ends
  actualDevice?: string // resolved device: cpu | cuda | directml | rocm
  willOverwrite?: boolean // output file already exists and will be replaced
}

interface GpuStatus {
  cuda: boolean
  rocm: boolean
  directml: boolean
  platform: string   // 'win32' | 'linux' | 'darwin'
}

const WHISPER_MODELS = ['tiny', 'base', 'small', 'medium', 'large']
const OUTPUT_FORMATS = [
  { value: 'srt', label: 'SRT - SubRip (Most Popular)', icon: '📝' },
  { value: 'vtt', label: 'VTT - WebVTT', icon: '🌐' },
  { value: 'txt', label: 'TXT - Plain Text', icon: '📄' },
  { value: 'json', label: 'JSON - Structured Data', icon: '🔧' },
  { value: 'tsv', label: 'TSV - Tab Separated', icon: '📊' },
]
const LANGUAGES = [
  { code: 'auto', name: 'Auto Detect' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'tr', name: 'Turkish' },
]

export default function HomePage() {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [selectedModel, setSelectedModel] = useState('large')
  const [selectedLanguage, setSelectedLanguage] = useState('en')
  const [selectedFormat, setSelectedFormat] = useState('srt')
  const [selectedDevice, setSelectedDevice] = useState('auto')
  const [gpuStatus, setGpuStatus] = useState<GpuStatus | null>(null)

  // Ticks every second while any item is processing, driving the real-time
  // elapsed timer. Stops automatically when nothing is processing.
  const [tickNow, setTickNow] = useState(() => Date.now())
  const hasProcessingItem = useMemo(() => queue.some(i => i.status === 'processing'), [queue])
  useEffect(() => {
    if (!hasProcessingItem) return
    const id = setInterval(() => setTickNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [hasProcessingItem])

  // Format elapsed milliseconds as m:ss or h:mm:ss
  const formatElapsed = (ms: number): string => {
    const s = Math.floor(ms / 1000)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  useEffect(() => {
    const ipc = (window as any).ipc
    if (!ipc) return

    // Check GPU/accelerator availability
    ipc.send('check-gpu-status')
    ipc.on('gpu-status', (status: GpuStatus) => {
      setGpuStatus(status)
      // If the currently selected device is unavailable, fall back to auto
      setSelectedDevice(prev => {
        if (prev === 'cuda' && !status.cuda) return 'auto'
        if (prev === 'directml' && !status.directml) return 'auto'
        if (prev === 'rocm' && !status.rocm) return 'auto'
        return prev
      })
    })

    // Listen for transcription updates
    {
      const handleProgress = (data: { id: string; progress: number; eta?: string }) => {
        updateQueueItem(data.id, { progress: data.progress, eta: data.eta })
      }

      const handleDevice = (data: { id: string; device: string }) => {
        updateQueueItem(data.id, { actualDevice: data.device })
      }

      const handleOutputExistsResult = (data: { id: string; exists: boolean }) => {
        updateQueueItem(data.id, { willOverwrite: data.exists })
      }

      const handleComplete = (data: { id: string; outputPath: string }) => {
        console.log('Transcription complete:', data.id)
        // Freeze the elapsed time at completion
        setQueue(prev => prev.map(item => {
          if (item.id !== data.id) return item
          const elapsedMs = item.startedAt != null ? Date.now() - item.startedAt : undefined
          return { ...item, status: 'completed' as const, progress: 100, eta: undefined, outputPath: data.outputPath, elapsedMs }
        }))
        // Trigger processing next item
        setTimeout(() => {
          setQueue(prevQueue => {
            const justCompleted = prevQueue.find(item => item.id === data.id)
            const nextItem = prevQueue.find(item => item.status === 'pending')
            
            console.log('Queue check - completed:', justCompleted?.fileName, 'next:', nextItem?.fileName)
            
            if (nextItem) {
              console.log('Processing next item:', nextItem.fileName)
              setIsPaused(prev => {
                if (!prev) {
                  processNextInQueue()
                }
                return prev
              })
            } else {
              console.log('No more items in queue, stopping')
              setIsProcessing(false)
            }
            return prevQueue
          })
        }, 500)
      }

      const handleError = (data: { id: string; error: string }) => {
        console.log('Transcription error:', data.id, data.error)
        // Freeze the elapsed time at failure
        setQueue(prev => prev.map(item => {
          if (item.id !== data.id) return item
          const elapsedMs = item.startedAt != null ? Date.now() - item.startedAt : undefined
          return { ...item, status: 'error' as const, error: data.error, elapsedMs }
        }))
        // Trigger processing next item
        setTimeout(() => {
          setQueue(prevQueue => {
            const nextItem = prevQueue.find(item => item.status === 'pending')
            
            console.log('Queue check after error - next:', nextItem?.fileName)
            
            if (nextItem) {
              console.log('Processing next item after error:', nextItem.fileName)
              setIsPaused(prev => {
                if (!prev) {
                  processNextInQueue()
                }
                return prev
              })
            } else {
              console.log('No more items in queue, stopping')
              setIsProcessing(false)
            }
            return prevQueue
          })
        }, 500)
      }

      const handleCancelled = (data: { id: string }) => {
        console.log('Transcription cancelled:', data.id)
        // Freeze the elapsed time at cancellation
        setQueue(prev => prev.map(item => {
          if (item.id !== data.id) return item
          const elapsedMs = item.startedAt != null ? Date.now() - item.startedAt : undefined
          return { ...item, status: 'cancelled' as const, error: 'Cancelled by user', elapsedMs }
        }))
      }

      const handleFilesSelected = (filePaths: string[]) => {
        addFilesToQueue(filePaths)
      }

      ipc.on('transcription-progress', handleProgress)
      ipc.on('transcription-device', handleDevice)
      ipc.on('output-exists-result', handleOutputExistsResult)
      ipc.on('transcription-complete', handleComplete)
      ipc.on('transcription-error', handleError)
      ipc.on('transcription-cancelled', handleCancelled)
      ipc.on('audio-files-selected', handleFilesSelected)

      // Cleanup function to remove listeners
      return () => {
        ipc.removeListener('transcription-progress', handleProgress)
        ipc.removeListener('transcription-device', handleDevice)
        ipc.removeListener('output-exists-result', handleOutputExistsResult)
        ipc.removeListener('transcription-complete', handleComplete)
        ipc.removeListener('transcription-error', handleError)
        ipc.removeListener('transcription-cancelled', handleCancelled)
        ipc.removeListener('audio-files-selected', handleFilesSelected)
      }
    }
  }, [])
  const handleSelectFile = async () => {
    try {
      const ipc = (window as any).ipc
      if (ipc) {
        ipc.send('select-audio-files')
      }
    } catch (error) {
      console.error('Error selecting files:', error)
    }
  }

  const addFilesToQueue = (filePaths: string[]) => {
    const newItems: QueueItem[] = filePaths.map(filePath => {
      // Extract filename from path (works for both Unix / and Windows \)
      const fileName = filePath.split(/[\\/]/).pop() || filePath
      return {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        filePath,
        fileName,
        status: 'pending' as const,
        progress: 0,
      }
    })
    setQueue(prev => [...prev, ...newItems])
    // Check if output files already exist for the new items
    checkOverwrites(newItems, selectedFormat)
  }

  // Send existence checks to the main process for a set of items + format.
  const checkOverwrites = (items: Pick<QueueItem, 'id' | 'filePath'>[], format: string) => {
    const ipc = (window as any).ipc
    if (!ipc) return
    for (const item of items) {
      ipc.send('check-output-exists', { id: item.id, filePath: item.filePath, format })
    }
  }

  const updateQueueItem = (id: string, updates: Partial<QueueItem>) => {
    setQueue(prev => prev.map(item => 
      item.id === id ? { ...item, ...updates } : item
    ))
  }

  const removeFromQueue = (id: string) => {
    setQueue(prev => prev.filter(item => item.id !== id))
  }

  const requeueItem = (id: string) => {
    // Just reset the item to pending status (add back to queue)
    updateQueueItem(id, { status: 'pending', progress: 0, eta: undefined, error: undefined })
  }

  const clearCompleted = () => {
    setQueue(prev => prev.filter(item => item.status !== 'completed'))
  }

  const startQueue = async () => {
    if (isProcessing && !isPaused) return
    console.log('Starting queue')
    
    // Reset cancelled items back to pending
    setQueue(prev => prev.map(item => 
      item.status === 'cancelled' 
        ? { ...item, status: 'pending', progress: 0, error: undefined } 
        : item
    ))
    
    setIsProcessing(true)
    setIsPaused(false)
    processNextInQueue()
  }

  const pauseQueue = () => {
    console.log('Pausing queue')
    setIsPaused(true)
    setIsProcessing(false)
    
    // Send cancel signal to backend (backend will handle marking as cancelled)
    const ipc = (window as any).ipc
    if (ipc) {
      ipc.send('cancel-transcription')
    }
  }

  const resumeQueue = () => {
    console.log('Resuming queue')
    setIsPaused(false)
    setIsProcessing(true)
    processNextInQueue()
  }

  const processNextInQueue = () => {
    setQueue(prevQueue => {
      const processingItem = prevQueue.find(item => item.status === 'processing')
      if (processingItem) {
        console.log('Already processing an item, skipping')
        return prevQueue
      }

      setIsPaused(prevPaused => {
        if (prevPaused) {
          console.log('Queue is paused, not processing')
          return prevPaused
        }
        
        const nextItem = prevQueue.find(item => item.status === 'pending')
        
        if (!nextItem) {
          console.log('No pending items in queue')
          setIsProcessing(false)
          return prevPaused
        }

        console.log('Processing next item:', nextItem.fileName)
        setIsProcessing(true)
        updateQueueItem(nextItem.id, {
          status: 'processing',
          progress: 0,
          eta: undefined,
          startedAt: Date.now(),
          // For non-auto devices we already know what will be used; for auto
          // we wait for the STATUS_DEVICE IPC event from the Python script.
          actualDevice: selectedDevice !== 'auto' ? selectedDevice : undefined,
        })

        const ipc = (window as any).ipc
        if (ipc) {
          ipc.send('transcribe-audio', {
                            id: nextItem.id,
                            filePath: nextItem.filePath,
                            model: selectedModel,
                            language: selectedLanguage === 'auto' ? null : selectedLanguage,
                            format: selectedFormat,
                            device: selectedDevice,
                          })
        }
        
        return prevPaused
      })
      return prevQueue
    })
  }

  const openFileLocation = (filePath: string) => {
    const ipc = (window as any).ipc
    if (ipc) {
      ipc.send('open-file-location', filePath)
    }
  }

  const stopQueue = () => {
    setIsProcessing(false)
    setIsPaused(false)
    // Reset processing items to pending
    setQueue(prev => prev.map(item => 
      item.status === 'processing' ? { ...item, status: 'pending', progress: 0 } : item
    ))
  }

  const truncatePathStart = (filePath: string, fileName: string, maxLength: number = 60) => {
    // If the path is short enough, return as is
    if (filePath.length <= maxLength) {
      return filePath
    }
    
    // Calculate how much space we need for the filename
    const fileNameLength = fileName.length
    const prefixLength = maxLength - fileNameLength - 3 // 3 for "..."
    
    if (prefixLength <= 0) {
      // If filename itself is too long, just show it
      return `...${fileName}`
    }
    
    // Get the directory path without the filename
    const dirPath = filePath.substring(0, filePath.length - fileName.length)
    
    // Truncate from the start of the directory path
    const truncatedDir = '...' + dirPath.substring(dirPath.length - prefixLength)
    
    return truncatedDir + fileName
  }

  const openOutputFolder = () => {
    const ipc = (window as any).ipc
    if (ipc) {
      ipc.send('open-output-folder')
    }
  }

  const getStatusIcon = (status: QueueItem['status']) => {
    switch (status) {
      case 'pending':
        return (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-500/20 to-orange-500/20 flex items-center justify-center border border-yellow-500/30">
            <svg className="w-5 h-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        )
      case 'processing':
        return (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center border border-blue-500/30">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-400"></div>
          </div>
        )
      case 'completed':
        return (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center border border-green-500/30">
            <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )
      case 'cancelled':
        return (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500/20 to-amber-500/20 flex items-center justify-center border border-orange-500/30">
            <svg className="w-5 h-5 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        )
      case 'error':
        return (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-red-500/20 to-pink-500/20 flex items-center justify-center border border-red-500/30">
            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        )
    }
  }

  const DEVICE_BADGE: Record<string, { label: string; classes: string }> = {
    cuda:     { label: 'CUDA',     classes: 'bg-green-500/15 border-green-500/30 text-green-400' },
    rocm:     { label: 'ROCm',     classes: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' },
    directml: { label: 'DirectML', classes: 'bg-purple-500/15 border-purple-500/30 text-purple-400' },
    cpu:      { label: 'CPU',      classes: 'bg-gray-600/30 border-gray-500/30 text-gray-400' },
  }

  const DeviceBadge = ({ device }: { device: string }) => {
    const cfg = DEVICE_BADGE[device]
    if (!cfg) return null
    return (
      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.classes}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
        {cfg.label}
      </span>
    )
  }

  const OverwriteWarning = () => (
    <span className="group relative inline-flex items-center flex-shrink-0">
      <svg
        className="w-3.5 h-3.5 text-amber-400 cursor-help"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
      {/* Opens downward so it stays inside the overflow-y:auto scroll container */}
      <span className="absolute left-0 top-5 hidden group-hover:block w-56 p-2 bg-gray-950 border border-amber-500/40 rounded-lg shadow-xl text-xs text-amber-300 z-30 pointer-events-none leading-relaxed">
        An output file with this name already exists and <span className="font-semibold text-amber-200">will be overwritten</span>.
      </span>
    </span>
  )

  const getStatusBg = (status: QueueItem['status']) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-900/30 hover:bg-yellow-900/40 border-l-4 border-yellow-600/60'
      case 'processing':
        return 'bg-blue-900/30 shadow-lg shadow-blue-500/20 border-l-4 border-blue-500/60'
      case 'completed':
        return 'bg-green-900/30 hover:bg-green-900/40 border-l-4 border-green-600/60'
      case 'cancelled':
        return 'bg-orange-900/30 hover:bg-orange-900/40 border-l-4 border-orange-600/60'
      case 'error':
        return 'bg-red-900/30 hover:bg-red-900/40 border-l-4 border-red-600/60'
      default:
        return 'bg-gray-800/30'
    }
  }

  const pendingCount = queue.filter(i => i.status === 'pending' || i.status === 'cancelled').length
  const completedCount = queue.filter(i => i.status === 'completed').length

  return (
    <React.Fragment>
      <Head>
        <title>Transcriber Desktop</title>
      </Head>
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 max-w-[1600px]">
          {/* Main Grid Layout */}
          <div className="space-y-6">
            {/* Top Row - Settings and Queue */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column - Settings & Controls */}
              <div className="space-y-6">
              {/* Settings & Controls */}
              <div className="bg-gradient-to-br from-gray-800/60 to-gray-800/40 backdrop-blur-sm rounded-xl border border-gray-700/50 p-5 shadow-xl">
                <div className="flex items-start justify-between mb-4">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                      <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">Settings</span>
                  </h2>
                </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                      {/* Model Selection */}
                      <div>
                        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-400 mb-1.5">
                          <span>Model</span>
                          <div className="group relative">
                            <svg className="w-3.5 h-3.5 text-gray-500 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-gray-950 border border-gray-600 rounded-lg shadow-xl text-xs text-gray-300 z-10">
                              <p className="font-semibold text-white mb-1">Model Size Guide:</p>
                              <p className="mb-1"><span className="text-yellow-400">tiny/base:</span> Fast, ~1-2 GB RAM</p>
                              <p className="mb-1"><span className="text-blue-400">small/medium:</span> Balanced, ~2-5 GB RAM</p>
                              <p><span className="text-red-400">large:</span> Most accurate, ~10 GB RAM</p>
                            </div>
                          </div>
                        </label>
                        <select
                          value={selectedModel}
                          onChange={(e) => setSelectedModel(e.target.value)}
                          disabled={isProcessing}
                          className="w-full bg-gray-900/70 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                          {WHISPER_MODELS.map(model => (
                            <option key={model} value={model}>{model.charAt(0).toUpperCase() + model.slice(1)}</option>
                          ))}
                        </select>
                      </div>

                      {/* Language Selection */}
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Language</label>
                        <select
                          value={selectedLanguage}
                          onChange={(e) => setSelectedLanguage(e.target.value)}
                          disabled={isProcessing}
                          className="w-full bg-gray-900/70 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                          {LANGUAGES.map(lang => (
                            <option key={lang.code} value={lang.code}>{lang.name}</option>
                          ))}
                        </select>
                      </div>

                      {/* Output Format Selection */}
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Output Format</label>
                        <select
                          value={selectedFormat}
                          onChange={(e) => {
                            const newFormat = e.target.value
                            setSelectedFormat(newFormat)
                            // Recheck all pending items — output path changes with format
                            const pending = queue.filter(i => i.status === 'pending')
                            checkOverwrites(pending, newFormat)
                          }}
                          disabled={isProcessing}
                          className="w-full bg-gray-900/70 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                          {OUTPUT_FORMATS.map(format => (
                            <option key={format.value} value={format.value}>
                              {format.icon} {format.value.toUpperCase()} - {format.label.split(' - ')[1]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Device Selection */}
                    <div className="mb-4">
                      <label className="flex items-center gap-1.5 text-xs font-medium text-gray-400 mb-2">
                        <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span>Compute Device</span>
                      </label>
                       <DeviceSelector
                        value={selectedDevice}
                        onChange={setSelectedDevice}
                        disabled={isProcessing}
                        gpuStatus={gpuStatus}
                        onNavigateToSetup={() => (window as any).ipc?.send('navigate-to', 'setup')}
                      />
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={handleSelectFile}
                        disabled={isProcessing}
                        className="flex-1 py-2.5 bg-gradient-to-r from-blue-600/80 to-cyan-600/80 hover:from-blue-600 hover:to-cyan-600 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-900/30 flex items-center justify-center gap-2 text-sm"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add Files
                      </button>
                    </div>

                    {/* Queue Controls */}
                    {queue.length > 0 && (
                      <div className="mt-4 bg-gray-700/60 rounded-lg p-3 border-2 border-gray-600">
                        <div className="flex flex-col gap-3">
                          <div className="flex items-center gap-2 text-xs flex-wrap">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-yellow-600/60 border-2 border-yellow-400/50 rounded-md shadow-lg shadow-yellow-500/25">
                              <span className="w-2 h-2 rounded-full bg-yellow-200 animate-pulse"></span>
                              <span className="text-white font-bold">{pendingCount}</span>
                              <span className="text-yellow-100">pending</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600/60 border-2 border-green-400/50 rounded-md shadow-lg shadow-green-500/25">
                              <span className="w-2 h-2 rounded-full bg-green-200"></span>
                              <span className="text-white font-bold">{completedCount}</span>
                              <span className="text-green-100">done</span>
                            </span>
                          </div>
                          <div className="flex gap-2">
                            {!isProcessing ? (
                              <button
                                onClick={startQueue}
                                disabled={pendingCount === 0}
                                className="flex-1 px-4 py-2 bg-gradient-to-br from-green-500/80 via-green-600/80 to-emerald-600/80 hover:from-green-500 hover:via-green-600 hover:to-emerald-600 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-all shadow-lg shadow-green-500/30 hover:shadow-green-500/40 disabled:shadow-none flex items-center justify-center gap-1.5 text-sm"
                              >
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M8 5v14l11-7z" />
                                </svg>
                                Start
                              </button>
                            ) : (
                              <button
                                onClick={pauseQueue}
                                className="flex-1 px-4 py-2 bg-gradient-to-br from-amber-500/80 via-orange-500/80 to-orange-600/80 hover:from-amber-500 hover:via-orange-500 hover:to-orange-600 text-white font-bold rounded-lg transition-all shadow-lg shadow-orange-500/30 hover:shadow-orange-500/40 flex items-center justify-center gap-1.5 text-sm"
                              >
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                                </svg>
                                Pause
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
              </div>

              {/* Right Column - Queue */}
              <div className="space-y-6">
                  {/* Queue */}
                  <div className="bg-gradient-to-br from-gray-800/60 to-gray-800/40 backdrop-blur-sm rounded-xl border border-gray-700/50 p-5 shadow-xl">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-semibold flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-blue-600/60 border border-blue-400 flex items-center justify-center">
                          <svg className="w-4 h-4 text-blue-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                          </svg>
                        </div>
                        <span className="bg-gradient-to-r from-blue-300 to-cyan-300 bg-clip-text text-transparent">Queue</span>
                        <span className="ml-1 px-2.5 py-1 bg-blue-600/70 text-white text-xs font-bold rounded-full border-2 border-blue-400 shadow-lg shadow-blue-500/40">
                          {queue.length}
                        </span>
                      </h2>
                      {completedCount > 0 && (
                        <button
                          onClick={clearCompleted}
                          className="text-xs px-3 py-1.5 bg-gradient-to-r from-gray-700 to-gray-600 hover:from-gray-600 hover:to-gray-500 text-gray-300 rounded-lg transition-all"
                        >
                          Clear Completed
                        </button>
                      )}
                    </div>

                    {queue.length === 0 ? (
                      <div className="py-16 text-center">
                        <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-gray-700/50 to-gray-800/50 flex items-center justify-center mb-4 shadow-inner">
                          <svg className="w-10 h-10 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                          </svg>
                        </div>
                        <p className="text-gray-400 font-medium mb-1">No files in queue</p>
                        <p className="text-sm text-gray-500">Add audio files to start transcription</p>
                      </div>
                    ) : (
                      <>
                        <div className="bg-gray-900/50 rounded-lg border border-gray-700/50 divide-y divide-gray-700/50 max-h-96 overflow-y-auto shadow-inner">
                          {queue.map((item) => (
                            <div key={item.id} className={`p-3 transition-all duration-300 ${getStatusBg(item.status)}`}>
                              <div className="flex items-start gap-3">
                                {getStatusIcon(item.status)}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 mb-1 min-w-0">
                                    <p className="text-white font-medium text-sm truncate" title={item.filePath}>{item.fileName}</p>
                                    {item.willOverwrite && <OverwriteWarning />}
                                  </div>
                                  {item.elapsedMs != null && item.status !== 'processing' && (
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="inline-flex items-center gap-1 text-xs text-gray-500 font-mono">
                                        ⏱ {formatElapsed(item.elapsedMs)}
                                      </span>
                                      {item.actualDevice && <DeviceBadge device={item.actualDevice} />}
                                    </div>
                                  )}
                                  {item.status === 'processing' && item.progress !== undefined && (
                                    <div className="mt-2">
                                      <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs font-medium text-blue-400">Processing...</span>
                                          {item.actualDevice && <DeviceBadge device={item.actualDevice} />}
                                        </div>
                                        <div className="flex items-center gap-2">
                                          {item.startedAt != null && (
                                            <span className="inline-block min-w-[3.5rem] text-right text-xs text-gray-400 font-mono">
                                              ⏱ {formatElapsed(tickNow - item.startedAt)}
                                            </span>
                                          )}
                                          {item.eta && (
                                            <span className="inline-block min-w-[5.5rem] text-right text-xs text-gray-400">
                                              ETA <span className="font-mono text-cyan-400">{item.eta}</span>
                                            </span>
                                          )}
                                          <span className="text-xs font-bold text-blue-400">{item.progress}%</span>
                                        </div>
                                      </div>
                                      <div className="w-full bg-gray-700/50 rounded-full h-2 overflow-hidden shadow-inner">
                                        <div
                                          className="bg-gradient-to-r from-blue-500 to-cyan-500 h-2 rounded-full transition-all duration-500 shadow-lg shadow-blue-500/50"
                                          style={{ width: `${item.progress}%` }}
                                        ></div>
                                      </div>
                                    </div>
                                  )}
                                  {item.status === 'cancelled' && item.error && (
                                    <div className="mt-2 p-2 bg-orange-900/20 border border-orange-500/30 rounded text-xs text-orange-400">{item.error}</div>
                                  )}
                                  {item.status === 'error' && item.error && (
                                    <div className="mt-2 space-y-1">
                                      <div className="p-2 bg-red-900/20 border border-red-500/30 rounded text-xs text-red-400 break-words">{item.error}</div>
                                      {/cuda|CUDA|torch\.cuda|deserializ/i.test(item.error) && (
                                        <div className="p-2 bg-amber-900/20 border border-amber-500/30 rounded text-xs text-amber-400">
                                          CUDA is not available on this system. Switch the Compute Device to <span className="font-semibold">CPU</span> in Settings.
                                        </div>
                                      )}
                                      {/rocm|ROCm|hip/i.test(item.error) && (
                                        <div className="p-2 bg-amber-900/20 border border-amber-500/30 rounded text-xs text-amber-400">
                                          ROCm is not available or not installed. Requires ROCm-enabled PyTorch on Linux. Switch the Compute Device to <span className="font-semibold">CPU</span> in Settings.
                                        </div>
                                      )}
                                      {/torch.directml|directml|DirectML/i.test(item.error) && (
                                        <div className="p-2 bg-amber-900/20 border border-amber-500/30 rounded text-xs text-amber-400">
                                          torch-directml is not installed. Run: <span className="font-mono">pip install torch-directml</span>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                                {item.status === 'pending' && !isProcessing && (
                                  <button
                                    onClick={() => removeFromQueue(item.id)}
                                    className="w-8 h-8 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 hover:border-red-500/50 flex items-center justify-center transition-all flex-shrink-0"
                                    title="Remove from queue"
                                  >
                                    <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                )}
                                {(item.status === 'error' || item.status === 'cancelled') && !isProcessing && (
                                  <div className="flex gap-2 flex-shrink-0">
                                    <button
                                      onClick={() => requeueItem(item.id)}
                                      className="w-8 h-8 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 hover:border-blue-500/50 flex items-center justify-center transition-all"
                                      title="Add back to queue"
                                    >
                                      <svg className="w-3.5 h-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                      </svg>
                                    </button>
                                    <button
                                      onClick={() => removeFromQueue(item.id)}
                                      className="w-8 h-8 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 hover:border-red-500/50 flex items-center justify-center transition-all"
                                      title="Remove from queue"
                                    >
                                      <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  </div>
                                )}
                                {item.status === 'completed' && item.outputPath && (
                                  <button
                                    onClick={() => openFileLocation(item.outputPath!)}
                                    className="w-8 h-8 rounded-lg bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 hover:border-green-500/50 flex items-center justify-center transition-all flex-shrink-0"
                                    title="Open file location"
                                  >
                                    <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
              </div>

              {/* Right Column - Queue Summary/Stats */}
              <div className="lg:hidden">
                {/* This space intentionally empty on mobile, queue is full width */}
              </div>
            </div>

            {/* Bottom Row - System Logs */}
            <div className="w-full">
              <LogViewer />
            </div>

            {/* Footer - Contact & Support */}
            <div className="w-full">
              <div className="bg-gradient-to-br from-gray-800/40 to-gray-800/30 backdrop-blur-sm rounded-xl border border-gray-700/50 p-4 shadow-xl">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center border border-indigo-500/30">
                      <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm text-gray-300">
                        <span className="font-semibold text-white">Issues or Feature Requests?</span>
                      </p>
                      <p className="text-xs text-gray-500">
                        Contact: <span className="text-indigo-400 font-medium">andranik.arakelyan.work@gmail.com</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const ipc = (window as any).ipc
                        if (ipc) {
                          ipc.send('open-external', 'mailto:andranik.arakelyan.work@gmail.com?subject=Transcriber%20App%20Feedback')
                        }
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600/80 to-purple-600/80 hover:from-indigo-600 hover:to-purple-600 text-white rounded-lg transition-all shadow-lg shadow-indigo-900/20 hover:shadow-indigo-900/30 text-sm font-medium border border-indigo-500/50"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      <span>Contact</span>
                    </button>
                    <button
                      onClick={() => {
                        const ipc = (window as any).ipc
                        if (ipc) {
                          ipc.send('open-external', 'https://github.com/andranikarakelyan/transcriber')
                        }
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-700/80 hover:bg-gray-700 text-white rounded-lg transition-all shadow-lg shadow-gray-900/20 hover:shadow-gray-900/30 text-sm font-medium border border-gray-600/50"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                      </svg>
                      <span>GitHub</span>
                    </button>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-700/50">
                  <p className="text-xs text-gray-500 text-center">
                    <span className="inline-flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      This app was created using AI agents and tested manually.
                    </span>
                    {' '} Currently tested for Windows only. macOS/Linux support coming based on community needs.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </React.Fragment>
  )
}

// ---------------------------------------------------------------------------
// DeviceSelector — shows available / unavailable compute options as cards
// ---------------------------------------------------------------------------
interface DeviceSelectorProps {
  value: string
  onChange: (v: string) => void
  disabled: boolean
  gpuStatus: GpuStatus | null
  onNavigateToSetup: () => void
}

function DeviceSelector({ value, onChange, disabled, gpuStatus, onNavigateToSetup }: DeviceSelectorProps) {
  const platform = gpuStatus?.platform ?? 'win32'

  const options = [
    {
      value: 'auto',
      label: 'Auto',
      sub: 'CUDA → DirectML → CPU',
      available: true,
      installable: false,
      platformOk: true,
    },
    {
      value: 'cpu',
      label: 'CPU',
      sub: 'Always works, slowest',
      available: true,
      installable: false,
      platformOk: true,
    },
    {
      value: 'cuda',
      label: 'NVIDIA CUDA',
      sub: 'Best performance',
      available: gpuStatus?.cuda ?? false,
      installable: true,  // can install via Setup page
      platformOk: true,
    },
    {
      value: 'directml',
      label: 'AMD / Intel',
      sub: 'DirectML · Windows',
      available: gpuStatus?.directml ?? false,
      installable: true,  // can install via Setup page
      platformOk: platform === 'win32',
    },
    {
      value: 'rocm',
      label: 'AMD ROCm',
      sub: 'Linux only · manual install',
      available: gpuStatus?.rocm ?? false,
      installable: false, // requires manual Linux setup
      platformOk: platform === 'linux',
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-1.5">
      {options.map(opt => {
        const selectable = opt.available && !disabled && opt.platformOk
        const selected = value === opt.value
        const loading = gpuStatus === null && opt.value !== 'auto' && opt.value !== 'cpu'

        return (
          <div
            key={opt.value}
            role="radio"
            aria-checked={selected}
            tabIndex={selectable ? 0 : -1}
            onClick={() => selectable && onChange(opt.value)}
            onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && selectable && onChange(opt.value)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-left transition-all select-none
              ${selected
                ? 'bg-green-900/30 border-green-500/60 shadow-sm shadow-green-900/20'
                : selectable
                ? 'bg-gray-900/50 border-gray-700/50 hover:border-gray-500/70 hover:bg-gray-800/50 cursor-pointer'
                : opt.installable && opt.platformOk
                ? 'bg-gray-900/40 border-gray-700/40'
                : 'bg-gray-900/20 border-gray-800/40 opacity-40'
              }`}
          >
            {/* left: radio dot + labels */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className={`w-3 h-3 rounded-full border-2 flex-shrink-0 transition-colors ${
                selected ? 'border-green-400 bg-green-400' : 'border-gray-600'
              }`} />
              <div className="min-w-0">
                <span className={`text-sm font-medium block ${selected ? 'text-white' : 'text-gray-300'}`}>
                  {opt.label}
                </span>
                <span className="text-xs text-gray-500 block">{opt.sub}</span>
              </div>
            </div>

            {/* right: status / install button */}
            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
              {loading ? (
                <span className="text-xs text-gray-600 font-mono">...</span>
              ) : opt.value === 'auto' || opt.value === 'cpu' ? null
              : !opt.platformOk ? (
                <span className="text-xs text-gray-600">wrong OS</span>
              ) : opt.available ? (
                <span className="text-xs text-green-500 font-medium">installed</span>
              ) : opt.installable ? (
                <button
                  onClick={e => { e.preventDefault(); e.stopPropagation(); onNavigateToSetup() }}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 bg-blue-600/70 hover:bg-blue-500/70 text-white rounded-md transition-colors font-medium"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Install
                </button>
              ) : (
                <span className="text-xs text-gray-600">not installed</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
