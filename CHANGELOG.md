# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-06-01

### New Features

- **Inline GPU Installation** - Removed the separate setup page; GPU (CUDA/DirectML) installation is now handled through in-app modals with a more streamlined flow
- **Compute Device Badge** - Each queue task now displays the actual compute device being used (CUDA, DirectML, ROCm, or CPU)
- **Real-time Elapsed Time** - Each task shows live elapsed time during transcription, which freezes on completion
- **Loading Screen on Startup** - Added a loading screen instead of showing a blank window while the app initializes
- **Overwrite Warning** - Queue items now show a warning when the output file already exists and would be overwritten
- **Better Defaults** - Default language is now set to English and default model to `large`

### Improvements

- **Windows-Only Focus** - Removed ROCm support, macOS/Linux build scripts, and non-Windows platform branches to streamline the Windows-first release
- **720p Layout Optimization** - Compacted spacing and reduced the default window size for better usability on 1280x720 displays
- **Tooltip Improvement** - Replaced custom tooltip on overwrite warning with a native `title` attribute for better compatibility

### Bug Fixes

- Fixed overwrite warning tooltip being clipped by overflow container; it now opens downward
- Fixed white/blank screen on startup by using `show: false` + `ready-to-show` event + `backgroundColor`
- Fixed duplicate file additions when clicking the add-file button multiple times
- Fixed DirectML inference error by densifying sparse model tensors before moving them to the DML device

---

## [1.0.0] - 2026-01-31

Initial release.

- Local audio transcription using Whisper CLI
- Queue-based file processing
- Multiple output formats: SRT, VTT, TXT, JSON, TSV
- Language selection (15+ languages + auto-detect)
- Whisper model selection (tiny to large)
- CUDA GPU acceleration support
- Real-time transcription logs
- Windows support
