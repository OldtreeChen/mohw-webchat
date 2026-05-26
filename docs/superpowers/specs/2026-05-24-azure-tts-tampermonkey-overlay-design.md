# Azure TTS Tampermonkey Overlay — Design Spec

**Date:** 2026-05-24
**Status:** Draft — pending user review
**Phase:** 1 (HeyGen-muted parallel playback). Phase 2 (HeyGen Lite mode lip-sync) deferred.

---

## 1. Goal

Provide multilingual Azure Neural TTS playback for the HeyGen-based virtual assistant on the Taiwan MOHW Long-Term Care (LTC) WebChat, **without modifying any existing source file** in the project. Delivered as a single Tampermonkey userscript that can be applied to:

- `https://ltcai.mohw.gov.tw/webchat/index.html` (production)
- `https://rdqa.qbiai.com/1120mohwwebchat/index.html` (QA, multi-language input detection enabled)
- Local copies at `C:\Claude\衛福部webchat\` (when served via local web server)

Supported languages for output speech:

| UI label | BCP-47 |
|---|---|
| 繁中 / 簡中 | zh-CN |
| English | en-US |
| 泰文 | th-TH |
| 印尼文 | id-ID |
| 越南文 | vi-VN |
| 日本語 | ja-JP |

## 2. Non-Goals

- Modifying any file under `common/`, `styles/`, `lib/`, or `index.html`. Zero source edits.
- HeyGen lip-sync against Azure audio. Lip will not match speech in Phase 1.
- Replacing input STT (Azure STT already present in original code; out of scope).
- Production deployment, signing, packaging as a Chrome extension.
- Server-side proxy / token endpoint. Subscription key is held in Tampermonkey's `GM_setValue` storage and used directly in browser.

## 3. Hard Constraint

**Absolute rule from user:** Do not edit any existing file in the project. The deliverable is a standalone `.user.js` whose only effects on the page are:

1. DOM injection (a floating settings button + modal + `<style>` block, all namespaced with `#azure-tts-*`).
2. Runtime monkey-patching of `window.Avatar.speakDirectMode` (and a few related methods).
3. Read/write to `GM_setValue` / `GM_getValue` for user config.

No source file in `C:\Claude\衛福部webchat\` may be created or modified, **except** files under `outscript/` (or similar) that hold the userscript itself.

## 4. Architecture

```
┌─── Tampermonkey loads azure-tts-for-ltc.user.js ───┐
│                                                     │
│  @match  https://ltcai.mohw.gov.tw/webchat/*        │
│  @match  https://rdqa.qbiai.com/1120mohwwebchat/*   │
│  @match  http://localhost/*                         │
│  @require Azure Speech SDK (UMD bundle from CDN)    │
│  @grant   GM_getValue, GM_setValue                  │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │ ConfigStore (GM storage wrapper)             │   │
│  │ LangDetector (Unicode-range heuristic)       │   │
│  │ SSMLBuilder                                  │   │
│  │ AzureSpeaker (SpeechSynthesizer wrapper)     │   │
│  │ SettingsPanel (FAB + modal injection)        │   │
│  │ AvatarPatcher (waits then monkey-patches)    │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                       │
                       ▼ runtime, no source edits
   ┌─────────────────────────────────────────────┐
   │ Page already loaded:                         │
   │   Avatar.speakDirectMode(text, messageId)    │
   │   Avatar.tryAutoUnmute(videoElement)         │
   │   #heygen-video element                      │
   │   #toggle-avatar-mute-btn                    │
   └─────────────────────────────────────────────┘
```

### 4.1 Components

#### ConfigStore
Thin wrapper around `GM_getValue` / `GM_setValue` with defaults:

```
{
  enabled: true,
  subscriptionKey: "",       // filled at runtime via settings panel
  region: "japaneast",
  voiceId: "zh-CN-XiaoxiaoMultilingualNeural",
  muteHeygen: true,
  verboseLog: false
}
```

The subscription key is never logged, never serialized to console, never written to any file. Only stored in Tampermonkey's encrypted GM storage.

#### LangDetector
Pure function `detectLang(text: string): BCP47Code`.

```js
function detectLang(text) {
  if (/[฀-๿]/.test(text)) return 'th-TH';
  if (/[぀-ゟ゠-ヿ]/.test(text)) return 'ja-JP';
  if (/[一-鿿]/.test(text)) return 'zh-CN';
  if (/[ăâđêôơưĂÂĐÊÔƠƯàáảãạèéẻẽẹìíỉĩị]/i.test(text)) return 'vi-VN';
  if (/\b(saya|kamu|anda|terima kasih|adalah|untuk|dengan|tidak|sudah|belum)\b/i.test(text)) return 'id-ID';
  return 'en-US';
}
```

Order matters: Thai → Japanese (kana) → Chinese (CJK without kana) → Vietnamese (Latin with diacritics) → Indonesian (Latin with feature words) → English fallback.

#### SSMLBuilder
```js
function buildSSML(text, lang, voiceId) {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">
    <voice name="${voiceId}">
      <lang xml:lang="${lang}">${escapeXml(text)}</lang>
    </voice>
  </speak>`;
}
```

`<lang xml:lang="...">` is the trigger that makes a Multilingual voice switch phonetics. Without it the voice would pronounce all languages with its default locale, producing nonsense for non-default languages.

#### AzureSpeaker
Wraps Microsoft Cognitive Services Speech SDK's `SpeechSynthesizer`:

- `init(config)` — creates `SpeechConfig.fromSubscription(key, region)`, sets output to default speaker.
- `speak(text)` — detect lang → build SSML → `synthesizer.speakSsmlAsync()` → returns a Promise resolving when playback ends.
- `testAll()` — used by the settings panel "Test Voice" button. Plays 6 sample phrases sequentially.

Audio output goes through the Speech SDK's `SpeakerAudioDestination`, which creates an `HTMLAudioElement` under the hood. We expose it via `azureTTS.currentAudio` for inspection.

#### SettingsPanel
- Floating action button `#azure-tts-fab` (gear icon, fixed bottom-right, z-index 10000).
- Modal `#azure-tts-panel` with: enable toggle, key input (type=password), region select, voice dropdown, mute-HeyGen toggle, verbose log toggle, Test Voice button, Save button.
- Style block injected once into `<head>`, all rules scoped to `#azure-tts-*`.
- Translations: panel labels in Chinese (matches site primary audience).

#### AvatarPatcher
1. Polls every 100ms (max 30 s) for `window.Avatar?.speakDirectMode`.
2. Once found, saves reference to original and replaces with wrapper.
3. Also patches `Avatar.tryAutoUnmute` to short-circuit when Azure is enabled (otherwise it forces video unmute).
4. Hooks `#toggle-avatar-mute-btn` click listener with capture-phase handler to repurpose it as Azure volume mute.

### 4.2 Patch Wrapper

```js
const originalSpeak = window.Avatar.speakDirectMode;
window.Avatar.speakDirectMode = async function (text, messageId) {
  if (!Config.enabled || !text?.trim()) {
    return originalSpeak.call(this, text, messageId);
  }
  try {
    // 1. Mute HeyGen audio output (keep video).
    const video = document.querySelector('#heygen-video');
    if (video && Config.muteHeygen) video.muted = true;

    // 2. Send a whitespace placeholder to original speakDirectMode so HeyGen
    //    still emits an eventId and downstream handelSpeechAndTextSyncQueue
    //    continues to advance. This reuses the pattern already present at
    //    WebChat.js:5345.
    const placeholderPromise = originalSpeak.call(this, ' ', messageId);

    // 3. Synthesize with Azure in parallel.
    await AzureSpeaker.speak(text);

    await placeholderPromise;
  } catch (err) {
    console.warn('[AzureTTS] Azure speak failed, falling back to HeyGen', err);
    return originalSpeak.call(this, text, messageId);
  }
};
```

### 4.3 Data Flow Per Reply

```
Bot reply text arrives (via Jocket socket)
   │
   ▼
WebChat.js renders message + calls Avatar.speakDirectMode(text, messageId)
   │
   ▼ (patched)
1. Check Azure enabled
2. Mute #heygen-video
3. Call original speakDirectMode with " "  ──▶ HeyGen emits eventId
                                                 (keeps WebChat sync queue happy)
4. LangDetector.detectLang(text)        ──▶ "th-TH" / "en-US" / ...
5. SSMLBuilder.build(text, lang, voice) ──▶ SSML string
6. AzureSpeaker.speak(ssml)              ──▶ <audio> playback
7. Await both → return
```

## 5. UX

### Settings Panel
- Gear FAB at `bottom: 16px; right: 16px; width: 48px; height: 48px;` round button with 🔊 icon.
- Click → expand modal centered on viewport, max-width 360px.
- Save button persists to `GM_setValue` and closes modal.
- Test Voice plays 6 sample sentences sequentially with a status line:
  - 中文：「您好，我是長照智慧助理」
  - English: "Hello, I am the LTC assistant."
  - ภาษาไทย: "สวัสดี ฉันเป็นผู้ช่วยดูแลระยะยาว"
  - Bahasa: "Halo, saya asisten perawatan jangka panjang."
  - Tiếng Việt: "Xin chào, tôi là trợ lý chăm sóc dài hạn."
  - 日本語: "こんにちは、長期介護のアシスタントです。"

### When patch is active
- HeyGen `<video>` plays muted; `#toggle-avatar-mute-btn` controls Azure volume instead.
- A small badge "Azure TTS ON" appears under the gear FAB.

## 6. Error Handling

| Failure | Behavior |
|---|---|
| `window.Avatar` never appears (timeout 30 s) | Log warning, leave FAB visible but disabled; user sees a tooltip "Avatar not detected". |
| Azure SDK fails to load from CDN | Settings panel shows error banner; `Config.enabled` forced to false; original HeyGen speech continues. |
| `speakSsmlAsync` returns error | Log error (key redacted), fall back to original `Avatar.speakDirectMode` for this utterance. |
| Empty / whitespace-only text | Skip Azure, call original with original args. |
| Subscription key missing | Test Voice + Save are disabled with helper text. Patch wrapper falls back to HeyGen until key is set. |
| Network failure mid-speech | Promise rejects; the message's audio is lost but the rest of the session continues. |

## 7. Testing Strategy

### Unit-ish (manual, in-script)
- `LangDetector` runs against a fixed dictionary of 24 sample sentences (4 per language) at script load when `verboseLog` is on; logs any mismatches.

### End-to-end (Chrome MCP run by Claude)
Test plan, executed against `https://rdqa.qbiai.com/1120mohwwebchat/index.html`:

```
Step 0  Navigate to rdqa URL, wait for ready
Step 1  Inject the userscript content via javascript_tool eval
        NOTE: When injected via DevTools (not Tampermonkey), GM_* APIs are not
        available. The userscript must include a dev-mode polyfill that maps
        GM_getValue/GM_setValue to window.localStorage when typeof GM_setValue
        === 'undefined'. The build is otherwise identical.
Step 2  Open settings panel, paste key + region, Save
Step 3  Click "Test Voice", capture timestamps of each playback
Step 4  For each of 6 languages:
        a. Type the standard "我想申請長照服務" translation into editor
        b. Send
        c. Wait for bot reply
        d. Record:
           - detected reply language
           - whether <audio> element played (currentTime > 0)
           - screenshot of conversation
           - console logs
Step 5  Produce a results table.
```

### Test Phrases (input)
| Lang | Input phrase |
|---|---|
| zh | 我想申請長照服務 |
| en | I want to apply for long-term care service |
| th | ฉันต้องการสมัครบริการดูแลระยะยาว |
| id | Saya ingin mendaftar layanan perawatan jangka panjang |
| vi | Tôi muốn đăng ký dịch vụ chăm sóc dài hạn |
| ja | 長期介護サービスに申し込みたいです |

### Acceptance Criteria
1. Userscript installs cleanly via Tampermonkey (no errors at script start).
2. Settings panel opens and persists values across page reloads.
3. Test Voice produces audible output in all 6 languages with correct phonetics.
4. For each of the 6 test phrases sent to the bot, Azure plays the bot's reply in the detected language. (If the bot replies in Chinese to non-Chinese input, Azure correctly identifies as `zh-CN` and uses Chinese phonetics — this is still a pass for the framework.)
5. Toggling "Enable Azure TTS" off in the panel restores original HeyGen audio without page reload.
6. No JavaScript errors appear in console from our script.
7. No modification to any file in `C:\Claude\衛福部webchat\` (verified via `git status`).

## 8. Deliverables

```
C:\Claude\衛福部webchat\
├── outscript/                                          (new directory)
│   ├── azure-tts-for-ltc.user.js                       (the userscript)
│   └── README.md                                       (install + usage instructions)
└── docs/superpowers/specs/
    └── 2026-05-24-azure-tts-tampermonkey-overlay-design.md   (this file)
```

Plus a test report (Markdown + 6 screenshots) appended to `outscript/README.md` after the live test run.

## 9. Open Risks

1. **Tampermonkey's `@require` & SDK ESM compat** — must use the UMD bundle URL `https://cdn.jsdelivr.net/npm/microsoft-cognitiveservices-speech-sdk/distrib/browser/microsoft.cognitiveservices.speech.sdk.bundle-min.js`. If CDN moves, script breaks.
2. **rdqa bot output language** — backend's reply language may not match input language (e.g., always replies in Chinese). This is a property of the bot, not our framework; framework will correctly handle whatever language it gets. The test acceptance criteria explicitly accounts for this.
3. **Auto-play policy** — first audio playback may be blocked by browsers requiring user gesture. The settings-panel Test Voice click satisfies the gesture; subsequent bot replies inherit the permission. If a user never opens the panel, first reply may be silent. **Mitigation**: on first `AvatarPatcher` activation, show a one-time toast `<div id="azure-tts-start-toast">` near the FAB with text "Click to enable Azure voice". Clicking it triggers a 0.1 s silent SSML `<break time="100ms"/>` to satisfy the autoplay gesture, then removes itself.
4. **HeyGen `tryAutoUnmute` race** — runs ~500 ms after session start. Our patch overrides it, but if user enables Azure mid-conversation we may double-unmute briefly. Acceptable for Phase 1.
5. **Site updates** — if AI3 changes the structure of `Avatar.speakDirectMode` signature, our patch needs an update. Mitigate with a defensive check on argument count and graceful fallback.

## 10. Phase 2 (Out of Scope, Documented for Continuity)

If the audio-without-lip-sync experience is unacceptable, the upgrade path is:
- Switch HeyGen account to **Lite Mode**.
- Replace `AzureSpeaker` output target from `SpeakerAudioDestination` to a LiveKit `LocalAudioTrack` publishing into the HeyGen Lite room.
- All other components (ConfigStore, LangDetector, SSMLBuilder, SettingsPanel) are reused verbatim.

This is documented here only so Phase 1 code structure preserves the seams (e.g., `AzureSpeaker.speak` returns a Promise; output destination is a constructor param, not hard-coded).
