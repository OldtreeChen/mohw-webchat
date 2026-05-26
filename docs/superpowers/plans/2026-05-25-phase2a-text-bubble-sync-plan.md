# Phase 2-A Text Bubble Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the host site's chat bubble show the bot's real reply text, revealed character-by-character in sync with Azure TTS playback. No source modification.

**Architecture:** Append four sections to the existing `outscript/azure-tts-for-ltc.user.js`: extend `AzureSpeaker` to capture Azure SDK `wordBoundary` and `synthesizing` events, add a `BubbleWriter` that schedules `setTimeout`-based DOM writes against the bubble's `.ChatMessageTextContent` element, add a `WebChatPatcher` that suppresses the whitespace placeholder entries from `WebChat.handelSpeechAndTextSyncQueue` (the entries that would otherwise overwrite our text with `' '`), and add a `RestartHook` to clear pending timers when the user restarts the conversation. The patched `Avatar.speakDirectMode` wrapper passes the boundary array and audio-start timestamp from `AzureSpeaker.speak()` to `BubbleWriter.schedule()`.

**Tech Stack:** Vanilla ES2017 inside the existing IIFE. Microsoft Cognitive Services Speech SDK 1.40.0 (`wordBoundary` and `synthesizing` callback hooks on `SpeechSynthesizer`). Plain DOM (`setTimeout`, `document.getElementById`, `textContent`). No new dependencies.

**Hard constraint reminder:** Do not edit any file in `C:\Claude\衛福部webchat\` outside `outscript/` and `docs/`. Skip all `git` steps (this directory is not a git repository).

**Predecessors:**
- Phase 1 design: `docs/superpowers/specs/2026-05-24-azure-tts-tampermonkey-overlay-design.md`
- Phase 1 plan: `docs/superpowers/plans/2026-05-24-azure-tts-tampermonkey-overlay-plan.md`
- Phase 2-A design: `docs/superpowers/specs/2026-05-25-phase2a-text-bubble-sync-design.md`

---

## File Structure

```
C:\Claude\衛福部webchat\
├── outscript\
│   ├── azure-tts-for-ltc.user.js          (MODIFY — append 4 sections, edit 2 existing)
│   └── README.md                           (MODIFY — append Phase 2-A notes + Phase 2-A test report)
└── docs\superpowers\
    ├── specs\2026-05-25-phase2a-text-bubble-sync-design.md   (already exists)
    └── plans\2026-05-25-phase2a-text-bubble-sync-plan.md     (this file)
```

The userscript is grown incrementally. Each task modifies a specific, clearly-marked region. Sentinel comments delimit sections (already present from Phase 1):

```js
// ============ ConfigStore ============
// ...
// ============ /ConfigStore ============
```

New sentinels added by this plan:
```js
// ============ BubbleWriter ============   (Phase 2-A)
// ============ WebChatPatcher ============ (Phase 2-A)
// ============ RestartHook ============    (Phase 2-A)
```

---

## Task 1: Add Phase 2-A config defaults + settings-panel rows

**Files:**
- Modify: `C:\Claude\衛福部webchat\outscript\azure-tts-for-ltc.user.js`
  - `ConfigDefaults` literal (currently 6 keys)
  - `injectPanel` innerHTML (HTML string)
  - The Save click handler inside `injectPanel`

- [ ] **Step 1: Extend ConfigDefaults.**

Find the `const ConfigDefaults = { ... };` block. Append the three new keys so the final block reads:

```js
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
```

- [ ] **Step 2: Add 2 new checkbox rows to the settings panel HTML.**

In `injectPanel`, find the `<div class="row">` block for `azure-tts-verbose` and add two more rows immediately after it (still inside the `panel.innerHTML = ...` template literal, before the `<div class="actions">` block):

```js
      + '<div class="row"><input type="checkbox" id="azure-tts-sync-text"><label for="azure-tts-sync-text" style="margin:0;">Sync text to chat bubble</label></div>'
      + '<div class="row"><input type="checkbox" id="azure-tts-boundary-debug"><label for="azure-tts-boundary-debug" style="margin:0;">Verbose word-boundary log</label></div>'
```

So the full section of `panel.innerHTML` covering those rows reads:

```js
      + '<div class="row"><input type="checkbox" id="azure-tts-mute"><label for="azure-tts-mute" style="margin:0;">Mute HeyGen audio</label></div>'
      + '<div class="row"><input type="checkbox" id="azure-tts-verbose"><label for="azure-tts-verbose" style="margin:0;">Verbose console log</label></div>'
      + '<div class="row"><input type="checkbox" id="azure-tts-sync-text"><label for="azure-tts-sync-text" style="margin:0;">Sync text to chat bubble</label></div>'
      + '<div class="row"><input type="checkbox" id="azure-tts-boundary-debug"><label for="azure-tts-boundary-debug" style="margin:0;">Verbose word-boundary log</label></div>'
      + '<div class="actions"><button class="secondary" id="azure-tts-test">Test Voice</button><button class="primary" id="azure-tts-save">Save</button></div>'
      + '<div class="status" id="azure-tts-status"></div>';
```

(Note `suppressPlaceholderQueueWrite` is intentionally NOT exposed in the panel UI — it's an internal emergency-disable accessible only via console: `__azureTTS.Config.set('suppressPlaceholderQueueWrite', false)`. Keeps the panel uncluttered.)

- [ ] **Step 3: Hydrate the two new checkboxes from Config at panel init.**

In `injectPanel`, just after the existing `panel.querySelector('#azure-tts-verbose').checked = Config.get('verboseLog');` line, add:

```js
    panel.querySelector('#azure-tts-sync-text').checked = Config.get('syncTextToBubble');
    panel.querySelector('#azure-tts-boundary-debug').checked = Config.get('boundaryDebug');
```

- [ ] **Step 4: Persist the two new checkboxes on Save.**

In the Save click handler inside `injectPanel`, after the existing `Config.set('verboseLog', ...)` line, add:

```js
      Config.set('syncTextToBubble', panel.querySelector('#azure-tts-sync-text').checked);
      Config.set('boundaryDebug', panel.querySelector('#azure-tts-boundary-debug').checked);
```

- [ ] **Step 5: Verify by re-injecting in DevTools.**

After reloading the page and re-injecting the script, run in console:

```js
window.__azureTTS.Config.all()
```

Expected output includes `syncTextToBubble: true`, `suppressPlaceholderQueueWrite: true`, `boundaryDebug: false`. Open the settings panel — see the two new checkboxes, both ticked (sync) / unticked (boundary debug) by default.

---

## Task 2: Extend AzureSpeaker to capture wordBoundary + synthesizing events

**Files:**
- Modify: `C:\Claude\衛福部webchat\outscript\azure-tts-for-ltc.user.js`
  - `AzureSpeaker._doSpeak` (currently in ~lines 206-232)
  - `AzureSpeaker.speak` (currently in ~lines 198-204)

- [ ] **Step 1: Update `speak()` to forward callbacks.**

Find the existing `speak(text)` method and replace its body so it accepts an optional second argument:

```js
    speak(text, callbacks) {
      const next = this._speakChain.catch(() => {}).then(() => this._doSpeak(text, callbacks));
      this._speakChain = next;
      return next;
    },
```

- [ ] **Step 2: Rewrite `_doSpeak()` to capture events.**

Replace the entire `_doSpeak(text)` function with this expanded version:

```js
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
```

- [ ] **Step 3: Update `testAll()` and the toast warmup are not callers that pass callbacks — verify they still work.**

`testAll()` calls `this.speak(text)` with one argument — the new signature defaults `callbacks` to `undefined`, then `_doSpeak` defaults it to `{}`. Same for the toast warmup which calls `synth.speakSsmlAsync` directly bypassing our chain.

No change needed to `testAll` or `showStartToast` code.

- [ ] **Step 4: Sanity check via DevTools.**

After re-injecting the script, in DevTools console:

```js
await window.__azureTTS.AzureSpeaker.speak('您好測試一二三', {
  onBoundary: (b) => console.log('GOT BOUNDARY', b),
  onAudioStart: (ts) => console.log('AUDIO START at', ts),
});
```

Expected:
- Console shows one `AUDIO START at <number>` line.
- Console shows multiple `GOT BOUNDARY {...}` lines, each with `audioOffsetMs`, `textOffset`, `wordLength`, `boundaryType`, `text`.
- The returned object contains `boundaries: [...]` (non-empty) and `firstAudioTs: <number>`.

If `boundaries` is empty for CJK text, check the SDK version (must be 1.40.0+; verify `SpeechSDK.SpeechConfig` exists and works as in Phase 1).

---

## Task 3: Add BubbleWriter section

**Files:**
- Modify: `C:\Claude\衛福部webchat\outscript\azure-tts-for-ltc.user.js`
  - Insert a new `BubbleWriter` section **immediately before** the `// ============ SettingsPanel ============` line.

- [ ] **Step 1: Insert the BubbleWriter section.**

Add this block right before the existing SettingsPanel sentinel:

```js
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

```

- [ ] **Step 2: Sanity check by simulating a call in DevTools.**

After re-injecting, set up a detached test bubble and verify:

```js
// Create a fake bubble fixture in the DOM
const fixture = document.createElement('div');
fixture.id = 'ChatMessage_TEST';
fixture.innerHTML = '<div class="ChatMessageTextContent"></div>';
document.body.appendChild(fixture);

// Re-export BubbleWriter via debug handle (already exposed if running test-injection variant)
// The production userscript closes over it, so we use a synthetic test:
window.__azureTTS.AzureSpeaker.speak('您好測試', {
  onBoundary: (b) => console.log('B', b),
}).then(r => {
  // Manually replay the schedule
  // (BubbleWriter is closure-private; test by triggering the real flow instead)
  console.log('full result', r);
});

// Then send a real chat message and watch the bubble fill in via the patched
// speakDirectMode path (this is the real integration test in Task 5).
fixture.remove();
```

This is a smoke test only — the real assertion happens in Task 5 once `BubbleWriter.schedule` is wired into the patched `speakDirectMode`.

---

## Task 4: Add WebChatPatcher section (suppress placeholder writes)

**Files:**
- Modify: `C:\Claude\衛福部webchat\outscript\azure-tts-for-ltc.user.js`
  - Insert a new `WebChatPatcher` section **immediately before** the `// ============ AvatarPatcher ============` line.

- [ ] **Step 1: Insert the WebChatPatcher section.**

```js
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

```

- [ ] **Step 2: Hook patchWebChat into the existing bootstrap (in AvatarPatcher section).**

Find the existing bootstrap at the bottom of the AvatarPatcher section:

```js
  waitForAvatar()
    .then(patchAvatar)
    .catch((err) => console.warn('[AzureTTS]', err.message, '— patch skipped.'));
```

Replace it with:

```js
  waitForAvatar()
    .then(patchAvatar)
    .catch((err) => console.warn('[AzureTTS]', err.message, '— Avatar patch skipped.'));

  waitForWebChat()
    .then((wc) => { if (wc) patchWebChat(); else console.warn('[AzureTTS] WebChat patch skipped — handelSpeechAndTextSyncQueue not detected.'); });
```

- [ ] **Step 3: Verify in DevTools.**

After re-injecting on the rdqa URL, expect console line:

```
[AzureTTS] WebChat.handelSpeechAndTextSyncQueue patched
```

Then in console:

```js
window.WebChat.__azureTtsSyncPatched
```

Expected: `true`.

---

## Task 5: Wire BubbleWriter into the patched speakDirectMode + add RestartHook

**Files:**
- Modify: `C:\Claude\衛福部webchat\outscript\azure-tts-for-ltc.user.js`
  - The patched `Avatar.speakDirectMode` function inside `patchAvatar` (currently in ~lines 461-490)
  - Add `RestartHook` (new section just before the `waitForAvatar()` bootstrap)

- [ ] **Step 1: Replace the patched `Avatar.speakDirectMode` body so it threads boundaries into BubbleWriter.**

Inside `patchAvatar(Avatar)`, locate the assignment `Avatar.speakDirectMode = async function (text, messageId) { ... }` and replace its body:

```js
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
```

- [ ] **Step 2: Add RestartHook section.**

Insert a new section **immediately before** the `waitForAvatar()` bootstrap call at the bottom of the AvatarPatcher block (which now has `waitForWebChat` next to it from Task 4):

```js
  // ============ RestartHook ============
  function hookRestart() {
    const btn = document.getElementById('RestartChatButton');
    if (!btn) return false;
    if (btn.__azureTtsHooked) return true;
    btn.__azureTtsHooked = true;
    btn.addEventListener('click', () => {
      if (Config.get('boundaryDebug')) console.log('[AzureTTS] RestartChatButton clicked — clearing BubbleWriter timers');
      BubbleWriter.clearAll();
    }, { capture: true });
    return true;
  }

  function waitForRestartButton(timeoutMs) {
    if (timeoutMs == null) timeoutMs = AVATAR_TIMEOUT_MS;
    return new Promise((resolve) => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (document.getElementById('RestartChatButton')) {
          clearInterval(timer);
          resolve(true);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          resolve(false);
        }
      }, POLL_MS);
    });
  }
  // ============ /RestartHook ============

```

- [ ] **Step 3: Wire hookRestart into the bootstrap.**

Just below the `waitForWebChat()` block you added in Task 4 Step 2, add:

```js
  waitForRestartButton()
    .then((ok) => { if (ok) hookRestart(); });
```

So the bottom of the AvatarPatcher region now reads (in order):

```js
  waitForAvatar()
    .then(patchAvatar)
    .catch((err) => console.warn('[AzureTTS]', err.message, '— Avatar patch skipped.'));

  waitForWebChat()
    .then((wc) => { if (wc) patchWebChat(); else console.warn('[AzureTTS] WebChat patch skipped — handelSpeechAndTextSyncQueue not detected.'); });

  waitForRestartButton()
    .then((ok) => { if (ok) hookRestart(); });
```

- [ ] **Step 4: Integration smoke test in DevTools (rdqa URL).**

Re-inject the script. Expect console:
```
[AzureTTS] userscript loaded, version 0.1.0
[AzureTTS] Config loaded: { ... }
[AzureTTS] LangDetector self-test PASSED (24/24)
[AzureTTS] Avatar.speakDirectMode patched
[AzureTTS] WebChat.handelSpeechAndTextSyncQueue patched
```

Then send a Chinese phrase via the chat editor:

```js
const editor = document.getElementById('Editor');
const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
setter.call(editor, '我想申請長照服務');
editor.dispatchEvent(new Event('input', { bubbles: true }));
document.getElementById('SendButton').click();
```

Expected within ~10 s:
- New bubble appears in `#MessageList`.
- Bubble's `.ChatMessageTextContent` is initially empty, then fills character-by-character as Azure speaks.
- Console contains (with `boundaryDebug` enabled): one line `[AzureTTS] suppressed whitespace queue entry { ... }` per chunk.
- After Azure finishes, bubble.textContent matches the spoken bot reply.

If the bubble stays empty: check `Config.get('syncTextToBubble')` is true and look for `[BubbleWriter] bubble not found` or `.ChatMessageTextContent not found` warnings in console (enable `boundaryDebug` first).

- [ ] **Step 5: Restart-hook smoke test.**

Click the chat panel's "重啟交談" button (id `RestartChatButton`). With `boundaryDebug` on, expect console:
```
[AzureTTS] RestartChatButton clicked — clearing BubbleWriter timers
```

Then send a fresh message and confirm the new bubble fills as expected (no leak from previous timers).

---

## Task 6: Update README with Phase 2-A notes

**Files:**
- Modify: `C:\Claude\衛福部webchat\outscript\README.md`

- [ ] **Step 1: Replace the "Known limitations" section.**

Find this exact section:

```markdown
- **Visible text bubble in the chat panel renders empty.** The host site's `handelSpeechAndTextSyncQueue` pairs the bot reply text with the eventId returned by HeyGen. Because our patch sends a single whitespace to HeyGen (to keep the queue advancing) instead of the real text, the queue sees `' '` for each chunk and the bubble's `.ChatMessageTextContent` ends up empty. **The Azure audio plays correctly with the full text — only the visible transcript is missing.** A future improvement would call `WebChat.handelSpeechAndTextSyncQueue` directly with the real text so the bubble populates.
```

Replace with:

```markdown
- **Visible text bubble** — *resolved in Phase 2-A* via `BubbleWriter` + `WebChatPatcher`. Bot reply text now appears in the chat bubble, synchronized character-by-character with Azure TTS playback using the SDK's `wordBoundary` events. To disable Phase 2-A and revert to the Phase 1 empty-bubble behavior, uncheck "Sync text to chat bubble" in the settings panel. If a stall is observed (very unlikely), open DevTools console and run `window.__azureTTS && __azureTTS.Config.set('suppressPlaceholderQueueWrite', false)` to fall back to the flicker-mode where HeyGen briefly writes `' '` before our timers overwrite.
```

- [ ] **Step 2: Append a Phase 2-A test report placeholder.**

After the existing Phase 1 test report (at the bottom of README.md), append:

```markdown

---

## Phase 2-A Test Report

**Run date:** _(filled by Task 7)_
**Goal verified:** Bubble fills with bot reply text, synced to Azure TTS playback.

### Pre-flight (Phase 1 regression)
| Test | Result |
|---|---|
| LangDetector 24 fixtures | _(pending)_ |
| `testAll()` 6 samples | _(pending)_ |

### Phase 2-A targeted tests

| # | Scenario | Bubble shows text | Sync looks correct | Notes |
|---|---|---|---|---|
| 1 | Send 中文 "我想申請長照服務", observe bubble | _(pending)_ | _(pending)_ | |
| 2 | Send 英文 "I want to apply for long-term care service" | _(pending)_ | _(pending)_ | |
| 3 | Send 日文 "長期介護サービスに申し込みたいです" | _(pending)_ | _(pending)_ | |
| 4 | Toggle "Sync text to chat bubble" OFF, send a phrase | _(pending)_ | n/a | should be empty bubble (Phase 1 behavior) |
| 5 | Click "重啟交談" mid-stream, confirm no timer leak | _(pending)_ | n/a | console log shows clearAll |
| 6 | Set `suppressPlaceholderQueueWrite=false` via console, observe flicker mode | _(pending)_ | _(pending)_ | brief ' ' flash acceptable |

### Verification: no source modification
_(filled by Task 7)_
```

- [ ] **Step 3: No additional changes to the rest of README.**

Skip git commit step (no repo).

---

## Task 7: End-to-end Chrome MCP test (controller-executed, not a subagent task)

**Files:**
- Modify: `C:\Claude\衛福部webchat\outscript\README.md` — fill the Phase 2-A test report

This task is **executed by the controller** (the agent driving subagent execution). A subagent does not run this task because it requires Chrome MCP access.

- [ ] **Step 1: Navigate to rdqa.**

Use `mcp__Claude_in_Chrome__navigate` to open `https://rdqa.qbiai.com/1120mohwwebchat/index.html`. Wait until `window.Avatar?.speakDirectMode` is a function and `window.WebChat?.handelSpeechAndTextSyncQueue` is a function (poll for both).

- [ ] **Step 2: Load Azure SDK then inject the updated userscript body.**

Read the current `outscript/azure-tts-for-ltc.user.js`, strip the `// ==UserScript==` header block (DevTools doesn't parse it), and execute the IIFE body via `mcp__Claude_in_Chrome__javascript_tool`. Confirm console log:

```
[AzureTTS] userscript loaded, version 0.1.0
[AzureTTS] Config loaded: { ... }
[AzureTTS] LangDetector self-test PASSED (24/24)
[AzureTTS] Avatar.speakDirectMode patched
[AzureTTS] WebChat.handelSpeechAndTextSyncQueue patched
```

- [ ] **Step 3: Configure and enable `boundaryDebug` for diagnosis.**

```js
window.__azureTTS.Config.set('subscriptionKey', '<paste key>');
window.__azureTTS.Config.set('region', 'japaneast');
window.__azureTTS.Config.set('boundaryDebug', true);
window.__azureTTS.Config.set('syncTextToBubble', true);
window.__azureTTS.Config.set('suppressPlaceholderQueueWrite', true);
```

(The Phase 1 testing infrastructure already exposes `window.__azureTTS` as a debug handle when running via injection rather than Tampermonkey. If Phase 2-A removed it, re-add at the end of the IIFE: `window.__azureTTS = { Config, AzureSpeaker, detectLang, buildSSML, LANG_FIXTURES, BubbleWriter };`)

- [ ] **Step 4: Warmup gesture.**

```js
await window.__azureTTS.AzureSpeaker.speak('warmup');
```

Expect `{ lang: 'en-US', durationMs: ~1300, boundaries: [...], firstAudioTs: <number> }`. The new `boundaries` and `firstAudioTs` fields confirm Phase 2-A AzureSpeaker extension landed.

- [ ] **Step 5: Run Phase 1 regression — testAll.**

```js
await window.__azureTTS.AzureSpeaker.testAll();
```

Expect 6/6 ok=true. Record in the README test report.

- [ ] **Step 6: For each of 3 languages (zh, en, ja), send phrase and observe bubble.**

For zh: "我想申請長照服務"; en: "I want to apply for long-term care service"; ja: "長期介護サービスに申し込みたいです".

For each phrase:
1. Set Editor.value via the native setter + dispatch input event, click SendButton (see Phase 1 test helper pattern).
2. Wait for new ChatMessage left-bubble to appear in MessageList.
3. Sample `bubble.querySelector('.ChatMessageTextContent').textContent.length` every 500 ms for ~15 s, recording the growth curve.
4. Screenshot at end.
5. Record in the README test report: did text appear? Did it grow over time (not all-at-once)?

If the bot's idle timeout kicks in mid-test, click "重啟交談" and resume.

- [ ] **Step 7: Toggle test — sync OFF.**

```js
window.__azureTTS.Config.set('syncTextToBubble', false);
```

Send another phrase, confirm the bubble stays empty (Phase 1 behavior), then toggle back on:

```js
window.__azureTTS.Config.set('syncTextToBubble', true);
```

- [ ] **Step 8: Toggle test — placeholder suppression OFF (flicker mode).**

```js
window.__azureTTS.Config.set('suppressPlaceholderQueueWrite', false);
```

Send another phrase, observe: bubble briefly shows ' ' then overwrites with real text. Acceptable. Toggle back on:

```js
window.__azureTTS.Config.set('suppressPlaceholderQueueWrite', true);
```

- [ ] **Step 9: Restart test.**

Click `#RestartChatButton`, observe console line:

```
[AzureTTS] RestartChatButton clicked — clearing BubbleWriter timers
```

Send a new phrase, confirm new bubble fills normally.

- [ ] **Step 10: Verify no source modification.**

In Bash:

```
Glob '**/*' under C:\Claude\衛福部webchat\ excluding outscript/ and docs/ — confirm mtimes are all 2026-05-17/18 (the original repo timestamps).
```

- [ ] **Step 11: Fill the Phase 2-A test report in README.**

Replace the `_(pending)_` placeholders in the test report table with actual results. Add at the bottom:

```markdown
### Verification: no source modification
Confirmed: only `outscript/azure-tts-for-ltc.user.js`, `outscript/README.md`, and the new spec/plan files under `docs/` were modified during Phase 2-A development and testing. All other directories (`common/`, `lib/`, `styles/`, `image/`, `deploy/`, root-level HTML files) retain their original 2026-05-17/18 modification times.

### Verdict
_(filled with PASS / PASS WITH NOTES / FAIL based on above)_
```

- [ ] **Step 12: Done.**

Report to user: paths to the updated userscript and README, summary of test results, any anomalies.

---

## Self-Review

### Spec coverage check

- ✅ Spec §4.1 components: ConfigStore extension (Task 1), AzureSpeaker extension (Task 2), BubbleWriter (Task 3), WebChatPatcher (Task 4), RestartHook (Task 5).
- ✅ Spec §4.2 new config keys: `syncTextToBubble`, `suppressPlaceholderQueueWrite`, `boundaryDebug` — all in Task 1 Step 1.
- ✅ Spec §4.3 data flow per chunk — implemented in Task 5 Step 1.
- ✅ Spec §4.4 AzureSpeaker extension — Task 2.
- ✅ Spec §4.5 BubbleWriter — Task 3.
- ✅ Spec §4.6 WebChatPatcher — Task 4.
- ✅ Spec §4.7 conservative fallback — `suppressPlaceholderQueueWrite` flag set up in Task 1, can be toggled in Task 7 Step 8.
- ✅ Spec §4.8 RestartHook — Task 5 Step 2-3.
- ✅ Spec §5 UX — settings panel rows in Task 1; UX visible in Task 7.
- ✅ Spec §6 error handling — each error path implemented in BubbleWriter/WebChatPatcher (Tasks 3-4) and verified in Task 7.
- ✅ Spec §7 testing — Phase 1 regression in Task 7 Step 5, Phase 2-A targeted tests in Task 7 Steps 6-9.
- ✅ Spec §8 acceptance criteria — covered by Task 7 test plan.
- ✅ Spec §9 open risks — Risk 1 (queue side effects) mitigated by feature flag in Task 1 + flicker-mode test in Task 7 Step 8. Other risks (CJK granularity, audio start timing, DOM selector fragility, concurrent chunks, setTimeout drift) addressed in code (graceful fallbacks) and via the test plan.

No gaps.

### Placeholder scan

- No "TBD" or "implement later" markers in task content (the `_(pending)_` markers in the README test report template are intentional fixtures filled at runtime).
- All code blocks are complete and self-contained.
- All sentinels and section names are spelled identically across tasks.

### Type consistency

- `Config.get/set`, `AzureSpeaker.speak/_doSpeak/testAll`, `BubbleWriter.schedule/clearMessage/clearAll`, `patchWebChat`, `waitForWebChat`, `hookRestart`, `waitForRestartButton`, `detectLang`, `buildSSML`, `escapeXml` — all names used identically across tasks. ✓
- `boundaries` array element shape `{audioOffsetMs, textOffset, wordLength, boundaryType, text}` is consistent between Task 2 and Task 3. ✓
- Return shape of `AzureSpeaker.speak`: `{lang, durationMs, boundaries, firstAudioTs}` — defined in Task 2 Step 2, consumed in Task 5 Step 1. ✓

No issues.
