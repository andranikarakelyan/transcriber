import React from 'react'
import Head from 'next/head'

export default function LoadingPage() {
  return (
    <>
      <Head>
        <title>Transcriber</title>
      </Head>
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-8">

          {/* Spinner + icon */}
          <div className="relative w-28 h-28">
            {/* Outer spinning ring */}
            <div className="absolute inset-0 rounded-full border-4 border-gray-700/60 border-t-blue-500 border-r-cyan-400 animate-spin" />
            {/* Inner icon container */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600/30 to-cyan-600/20 border border-blue-500/30 flex items-center justify-center shadow-lg shadow-blue-900/40">
                {/* Microphone icon */}
                <svg
                  className="w-8 h-8 text-blue-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.8}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 1a4 4 0 014 4v6a4 4 0 01-8 0V5a4 4 0 014-4z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 10a7 7 0 01-14 0M12 19v4M8 23h8"
                  />
                </svg>
              </div>
            </div>
          </div>

          {/* Text */}
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-300 to-cyan-300 bg-clip-text text-transparent tracking-wide">
              Transcriber
            </h1>
            <p className="text-sm text-gray-500 animate-pulse">Starting up...</p>
          </div>

        </div>
      </div>
    </>
  )
}
