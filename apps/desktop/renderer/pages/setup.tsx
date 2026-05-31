import React, { useEffect, useRef, useState } from 'react'
import Head from 'next/head'

interface DepStatus {
  python: string | null
  whisper: string | null
  torchDirectml: string | null
  torchCuda: string | null
  isBundled: boolean
}

type InstallTarget = 'directml' | 'cuda'
type InstallState = 'idle' | 'running' | 'done' | 'error'

export default function SetupPage() {
  const [deps, setDeps]         = useState<DepStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState<InstallTarget | null>(null)
  const [installState, setInstallState] = useState<InstallState>('idle')
  const [logs, setLogs]         = useState<string[]>([])
  const [error, setError]       = useState<string | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  const ipc = () => (window as any).ipc

  useEffect(() => {
    checkDeps()

    const off1 = ipc()?.on('dep-status', (status: DepStatus) => {
      setDeps(status)
      setChecking(false)
    })
    const off2 = ipc()?.on('install-log', (line: string) => {
      setLogs(prev => [...prev, line])
    })
    const off3 = ipc()?.on('install-complete', (_target: InstallTarget) => {
      setInstallState('done')
      setInstalling(null)
      setLogs(prev => [...prev, '✓ Done!'])
      // Re-check deps so the new GPU row shows up as installed
      setTimeout(checkDeps, 400)
    })
    const off4 = ipc()?.on('install-error', (msg: string) => {
      setInstallState('error')
      setInstalling(null)
      setError(msg)
      setLogs(prev => [...prev, `✗ ${msg}`])
    })

    return () => { off1?.(); off2?.(); off3?.(); off4?.() }
  }, [])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const checkDeps = () => {
    setChecking(true)
    ipc()?.send('check-dependencies')
  }

  const startInstall = (target: InstallTarget) => {
    setInstalling(target)
    setInstallState('running')
    setLogs([])
    setError(null)
    ipc()?.send('start-install', { target })
  }

  const goToApp  = () => ipc()?.send('navigate-to', 'home')
  const openUrl  = (url: string) => ipc()?.send('open-external', url)

  const coreReady = true  // always bundled

  return (
    <React.Fragment>
      <Head><title>Transcriber — Setup</title></Head>
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white flex items-center justify-center p-6">
        <div className="w-full max-w-xl">

          {/* ── Header ── */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-600/30 to-purple-600/30 border border-blue-500/30 mb-4 shadow-2xl shadow-blue-900/30">
              <svg className="w-10 h-10 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent mb-2">
              Transcriber Setup
            </h1>
            <p className="text-gray-400 text-sm">Python and Whisper are bundled. GPU acceleration is optional.</p>
          </div>

          <div className="bg-gray-800/50 backdrop-blur rounded-2xl border border-gray-700/50 shadow-2xl p-6 space-y-5">

            {/* ── Core (always bundled) ── */}
            <div className="flex items-center gap-3 p-3 bg-green-900/20 rounded-lg border border-green-700/30">
              <div className="w-5 h-5 rounded-full bg-green-500/20 border border-green-500/50 flex items-center justify-center flex-shrink-0">
                <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-green-300 font-medium">Python + Whisper — bundled</p>
                <p className="text-xs text-green-600 mt-0.5">All core dependencies are included in the installer</p>
              </div>
              <span className="text-xs px-1.5 py-0.5 bg-blue-900/40 border border-blue-700/40 text-blue-400 rounded-md flex-shrink-0">bundled</span>
            </div>

            {/* ── GPU Acceleration ── */}
            <div className="border-t border-gray-700/50 pt-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  GPU Acceleration <span className="normal-case font-normal text-gray-500">(optional)</span>
                </h2>
                {!checking && !installing && (
                  <button
                    onClick={checkDeps}
                    className="text-xs px-2.5 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 transition-colors"
                  >
                    Recheck
                  </button>
                )}
              </div>
              <div className="space-y-2">

                <GpuRow
                  label="AMD / Intel DirectML"
                  sub="Windows GPU acceleration (~400 MB)"
                  version={deps?.torchDirectml ?? null}
                  checking={checking}
                  installing={installing === 'directml'}
                  installDone={installState === 'done' && !installing}
                  onInstall={() => startInstall('directml')}
                  disabled={installing !== null}
                />

                <GpuRow
                  label="NVIDIA CUDA"
                  sub="Best performance on NVIDIA GPUs (~2.5 GB)"
                  version={deps?.torchCuda ?? null}
                  checking={checking}
                  installing={installing === 'cuda'}
                  installDone={installState === 'done' && !installing}
                  onInstall={() => startInstall('cuda')}
                  disabled={installing !== null}
                />

                {/* ROCm — Linux only, manual */}
                <div className="flex items-start justify-between p-3 bg-gray-900/50 rounded-lg border border-gray-700/30 gap-3">
                  <div className="flex items-start gap-2 min-w-0">
                    <div className="w-4 h-4 rounded-full bg-gray-600/30 border border-gray-600/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-2.5 h-2.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-gray-300">AMD ROCm</p>
                      <p className="text-xs text-gray-500 mt-0.5">Linux GPU acceleration — manual install required</p>
                    </div>
                  </div>
                  <a
                    href="#"
                    onClick={e => { e.preventDefault(); openUrl('https://pytorch.org/get-started/locally/') }}
                    className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex-shrink-0 mt-0.5"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    PyTorch guide
                  </a>
                </div>

              </div>
            </div>

            {/* ── Install log ── */}
            {logs.length > 0 && (
              <div className="border-t border-gray-700/50 pt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Install Log</p>
                <div className="bg-gray-950/80 rounded-xl border border-gray-700/50 p-3 max-h-52 overflow-y-auto font-mono text-xs space-y-0.5">
                  {logs.map((line, i) => (
                    <div key={i} className={
                      line.startsWith('✓') ? 'text-green-400' :
                      line.startsWith('✗') ? 'text-red-400' :
                      line.startsWith('⚠') ? 'text-amber-400' :
                      line.startsWith('---') ? 'text-blue-400 font-semibold mt-1' :
                      line.startsWith('>') ? 'text-gray-500' :
                      'text-gray-400'
                    }>{line}</div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </div>
            )}

            {/* ── Error banner ── */}
            {installState === 'error' && error && (
              <div className="border border-red-500/30 bg-red-900/20 rounded-xl p-3 text-sm text-red-300">
                {error}
              </div>
            )}

            {/* ── Bottom actions ── */}
            <div className="border-t border-gray-700/50 pt-4">
              {installing && (
                <div className="flex items-center justify-center gap-2 text-gray-300 py-2 mb-3">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400" />
                  <span className="text-sm">Installing… do not close the app</span>
                </div>
              )}
              <button
                onClick={goToApp}
                disabled={!coreReady || !!installing}
                className="w-full py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-lg shadow-green-900/30 flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                {coreReady ? 'Start Transcribing' : 'Bundled Python not found — rebuild app'}
              </button>
            </div>

          </div>

          <p className="text-center text-xs text-gray-600 mt-4">
            GPU packages are downloaded and installed into the app's own Python environment
          </p>
        </div>
      </div>
    </React.Fragment>
  )
}

// ── GpuRow ───────────────────────────────────────────────────────────────────
function GpuRow({ label, sub, version, checking, installing, installDone, onInstall, disabled }: {
  label: string
  sub: string
  version: string | null
  checking: boolean
  installing: boolean
  installDone: boolean
  onInstall: () => void
  disabled: boolean
}) {
  const installed = version != null

  return (
    <div className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg border border-gray-700/30 gap-3">
      <div className="flex items-start gap-2 min-w-0">
        {checking || installing ? (
          <div className="w-4 h-4 rounded-full border-2 border-gray-600 border-t-blue-400 animate-spin flex-shrink-0 mt-0.5" />
        ) : installed ? (
          <div className="w-4 h-4 rounded-full bg-green-500/20 border border-green-500/50 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-2.5 h-2.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        ) : (
          <div className="w-4 h-4 rounded-full bg-gray-600/30 border border-gray-600/50 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-2.5 h-2.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm text-gray-300">{label}</p>
          <p className="text-xs text-gray-500 mt-0.5">{installing ? 'Downloading and installing…' : sub}</p>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
        {installed ? (
          <span className="text-xs font-mono text-green-400">{version}</span>
        ) : installing ? (
          <span className="text-xs text-blue-400 animate-pulse">installing…</span>
        ) : (
          <button
            onClick={onInstall}
            disabled={disabled}
            className="text-xs px-3 py-1.5 bg-blue-600/80 hover:bg-blue-500/80 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium flex items-center gap-1.5"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Enable
          </button>
        )}
      </div>
    </div>
  )
}
