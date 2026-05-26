# Phase 2-A — Text Bubble Sync — Design Spec

**Date:** 2026-05-25
**Status:** Draft — pending user review
**Phase:** 2-A (chat bubble shows real bot text, synced to Azure TTS word-by-word). Phase 2-B (HeyGen Lite Mode lip-sync) is a separate cycle.
**Predecessor:** [Phase 1 design](2026-05-24-azure-tts-tampermonkey-overlay-design.md), [Phase 1 plan](../plans/2026-05-24-azure-tts-tampermonkey-overlay-plan.md).

---

## 1. Goal

Make the host site's chat bubble display the bot's actual reply text, **synchronized with Azure TTS playback**, while continuing to honor the Phase 1 hard rule: do not modify any existing project file. The Phase 1 framework currently leaves the bubble empty (only timestamp visible) because the whitespace-placeholder pattern feeds `' '` into the host's `handelSpeechAndTextSyncQueue`, so the queue writes `' '` to the bubble's `.ChatMessageTextContent`.

## 2. Non-Goals

- HeyGen lip-sync against Azure audio — Phase 2-B.
- Translating bot replies — out of scope (host bot's NLU controls reply language).
- Editing any file under `common/`, `lib/`, `styles/`, `image/`, `deploy/`, or any root-level HTML. **Same hard rule as Phase 1.**
- New deliverable files. **All Phase 2-A code is appended to the existing `outscript/azure-tts-for-ltc.user.js`.**
- A separate Chrome extension. Still Tampermonkey-only.

## 3. Hard Constraints

1. **Zero source modification.** Inherited from Phase 1.
2. **Same file.** No new `.user.js`. Append sections to `outscript/azure-tts-for-ltc.user.js`.
3. **No breakage of Phase 1.** Azure TTS playback in 6 languages must continue to pass the existing self-test. New code is purely additive.
4. **Feature flag.** A `syncTextToBubble` config flag (default `true`) lets the user disable Phase 2-A without uninstalling, falling back to Phase 1 behavior (empty bubble + Azure audio).

## 4. Architecture

### 4.1 Component overview

```
[Phase 1 — unchanged surface]                [Phase 2-A — new / extended]

AzureSpeaker.speak(text)            ────────▶ Augmented: accepts optional callbacks
   │                                              { onBoundary(b), onAudioStart(ts) }
   │ wordBoundary event collection             Returns { lang, durationMs, boundaries, firstAudioTs }
   │ synthesizing event capture                
   │
AvatarPatcher.speakDirectMode wrapper ──────▶ Calls BubbleWriter.schedule(...)
   │                                              after Azure.speak resolves
   │
                                            BubbleWriter (NEW)
                                              ├─ schedule(messageId, chunkText, boundaries, audioStartTs)
                                              ├─ writeBubble(messageId, fullText)
                                              ├─ clearMessage(messageId)
                                              └─ clearAll()

                                            WebChatPatcher (NEW)
                                              └─ patches WebChat.handelSpeechAndTextSyncQueue
                                                  to skip whitespace-only entries
                                                  (prevents the ' ' placeholder from clobbering
                                                   our text writes)

                                            RestartHook (NEW, minimal)
                                              └─ hooks the "重啟交談" button click to
                                                  call BubbleWriter.clearAll()
```

### 4.2 New / extended config

Append to `ConfigDefaults`:

```js
syncTextToBubble: true,                  // master switch for Phase 2-A
suppressPlaceholderQueueWrite: true,     // skip ' ' entries in handelSpeechAndTextSyncQueue (default safe path)
boundaryDebug: false,                    // when true, log every wordBoundary to console for diagnosis
```

Add a checkbox to the SettingsPanel:

- "Sync text to chat bubble" (bound to `syncTextToBubble`)
- "Verbose word-boundary log" (bound to `boundaryDebug`)

### 4.3 Data flow per chunk

```
WebChat.js calls Avatar.speakDirectMode(text, messageId)
   │ (text = a streamed chunk of the bot reply; messageId = the bubble's DOM id)
   ▼
[Phase 1 patched wrapper, now extended]

1. Mute #heygen-video                                                  (Phase 1)
2. originalSpeak(' ', messageId) → fires & later writes ' ' to queue   (Phase 1)
   (WebChatPatcher will intercept the queue write, see 4.6)
3. boundaries = []
4. AzureSpeaker.speak(text, {
       onBoundary: (b) => boundaries.push(b),    // already collected inside SDK call
       onAudioStart: (ts) => audioStartTs = ts,
   })
5. After Azure resolve: BubbleWriter.schedule(messageId, text, boundaries, audioStartTs)
6. return await originalSpeak's promise                                (Phase 1)
```

### 4.4 AzureSpeaker extension (wordBoundary + synthesizing capture)

The Microsoft Cognitive Services Speech SDK exposes two relevant callback-style hooks on `SpeechSynthesizer`:

- `synthesizer.wordBoundary` — fired per word boundary (CJK: per character; punctuation: per punctuation mark).
- `synthesizer.synthesizing` — fired as audio bytes are produced; the first fire approximates when playback begins (the default `SpeakerAudioDestination` plays as bytes stream).

The event payload exposes (Microsoft.CognitiveServices.Speech.SpeechSynthesisWordBoundaryEventArgs):

- `audioOffset` — in 100-ns ticks (divide by 10 000 → milliseconds)
- `textOffset` — character offset within the original SSML's text content
- `wordLength` — length of this word
- `boundaryType` — `'WordBoundary' | 'PunctuationBoundary' | 'SentenceBoundary'`
- `text` — the word string

Extended `_doSpeak`:

```js
_doSpeak(text, callbacks = {}) {
  return new Promise((resolve, reject) => {
    let synth;
    try { synth = this._ensureSynth(); }
    catch (e) { return reject(e); }

    const lang = detectLang(text);
    const voiceId = Config.get('voiceId');
    const ssml = buildSSML(text, lang, voiceId);

    const boundaries = [];
    let firstAudioTs = null;

    synth.wordBoundary = (s, e) => {
      const b = {
        audioOffsetMs: e.audioOffset / 10000,
        textOffset: e.textOffset,
        wordLength: e.wordLength,
        boundaryType: e.boundaryType,
        text: e.text,
      };
      boundaries.push(b);
      if (Config.get('boundaryDebug')) console.log('[AzureTTS][boundary]', b);
      if (callbacks.onBoundary) callbacks.onBoundary(b);
    };
    synth.synthesizing = (s, e) => {
      if (firstAudioTs === null) {
        firstAudioTs = performance.now();
        if (callbacks.onAudioStart) callbacks.onAudioStart(firstAudioTs);
      }
    };

    const cleanup = () => {
      synth.wordBoundary = undefined;
      synth.synthesizing = undefined;
    };

    synth.speakSsmlAsync(ssml,
      (result) => {
        cleanup();
        if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
          resolve({ lang, durationMs: result.audioDuration / 10000, boundaries, firstAudioTs });
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
}
```

`speak(text, callbacks)` updates to forward `callbacks` to `_doSpeak`, preserving the serialization chain.

**Phase 1 backward compatibility:** existing callers like `testAll()` and the toast warmup do not pass `callbacks` — defaults to `{}`, no behavior change. The return value shape gains `boundaries` and `firstAudioTs`, which Phase 1 callers ignore.

### 4.5 BubbleWriter (DOM write scheduler)

State machine per `messageId`:

```js
{
  revealedBase: string,  // text already shown from previous chunks
  timers: number[],      // pending setTimeout ids for this bubble
}
```

Operations:

```js
const BubbleWriter = {
  _state: new Map(),

  schedule(messageId, chunkText, boundaries, audioStartTs) {
    if (!messageId || !chunkText) return;
    const bubble = document.getElementById(messageId);
    if (!bubble) return;
    const el = bubble.querySelector('.ChatMessageTextContent');
    if (!el) return;

    let state = this._state.get(messageId);
    if (!state) {
      state = { revealedBase: '', timers: [] };
      this._state.set(messageId, state);
    }
    const base = state.revealedBase;
    const writeUpTo = (targetText) => {
      // Monotonic: only grow, never shrink. Guards against ' '-placeholder
      // races or out-of-order timer fires.
      if (el.textContent.length < targetText.length) {
        el.textContent = targetText;
      }
    };

    // Schedule one DOM write per boundary, at audioStartTs + b.audioOffsetMs.
    const nowOffset = performance.now();
    for (const b of boundaries) {
      const cutPos = b.textOffset + b.wordLength;
      const visible = base + chunkText.slice(0, cutPos);
      const delay = Math.max(0, (audioStartTs + b.audioOffsetMs) - nowOffset);
      state.timers.push(setTimeout(() => writeUpTo(visible), delay));
    }

    // Tail timer: 200ms after the last boundary, write the full chunk (covers
    // sentence punctuation, late boundaries, or no-boundary edge cases).
    const lastOffset = boundaries.length
      ? boundaries[boundaries.length - 1].audioOffsetMs
      : 0;
    const tailDelay = Math.max(0, (audioStartTs + lastOffset + 200) - nowOffset);
    state.timers.push(setTimeout(() => {
      const full = base + chunkText;
      writeUpTo(full);
      state.revealedBase = full;   // commit base for the next chunk
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
```

Why monotonic writes: if HeyGen's `' '` write from the placeholder reaches the bubble between our scheduled writes, `el.textContent.length < targetText.length` ensures the next scheduled write replaces the `' '` with the real growing text. Without monotonicity we'd risk flicker.

### 4.6 WebChatPatcher (suppress placeholder write)

The host's `WebChat.handelSpeechAndTextSyncQueue({eventId, messageId, text})` is the function that writes `text` to the bubble when HeyGen reports the `eventId` completed. We feed it `text: ' '` from the Phase 1 placeholder. To prevent the `' '` from racing with our writes, we suppress whitespace-only entries when Azure TTS is enabled.

```js
function patchWebChat() {
  if (!window.WebChat || typeof window.WebChat.handelSpeechAndTextSyncQueue !== 'function') return;
  if (window.WebChat.__azureTtsSyncPatched) return;
  window.WebChat.__azureTtsSyncPatched = true;

  const original = window.WebChat.handelSpeechAndTextSyncQueue.bind(window.WebChat);
  window.WebChat.handelSpeechAndTextSyncQueue = function (entry) {
    if (
      Config.get('enabled') &&
      Config.get('subscriptionKey') &&
      Config.get('syncTextToBubble') &&
      entry && typeof entry.text === 'string' && entry.text.trim() === ''
    ) {
      // Skip. We do not want the ' ' placeholder written to the bubble.
      // The queue's internal eventId bookkeeping happens elsewhere in
      // WebChat's HeyGen listeners — observation in Phase 1 testing showed
      // that skipping ' ' entries did not stall the conversation flow.
      return;
    }
    return original(entry);
  };
}
```

**Risk acknowledged in the design (Section 4 user discussion):** if `handelSpeechAndTextSyncQueue` performs other state-mutating side effects beyond writing text (e.g., tracking pending eventIds, advancing speech queue cursors), suppressing whitespace entries could stall later messages. This is the **primary risk** of Phase 2-A.

**Mitigation:**

1. Behavior verified during testing — run the standard 6-language end-to-end test. If a stall is observed, immediately revert to the conservative fallback (see 4.7).
2. The skip is gated on `syncTextToBubble === true` — toggling the setting OFF instantly restores Phase 1 behavior with no reload.

### 4.7 Conservative Fallback (kept ready in code, default off)

If testing reveals that suppressing `' '` entries breaks anything, swap `patchWebChat` to a no-op (do not patch). BubbleWriter's monotonic `writeUpTo` already overpowers a single `' '` write because our timers fire many times, with each write replacing the bubble's content with the longer text. The fallback path's only downside is a brief visible flicker as `' '` momentarily appears before the next BubbleWriter timer overwrites it (~50-200 ms).

Switch via a Config flag `suppressPlaceholderQueueWrite` (default `true`, can be flipped in panel if needed). For Phase 2-A v1 we ship with this flag `true` and instrument the toggle for emergency disable.

### 4.8 RestartHook

When the user clicks "重啟交談" (`#RestartChatButton`), bubble DOM is cleared and message ids restart. Any pending BubbleWriter timers should be canceled.

```js
function hookRestart() {
  const btn = document.getElementById('RestartChatButton');
  if (!btn || btn.__azureTtsHooked) return;
  btn.__azureTtsHooked = true;
  btn.addEventListener('click', () => BubbleWriter.clearAll(), { capture: true });
}
```

`hookRestart` runs in the same poll loop as `waitForAvatar` (RestartChatButton appears at load).

## 5. UX

### 5.1 What the user sees

1. Bot reply arrives → bubble appears, initially empty (timestamp only).
2. ~100-300 ms later (Azure synth latency): first character/word appears in the bubble.
3. As Azure plays each character/word, text reveals at the same rate.
4. End-of-chunk: full chunk text fixed in bubble.
5. If multiple chunks, chunk 2's text appends to chunk 1's text, continuing the typewriter.

### 5.2 Settings panel additions

- New row: ☑ Sync text to chat bubble — bound to `syncTextToBubble`.
- New row: ☐ Verbose word-boundary log — bound to `boundaryDebug`.

### 5.3 When `syncTextToBubble = false`

- Phase 1 behavior: bubble empty (timestamp only), Azure audio plays normally.
- Useful for users who only want audio and find typewriter distracting.

## 6. Error Handling

| Failure | Behavior |
|---|---|
| `messageId` parameter is null/empty | `BubbleWriter.schedule` early-return (no-op) |
| `document.getElementById(messageId)` returns null (bubble removed) | early-return (no-op) |
| `.ChatMessageTextContent` selector misses (host DOM changed) | early-return; logs warning if `boundaryDebug` is on |
| Azure synth fails | Phase 1 fallback (call original speakDirectMode again). BubbleWriter not invoked. |
| wordBoundary fires zero times for a chunk (very short text / pure punctuation) | Tail timer at `audioStartTs + 200ms` writes the full chunk |
| `audioStartTs` never set (no `synthesizing` event fired) | Use `performance.now()` at schedule time as fallback origin |
| Multiple `setTimeout` calls for overlapping audio (two chunks back-to-back) | Serialization in `_speakChain` ensures chunk 2 starts after chunk 1 settles |
| WebChat object never appears | `patchWebChat` simply doesn't patch; Phase 1 behavior applies |
| User clicks "重啟交談" mid-stream | `clearAll()` cancels all pending timers; new bubbles start fresh |
| `handelSpeechAndTextSyncQueue` skip causes stall (mitigation risk) | User toggles `suppressPlaceholderQueueWrite` off; flicker mode resumes |

## 7. Testing Strategy

### 7.1 Static / inline self-tests

No JS test harness in this project (Phase 1 confirmed). Inline assertions only:

- At userscript load, run a synthetic `BubbleWriter.schedule()` against a temporary detached `<div>` with `.ChatMessageTextContent` to verify the tail timer writes the full text. Gate behind `boundaryDebug` so it doesn't run by default.
- The existing `selfTestLangDetector()` (24 fixtures, Phase 1) still runs unconditionally — covers regression of Phase 1 surface.

### 7.2 End-to-end (Chrome MCP, same as Phase 1)

```
Step 0  Navigate to https://rdqa.qbiai.com/1120mohwwebchat/index.html
Step 1  Inject the updated userscript content
Step 2  Configure: enabled=true, key, region=japaneast, syncTextToBubble=true,
        boundaryDebug=true (for diagnosis)
Step 3  Click Test Voice — confirm 6/6 pass (Phase 1 regression check)
Step 4  For each of the 6 language inputs, send and observe:
        a. Bubble appears, empty
        b. Within 300ms, first character appears
        c. Text reveals progressively, ending in full bot reply
        d. console contains boundary logs
        e. No infinite spinner / stall
        f. Screenshot showing full bot text in bubble
Step 5  Toggle syncTextToBubble OFF, send one phrase, confirm Phase 1 behavior
Step 6  Toggle suppressPlaceholderQueueWrite OFF, send one phrase, verify the
        flicker mode also works (text appears with a brief ' ' flash)
Step 7  Click "重啟交談", confirm any in-flight timers don't write to new bubbles
```

### 7.3 Acceptance criteria

1. Bubble displays the bot reply text for all 6 test languages.
2. Reveal timing visibly tracks Azure audio playback (subjective, ±300 ms acceptable).
3. No flicker in default config (`suppressPlaceholderQueueWrite=true`).
4. Phase 1 self-tests (6/6 testAll) still pass.
5. Toggling `syncTextToBubble` off restores Phase 1 behavior without reload.
6. No JavaScript errors in console.
7. Restart conversation does not leak timers into new bubbles.
8. `git status`-equivalent check: only `outscript/azure-tts-for-ltc.user.js` (modified), `outscript/README.md` (updated), and the new spec/plan files (under `docs/`) have changed.

## 8. Deliverables

```
C:\Claude\衛福部webchat\
├── outscript\
│   ├── azure-tts-for-ltc.user.js          (MODIFIED — +4 sections, ~250 added lines)
│   └── README.md                           (UPDATED — add Phase 2-A notes + new test report)
└── docs\superpowers\
    ├── specs\
    │   ├── 2026-05-24-azure-tts-tampermonkey-overlay-design.md   (unchanged)
    │   └── 2026-05-25-phase2a-text-bubble-sync-design.md         (this file)
    └── plans\
        └── 2026-05-25-phase2a-text-bubble-sync-plan.md           (next step)
```

Plus a Phase 2-A test report appended to `outscript/README.md` after live test.

## 9. Open Risks

1. **`handelSpeechAndTextSyncQueue` side effects.** This is the highest risk. If the queue does more than write text (e.g., updates a pending-events counter for HeyGen), skipping `' '` entries could break message flow. Mitigated by feature flag, but the v1 ship default skips them — verification depends on the live test.

2. **wordBoundary CJK granularity.** Azure documentation states CJK boundaries fire per character, but `text` field for `WordBoundary` type may aggregate multiple characters depending on voice. If we see fewer boundaries than characters, the tail timer covers the rest but the typewriter looks chunky. Acceptable.

3. **Audio start timing.** The first `synthesizing` event approximates audio playback start within ~50 ms. For ultra-short chunks (1-2 chars) the timing may feel off. Acceptable; the bot's chunks are typically sentences.

4. **DOM selector fragility.** `.ChatMessageTextContent` is the current host site class. If AI3 changes the class name, our writes silently fail. Mitigated by `boundaryDebug` logs and the bubble's empty visible state would show.

5. **Concurrent chunks for different messageIds.** If the bot ever streams replies to two distinct `messageId`s simultaneously, our per-messageId state map handles them independently. Tested implicitly during multi-language batch send in Phase 1.

6. **SetTimeout clock drift.** Browser timers can lag under load. For long replies (>20 s), drift between Azure audio and DOM writes can become visible. Acceptable for Phase 2-A; revisit if observed.

## 10. Out of Scope (Phase 2-B)

- HeyGen Lite Mode integration (lip-sync against Azure audio).
- Replacing the host's HeyGen Full Mode session.
- LiveKit audio track publishing.
- All of the above tracked separately in a future spec cycle.

The text bubble work in Phase 2-A is independent and ships first.
