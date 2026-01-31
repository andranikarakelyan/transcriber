# Transcriber Desktop

A desktop application for local audio transcription using OpenAI's Whisper CLI.

## Overview

Transcriber Desktop is an Electron-based application that leverages Whisper CLI for transcribing audio files. All processing happens locally, ensuring privacy and offline capability.

## Features

- **Local File Selection** - Choose audio files from your file system
- **Whisper CLI Integration** - Uses Whisper CLI installed on your system
- **Automatic Whisper Detection** - Checks installation and provides setup instructions
- **Queue Management** - Process multiple files in sequence
- **Multiple Output Formats** - SRT, VTT, TXT, JSON, TSV
- **Real-time Logs** - Monitor transcription progress
- **CUDA GPU Support** - Optional GPU acceleration
- **Privacy-First** - All processing is local

## Requirements

- **Node.js**: v18 or higher
- **Whisper CLI**: Must be installed on your system
  - Installation: https://github.com/openai/whisper#setup

## Available Commands

```bash
# Install dependencies
npm install

# Development mode (with hot reload)
npm run dev

# Build for Windows (x64) - Tested ✓
npm run build:win64

# Build for macOS - ⚠️ Not tested yet
npm run build:mac

# Build for Linux - ⚠️ Not tested yet
npm run build:linux
```

## Tech Stack

- Electron - Desktop framework
- Next.js - React framework for UI
- TailwindCSS - Styling
- TypeScript - Type safety
- Whisper CLI - Audio transcription engine

## Contact & Support

**Author:** Andranik Arakelyan
- Email: andranik.arakelyan.work@gmail.com
- GitHub: [@andranikarakelyan](https://github.com/andranikarakelyan)

For issues, bugs, or feature requests, please contact via email or create an issue on GitHub.
