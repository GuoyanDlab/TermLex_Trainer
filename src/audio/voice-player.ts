import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

type Accent = 'us' | 'uk';
export interface PlayResult {
  ok: boolean;
  reason?: string;
}

interface ElevenLabsVoiceOption {
  id: string;
  name: string;
}

interface ElevenLabsVoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}

const DEFAULT_ELEVENLABS_VOICES: ElevenLabsVoiceOption[] = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily' },
];

const DEFAULT_ELEVENLABS_SETTINGS: ElevenLabsVoiceSettings = {
  stability: 0.32,
  similarity_boost: 0.88,
  style: 0.45,
  use_speaker_boost: true,
};

function execFileAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function safeAudioFileName(word: string, type: number): string {
  const base = word.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'word';
  return `${base}_${type}.mp3`;
}

function safeCachePart(input: string): string {
  const normalized = input.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || 'default';
}

function sentenceHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 16);
}

function safePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? '');
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function clamp01(raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? '');
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  const value = (raw || '').trim().toLowerCase();
  if (!value) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return fallback;
}

export class VoicePlayer {
  private muted = false;
  private accent: Accent = 'us';
  private lastNotice = '';
  private currentPlayPid: number | null = null;
  private elevenLabsSentenceVoiceCursor = 0;

  constructor(private readonly audioDir: string) {}

  async init(): Promise<void> {
    await fs.mkdir(this.audioDir, { recursive: true });
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  toggleAccent(): Accent {
    this.accent = this.accent === 'us' ? 'uk' : 'us';
    return this.accent;
  }

  isMuted(): boolean {
    return this.muted;
  }

  getAccent(): Accent {
    return this.accent;
  }

  getLastNotice(): string {
    return this.lastNotice;
  }

  private playWithSay(word: string): PlayResult {
    try {
      const child = spawn('say', [word], { stdio: 'ignore' });
      child.on('error', (error) => {
        this.lastNotice = `say fallback failed: ${error.message}`;
      });
      child.unref();
      return { ok: true, reason: 'fallback-say' };
    } catch (error) {
      this.lastNotice = `say fallback failed: ${(error as Error).message}`;
      return { ok: false, reason: this.lastNotice };
    }
  }

  private async spawnAndConfirm(command: string, args: string[]): Promise<PlayResult> {
    try {
      const child = spawn(command, args, { stdio: 'ignore' });
      return await new Promise<PlayResult>((resolve) => {
        let settled = false;
        const settle = (result: PlayResult): void => {
          if (settled) return;
          settled = true;
          resolve(result);
        };

        child.once('error', (error) => {
          this.lastNotice = `${command} failed: ${error.message}`;
          settle({ ok: false, reason: this.lastNotice });
        });

        child.once('exit', (code, signal) => {
          if (settled) return;
          if (code === 0 || signal === 'SIGTERM') {
            // A very short audio may exit quickly with code 0; still treat as success.
            settle({ ok: true });
            return;
          }
          this.lastNotice = `${command} exited unexpectedly (code=${code}, signal=${signal ?? 'none'})`;
          settle({ ok: false, reason: this.lastNotice });
        });

        setTimeout(() => {
          settle({ ok: true });
        }, 250).unref();

        child.unref();
      });
    } catch (error) {
      this.lastNotice = `${command} failed: ${(error as Error).message}`;
      return { ok: false, reason: this.lastNotice };
    }
  }

  clearNotice(): void {
    this.lastNotice = '';
  }

  async playWord(rawWord: string): Promise<PlayResult> {
    const word = rawWord.trim();
    if (!word) {
      return { ok: false, reason: 'empty-word' };
    }
    if (this.muted) {
      this.lastNotice = 'Audio is muted';
      return { ok: false, reason: 'muted' };
    }

    this.lastNotice = '';
    const type = this.accent === 'uk' ? 1 : 2;
    const cachePath = path.join(this.audioDir, safeAudioFileName(word, type));
    try {
      await fs.access(cachePath);
    } catch {
      const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`;
      try {
        await execFileAsync('curl', ['-L', '-sS', url, '-o', cachePath]);
      } catch (error) {
        if (process.platform === 'darwin') {
          this.lastNotice = 'Youdao unreachable, fallback to macOS say';
          return this.playWithSay(word);
        }
        this.lastNotice = `Voice download failed: ${(error as Error).message}`;
        return { ok: false, reason: this.lastNotice };
      }
    }

    if (process.platform !== 'darwin') {
      this.lastNotice = 'Audio playback TODO: non-macOS fallback is not implemented yet';
      return { ok: false, reason: this.lastNotice };
    }

    const result = await this.spawnAndConfirm('afplay', [cachePath]);
    if (!result.ok) {
      return result;
    }
    return { ok: true };
  }

  private resolveElevenLabsVoices(): ElevenLabsVoiceOption[] {
    const rawIds = (process.env.ELEVENLABS_VOICE_IDS || '').trim();
    const rawNames = (process.env.ELEVENLABS_VOICE_NAMES || '').trim();

    if (rawIds) {
      const ids = rawIds
        .split(/[,\n;]/)
        .map((item) => item.trim())
        .filter(Boolean);
      const names = rawNames
        .split(/[,\n;]/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (ids.length > 0) {
        return ids.map((id, index) => ({
          id,
          name: names[index] || `Voice ${index + 1}`,
        }));
      }
    }

    const singleVoiceId = (process.env.ELEVENLABS_VOICE_ID || '').trim();
    if (singleVoiceId) {
      const singleVoiceName = (process.env.ELEVENLABS_VOICE_NAME || '').trim();
      return [{ id: singleVoiceId, name: singleVoiceName || 'Default' }];
    }

    return DEFAULT_ELEVENLABS_VOICES;
  }

  private pickNextElevenLabsVoice(): ElevenLabsVoiceOption {
    const voices = this.resolveElevenLabsVoices();
    if (voices.length === 0) {
      return DEFAULT_ELEVENLABS_VOICES[0];
    }
    const index = this.elevenLabsSentenceVoiceCursor % voices.length;
    const voice = voices[index];
    this.elevenLabsSentenceVoiceCursor = (index + 1) % voices.length;
    return voice;
  }

  private resolveElevenLabsVoiceSettings(): ElevenLabsVoiceSettings {
    return {
      stability: clamp01(process.env.ELEVENLABS_VOICE_STABILITY, DEFAULT_ELEVENLABS_SETTINGS.stability),
      similarity_boost: clamp01(
        process.env.ELEVENLABS_VOICE_SIMILARITY_BOOST,
        DEFAULT_ELEVENLABS_SETTINGS.similarity_boost,
      ),
      style: clamp01(process.env.ELEVENLABS_VOICE_STYLE, DEFAULT_ELEVENLABS_SETTINGS.style),
      use_speaker_boost: parseBoolean(
        process.env.ELEVENLABS_USE_SPEAKER_BOOST,
        DEFAULT_ELEVENLABS_SETTINGS.use_speaker_boost,
      ),
    };
  }

  private async synthesizeSentenceWithElevenLabs(
    sentence: string,
    voice: ElevenLabsVoiceOption,
  ): Promise<string> {
    const apiKey = (process.env.ELEVENLABS_API_KEY || '').trim();
    if (!apiKey) {
      this.lastNotice = 'Missing ELEVENLABS_API_KEY, fallback to macOS say';
      return '';
    }

    const modelId = (process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5').trim();
    const outputFormat = (process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128').trim();
    const voiceSettings = this.resolveElevenLabsVoiceSettings();
    const maxLenValue = Number(process.env.ELEVENLABS_MAX_LEN || '280');
    const maxLen = Number.isFinite(maxLenValue) && maxLenValue > 0 ? maxLenValue : 280;
    const normalizedSentence = sentence.length > maxLen ? sentence.slice(0, maxLen) : sentence;
    const voiceSettingsKey = [
      voiceSettings.stability,
      voiceSettings.similarity_boost,
      voiceSettings.style,
      voiceSettings.use_speaker_boost ? '1' : '0',
    ].join('|');
    const cacheId = sentenceHash(
      `${voice.id}|${modelId}|${outputFormat}|${voiceSettingsKey}|${normalizedSentence}`,
    );
    const cachePath = path.join(
      this.audioDir,
      `sentence_elevenlabs_${safeCachePart(voice.id)}_${cacheId}.mp3`,
    );

    try {
      await fs.access(cachePath);
      return cachePath;
    } catch {
      // continue to synthesize
    }

    const url =
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.id)}` +
      `?output_format=${encodeURIComponent(outputFormat)}`;
    const body = JSON.stringify({
      text: normalizedSentence,
      model_id: modelId,
      voice_settings: voiceSettings,
    });

    try {
      await execFileAsync('curl', [
        '-L',
        '-sS',
        '--fail',
        '--connect-timeout',
        String(safePositiveInt(process.env.ELEVENLABS_CONNECT_TIMEOUT_SEC, 2)),
        '--max-time',
        String(safePositiveInt(process.env.ELEVENLABS_MAX_TIME_SEC, 20)),
        '-X',
        'POST',
        '-H',
        `xi-api-key: ${apiKey}`,
        '-H',
        'Content-Type: application/json',
        '-d',
        body,
        url,
        '-o',
        cachePath,
      ]);
      return cachePath;
    } catch {
      this.lastNotice = 'ElevenLabs TTS unavailable, fallback to macOS say';
      return '';
    }
  }

  private async playSentenceWithSay(sentence: string): Promise<PlayResult> {
    const preferredVoice = (process.env.MACOS_TTS_VOICE || 'Samantha').trim();
    const rate = safePositiveInt(process.env.MACOS_TTS_RATE, 190);
    const baseArgs = ['-r', String(rate)];

    if (preferredVoice) {
      const preferred = await this.spawnAndConfirm('say', ['-v', preferredVoice, ...baseArgs, sentence]);
      if (preferred.ok) {
        return { ok: true, reason: 'macos-say' };
      }
    }

    const fallback = await this.spawnAndConfirm('say', [...baseArgs, sentence]);
    if (fallback.ok) {
      this.lastNotice = preferredVoice
        ? `Voice "${preferredVoice}" unavailable, using default macOS voice`
        : '';
      return { ok: true, reason: 'macos-say-default' };
    }
    return fallback;
  }

  async playSentenceElevenLabs(rawSentence: string): Promise<PlayResult> {
    const sentence = rawSentence.trim();
    if (!sentence) {
      this.lastNotice = 'No sentence available';
      return { ok: false, reason: 'empty-sentence' };
    }
    if (this.muted) {
      this.lastNotice = 'Audio is muted';
      return { ok: false, reason: 'muted' };
    }

    this.lastNotice = '';

    if (process.platform !== 'darwin') {
      this.lastNotice = 'Sentence playback TODO: non-macOS fallback is not implemented yet';
      return { ok: false, reason: this.lastNotice };
    }

    const voice = this.pickNextElevenLabsVoice();
    const elevenlabsAudioPath = await this.synthesizeSentenceWithElevenLabs(sentence, voice);
    if (elevenlabsAudioPath) {
      const result = await this.spawnAndConfirm('afplay', [elevenlabsAudioPath]);
      if (result.ok) {
        this.lastNotice = `Sentence played (ElevenLabs: ${voice.name})`;
        return { ok: true, reason: 'elevenlabs-tts' };
      }
    }

    if (!this.lastNotice) {
      this.lastNotice = 'ElevenLabs TTS unavailable, fallback to macOS say';
    }
    return this.playSentenceWithSay(sentence);
  }

  async playSentence(rawSentence: string): Promise<PlayResult> {
    const provider = (process.env.SENTENCE_TTS_PROVIDER || 'say').trim().toLowerCase();
    if (provider === 'elevenlabs') {
      return this.playSentenceElevenLabs(rawSentence);
    }

    const sentence = rawSentence.trim();
    if (!sentence) {
      this.lastNotice = 'No sentence available';
      return { ok: false, reason: 'empty-sentence' };
    }
    if (this.muted) {
      this.lastNotice = 'Audio is muted';
      return { ok: false, reason: 'muted' };
    }

    this.lastNotice = '';

    if (process.platform !== 'darwin') {
      this.lastNotice = 'Sentence playback TODO: non-macOS fallback is not implemented yet';
      return { ok: false, reason: this.lastNotice };
    }

    return this.playSentenceWithSay(sentence);
  }
}
