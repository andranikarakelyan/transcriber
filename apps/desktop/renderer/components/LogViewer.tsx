import React, { useEffect, useRef, useState } from 'react'

interface LogEntry {
  timestamp: string
  level: 'info' | 'error' | 'warn' | 'debug'
  message: string
}

export default function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Listen for logs from the main process
    const unsubscribe = (window as any).ipc?.on('log', (log: LogEntry) => {
      setLogs((prevLogs) => [...prevLogs, log])
    })

    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
    }
  }, [])

  useEffect(() => {
    // Auto-scroll to bottom when new logs arrive
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => {
    // Scroll to bottom when expanding
    if (isExpanded) {
      setTimeout(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, 100)
    }
  }, [isExpanded])

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error':
        return 'text-red-400'
      case 'warn':
        return 'text-yellow-400'
      case 'info':
        return 'text-blue-400'
      case 'debug':
        return 'text-gray-400'
      default:
        return 'text-gray-300'
    }
  }

  const getLevelBg = (level: string) => {
    switch (level) {
      case 'error':
        return 'bg-red-500/10'
      case 'warn':
        return 'bg-yellow-500/10'
      case 'info':
        return 'bg-blue-500/10'
      case 'debug':
        return 'bg-gray-500/10'
      default:
        return 'bg-gray-500/10'
    }
  }

  const clearLogs = () => {
    setLogs([])
  }

  const copyLogs = async () => {
    const logsText = logs
      .map(log => `${log.timestamp} [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n')
    
    try {
      await navigator.clipboard.writeText(logsText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy logs:', err)
    }
  }

  return (
    <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700 p-5 flex flex-col">
      <div className="flex justify-between items-center mb-3">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            System Logs
            {logs.length > 0 && (
              <span className="ml-1 px-2 py-0.5 bg-purple-600/50 text-white text-xs font-bold rounded-full">
                {logs.length}
              </span>
            )}
          </h3>
          <svg 
            className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {isExpanded && (
          <div className="flex gap-2">
            <button
              onClick={copyLogs}
              disabled={logs.length === 0}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                copied 
                  ? 'bg-green-600 text-white' 
                  : 'bg-blue-600/80 hover:bg-blue-600 text-white disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed'
              }`}
            >
              {copied ? (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy
                </>
              )}
            </button>
            <button
              onClick={clearLogs}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 text-xs font-medium transition-colors"
            >
              Clear
            </button>
          </div>
        )}
      </div>
      {isExpanded && (
        <div className="h-[400px] min-h-0 overflow-y-auto bg-gray-900/70 rounded-lg p-4 border border-gray-700 animate-in slide-in-from-top-2 duration-200">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <svg className="w-12 h-12 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm">No logs yet</p>
          </div>
        ) : (
          <div className="space-y-1 font-mono text-xs">
            {logs.map((log, index) => (
              <div 
                key={index} 
                className={`flex gap-2 p-2 rounded ${getLevelBg(log.level)} hover:bg-opacity-20 transition-colors`}
              >
                <span className="text-gray-500 flex-shrink-0">{log.timestamp}</span>
                <span className={`font-bold flex-shrink-0 ${getLevelColor(log.level)}`}>
                  [{log.level.toUpperCase()}]
                </span>
                <span className="text-gray-200 flex-1 break-words">{log.message}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
        </div>
      )}
    </div>
  )
}
