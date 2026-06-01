# Transcriber Desktop

A desktop application for local audio transcription using OpenAI's Whisper — bundled Python included, no manual installation required.

## Overview

Transcriber Desktop is an Electron-based application that bundles a portable Python 3.12 environment with `openai-whisper` and `torch` inside the app. No external Whisper or Python installation is needed. All processing happens locally, ensuring privacy and offline capability.

**Windows only.**

## Features

- **Local Audio Transcription** - Process audio files entirely on your machine
- **Bundled Python & Whisper** - No system-level Python or Whisper install needed
- **Queue Management** - Process multiple files in sequence
- **Multiple Output Formats** - SRT, VTT, TXT, JSON, TSV
- **GPU Acceleration** - CUDA and DirectML support, installable directly from within the app
- **Compute Device Badge** - Each task shows which device (CUDA, DirectML, or CPU) is processing it
- **Real-time Progress** - Live elapsed time per task and detailed transcription logs
- **Overwrite Warning** - Visual warning on queue items when output file already exists
- **Fast Startup** - Loading screen on launch instead of a blank window
- **Privacy-First** - All processing is local, nothing leaves your machine

## Requirements

- **Node.js** v18 or higher
- **pnpm**
- **Windows** (x64) or **WSL2**

No external Python or Whisper installation required — the build script downloads and bundles everything automatically.

## Available Commands

```bash
# Install dependencies
pnpm install

# Development mode (with hot reload)
pnpm dev
```

### Building

> **Important:** Before building for the first time (or after a clean checkout), you must run the fresh build command. It downloads a portable Python 3.12, installs `openai-whisper` and `torch` (~200 MB) into `resources/python/`, and then produces the installer.

```bash
# First-time build (or force-rebuild Python env) — required at least once
pnpm build:win64:fresh

# Subsequent builds — skips Python setup if resources/python/ already exists
pnpm build:win64
```

#### Setup scripts (optional, run separately)

```bash
# Set up the bundled Python environment without building
pnpm setup:python

# Force-recreate the Python environment from scratch
pnpm setup:python:force
```

The setup script:
1. Downloads Python 3.12 embeddable (Windows x64)
2. Bootstraps `pip`
3. Installs `openai-whisper` (includes `torch` CPU baseline)
4. Outputs everything to `resources/python/` — bundled into the app at build time

## Tech Stack

- **Electron** - Desktop framework
- **Next.js** - React framework for UI
- **TailwindCSS** - Styling
- **TypeScript** - Type safety
- **openai-whisper** - Audio transcription engine (bundled)
- **Python 3.12** (portable/embeddable, bundled)

## Contact & Support

**Author:** Andranik Arakelyan
- Email: andranik.arakelyan.work@gmail.com
- GitHub: [@andranikarakelyan](https://github.com/andranikarakelyan)

For issues, bugs, or feature requests, please contact via email or [create an issue on GitHub](https://github.com/andranikarakelyan/transcriber/issues).
