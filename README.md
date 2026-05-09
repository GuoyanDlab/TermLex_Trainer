# TermLex Trainer

[![English](https://img.shields.io/badge/README-English-blue)](./README.md)
[![简体中文](https://img.shields.io/badge/README-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-red)](./README.zh-CN.md)

A terminal-first English learning trainer (TUI) focused on character-by-character spelling practice, spaced repetition scheduling, and contextual listening. It also includes a high-frequency chunk listening mode powered by YouGlish.

Built with TypeScript + Node.js + neo-blessed. This is not a web app and does not use React/Ink.

## Quick Start (30 Seconds)

```bash
git clone https://github.com/GuoyanDlab/TermLex_Trainer.git
cd TermLex_Trainer
corepack enable
pnpm install
cp .env.example .env
pnpm run dev
```

First interaction flow:

- In the left dataset panel, use `j/k` (or `↑/↓`) to pick a dataset, then press `Enter`.
- Press `Tab` to move focus to the training panel.
- Press `Ctrl+Y` to open Word YouGlish, or `Ctrl+O` to open Chunk Radio.
- Press `q` to quit.

## Product Goal

- High-frequency training for English words and chunks in terminal.
- Two-column workflow: dataset selection on the left, task practice on the right.
- Memory-stage and due-time scheduling instead of naive linear drilling.
- Built-in word pronunciation, sentence playback, and YouGlish audio context.

## Feature Overview

- Dataset management
- Automatically loads `json/*.json`
- Supports `/` search, `j/k` or `↑/↓` navigation, and `Enter` to switch dataset

- Training tasks (MVP)
- `copy_typing`
- `meaning_to_word`
- `word_to_meaning` + self-rating (`again/hard/good`)

- Memory system
- Stages: `new / encoding / learning / reviewing / mature / leech`
- Local progress file: `data/progress.json`
- Due priority: learning/encoding/leech -> reviewing -> new -> mature

- Audio
- Word pronunciation: Youdao API + local cache (`data/audio/`)
- Sentence TTS: ElevenLabs (supports voice cycling)

- YouGlish Word mode
- Uses current word as query
- Shows phrase, clip progress, and translation

- YouGlish Chunk Radio mode
- Queries come from `chunks/chunks.json`
- Auto-plays clips and auto-switches to next chunk after target clips
- If a chunk has fewer than 20 clips, it switches right after the last clip
- Loops back to chunk 1 after the last chunk
- Supports manual previous/next/jump
- Saves position on exit and resumes next time

- Real-time YouGlish playback controls
- Adjust playback speed while listening
- Adjust auto-switch delay between clips
- Shows current speed and delay values in overlay panel

## Core Design Principles

### 1) Dictionary normalization (reliable input)

After loading `json/*.json`, data is normalized:

- Missing `name` entries are skipped
- Non-array `trans` / `e_mean` are converted to empty arrays
- Missing `usphone` / `ukphone` / `speech` become empty strings
- Deduplicates by `name` (case-insensitive) within the same dictionary
- `sentence` is read from either `sentence` or `sentences[]` (compat mode)

Code:

- `src/dict/loader.ts`
- `src/dict/normalize.ts`

### 2) Task state machine (task-driven learning)

Task type and repeat target are generated from stage:

- `new` -> `copy_typing`
- `encoding/learning/reviewing/leech` -> `meaning_to_word`
- `mature` -> `word_to_meaning`

Each round is checked character-by-character. Wrong rounds do not count toward repeat; only clean rounds do.

Code:

- `src/session/task.ts`
- `src/session/typing-engine.ts`
- `src/session/session.ts`

### 3) Progress updates (sustainable review)

Rating keys `a/s/d` update:

- `stage`
- `spellingLevel` / `meaningLevel`
- `wrongCount` / `consecutiveCorrect`
- `nextSpellingAt` / `nextMeaningAt`

All updates persist to `data/progress.json`.

Code:

- `src/progress/progress-store.ts`
- `src/session/session.ts`

### 4) Due scheduling (practice what matters now)

Word selection prioritizes due and more important stages before everything else.

Code:

- `src/progress/scheduler.ts`

### 5) Audio architecture (cache + fallback)

- Word audio: download MP3 from Youdao and cache locally
- Sentence audio: generate with ElevenLabs and cache (with multi-voice rotation)
- On macOS, `afplay` is preferred; `say` can be used as fallback

Code:

- `src/audio/voice-player.ts`

### 6) YouGlish bridge (browser bridge layer)

- Uses Playwright persistent browser context
- Injects YouGlish widget and reads snapshots (clip/phrase/state)
- Includes timeout retry and manual bridge restart recovery

Code:

- `src/youglish/bridge.ts`
- `src/app.ts`

### 7) Chunk Radio (continuous chunk listening)

- Loads `chunks/chunks.json` (string array)
- Auto-switching is clip-progress based (not caption-count based)
- Saves chunk cursor to `data/chunks-progress.json` on exit

Code:

- `src/chunks/loader.ts`
- `src/chunks/progress-store.ts`
- `src/app.ts`

## Requirements

- Node.js 18+ (Node.js 20+ recommended)
- `pnpm`
- macOS recommended (current audio path is optimized for macOS)
- Local Chrome/Chromium/Edge (for YouGlish bridge)

## Installation

```bash
git clone https://github.com/GuoyanDlab/TermLex_Trainer.git
cd TermLex_Trainer
corepack enable
pnpm install
cp .env.example .env
```

Then edit `.env` as needed. At minimum, set `ELEVENLABS_API_KEY` for high-quality sentence TTS.

## Run and Build

Development mode:

```bash
pnpm run dev
```

Build and run:

```bash
pnpm run build
pnpm start
```

Sentence helper:

```bash
pnpm run sentence:add -- <dictId> <word>
```

## Environment Variables

See `.env.example`. Common options:

- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_IDS`
- `ELEVENLABS_VOICE_NAMES`
- `ELEVENLABS_MODEL_ID`
- `YOUGLISH_BROWSER_CHANNEL`
- `YOUGLISH_BROWSER_PATH`
- `YOUGLISH_HEADLESS`
- `YOUGLISH_AUTO_NEXT`
- `YOUGLISH_AUTO_NEXT_GAP_MS`
- `YOUGLISH_DEFAULT_SPEED`

## Keybindings

### Global

- `Tab`: switch focus between dataset and task panel
- `/`: dataset search
- `Enter`: load selected dataset
- `q`: quit (outside input flow)
- `Shift+Q` or `Ctrl+C`: force quit
- `Ctrl+E`: query and write sentence for current word

### Training Modes

- Submit typing/meaning input: `Enter`
- Replay current word: `Shift+P`
- Toggle mute: `Shift+M`
- Switch US/UK accent: `Shift+U`
- Reload dictionary: `Shift+R`

### Rating Mode

- `a`: again
- `s`: hard
- `d`: good
- `e`: ElevenLabs sentence playback (voice cycling)
- `f`: default sentence playback
- `t`: translate sentence

### YouGlish Word Mode

- Open: `Ctrl+Y`
- Close: `Esc` / `Ctrl+Y`
- Play/pause: `Space`
- Previous/next clip: `[` / `]`
- Slower/faster playback: `-` / `=` (real-time)
- Increase/decrease auto-switch delay: `,` / `.` (real-time)
- Translate phrase: `t`
- Reload current word query: `r`
- Restart bridge: `x`

### YouGlish Chunk Radio Mode

- Open: `Ctrl+O`
- Close: `Esc` / `Ctrl+O`
- Play/pause: `Space`
- Next/previous chunk: `n` / `b`
- Jump to chunk N: `j` (input number, then `Enter`)
- Previous/next clip: `[` / `]`
- Slower/faster playback: `-` / `=` (real-time)
- Increase/decrease auto-switch delay: `,` / `.` (real-time)
- Translate phrase: `t`
- Reload current chunk query: `r`
- Restart bridge: `x`

## Real-time Playback Controls (YouGlish)

These controls work in both YouGlish Word mode and Chunk Radio mode:

- `-`: decrease speed
- `=` (or `+`): increase speed
- `,`: increase auto-switch delay (switch later)
- `.`: decrease auto-switch delay (switch sooner)

Current values are displayed in the YouGlish overlay:

- `Speed`: current playback rate (e.g. `0.92x`)
- `Switch Delay`: current clip auto-switch delay in milliseconds (e.g. `900ms`)

Default behavior:

- Default speed: `0.92x`
- Default switch delay: `900ms`

You can also set defaults through environment variables:

- `YOUGLISH_DEFAULT_SPEED`
- `YOUGLISH_AUTO_NEXT_GAP_MS`

## Data Files

- Dictionaries: `json/*.json`
- Chunks: `chunks/chunks.json`
- Word progress: `data/progress.json`
- Chunk radio progress: `data/chunks-progress.json`
- Audio cache: `data/audio/`
- YouGlish browser profile: `data/youglish/profile/`

## FAQ

### 1) YouGlish shows `ready-timeout-giveup`

This is usually not a network outage. Most often the local browser profile/widget state is stuck.

Recommended order:

1. Press `x` in YouGlish panel to restart bridge.
2. If still broken, delete `data/youglish/profile/` once and restart app.

### 2) Why does deleting profile fix it?

`profile` is a persistent browser directory with cookies/localStorage/service workers. If those states are corrupted, player-ready can fail. Deleting it recreates a clean profile.

You do not need to delete it often. Only do this when bridge restart (`x`) cannot recover.

### 3) No audio on non-macOS

Current MVP audio backend is optimized for macOS. Core training logic and YouGlish text/control still work on other platforms.

## Directory Structure

```text
src/
  main.ts
  app.ts
  types.ts
  env/
  dict/
  progress/
  session/
  audio/
  youglish/
  chunks/
  ui/
  tools/
chunks/
  chunks.json
json/
  *.json
data/
  progress.json
  chunks-progress.json
  audio/
  youglish/
```

## Current MVP Scope

Implemented:

- Left dataset list with search/switch
- Right-side training tasks (`copy_typing / meaning_to_word / word_to_meaning + rating`)
- Character-level validation + repeat mechanism
- Local progress persistence
- Youdao word pronunciation + ElevenLabs sentence TTS
- YouGlish Word mode
- YouGlish Chunk Radio mode

Planned extensions:

- `choice / dictation / exam` tasks
- Better cross-platform audio backend
- Smarter YouGlish profile self-healing
