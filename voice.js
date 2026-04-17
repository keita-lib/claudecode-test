const URL_PATTERN = /https?:\/\/[^\s\u3000\u3001\u3002\uff01\uff1f]+/g;

// 日本語の日付表現を今日基準でDateに変換
export function parseDeadline(text) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const t = text
    .replace(/\s/g, '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

  // 〇月〇日
  const md = t.match(/(\d{1,2})月(\d{1,2})日/);
  if (md) {
    const year = today.getMonth() + 1 > parseInt(md[1]) ? today.getFullYear() + 1 : today.getFullYear();
    return new Date(year, parseInt(md[1]) - 1, parseInt(md[2]));
  }

  // 〇/〇
  const slash = t.match(/(\d{1,2})\/(\d{1,2})/);
  if (slash) {
    const year = today.getMonth() + 1 > parseInt(slash[1]) ? today.getFullYear() + 1 : today.getFullYear();
    return new Date(year, parseInt(slash[1]) - 1, parseInt(slash[2]));
  }

  // 今日 / 本日
  if (/今日|本日/.test(t)) return new Date(today);

  // 明日
  if (/明日|あした/.test(t)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d;
  }

  // 今週末 / 週末
  if (/今週末|週末/.test(t)) {
    const d = new Date(today);
    d.setDate(d.getDate() + (6 - d.getDay()));
    return d;
  }

  // 来週
  if (/来週/.test(t)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 7);
    return d;
  }

  // 今月末 / 月末
  if (/今月末|月末/.test(t)) {
    return new Date(today.getFullYear(), today.getMonth() + 1, 0);
  }

  // 来月末
  if (/来月末/.test(t)) {
    return new Date(today.getFullYear(), today.getMonth() + 2, 0);
  }

  // 〇日以内 / 〇日後
  const days = t.match(/(\d+)日(以内|後|まで)/);
  if (days) {
    const d = new Date(today);
    d.setDate(d.getDate() + parseInt(days[1]));
    return d;
  }

  // 〇週間後
  const weeks = t.match(/(\d+)週間(後|以内)/);
  if (weeks) {
    const d = new Date(today);
    d.setDate(d.getDate() + parseInt(weeks[1]) * 7);
    return d;
  }

  return null;
}

export function extractUrls(text) {
  return text.match(URL_PATTERN) || [];
}

// 案件名の簡易抽出：「〇〇の〜」「〇〇プロジェクト」「〇〇案件」
export function extractProject(text) {
  const m = text.match(/^(.+?)(?:の|プロジェクト|案件|PJ)/);
  return m ? m[1].trim() : null;
}

// 未定キーワード判定
export function isUndecided(text) {
  return /未定|決まってない|決まってない|わからない|分からない|後で|あとで|tbd|TBD/.test(text);
}

export class VoiceRecorder {
  constructor({ onResult, onError, lang = 'ja-JP' }) {
    this.onResult = onResult;
    this.onError = onError;
    this.lang = lang;
    this.recognition = null;
    this.active = false;
  }

  get supported() {
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  }

  start() {
    if (!this.supported) {
      this.onError('お使いのブラウザは音声入力に対応していません。Chromeをお使いください。');
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SR();
    this.recognition.lang = this.lang;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;

    this.recognition.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join('');
      const isFinal = e.results[e.results.length - 1].isFinal;
      this.onResult(transcript, isFinal);
    };

    this.recognition.onerror = (e) => {
      this.active = false;
      if (e.error !== 'no-speech') this.onError(e.error);
    };

    this.recognition.onend = () => {
      this.active = false;
    };

    this.recognition.start();
    this.active = true;
  }

  stop() {
    if (this.recognition) {
      this.recognition.stop();
      this.active = false;
    }
  }
}
