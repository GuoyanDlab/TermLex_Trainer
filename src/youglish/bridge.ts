import fs from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';

export type YouGlishPlayerState =
  | 'unstarted'
  | 'ended'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'cued'
  | 'unknown';

export interface YouGlishSnapshot {
  ready: boolean;
  query: string;
  lang: string;
  accent: string;
  totalClips: number;
  clipIndex: number;
  consumedCount: number;
  videoId: string;
  phrase: string;
  captionId: number;
  playerState: YouGlishPlayerState;
  errorCode: number;
  message: string;
}

const EMPTY_SNAPSHOT: YouGlishSnapshot = {
  ready: false,
  query: '',
  lang: 'english',
  accent: 'us',
  totalClips: 0,
  clipIndex: 0,
  consumedCount: 0,
  videoId: '',
  phrase: '',
  captionId: 0,
  playerState: 'unknown',
  errorCode: 0,
  message: 'idle',
};

function normalizeWord(rawWord: string): string {
  return rawWord.trim().replace(/\s+/g, ' ');
}

function toPlayerState(state: number): YouGlishPlayerState {
  if (state === -1) return 'unstarted';
  if (state === 0) return 'ended';
  if (state === 1) return 'playing';
  if (state === 2) return 'paused';
  if (state === 3) return 'buffering';
  if (state === 5) return 'cued';
  return 'unknown';
}

interface BridgeState {
  ready: boolean;
  query: string;
  lang: string;
  accent: string;
  totalClips: number;
  clipIndex: number;
  consumedCount: number;
  videoId: string;
  phrase: string;
  captionId: number;
  playerState: number;
  errorCode: number;
  message: string;
}

export class YouGlishBridge {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private loading = false;

  constructor(private readonly userDataDir: string) {}

  private resolveAutoNextEnabled(): boolean {
    const raw = (process.env.YOUGLISH_AUTO_NEXT || 'true').trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
    return true;
  }

  private resolveAutoNextGapMs(): number {
    const value = Number(process.env.YOUGLISH_AUTO_NEXT_GAP_MS || '350');
    if (!Number.isFinite(value) || value < 100) return 350;
    return Math.floor(value);
  }

  private async resolveBrowserExecutablePath(): Promise<string | null> {
    const envPath = (process.env.YOUGLISH_BROWSER_PATH || '').trim();
    if (envPath) {
      try {
        await fs.access(envPath);
        return envPath;
      } catch {
        return null;
      }
    }

    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // continue
      }
    }
    return null;
  }

  private getBridgeHtml(): string {
    const autoNextEnabled = this.resolveAutoNextEnabled();
    const autoNextGapMs = this.resolveAutoNextGapMs();
    return String.raw`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>YouGlish Audio Bridge</title>
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        background: #000;
      }
      #youglish-root {
        width: 640px;
        height: 360px;
        opacity: 0.01;
        overflow: hidden;
      }
    </style>
  </head>
  <body>
    <div id="youglish-root"></div>
    <script>
      (function () {
        var widget = null;
        var pendingFetch = null;
        var autoNextEnabled = ${JSON.stringify(autoNextEnabled)};
        var autoNextGapMs = ${JSON.stringify(autoNextGapMs)};
        var readyWaitTimeoutMs = 12000;
        var maxReadyRetry = 3;
        var lastAutoNextAt = 0;
        var lastConsumedCaptionId = 0;
        var autoNextTimer = null;
        var widgetCreatedAt = 0;
        var readyRetryCount = 0;
        var lastWaitSecond = -1;
        var apiLoaded = false;
        var state = {
          ready: false,
          query: '',
          lang: 'english',
          accent: 'us',
          totalClips: 0,
          clipIndex: 0,
          consumedCount: 0,
          videoId: '',
          phrase: '',
          captionId: 0,
          playerState: -1,
          errorCode: 0,
          message: 'booting'
        };

        function normalizeCaption(text) {
          var value = String(text || '')
            .replace(/\[\[\[/g, '')
            .replace(/\]\]\]/g, '')
            .trim();
          if (!value) return '';

          value = value.replace(/\+/g, ' ');

          for (var i = 0; i < 3; i++) {
            if (!/%[0-9A-Fa-f]{2}/.test(value)) break;
            try {
              var decoded = decodeURIComponent(value);
              if (decoded === value) break;
              value = decoded;
            } catch (error) {
              try {
                var repaired = value.replace(/%(?![0-9A-Fa-f]{2})/g, '%25');
                var repairedDecoded = decodeURIComponent(repaired);
                if (repairedDecoded === value) break;
                value = repairedDecoded;
              } catch (innerError) {
                break;
              }
            }
          }

          value = value
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim();

          return value;
        }

        function update(patch) {
          state = Object.assign({}, state, patch || {});
        }

        function requestFetch(source) {
          if (!pendingFetch) return false;
          if (!widget) {
            update({ message: 'fetch-queued' });
            return false;
          }
          try {
            update({
              query: pendingFetch.query,
              lang: pendingFetch.lang,
              accent: pendingFetch.accent,
              totalClips: 0,
              clipIndex: 0,
              consumedCount: 0,
              videoId: '',
              phrase: '',
              captionId: 0,
              message: source || 'fetch-requested',
              errorCode: 0
            });
            widget.fetch(pendingFetch.query, pendingFetch.lang, pendingFetch.accent);
            pendingFetch = null;
            return true;
          } catch (error) {
            update({
              message: 'fetch-error',
              errorCode: 1
            });
            return false;
          }
        }

        function shouldAutoNext(captionId) {
          if (!autoNextEnabled) return false;
          if (!widget) return false;
          if (state.totalClips > 0 && state.clipIndex >= state.totalClips) return false;
          if (state.playerState === 2) return false;
          var now = Date.now();
          if (now - lastAutoNextAt < autoNextGapMs) return false;
          if (captionId && captionId === lastConsumedCaptionId) return false;
          return true;
        }

        function createWidget(reason) {
          if (typeof YG === 'undefined' || !YG || typeof YG.Widget !== 'function') {
            update({
              ready: false,
              message: 'yg-api-unavailable',
              errorCode: 1
            });
            return false;
          }
          try {
            widget = new YG.Widget('youglish-root', {
              width: 640,
              height: 360,
              autoStart: 1,
              videoQuality: 'small',
              components: 9,
              events: {
                onFetchDone: function (event) {
                  update({
                    totalClips: Number(event && event.totalResult ? event.totalResult : 0),
                    query: String(event && event.query ? event.query : state.query),
                    lang: String(event && event.lang ? event.lang : state.lang),
                    accent: String(event && event.accent ? event.accent : state.accent),
                    message: Number(event && event.totalResult ? event.totalResult : 0) > 0 ? 'fetch-done' : 'fetch-zero'
                  });
                },
                onVideoChange: function (event) {
                  update({
                    clipIndex: Number(event && event.trackNumber ? event.trackNumber : 0),
                    videoId: String(event && event.video ? event.video : ''),
                    message: 'video-change'
                  });
                },
                onCaptionChange: function (event) {
                  update({
                    phrase: normalizeCaption(event && event.caption),
                    captionId: Number(event && event.id ? event.id : 0),
                    message: 'caption-change'
                  });
                },
                onCaptionConsumed: function (event) {
                  var consumedId = Number(event && event.id ? event.id : 0);
                  update({
                    captionId: consumedId,
                    consumedCount: Number(state.consumedCount || 0) + 1,
                    message: 'caption-consumed'
                  });
                  scheduleAutoNext(consumedId);
                },
                onPlayerStateChange: function (event) {
                  update({
                    playerState: Number(event && typeof event.state === 'number' ? event.state : -1),
                    message: 'player-state'
                  });
                },
                onError: function (event) {
                  update({
                    errorCode: Number(event && typeof event.code === 'number' ? event.code : 1),
                    message: 'error'
                  });
                },
                onPlayerReady: function () {
                  update({
                    ready: true,
                    message: 'ready'
                  });
                  lastWaitSecond = -1;
                  requestFetch('fetch-on-ready');
                }
              }
            });
            widgetCreatedAt = Date.now();
            update({
              ready: false,
              message: reason || 'widget-created',
              errorCode: 0
            });
            requestFetch('fetch-on-widget-created');
            return true;
          } catch (error) {
            update({
              ready: false,
              message: 'init-error',
              errorCode: 1
            });
            return false;
          }
        }

        function recreateWidget(reason) {
          try {
            if (widget && typeof widget.close === 'function') {
              widget.close();
            }
          } catch (error) {}
          widget = null;
          return createWidget(reason || 'widget-recreate');
        }

        function scheduleAutoNext(captionId) {
          if (!shouldAutoNext(captionId)) return false;
          if (captionId) {
            lastConsumedCaptionId = captionId;
          }
          if (autoNextTimer) {
            clearTimeout(autoNextTimer);
            autoNextTimer = null;
          }
          update({ message: 'auto-next-waiting' });
          autoNextTimer = setTimeout(function () {
            autoNextTimer = null;
            if (!widget) return;
            if (state.playerState === 2) return;
            try {
              lastAutoNextAt = Date.now();
              update({ message: 'auto-next' });
              widget.next();
            } catch (error) {
              update({
                message: 'auto-next-failed',
                errorCode: 1
              });
            }
          }, autoNextGapMs);
          return true;
        }

        window.__YGBridge = {
          fetch: function (query, lang, accent) {
            pendingFetch = {
              query: String(query || '').trim(),
              lang: String(lang || 'english'),
              accent: String(accent || 'us')
            };
            update({
              query: pendingFetch.query,
              lang: pendingFetch.lang,
              accent: pendingFetch.accent,
              message: 'fetching',
              errorCode: 0
            });
            requestFetch('fetch-requested');
            return true;
          },
          next: function () {
            if (!widget) return false;
            widget.next();
            return true;
          },
          previous: function () {
            if (!widget) return false;
            widget.previous();
            return true;
          },
          pause: function () {
            if (!widget) return false;
            widget.pause();
            return true;
          },
          play: function () {
            if (!widget) return false;
            widget.play();
            return true;
          },
          toggle: function () {
            if (!widget) return false;
            if (state.playerState === 1) widget.pause();
            else widget.play();
            return true;
          },
          getState: function () {
            return Object.assign({}, state);
          }
        };

        window.onYouglishAPIReady = function () {
          apiLoaded = true;
          readyRetryCount = 0;
          createWidget('widget-created');
        };

        var tag = document.createElement('script');
        tag.src = 'https://youglish.com/public/emb/widget.js';
        tag.onload = function () {
          update({
            message: 'script-loaded',
            errorCode: 0
          });
        };
        tag.onerror = function () {
          update({
            message: 'script-load-failed',
            errorCode: 1
          });
        };
        document.body.appendChild(tag);
        setInterval(function () {
          requestFetch('fetch-retry');
        }, 1000);
        setInterval(function () {
          if (!state.ready && widget) {
            var waitedMs = Date.now() - widgetCreatedAt;
            var waitedSec = Math.floor(waitedMs / 1000);
            if (waitedSec !== lastWaitSecond) {
              lastWaitSecond = waitedSec;
              update({ message: 'waiting-player-ready ' + waitedSec + 's' });
            }
            if (waitedMs >= readyWaitTimeoutMs) {
              if (readyRetryCount < maxReadyRetry) {
                readyRetryCount += 1;
                recreateWidget('ready-timeout-retry-' + readyRetryCount);
              } else {
                update({
                  message: 'ready-timeout-giveup',
                  errorCode: 3
                });
              }
            }
            return;
          }
          if (!apiLoaded && !widget) {
            update({ message: 'waiting-api-load' });
            return;
          }
        }, 1500);
      })();
    </script>
  </body>
</html>`;
  }

  private async ensurePage(): Promise<void> {
    if (this.page || this.loading) {
      while (this.loading) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return;
    }
    this.loading = true;
    try {
      await fs.mkdir(this.userDataDir, { recursive: true });
      const playwright = await import('playwright-core');
      const executablePath = await this.resolveBrowserExecutablePath();
      const headless = (process.env.YOUGLISH_HEADLESS || '').trim().toLowerCase() === 'true';
      const channel = (process.env.YOUGLISH_BROWSER_CHANNEL || 'chrome').trim();
      const args = [
        '--autoplay-policy=no-user-gesture-required',
        '--window-size=760,520',
        '--window-position=2600,80',
      ];

      this.context = await playwright.chromium.launchPersistentContext(
        path.join(this.userDataDir, 'profile'),
        {
        headless,
        args,
        ...(executablePath ? { executablePath } : {}),
        ...(!executablePath && channel ? { channel } : {}),
        },
      );
      this.page = this.context.pages()[0] || null;
      if (!this.page) {
        this.page = await this.context.newPage();
      }
      await this.page.setViewportSize({
        width: 760,
        height: 520,
      });
      await this.page.bringToFront();
      await this.page.setContent(this.getBridgeHtml(), { waitUntil: 'domcontentloaded' });
    } finally {
      this.loading = false;
    }
  }

  private async getRawState(): Promise<BridgeState> {
    if (!this.page) {
      return {
        ...EMPTY_SNAPSHOT,
        playerState: -1,
      };
    }
    const raw = await this.page.evaluate(() => {
      const bridge = (window as unknown as { __YGBridge?: { getState?: () => unknown } }).__YGBridge;
      if (!bridge || typeof bridge.getState !== 'function') {
        return null;
      }
      return bridge.getState();
    });
    if (!raw || typeof raw !== 'object') {
      return {
        ...EMPTY_SNAPSHOT,
        playerState: -1,
      };
    }
    const parsed = raw as Partial<BridgeState>;
    return {
      ready: Boolean(parsed.ready),
      query: typeof parsed.query === 'string' ? parsed.query : '',
      lang: typeof parsed.lang === 'string' ? parsed.lang : 'english',
      accent: typeof parsed.accent === 'string' ? parsed.accent : 'us',
      totalClips: Number.isFinite(parsed.totalClips) ? Number(parsed.totalClips) : 0,
      clipIndex: Number.isFinite(parsed.clipIndex) ? Number(parsed.clipIndex) : 0,
      consumedCount: Number.isFinite(parsed.consumedCount) ? Number(parsed.consumedCount) : 0,
      videoId: typeof parsed.videoId === 'string' ? parsed.videoId : '',
      phrase: typeof parsed.phrase === 'string' ? parsed.phrase : '',
      captionId: Number.isFinite(parsed.captionId) ? Number(parsed.captionId) : 0,
      playerState: Number.isFinite(parsed.playerState) ? Number(parsed.playerState) : -1,
      errorCode: Number.isFinite(parsed.errorCode) ? Number(parsed.errorCode) : 0,
      message: typeof parsed.message === 'string' ? parsed.message : '',
    };
  }

  private toSnapshot(state: BridgeState): YouGlishSnapshot {
    return {
      ready: state.ready,
      query: state.query,
      lang: state.lang,
      accent: state.accent,
      totalClips: state.totalClips,
      clipIndex: state.clipIndex,
      consumedCount: state.consumedCount,
      videoId: state.videoId,
      phrase: state.phrase,
      captionId: state.captionId,
      playerState: toPlayerState(state.playerState),
      errorCode: state.errorCode,
      message: state.message,
    };
  }

  private errorSnapshot(error: unknown): YouGlishSnapshot {
    const raw = (error as Error).message || String(error);
    const concise = raw
      .replace(/\u001b\[[0-9;]*m/g, ' ')
      .replace(/\\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
    return {
      ...EMPTY_SNAPSHOT,
      message: `bridge-error: ${concise}`,
    };
  }

  async fetch(word: string, lang = 'english', accent = 'us'): Promise<YouGlishSnapshot> {
    try {
      const query = normalizeWord(word);
      await this.ensurePage();
      if (!this.page) {
        return {
          ...EMPTY_SNAPSHOT,
          message: 'browser-unavailable',
        };
      }

      await this.page.evaluate(
        ([q, l, a]) => {
          const bridge = (window as unknown as { __YGBridge?: { fetch?: (query: string, lang: string, accent: string) => boolean } }).__YGBridge;
          if (!bridge || typeof bridge.fetch !== 'function') return;
          bridge.fetch(q, l, a);
        },
        [query, lang, accent],
      );
      return this.getSnapshot();
    } catch (error) {
      return this.errorSnapshot(error);
    }
  }

  async playPause(): Promise<YouGlishSnapshot> {
    try {
      await this.ensurePage();
      if (this.page) {
        await this.page.evaluate(() => {
          const bridge = (window as unknown as { __YGBridge?: { toggle?: () => boolean } }).__YGBridge;
          if (bridge && typeof bridge.toggle === 'function') {
            bridge.toggle();
          }
        });
      }
      return this.getSnapshot();
    } catch (error) {
      return this.errorSnapshot(error);
    }
  }

  async pause(): Promise<YouGlishSnapshot> {
    try {
      await this.ensurePage();
      if (this.page) {
        await this.page.evaluate(() => {
          const bridge = (window as unknown as { __YGBridge?: { pause?: () => boolean } }).__YGBridge;
          if (bridge && typeof bridge.pause === 'function') {
            bridge.pause();
          }
        });
      }
      return this.getSnapshot();
    } catch (error) {
      return this.errorSnapshot(error);
    }
  }

  async next(): Promise<YouGlishSnapshot> {
    try {
      await this.ensurePage();
      if (this.page) {
        await this.page.evaluate(() => {
          const bridge = (window as unknown as { __YGBridge?: { next?: () => boolean } }).__YGBridge;
          if (bridge && typeof bridge.next === 'function') {
            bridge.next();
          }
        });
      }
      return this.getSnapshot();
    } catch (error) {
      return this.errorSnapshot(error);
    }
  }

  async previous(): Promise<YouGlishSnapshot> {
    try {
      await this.ensurePage();
      if (this.page) {
        await this.page.evaluate(() => {
          const bridge = (window as unknown as { __YGBridge?: { previous?: () => boolean } }).__YGBridge;
          if (bridge && typeof bridge.previous === 'function') {
            bridge.previous();
          }
        });
      }
      return this.getSnapshot();
    } catch (error) {
      return this.errorSnapshot(error);
    }
  }

  async getSnapshot(): Promise<YouGlishSnapshot> {
    try {
      await this.ensurePage();
      const state = await this.getRawState();
      return this.toSnapshot(state);
    } catch (error) {
      return this.errorSnapshot(error);
    }
  }

  async close(): Promise<void> {
    if (this.page) {
      try {
        await this.page.close();
      } catch {
        // ignore
      }
      this.page = null;
    }
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // ignore
      }
      this.context = null;
    }
  }
}
