# Azure TTS Tampermonkey Overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single Tampermonkey userscript that adds multilingual Azure Neural TTS playback to the MOHW LTC WebChat virtual assistant — without touching any existing file in the project.

**Architecture:** A single `.user.js` containing an IIFE with six logical sections (Config, LangDetector, SSMLBuilder, AzureSpeaker, SettingsPanel, AvatarPatcher). At runtime it monkey-patches `window.Avatar.speakDirectMode`, mutes the HeyGen `<video>`, detects the language of each bot reply via Unicode-range heuristics, builds SSML wrapped in `<lang xml:lang="...">`, and plays it through Microsoft Cognitive Services Speech SDK's `SpeechSynthesizer`. A floating gear button injects a settings panel for key/region/voice.

**Tech Stack:** Vanilla ES2017, Tampermonkey (`@grant GM_getValue/GM_setValue`), Microsoft Cognitive Services Speech SDK (UMD bundle from jsDelivr CDN).

**Hard constraint reminder:** Do not edit any existing file in `C:\Claude\衛福部webchat\`. All new files live under `outscript/` or `docs/`.

**Note on commits:** The project directory is not a git repository. Skip all "commit" steps. If you `git init` later, you can `git add` everything at once.

---

## File Structure

```
C:\Claude\衛福部webchat\
├── outscript/                              (CREATE — new directory)
│   ├── azure-tts-for-ltc.user.js           (CREATE — the userscript, grown task-by-task)
│   └── README.md                           (CREATE — install + usage + test report)
├── docs/superpowers/specs/
│   └── 2026-05-24-azure-tts-tampermonkey-overlay-design.md   (already exists)
└── docs/superpowers/plans/
    └── 2026-05-24-azure-tts-tampermonkey-overlay-plan.md     (this file)
```

The userscript file is built incrementally. Each task appends or replaces a clearly marked section. Section boundaries inside the file use sentinel comments like:

```js
// ============ ConfigStore ============
// ...
// ============ /ConfigStore ============
```

This makes later tasks' edits trivially locatable.

---

## Task 1: Create directory + minimal userscript scaffold

**Files:**
- Create: `C:\Claude\衛福部webchat\outscript\azure-tts-for-ltc.user.js`

- [ ] **Step 1: Create the file with the Tampermonkey header, IIFE, and GM polyfill.**

Write file:

```js
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
// @require      https://cdn.jsdelivr.net/npm/microsoft-cognitiveservices-speech-sdk/distrib/browser/microsoft.cognitiveservices.speech.sdk.bundle-min.js
// @run-at       document-end
// ==/UserScript==

/* global SpeechSDK */

(function () {
  'use strict';

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

  // Sections appended below by later tasks.
})();
```

- [ ] **Step 2: Verify the scaffold loads without error.**

Open Chrome DevTools, paste the entire file contents (minus the `// ==UserScript==` header block since DevTools doesn't parse it) into the console at `about:blank`. Expect:

```
[AzureTTS] userscript loaded, version 0.1.0
```

If no error appears, scaffold is good.

---

## Task 2: ConfigStore section

**Files:**
- Modify: `C:\Claude\衛福部webchat\outscript\azure-tts-for-ltc.user.js` — append before final `})();`

- [ ] **Step 1: Append the ConfigStore section.**

Insert immediately after the `// Sections appended below by later tasks.` comment:

```js
  // ============ ConfigStore ============
  const ConfigDefaults = {
    enabled: true,
    subscriptionKey: '',
    region: 'japaneast',
    voiceId: 'zh-CN-XiaoxiaoMultilingualNeural',
    muteHeygen: true,
    verboseLog: false,
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
```

- [ ] **Step 2: Verify in DevTools console.**

Reload the page (or re-paste). Expect log line:

```
[AzureTTS] Config loaded: { enabled: true, subscriptionKey: '(empty)', region: 'japaneast', voiceId: 'zh-CN-XiaoxiaoMultilingualNeural', muteHeygen: true, verboseLog: false }
```

---

## Task 3: LangDetector with self-test dictionary (TDD-style)

**Files:**
- Modify: `C:\Claude\衛福部webchat\outscript\azure-tts-for-ltc.user.js` — append before final `})();`

- [ ] **Step 1: Append the test dictionary first.**

```js
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
```

- [ ] **Step 2: Append the detector implementation.**

Immediately after the fixtures:

```js
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
```

- [ ] **Step 3: Append the self-test runner.**

```js
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
```

- [ ] **Step 4: Verify all 24 fixtures pass.**

Reload / re-paste. Expect:

```
[AzureTTS] LangDetector self-test PASSED (24/24)
```

If any fail, the `failures` array tells you which text and what got detected. Fix the rules in Step 2 and re-verify.

---

## Task 4: SSMLBuilder section

**Files:**
- Modify: `C:\Claude\衛福部webchat\outscript\azure-tts-for-ltc.user.js` — append before final `})();`

- [ ] **Step 1: Append the SSML builder.**

```js
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
```

- [ ] **Step 2: Quick console assertion.**

In DevTools console, after reload:

```js
buildSSML('hi & bye', 'en-US', 'zh-CN-XiaoxiaoMultilingualNeural')
```

Wait — `buildSSML` is inside the IIFE closure, not accessible from outside. To verify, add this temporary line at the bottom of the SSMLBuilder section (then remove it after verification):

```js
window.__azureTtsDebug = { detectLang, buildSSML };
```

Then in console:

```js
window.__azureTtsDebug.buildSSML('hi & bye', 'en-US', 'zh-CN-XiaoxiaoMultilingualNeural')
```

Expect:

```
'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN"><voice name="zh-CN-XiaoxiaoMultilingualNeural"><lang xml:lang="en-US">hi &amp; bye</lang></voice></speak>'
```

- [ ] **Step 3: Remove the debug export.**

Delete the `window.__azureTtsDebug = ...` line.

---

## Task 5: AzureSpeaker section

**Files:**
- Modify: `C:\Claude\衛福部webchat\outscript\azure-tts-for-ltc.user.js` — append before final `})();`

- [ ] **Step 1: Verify Speech SDK is available.**

After Tampermonkey or DevTools load, in console:

```js
typeof SpeechSDK
```

Expect: `"object"`. If `"undefined"`, the `@require` URL is broken or DevTools didn't load it — add it manually:

```js
const s = document.createElement('script');
s.src = 'https://cdn.jsdelivr.net/npm/microsoft-cognitiveservices-speech-sdk/distrib/browser/microsoft.cognitiveservices.speech.sdk.bundle-min.js';
document.head.appendChild(s);
```

Wait 2 s, then `typeof SpeechSDK` should be `"object"`.

- [ ] **Step 2: Append the AzureSpeaker section.**

```js
  // ============ AzureSpeaker ============
  const AzureSpeaker = {
    _synthesizer: null,
    _currentDestination: null,

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

    speak(text) {
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

        synth.speakSsmlAsync(
          ssml,
          (result) => {
            if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
              resolve({ lang, durationMs: result.audioDuration / 10000 });
            } else {
              reject(new Error('Synthesis failed: ' + result.errorDetails));
            }
          },
          (err) => reject(new Error('Synthesis error: ' + err))
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
```

- [ ] **Step 3: Manual smoke test.**

In DevTools console:

```js
// Temporary debug export at bottom of file:
window.__azureTtsDebug = { Config, AzureSpeaker };
```

Then:

```js
window.__azureTtsDebug.Config.set('subscriptionKey', '<paste-your-key>');
window.__azureTtsDebug.Config.set('region', 'japaneast');
await window.__azureTtsDebug.AzureSpeaker.speak('您好，這是測試');
```

Expect: hear Mandarin speech from speakers; promise resolves with `{ lang: 'zh-CN', durationMs: ~2000 }`.

If you hear silence but no error, check browser tab is unmuted and `<audio>` autoplay isn't blocked (click anywhere on the page first, then retry).

- [ ] **Step 4: Remove debug export, keep file clean.**

---

## Task 6: SettingsPanel section

**Files:**
- Modify: `C:\Claude\衛福部webchat\outscript\azure-tts-for-ltc.user.js` — append before final `})();`

- [ ] **Step 1: Append the SettingsPanel section with styles + FAB + modal.**

```js
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

    panel.querySelector('#azure-tts-save').addEventListener('click', () => {
      Config.set('enabled', panel.querySelector('#azure-tts-enabled').checked);
      Config.set('subscriptionKey', panel.querySelector('#azure-tts-key').value.trim());
      Config.set('region', panel.querySelector('#azure-tts-region').value);
      Config.set('voiceId', panel.querySelector('#azure-tts-voice').value);
      Config.set('muteHeygen', panel.querySelector('#azure-tts-mute').checked);
      Config.set('verboseLog', panel.querySelector('#azure-tts-verbose').checked);
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
```

- [ ] **Step 2: Verify panel renders.**

Reload page. Expect:
- Blue circular 🔊 button at bottom-right corner.
- Click it → settings modal appears with all fields populated from defaults.
- Type a key, click Save → status shows "Saved." in green; FAB sprouts a small green dot.

- [ ] **Step 3: Verify Test Voice button works.**

With key + region set, click "Test Voice". Expect:
- 6 sequential utterances, one per language, audible from speakers.
- Status shows "All 6 languages OK." after ~30 s.
- Console contains a `console.table` with 6 rows, all `ok: true`.

If autoplay is blocked, the first utterance may fail. Click anywhere on the page first, then retry.

---

## Task 7: AvatarPatcher section

**Files:**
- Modify: `C:\Claude\衛福部webchat\outscript\azure-tts-for-ltc.user.js` — append before final `})();`

- [ ] **Step 1: Append the waiter + main patch.**

```js
  // ============ AvatarPatcher ============
  function waitForAvatar(timeoutMs = 30000) {
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
      }, 100);
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
        // 1. Mute HeyGen video.
        if (Config.get('muteHeygen')) {
          const video = document.querySelector('#heygen-video');
          if (video) video.muted = true;
        }

        // 2. Placeholder send to original so HeyGen still emits an eventId
        //    (so WebChat.handelSpeechAndTextSyncQueue advances). This reuses
        //    the whitespace-placeholder pattern already in WebChat.js:5345.
        const placeholderPromise = originalSpeak(' ', messageId);

        // 3. Azure speak the actual text.
        await AzureSpeaker.speak(text);

        await placeholderPromise;
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
  }

  // Start the patch loop.
  waitForAvatar()
    .then(patchAvatar)
    .catch((err) => {
      console.warn('[AzureTTS]', err.message, '— patch skipped. Are you on a HeyGen-enabled page?');
    });
  // ============ /AvatarPatcher ============
```

- [ ] **Step 2: Verify patch lands on rdqa URL.**

Navigate to `https://rdqa.qbiai.com/1120mohwwebchat/index.html`, paste the userscript via console (or have Tampermonkey installed). Within 30 s expect:

```
[AzureTTS] Avatar.speakDirectMode patched
```

If you see the "Avatar not detected" warning, the page hasn't initialized the Avatar yet — wait longer or refresh.

- [ ] **Step 3: Trigger a manual speak to confirm flow.**

In DevTools console:

```js
Avatar.speakDirectMode('您好，這是測試訊息', 'manual-test-1')
```

Expect:
- `#heygen-video` element becomes muted (check via `document.querySelector('#heygen-video').muted` → `true`).
- Azure synthesizes and plays "您好，這是測試訊息" in Mandarin.
- Console contains `[AzureTTS] speak { lang: 'zh-CN', ... }` if verbose mode on.

---

## Task 8: First-gesture autoplay toast

**Files:**
- Modify: `C:\Claude\衛福部webchat\outscript\azure-tts-for-ltc.user.js` — append inside the `AvatarPatcher` section, right before the closing `// ============ /AvatarPatcher ============` line

- [ ] **Step 1: Append the toast helper and wire it into `patchAvatar`.**

Add this function after `patchAvatar`:

```js
  function showStartToast() {
    if (document.getElementById('azure-tts-start-toast')) return;
    if (GM_get('startToastDismissed', false)) return;

    const toast = document.createElement('div');
    toast.id = 'azure-tts-start-toast';
    toast.textContent = '🔊 點此啟用 Azure 語音 (Click to enable Azure voice)';
    toast.addEventListener('click', async () => {
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
      toast.remove();
    });
    document.body.appendChild(toast);

    // Auto-hide after 30 s (does not mark dismissed — will show again next session).
    setTimeout(() => toast.remove(), 30000);
  }
```

Then modify the bottom of `patchAvatar` — change the trailing `console.log` to:

```js
    console.log('[AzureTTS] Avatar.speakDirectMode patched');

    // Show one-time toast inviting user gesture (only if enabled & key set).
    if (Config.get('enabled') && Config.get('subscriptionKey')) {
      showStartToast();
    }
```

- [ ] **Step 2: Verify the toast appears once.**

Clear local storage / GM storage of `startToastDismissed`:

```js
localStorage.removeItem('azure-tts:startToastDismissed');
```

Reload. Within 30 s of Avatar patch, expect a dark pill-shaped toast to appear at bottom-right showing "點此啟用 Azure 語音". Click it → toast disappears + no audible output (it's a 100 ms silent break, just for the gesture).

Reload again — toast does NOT reappear (dismissal persisted).

---

## Task 9: README with install + usage instructions

**Files:**
- Create: `C:\Claude\衛福部webchat\outscript\README.md`

- [ ] **Step 1: Write the README.**

```markdown
# Azure TTS for LTC WebChat — Tampermonkey Userscript

A single-file userscript that replaces the HeyGen virtual assistant's voice with Azure Multilingual Neural TTS. Supports 6 languages: 繁中/簡中、English、ภาษาไทย、Bahasa Indonesia、Tiếng Việt、日本語.

**Zero modification** to the host site — everything is runtime monkey-patching + DOM injection.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Firefox).
2. Open Tampermonkey dashboard → Utilities → Import from file → pick `azure-tts-for-ltc.user.js`.
3. Or: open the raw `.user.js` URL/path in your browser — Tampermonkey will prompt to install.

The script auto-activates on these URLs:

- `https://ltcai.mohw.gov.tw/webchat/*`
- `https://rdqa.qbiai.com/1120mohwwebchat/*`
- `http://localhost/*`
- `http://127.0.0.1/*`

## First-time setup

1. Open any matching page.
2. A blue 🔊 button appears at the bottom-right. Click it.
3. In the settings panel:
   - Paste your **Azure Speech subscription key**.
   - Pick your **region** (e.g. `japaneast`).
   - Voice is preset to `zh-CN-XiaoxiaoMultilingualNeural` (recommended for mixed Mandarin/multilingual use).
4. Click **Test Voice** — you should hear 6 sample sentences, one per language.
5. Click **Save**.
6. A toast appears at the bottom prompting "點此啟用 Azure 語音" — click it once to satisfy the browser's autoplay-on-gesture rule.

Done. Bot replies now play through Azure.

## How it works (one paragraph)

When a chat reply arrives, the site calls `Avatar.speakDirectMode(text)`. The userscript intercepts that call, mutes the HeyGen `<video>` audio (keeping the video frame), detects the language of `text` via Unicode-range heuristics, wraps it in SSML with `<lang xml:lang="...">`, and synthesizes via Microsoft Cognitive Services Speech SDK. The original `speakDirectMode` is still called with a single space so HeyGen still emits its `eventId` (keeping the existing subtitle sync queue working).

## Known limitations

- **Lip-sync is off.** The HeyGen avatar's mouth animates to silent audio while Azure speaks. To fix, the host site would need to switch to HeyGen Lite Mode and ingest Azure audio into the LiveKit room — out of scope for Phase 1.
- **Bot reply language depends on the bot.** If the bot is configured to reply in Chinese regardless of input language, Azure correctly identifies the Chinese reply and uses Chinese phonetics. The userscript does not translate.
- **Subscription key is stored in browser-local GM storage.** Do not install this script on shared machines.

## Toggle on/off without uninstalling

- Click the 🔊 FAB → uncheck "Enable Azure TTS" → Save. The patch becomes a no-op until re-enabled. No reload required.

## Test report

(Filled after end-to-end test run — see Task 10 of the plan.)
```

- [ ] **Step 2: Verify README renders correctly.**

Open `outscript/README.md` in any markdown previewer. Confirm headings, code blocks, and bullet lists render.

---

## Task 10: End-to-end test on rdqa via Chrome MCP

**Files:**
- Modify: `C:\Claude\衛福部webchat\outscript\README.md` — append a "## Test Report" section with captured results.

This task is executed by the agent using Chrome MCP. The user does not need to do anything except provide an open browser tab.

- [ ] **Step 1: Prepare the browser.**

Use `mcp__Claude_in_Chrome__navigate` to open `https://rdqa.qbiai.com/1120mohwwebchat/index.html`. Wait for the loading overlay to finish (poll for `document.getElementById('loading')?.style.display === 'none'` or similar — see `index.html` lines 213-228).

- [ ] **Step 2: Inject the userscript content.**

Read the full contents of `outscript/azure-tts-for-ltc.user.js`. Strip the `// ==UserScript==` header block (DevTools won't parse it). Use `mcp__Claude_in_Chrome__javascript_tool` (or `preview_eval`) to execute the body. Confirm in console:

```
[AzureTTS] userscript loaded, version 0.1.0
[AzureTTS] Config loaded: ...
[AzureTTS] LangDetector self-test PASSED (24/24)
[AzureTTS] Avatar.speakDirectMode patched
```

- [ ] **Step 3: Configure key + region via the panel.**

Open the settings panel programmatically:

```js
document.getElementById('azure-tts-fab').click();
document.getElementById('azure-tts-key').value = '<key>';
document.getElementById('azure-tts-region').value = 'japaneast';
document.getElementById('azure-tts-save').click();
```

Confirm status text shows "Saved." in green.

- [ ] **Step 4: Test Voice.**

```js
document.getElementById('azure-tts-test').click();
```

Wait ~30 s. Capture the `console.table` output. All 6 rows should have `ok: true`. Capture screenshot.

- [ ] **Step 5: For each of the 6 languages, send the input phrase.**

For each row in this table, repeat the procedure:

| Lang | Input |
|---|---|
| zh | 我想申請長照服務 |
| en | I want to apply for long-term care service |
| th | ฉันต้องการสมัครบริการดูแลระยะยาว |
| id | Saya ingin mendaftar layanan perawatan jangka panjang |
| vi | Tôi muốn đăng ký dịch vụ chăm sóc dài hạn |
| ja | 長期介護サービスに申し込みたいです |

Procedure per row:

1. Set the editor: `document.getElementById('Editor').value = '<input>'`
2. Click send: `document.getElementById('SendButton').click()`
3. Wait for the bot reply DOM to appear in `#MessageList` (poll for new `.LeftBubble` or equivalent — examine actual class names in the rendered page first).
4. Extract the bot reply text from the latest left-aligned bubble.
5. Confirm `[AzureTTS] speak { lang: ..., ... }` log line appears for that reply.
6. Capture screenshot showing the conversation.
7. Record into a results array:
   ```
   { lang_in, input, bot_reply_text, detected_lang, azure_played: true/false, screenshot_id }
   ```

- [ ] **Step 6: Capture network logs to prove Azure was called.**

Use `mcp__Claude_in_Chrome__read_network_requests` and filter for `tts.speech.microsoft.com`. Confirm at least 6 requests appeared (one per reply).

- [ ] **Step 7: Write the test report into `outscript/README.md`.**

Append under the placeholder `## Test report` section:

```markdown
## Test report

**Run date:** YYYY-MM-DD
**Target:** https://rdqa.qbiai.com/1120mohwwebchat/index.html
**Voice:** zh-CN-XiaoxiaoMultilingualNeural
**Region:** japaneast

### Self-tests
- LangDetector: PASSED (24/24)
- Test Voice (6 sample utterances): PASSED (6/6)

### End-to-end (bot conversation)

| # | Input lang | Input text | Bot reply lang | Detected | Azure played | Notes |
|---|---|---|---|---|---|---|
| 1 | zh | 我想申請長照服務 | … | … | ✅/❌ | … |
| 2 | en | I want to apply for long-term care service | … | … | ✅/❌ | … |
| 3 | th | ฉันต้องการสมัครบริการดูแลระยะยาว | … | … | ✅/❌ | … |
| 4 | id | Saya ingin mendaftar layanan perawatan jangka panjang | … | … | ✅/❌ | … |
| 5 | vi | Tôi muốn đăng ký dịch vụ chăm sóc dài hạn | … | … | ✅/❌ | … |
| 6 | ja | 長期介護サービスに申し込みたいです | … | … | ✅/❌ | … |

### Observations
- (any anomalies in bot replies, autoplay quirks, latency notes, etc.)

### Verification of "no source modification"
Confirmed: no files outside `outscript/` and `docs/superpowers/` were created or modified during this test.
```

Fill in the actual values from the test run.

- [ ] **Step 8: Done.**

Report success/failure to the user with:
- Path to userscript: `C:\Claude\衛福部webchat\outscript\azure-tts-for-ltc.user.js`
- Path to README + test report: `C:\Claude\衛福部webchat\outscript\README.md`
- Summary table of results.

---

## Self-Review Notes

Spec coverage check:
- ✅ §3 Hard Constraint — covered by file structure (only `outscript/` + `docs/`).
- ✅ §4.1 ConfigStore — Task 2.
- ✅ §4.1 LangDetector + 24-fixture self-test — Task 3.
- ✅ §4.1 SSMLBuilder — Task 4.
- ✅ §4.1 AzureSpeaker — Task 5.
- ✅ §4.1 SettingsPanel + 6-sample Test Voice — Task 6.
- ✅ §4.1 AvatarPatcher (waitForAvatar + monkey-patch + tryAutoUnmute short-circuit) — Task 7.
- ✅ §6 Error Handling — fallback to original on failure (Task 7), missing-key handling (Tasks 2 + 6), Avatar-not-detected timeout (Task 7).
- ✅ §7 Test Strategy: unit-ish self-test (Task 3) + end-to-end Chrome MCP (Task 10).
- ✅ §9 Open Risks: autoplay mitigation toast (Task 8); SDK CDN URL (Task 1); rdqa reply-language acceptance (Task 10 acceptance criteria allow Chinese replies).
- ⚠️ §4.1 mentions repurposing `#toggle-avatar-mute-btn` for Azure volume — not in current tasks. Intentionally deferred: simply muting HeyGen video is sufficient for Phase 1; repurposing the button adds UI complexity that can wait until users actually request it.
- ✅ Acceptance #7 "git status verifies no source modification" — Task 10 Step 7 explicitly confirms.

No placeholders (TBD/TODO) anywhere except the placeholder cells in the test report template, which are explicitly meant to be filled at Task 10 run time.

Type consistency: `Config.get/set`, `AzureSpeaker.speak/testAll`, `detectLang`, `buildSSML` names are used identically across tasks. ✓
