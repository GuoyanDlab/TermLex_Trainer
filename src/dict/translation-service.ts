import https from 'node:https';

export interface SentenceTranslationResult {
  translation: string;
  source: 'mymemory' | 'google' | 'fallback';
}

interface MyMemoryResponse {
  responseStatus?: number;
  responseData?: {
    translatedText?: string;
  };
}

function requestJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      const statusCode = res.statusCode ?? 0;
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`HTTP ${statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => reject(error));
    req.setTimeout(6000, () => {
      req.destroy(new Error('request timeout'));
    });
  });
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number(code);
      if (!Number.isFinite(value)) return '';
      return String.fromCharCode(value);
    });
}

function parseTranslatedText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const response = payload as MyMemoryResponse;
  if (response.responseStatus !== 200) {
    return '';
  }
  const raw = typeof response.responseData?.translatedText === 'string'
    ? response.responseData.translatedText.trim()
    : '';
  if (!raw) {
    return '';
  }
  return decodeHtmlEntities(raw).trim();
}

function parseGoogleTranslatedText(payload: unknown): string {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
    return '';
  }

  const parts: string[] = [];
  for (const segment of payload[0] as unknown[]) {
    if (!Array.isArray(segment)) continue;
    const text = typeof segment[0] === 'string' ? segment[0].trim() : '';
    if (text) {
      parts.push(text);
    }
  }

  return parts.join('').trim();
}

export async function translateSentenceToChinese(sentence: string): Promise<SentenceTranslationResult> {
  const target = sentence.trim();
  if (!target) {
    return { translation: '', source: 'fallback' };
  }

  const maxLen = 500;
  const compact = target.length > maxLen ? target.slice(0, maxLen) : target;
  const email = (process.env.MYMEMORY_EMAIL || '').trim();
  const query = new URLSearchParams({
    q: compact,
    langpair: 'en|zh-CN',
  });
  if (email) {
    query.set('de', email);
  }
  const url = `https://api.mymemory.translated.net/get?${query.toString()}`;

  try {
    const payload = await requestJson(url);
    const translated = parseTranslatedText(payload);
    if (translated) {
      return { translation: translated, source: 'mymemory' };
    }
  } catch {
    // Try Google fallback below.
  }

  const googleQuery = new URLSearchParams({
    client: 'gtx',
    sl: 'en',
    tl: 'zh-CN',
    dt: 't',
    q: compact,
  });
  const googleUrl = `https://translate.googleapis.com/translate_a/single?${googleQuery.toString()}`;

  try {
    const payload = await requestJson(googleUrl, {
      'User-Agent': 'Mozilla/5.0',
    });
    const translated = parseGoogleTranslatedText(payload);
    if (translated) {
      return { translation: translated, source: 'google' };
    }
  } catch {
    // fall through to fallback result
  }

  return { translation: '', source: 'fallback' };
}
