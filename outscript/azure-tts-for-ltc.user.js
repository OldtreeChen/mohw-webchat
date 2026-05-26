// ==UserScript==
// @name         Azure TTS for LTC WebChat
// @namespace    https://ltcai.mohw.gov.tw/
// @version      0.1.0
// @description  Replace HeyGen avatar voice with Azure Multilingual Neural TTS (zh/en/th/id/vi/ja)
// @author       —
// @match        https://ltcai.mohw.gov.tw/webchat/*
// @match        https://rdqa.qbiai.com/1120mohwwebchat/*
// @match        http://localhost/*
// @match        http://127.0.0.1/*
// @grant        GM_getValue
// @grant        GM_setValue
// @require      https://cdn.jsdelivr.net/npm/microsoft-cognitiveservices-speech-sdk@1.40.0/distrib/browser/microsoft.cognitiveservices.speech.sdk.bundle-min.js
// @run-at       document-end
// ==/UserScript==

/* global SpeechSDK */

(function () {
  'use strict';

  // ============ Constants ============
  const POLL_MS = 100;
  const AVATAR_TIMEOUT_MS = 30000;
  const TOAST_HIDE_MS = 30000;
  const SYNTH_OUTPUT_FORMAT_KEY = 'Audio24Khz48KBitRateMonoMp3';
  // ============ /Constants ============

  // ============ DevMode GM polyfill ============
  // When this script is pasted into DevTools console instead of installed via
  // Tampermonkey, GM_getValue / GM_setValue do not exist. Fall back to
  // localStorage so behavior is identical for testing.
  const GM_get = typeof GM_getValue === 'function'
    ? GM_getValue
    : (k, def) => {
        try { const v = localStorage.getItem('azure-tts:' + k); return v == null ? def : JSON.parse(v); }
        catch { return def; }
      };
  const GM_set = typeof GM_setValue === 'function'
    ? GM_setValue
    : (k, v) => localStorage.setItem('azure-tts:' + k, JSON.stringify(v));
  // ============ /DevMode GM polyfill ============

  console.log('[AzureTTS] userscript loaded, version 0.1.0');

  // ============ ConfigStore ============
  const ConfigDefaults = {
    enabled: true,
    subscriptionKey: '',
    region: 'japaneast',
    voiceId: 'zh-CN-XiaoxiaoMultilingualNeural',
    muteHeygen: true,
    verboseLog: false,
    // Phase 2-A
    syncTextToBubble: true,
    suppressPlaceholderQueueWrite: true,
    boundaryDebug: false,
  };

  const Config = {
    _cache: {},
    load() {
      for (const k of Object.keys(ConfigDefaults)) {
        this._cache[k] = GM_get(k, ConfigDefaults[k]);
      }
      return this._cache;
    },
    get(k) { return k in this._cache ? this._cache[k] : ConfigDefaults[k]; },
    set(k, v) {
      this._cache[k] = v;
      GM_set(k, v);
    },
    all() { return { ...this._cache }; },
  };

  Config.load();
  // Redacted log: never print the key itself.
  console.log('[AzureTTS] Config loaded:', {
    ...Config.all(),
    subscriptionKey: Config.get('subscriptionKey') ? '***set***' : '(empty)',
  });
  // ============ /ConfigStore ============

  // ============ LangDetector ============
  // Test fixtures (declared first; used by self-test at bottom of section).
  const LANG_FIXTURES = [
    // zh-CN
    ['您好，我是長照智慧助理', 'zh-CN'],
    ['請問您要申請哪一項服務？', 'zh-CN'],
    ['謝謝您的來電', 'zh-CN'],
    ['我们提供居家照护服务', 'zh-CN'],
    // en-US
    ['Hello, I am the LTC assistant.', 'en-US'],
    ['How can I help you today?', 'en-US'],
    ['Please describe your situation.', 'en-US'],
    ['Thank you for contacting us.', 'en-US'],
    // th-TH
    ['สวัสดี ฉันเป็นผู้ช่วยดูแลระยะยาว', 'th-TH'],
    ['คุณต้องการสมัครบริการอะไร', 'th-TH'],
    ['ขอบคุณค่ะ', 'th-TH'],
    ['กรุณารอสักครู่', 'th-TH'],
    // id-ID
    ['Halo, saya asisten perawatan jangka panjang.', 'id-ID'],
    ['Apa yang bisa saya bantu untuk anda?', 'id-ID'],
    ['Terima kasih sudah menghubungi kami.', 'id-ID'],
    ['Saya tidak mengerti pertanyaan anda.', 'id-ID'],
    // vi-VN
    ['Xin chào, tôi là trợ lý chăm sóc dài hạn.', 'vi-VN'],
    ['Tôi có thể giúp gì cho bạn?', 'vi-VN'],
    ['Cảm ơn bạn đã liên hệ.', 'vi-VN'],
    ['Vui lòng đợi một chút.', 'vi-VN'],
    // ja-JP
    ['こんにちは、長期介護のアシスタントです。', 'ja-JP'],
    ['どのようなサービスを申し込みますか？', 'ja-JP'],
    ['ありがとうございます。', 'ja-JP'],
    ['少々お待ちください。', 'ja-JP'],
  ];

  function detectLang(text) {
    if (!text) return 'zh-CN';
    // Thai script — unique block, check first.
    if (/[฀-๿]/.test(text)) return 'th-TH';
    // Japanese kana — unique blocks.
    if (/[぀-ゟ゠-ヿ]/.test(text)) return 'ja-JP';
    // CJK ideographs without kana → treat as Chinese.
    if (/[一-鿿]/.test(text)) return 'zh-CN';
    // Vietnamese — Latin with characteristic diacritics.
    if (/[ăâđêôơưĂÂĐÊÔƠƯàáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵ]/.test(text)) return 'vi-VN';
    // Indonesian — feature words (case-insensitive).
    if (/\b(saya|kamu|anda|terima\s+kasih|adalah|untuk|dengan|tidak|sudah|belum|mengerti|menghubungi)\b/i.test(text)) return 'id-ID';
    // Default: English.
    return 'en-US';
  }

  function selfTestLangDetector() {
    const failures = [];
    for (const [text, expected] of LANG_FIXTURES) {
      const got = detectLang(text);
      if (got !== expected) failures.push({ text, expected, got });
    }
    if (failures.length === 0) {
      console.log(`[AzureTTS] LangDetector self-test PASSED (${LANG_FIXTURES.length}/${LANG_FIXTURES.length})`);
    } else {
      console.warn(`[AzureTTS] LangDetector self-test FAILED (${failures.length}/${LANG_FIXTURES.length})`, failures);
    }
    return failures;
  }

  // Always run self-test at load — it's <1ms and surfaces regressions immediately.
  selfTestLangDetector();
  // ============ /LangDetector ============

  // ============ SSMLBuilder ============
  function escapeXml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function buildSSML(text, lang, voiceId) {
    return (
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">` +
      `<voice name="${escapeXml(voiceId)}">` +
      `<lang xml:lang="${escapeXml(lang)}">${escapeXml(text)}</lang>` +
      `</voice>` +
      `</speak>`
    );
  }
  // ============ /SSMLBuilder ============

  // ============ AzureSpeaker ============
  const AzureSpeaker = {
    _synthesizer: null,
    _currentDestination: null,
    _sig: null,
    _speakChain: Promise.resolve(),

    _ensureSynth() {
      const key = Config.get('subscriptionKey');
      const region = Config.get('region');
      if (!key) throw new Error('Azure subscription key is not set');
      if (!region) throw new Error('Azure region is not set');

      // Recreate synthesizer if config changed (lazy comparison via cached signature).
      const sig = `${key}|${region}`;
      if (this._sig !== sig) {
        if (this._synthesizer) {
          try { this._synthesizer.close(); } catch {}
        }
        const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(key, region);
        speechConfig.speechSynthesisOutputFormat =
          SpeechSDK.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
        this._synthesizer = new SpeechSDK.SpeechSynthesizer(speechConfig);
        this._sig = sig;
      }
      return this._synthesizer;
    },

    speak(text, callbacks) {
      // Serialize: each speak waits for the previous to settle so a config
      // change between _ensureSynth() calls cannot close a synth still in use.
      const next = this._speakChain.catch(() => {}).then(() => this._doSpeak(text, callbacks));
      this._speakChain = next;
      return next;
    },

    _doSpeak(text, callbacks) {
      callbacks = callbacks || {};
      return new Promise((resolve, reject) => {
        let synth;
        try { synth = this._ensureSynth(); }
        catch (e) { return reject(e); }

        const lang = detectLang(text);
        const voiceId = Config.get('voiceId');
        const ssml = buildSSML(text, lang, voiceId);

        if (Config.get('verboseLog')) {
          console.log('[AzureTTS] speak', { lang, voiceId, textPreview: text.slice(0, 40) });
        }

        const boundaries = [];
        let firstAudioTs = null;

        // Subscribe to SDK callback-style hooks.
        synth.wordBoundary = function (s, e) {
          const b = {
            audioOffsetMs: e.audioOffset / 10000,
            textOffset: e.textOffset,
            wordLength: e.wordLength,
            boundaryType: e.boundaryType,
            text: e.text,
          };
          boundaries.push(b);
          if (Config.get('boundaryDebug')) console.log('[AzureTTS][boundary]', b);
          if (callbacks.onBoundary) {
            try { callbacks.onBoundary(b); } catch (err) { console.warn('[AzureTTS] onBoundary cb failed', err); }
          }
        };
        synth.synthesizing = function (s, e) {
          if (firstAudioTs === null) {
            firstAudioTs = performance.now();
            if (callbacks.onAudioStart) {
              try { callbacks.onAudioStart(firstAudioTs); } catch (err) { console.warn('[AzureTTS] onAudioStart cb failed', err); }
            }
          }
        };

        const cleanup = function () {
          synth.wordBoundary = undefined;
          synth.synthesizing = undefined;
        };

        synth.speakSsmlAsync(
          ssml,
          (result) => {
            cleanup();
            if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
              resolve({
                lang,
                durationMs: result.audioDuration / 10000,
                boundaries,
                firstAudioTs,
              });
            } else {
              reject(new Error('Synthesis failed: ' + result.errorDetails));
            }
          },
          (err) => {
            cleanup();
            reject(new Error('Synthesis error: ' + err));
          }
        );
      });
    },

    async testAll() {
      const samples = [
        ['您好，我是長照智慧助理', 'zh-CN'],
        ['Hello, I am the LTC assistant.', 'en-US'],
        ['สวัสดี ฉันเป็นผู้ช่วยดูแลระยะยาว', 'th-TH'],
        ['Halo, saya asisten perawatan jangka panjang.', 'id-ID'],
        ['Xin chào, tôi là trợ lý chăm sóc dài hạn.', 'vi-VN'],
        ['こんにちは、長期介護のアシスタントです。', 'ja-JP'],
      ];
      const results = [];
      for (const [text, expectLang] of samples) {
        try {
          const r = await this.speak(text);
          results.push({ text, expectLang, got: r.lang, ok: r.lang === expectLang, durationMs: r.durationMs });
        } catch (e) {
          results.push({ text, expectLang, error: e.message });
        }
      }
      console.table(results);
      return results;
    },
  };
  // ============ /AzureSpeaker ============

  // ============ BubbleWriter ============
  const BubbleWriter = {
    _state: new Map(),

    schedule(messageId, chunkText, boundaries, audioStartTs) {
      if (!Config.get('syncTextToBubble')) return;
      if (!messageId || !chunkText) return;
      const bubble = document.getElementById(messageId);
      if (!bubble) {
        if (Config.get('boundaryDebug')) console.warn('[BubbleWriter] bubble not found', messageId);
        return;
      }
      const el = bubble.querySelector('.ChatMessageTextContent');
      if (!el) {
        if (Config.get('boundaryDebug')) console.warn('[BubbleWriter] .ChatMessageTextContent not found in', messageId);
        return;
      }

      let state = this._state.get(messageId);
      if (!state) {
        state = { revealedBase: '', timers: [] };
        this._state.set(messageId, state);
      }
      const base = state.revealedBase;
      const nowOffset = performance.now();
      const safeAudioStart = audioStartTs != null ? audioStartTs : nowOffset;

      const writeUpTo = function (targetText) {
        // Monotonic: only grow. Protects against ' '-placeholder racing
        // and any out-of-order timer fires.
        if (el.textContent.length < targetText.length) {
          el.textContent = targetText;
        }
      };

      for (const b of boundaries) {
        const cutPos = b.textOffset + b.wordLength;
        const visible = base + chunkText.slice(0, cutPos);
        const delay = Math.max(0, (safeAudioStart + b.audioOffsetMs) - nowOffset);
        state.timers.push(setTimeout(() => writeUpTo(visible), delay));
      }

      const lastOffset = boundaries.length
        ? boundaries[boundaries.length - 1].audioOffsetMs
        : 0;
      const tailDelay = Math.max(0, (safeAudioStart + lastOffset + 200) - nowOffset);
      state.timers.push(setTimeout(() => {
        const full = base + chunkText;
        writeUpTo(full);
        state.revealedBase = full;
      }, tailDelay));
    },

    clearMessage(messageId) {
      const s = this._state.get(messageId);
      if (!s) return;
      s.timers.forEach(clearTimeout);
      this._state.delete(messageId);
    },

    clearAll() {
      for (const s of this._state.values()) s.timers.forEach(clearTimeout);
      this._state.clear();
    },
  };
  // ============ /BubbleWriter ============

  // ============ SettingsPanel ============
  const VOICE_OPTIONS = [
    'zh-CN-XiaoxiaoMultilingualNeural',
    'zh-CN-YunyiMultilingualNeural',
    'en-US-AvaMultilingualNeural',
    'en-US-AndrewMultilingualNeural',
    'en-US-EmmaMultilingualNeural',
    'en-US-BrianMultilingualNeural',
  ];

  const REGION_OPTIONS = [
    'japaneast', 'eastasia', 'southeastasia',
    'eastus', 'westus2', 'westeurope', 'northeurope',
  ];

  function injectStyles() {
    if (document.getElementById('azure-tts-style')) return;
    const style = document.createElement('style');
    style.id = 'azure-tts-style';
    style.textContent = `
      #azure-tts-fab {
        position: fixed; right: 16px; bottom: 16px;
        width: 48px; height: 48px; border-radius: 50%;
        background: #2563eb; color: #fff; border: none;
        font-size: 24px; cursor: pointer; z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        display: flex; align-items: center; justify-content: center;
      }
      #azure-tts-fab:hover { background: #1d4ed8; }
      #azure-tts-fab.enabled::after {
        content: ''; position: absolute; top: 4px; right: 4px;
        width: 10px; height: 10px; border-radius: 50%; background: #22c55e;
        border: 2px solid #fff;
      }
      #azure-tts-panel {
        position: fixed; right: 16px; bottom: 76px;
        width: 340px; max-height: 80vh; overflow-y: auto;
        background: #fff; color: #111;
        border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        z-index: 10001; padding: 16px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 14px;
      }
      #azure-tts-panel.hidden { display: none; }
      #azure-tts-panel h3 { margin: 0 0 12px; font-size: 16px; }
      #azure-tts-panel label { display: block; margin: 8px 0 4px; font-weight: 500; }
      #azure-tts-panel input[type=text],
      #azure-tts-panel input[type=password],
      #azure-tts-panel select {
        width: 100%; padding: 6px 8px; border: 1px solid #d1d5db;
        border-radius: 4px; font-size: 14px; box-sizing: border-box;
      }
      #azure-tts-panel .row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
      #azure-tts-panel button.primary {
        background: #2563eb; color: #fff; border: none;
        padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 500;
      }
      #azure-tts-panel button.secondary {
        background: #e5e7eb; color: #111; border: none;
        padding: 8px 16px; border-radius: 4px; cursor: pointer;
      }
      #azure-tts-panel .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
      #azure-tts-panel .status { font-size: 12px; color: #6b7280; margin-top: 8px; min-height: 16px; }
      #azure-tts-panel .status.error { color: #dc2626; }
      #azure-tts-panel .status.ok { color: #16a34a; }
      #azure-tts-start-toast {
        position: fixed; right: 80px; bottom: 24px;
        background: #111; color: #fff; padding: 8px 14px;
        border-radius: 6px; font-size: 13px; z-index: 10002; cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      }
    `;
    document.head.appendChild(style);
  }

  function injectFab() {
    if (document.getElementById('azure-tts-fab')) return;
    const fab = document.createElement('button');
    fab.id = 'azure-tts-fab';
    fab.textContent = '🔊';
    fab.title = 'Azure TTS Settings';
    if (Config.get('enabled') && Config.get('subscriptionKey')) fab.classList.add('enabled');
    fab.addEventListener('click', togglePanel);
    document.body.appendChild(fab);
  }

  function injectPanel() {
    if (document.getElementById('azure-tts-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'azure-tts-panel';
    panel.classList.add('hidden');
    panel.innerHTML = `
      <h3>🔊 Azure TTS Settings</h3>
      <div class="row">
        <input type="checkbox" id="azure-tts-enabled">
        <label for="azure-tts-enabled" style="margin:0;">Enable Azure TTS</label>
      </div>
      <label>Subscription Key</label>
      <input type="password" id="azure-tts-key" placeholder="paste your Azure Speech key">
      <label>Region</label>
      <select id="azure-tts-region">${REGION_OPTIONS.map(r => `<option value="${r}">${r}</option>`).join('')}</select>
      <label>Voice</label>
      <select id="azure-tts-voice">${VOICE_OPTIONS.map(v => `<option value="${v}">${v}</option>`).join('')}</select>
      <div class="row">
        <input type="checkbox" id="azure-tts-mute">
        <label for="azure-tts-mute" style="margin:0;">Mute HeyGen audio</label>
      </div>
      <div class="row">
        <input type="checkbox" id="azure-tts-verbose">
        <label for="azure-tts-verbose" style="margin:0;">Verbose console log</label>
      </div>
      <div class="row">
        <input type="checkbox" id="azure-tts-sync-text">
        <label for="azure-tts-sync-text" style="margin:0;">Sync text to chat bubble</label>
      </div>
      <div class="row">
        <input type="checkbox" id="azure-tts-boundary-debug">
        <label for="azure-tts-boundary-debug" style="margin:0;">Verbose word-boundary log</label>
      </div>
      <div class="actions">
        <button class="secondary" id="azure-tts-test">Test Voice</button>
        <button class="primary" id="azure-tts-save">Save</button>
      </div>
      <div class="status" id="azure-tts-status"></div>
    `;
    document.body.appendChild(panel);

    // Hydrate fields from Config.
    panel.querySelector('#azure-tts-enabled').checked = Config.get('enabled');
    panel.querySelector('#azure-tts-key').value = Config.get('subscriptionKey');
    panel.querySelector('#azure-tts-region').value = Config.get('region');
    panel.querySelector('#azure-tts-voice').value = Config.get('voiceId');
    panel.querySelector('#azure-tts-mute').checked = Config.get('muteHeygen');
    panel.querySelector('#azure-tts-verbose').checked = Config.get('verboseLog');
    panel.querySelector('#azure-tts-sync-text').checked = Config.get('syncTextToBubble');
    panel.querySelector('#azure-tts-boundary-debug').checked = Config.get('boundaryDebug');

    panel.querySelector('#azure-tts-save').addEventListener('click', () => {
      Config.set('enabled', panel.querySelector('#azure-tts-enabled').checked);
      Config.set('subscriptionKey', panel.querySelector('#azure-tts-key').value.trim());
      Config.set('region', panel.querySelector('#azure-tts-region').value);
      Config.set('voiceId', panel.querySelector('#azure-tts-voice').value);
      Config.set('muteHeygen', panel.querySelector('#azure-tts-mute').checked);
      Config.set('verboseLog', panel.querySelector('#azure-tts-verbose').checked);
      Config.set('syncTextToBubble', panel.querySelector('#azure-tts-sync-text').checked);
      Config.set('boundaryDebug', panel.querySelector('#azure-tts-boundary-debug').checked);
      setStatus('Saved.', 'ok');
      // Reflect on FAB.
      const fab = document.getElementById('azure-tts-fab');
      fab.classList.toggle('enabled', Config.get('enabled') && Config.get('subscriptionKey'));
    });

    panel.querySelector('#azure-tts-test').addEventListener('click', async () => {
      setStatus('Testing 6 languages…');
      try {
        // Apply current form values first (so user doesn't have to Save).
        Config.set('subscriptionKey', panel.querySelector('#azure-tts-key').value.trim());
        Config.set('region', panel.querySelector('#azure-tts-region').value);
        Config.set('voiceId', panel.querySelector('#azure-tts-voice').value);
        const results = await AzureSpeaker.testAll();
        const failed = results.filter(r => r.error || r.ok === false);
        if (failed.length === 0) setStatus(`All 6 languages OK.`, 'ok');
        else setStatus(`${failed.length}/6 failed — see console.`, 'error');
      } catch (e) {
        setStatus('Error: ' + e.message, 'error');
      }
    });
  }

  function setStatus(msg, kind) {
    const el = document.getElementById('azure-tts-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function togglePanel() {
    const panel = document.getElementById('azure-tts-panel');
    if (panel) panel.classList.toggle('hidden');
  }

  function initPanel() {
    injectStyles();
    injectPanel();
    injectFab();
  }

  // Init panel after DOM is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPanel);
  } else {
    initPanel();
  }
  // ============ /SettingsPanel ============

  // ============ WebChatPatcher ============
  function patchWebChat() {
    if (!window.WebChat) return false;
    if (typeof window.WebChat.handelSpeechAndTextSyncQueue !== 'function') return false;
    if (window.WebChat.__azureTtsSyncPatched) return true;
    window.WebChat.__azureTtsSyncPatched = true;

    const original = window.WebChat.handelSpeechAndTextSyncQueue.bind(window.WebChat);
    window.WebChat.handelSpeechAndTextSyncQueue = function (entry) {
      if (
        Config.get('enabled') &&
        Config.get('subscriptionKey') &&
        Config.get('syncTextToBubble') &&
        Config.get('suppressPlaceholderQueueWrite') &&
        entry && typeof entry.text === 'string' && entry.text.trim() === ''
      ) {
        if (Config.get('boundaryDebug')) {
          console.log('[AzureTTS] suppressed whitespace queue entry', { messageId: entry.messageId, eventId: entry.eventId });
        }
        return;
      }
      return original(entry);
    };
    console.log('[AzureTTS] WebChat.handelSpeechAndTextSyncQueue patched');
    return true;
  }

  // Poll for WebChat with the same cadence as waitForAvatar.
  function waitForWebChat(timeoutMs) {
    if (timeoutMs == null) timeoutMs = AVATAR_TIMEOUT_MS;
    return new Promise((resolve) => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (window.WebChat && typeof window.WebChat.handelSpeechAndTextSyncQueue === 'function') {
          clearInterval(timer);
          resolve(window.WebChat);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          resolve(null);
        }
      }, POLL_MS);
    });
  }
  // ============ /WebChatPatcher ============

  // ============ AvatarPatcher ============
  function waitForAvatar(timeoutMs = AVATAR_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (window.Avatar && typeof window.Avatar.speakDirectMode === 'function') {
          clearInterval(timer);
          resolve(window.Avatar);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          reject(new Error('window.Avatar not detected within ' + timeoutMs + 'ms'));
        }
      }, POLL_MS);
    });
  }

  function patchAvatar(Avatar) {
    if (Avatar.__azureTtsPatched) return;
    Avatar.__azureTtsPatched = true;

    const originalSpeak = Avatar.speakDirectMode.bind(Avatar);
    Avatar.speakDirectMode = async function (text, messageId) {
      const enabled = Config.get('enabled');
      const hasKey = !!Config.get('subscriptionKey');

      if (!enabled || !hasKey || !text || !text.trim()) {
        return originalSpeak(text, messageId);
      }

      try {
        if (Config.get('muteHeygen')) {
          const video = document.querySelector('#heygen-video');
          if (video) video.muted = true;
        }

        const placeholderPromise = originalSpeak(' ', messageId);

        const azureResult = await AzureSpeaker.speak(text);

        // Phase 2-A: schedule the typewriter reveal in the bubble using
        // the captured boundaries and audio-start timestamp.
        if (Config.get('syncTextToBubble') && messageId) {
          BubbleWriter.schedule(
            messageId,
            text,
            azureResult.boundaries || [],
            azureResult.firstAudioTs
          );
        }

        return await placeholderPromise;
      } catch (err) {
        console.warn('[AzureTTS] Azure speak failed, falling back to HeyGen', err);
        return originalSpeak(text, messageId);
      }
    };

    // Short-circuit tryAutoUnmute so HeyGen video stays muted.
    if (typeof Avatar.tryAutoUnmute === 'function') {
      const originalUnmute = Avatar.tryAutoUnmute.bind(Avatar);
      Avatar.tryAutoUnmute = function (videoElement) {
        if (Config.get('enabled') && Config.get('subscriptionKey') && Config.get('muteHeygen')) {
          if (videoElement) videoElement.muted = true;
          // Still emit the side-effects WebChat relies on (greeting message).
          if (window.WebChat?.isNeedSpeakGreetingMessageToHeyGen && window.WebChat?.greetingMessage) {
            window.WebChat.greetingMessage.click();
            window.WebChat.isNeedSpeakGreetingMessageToHeyGen = false;
          }
          return;
        }
        return originalUnmute(videoElement);
      };
    }

    console.log('[AzureTTS] Avatar.speakDirectMode patched');

    // Show one-time toast inviting user gesture (only if enabled & key set).
    if (Config.get('enabled') && Config.get('subscriptionKey')) {
      showStartToast();
    }
  }

  function showStartToast() {
    if (document.getElementById('azure-tts-start-toast')) return;
    if (GM_get('startToastDismissed', false)) return;

    const toast = document.createElement('div');
    toast.id = 'azure-tts-start-toast';
    toast.textContent = '🔊 點此啟用 Azure 語音 (Click to enable Azure voice)';

    // Auto-hide after TOAST_HIDE_MS (does not mark dismissed — will show again next session).
    const hideTimer = setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, TOAST_HIDE_MS);

    toast.addEventListener('click', async () => {
      clearTimeout(hideTimer);
      try {
        // 100ms silent SSML satisfies autoplay gesture requirement.
        const silentSsml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN"><voice name="${escapeXml(Config.get('voiceId'))}"><break time="100ms"/></voice></speak>`;
        await new Promise((resolve, reject) => {
          let synth;
          try { synth = AzureSpeaker._ensureSynth(); }
          catch (e) { return reject(e); }
          synth.speakSsmlAsync(silentSsml, () => resolve(), (err) => reject(err));
        });
      } catch (e) {
        console.warn('[AzureTTS] gesture warmup failed', e);
      }
      GM_set('startToastDismissed', true);
      if (toast.parentNode) toast.remove();
    });

    document.body.appendChild(toast);
  }

  // Start the patch loop.
  waitForAvatar()
    .then(patchAvatar)
    .catch((err) => {
      console.warn('[AzureTTS]', err.message, '— patch skipped. Are you on a HeyGen-enabled page?');
    });
  // ============ /AvatarPatcher ============

})();
