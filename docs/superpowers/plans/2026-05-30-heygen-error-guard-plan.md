# HeyGen Error Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以 Tampermonkey userscript monkey-patch 方式，偵測 HeyGen 服務異常並顯示錯誤 Overlay、停止 STT 收音、自動重試最多 5 次，完全不修改任何現有原始碼。

**Architecture:** 新增單一 userscript `outscript/heygen-error-guard.user.js`。腳本在 `document-end` 啟動，以 200ms polling 等待 `Avatar` 與 `WebChat` 物件就緒後 monkey-patch 四個目標方法。所有錯誤統一進入 `ErrorGuard.onError()`，由此管理 Overlay 顯示、STT 停止與重試排程。

**Tech Stack:** Vanilla JS、Tampermonkey（`@grant none`）、純 CSS spinner（無外部依賴）

---

### Task 1: 建立 userscript 骨架與 State 物件

**Files:**
- Create: `outscript/heygen-error-guard.user.js`

- [ ] **Step 1: 建立檔案，寫入 header、常數與 State**

建立 `outscript/heygen-error-guard.user.js`，完整內容如下：

```js
// ==UserScript==
// @name         HeyGen Error Guard for LTC WebChat
// @namespace    https://ltcai.mohw.gov.tw/
// @version      1.0.0
// @description  偵測 HeyGen 服務異常，顯示系統忙碌 Overlay，停止收音，自動重試（最多 5 次）
// @author       —
// @match        https://ltcai.mohw.gov.tw/webchat/*
// @match        https://rdqa.qbiai.com/1120mohwwebchat/*
// @match        http://localhost/*
// @match        http://127.0.0.1/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const RETRY_INTERVAL_MS = 3000;
  const MAX_RETRIES = 5;
  const POLL_MS = 200;
  const POLL_TIMEOUT_MS = 30000;

  const State = {
    isError: false,
    retryCount: 0,
    retryTimerId: null,
    wasRecording: false,
  };

  console.log('[HeyGenErrorGuard] userscript loaded v1.0.0');
})();
```

- [ ] **Step 2: 在瀏覽器 DevTools console 驗證載入**

於目標頁面（localhost 或 rdqa）開啟 DevTools → Console，貼上整個腳本內容。
預期輸出：`[HeyGenErrorGuard] userscript loaded v1.0.0`

- [ ] **Step 3: Commit**

```bash
git add outscript/heygen-error-guard.user.js
git commit -m "feat: scaffold HeyGen Error Guard userscript with State object"
```

---

### Task 2: 注入 Overlay DOM 與 CSS

**Files:**
- Modify: `outscript/heygen-error-guard.user.js`

- [ ] **Step 1: 在 `State` 宣告之後加入 `injectOverlay()` 函數**

```js
  // ============ Overlay DOM & CSS ============

  function injectOverlay() {
    const player = document.getElementById('heygen-player');
    if (!player) return false;

    // 確保 player 為 relative 定位（overlay 用 absolute 疊上去）
    player.style.position = 'relative';

    // 防止重複注入
    if (document.getElementById('heygen-error-overlay')) return true;

    // 注入 CSS
    const style = document.createElement('style');
    style.id = 'heygen-error-guard-style';
    style.textContent = `
      #heygen-error-overlay {
        display: none;
        position: absolute;
        top: 0; left: 0;
        width: 100%; height: 100%;
        background: rgba(0,0,0,0.65);
        align-items: center;
        justify-content: center;
        z-index: 999;
        flex-direction: column;
      }
      .heg-err-box {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        color: #fff;
        text-align: center;
        padding: 24px 32px;
        border-radius: 12px;
        background: rgba(0,0,0,0.4);
      }
      .heg-err-icon { font-size: 2.4rem; }
      .heg-err-title { font-size: 1.2rem; font-weight: bold; }
      .heg-err-subtitle { font-size: 0.9rem; opacity: 0.85; }
      .heg-err-spinner {
        width: 32px; height: 32px;
        border: 3px solid rgba(255,255,255,0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: heg-spin 0.8s linear infinite;
      }
      .heg-err-reload-btn {
        margin-top: 8px;
        padding: 8px 20px;
        background: #fff;
        color: #333;
        border: none;
        border-radius: 6px;
        font-size: 0.95rem;
        cursor: pointer;
      }
      .heg-err-reload-btn:hover { background: #eee; }
      @keyframes heg-spin { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);

    // 注入 Overlay DOM
    const overlay = document.createElement('div');
    overlay.id = 'heygen-error-overlay';
    overlay.innerHTML = `
      <div class="heg-err-box">
        <div class="heg-err-icon">⚠️</div>
        <div class="heg-err-title">系統忙碌中</div>
        <div class="heg-err-subtitle" id="heg-err-subtitle">正在嘗試重新連線...</div>
        <div class="heg-err-spinner" id="heg-err-spinner"></div>
      </div>
    `;
    player.appendChild(overlay);
    return true;
  }
```

- [ ] **Step 2: 在 DevTools console 驗證 Overlay 注入**

```js
// 確認注入成功
const result = injectOverlay();
console.log('inject result:', result); // 預期: true

// 手動顯示 overlay 確認外觀
document.getElementById('heygen-error-overlay').style.display = 'flex';
// 預期：HeyGen 影片區域上出現半透明深色遮罩 + ⚠️ + 「系統忙碌中」 + spinner
```

- [ ] **Step 3: 恢復狀態**

```js
document.getElementById('heygen-error-overlay').style.display = 'none';
```

- [ ] **Step 4: Commit**

```bash
git add outscript/heygen-error-guard.user.js
git commit -m "feat: inject HeyGen error overlay DOM and CSS"
```

---

### Task 3: showOverlay() / hideOverlay() / showFatalOverlay()

**Files:**
- Modify: `outscript/heygen-error-guard.user.js`

- [ ] **Step 1: 在 `injectOverlay()` 之後加入顯示控制函數**

```js
  // ============ Overlay show / hide ============

  function showOverlay() {
    const overlay = document.getElementById('heygen-error-overlay');
    if (!overlay) return;
    overlay.style.transition = 'opacity 300ms';
    overlay.style.opacity = '0';
    overlay.style.display = 'flex';
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });
  }

  function hideOverlay() {
    const overlay = document.getElementById('heygen-error-overlay');
    if (!overlay) return;
    overlay.style.transition = 'opacity 300ms';
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.style.display = 'none';
      // 重置回「重試中」的預設內容，供下次使用
      const box = overlay.querySelector('.heg-err-box');
      if (box) {
        box.innerHTML = `
          <div class="heg-err-icon">⚠️</div>
          <div class="heg-err-title">系統忙碌中</div>
          <div class="heg-err-subtitle" id="heg-err-subtitle">正在嘗試重新連線...</div>
          <div class="heg-err-spinner" id="heg-err-spinner"></div>
        `;
      }
    }, 300);
  }

  function updateSubtitle(text) {
    const el = document.getElementById('heg-err-subtitle');
    if (el) el.textContent = text;
  }

  function showFatalOverlay() {
    const overlay = document.getElementById('heygen-error-overlay');
    if (!overlay) return;
    const box = overlay.querySelector('.heg-err-box');
    if (box) {
      box.innerHTML = `
        <div class="heg-err-icon">⚠️</div>
        <div class="heg-err-title">服務暫時無法使用</div>
        <div class="heg-err-subtitle">請重新整理頁面</div>
        <button class="heg-err-reload-btn" onclick="location.reload()">重新整理</button>
      `;
    }
    overlay.style.opacity = '1';
    overlay.style.display = 'flex';
  }
```

- [ ] **Step 2: 在 DevTools 驗證所有顯示函數**

```js
injectOverlay();

// 1. 淡入
showOverlay();
// 預期：overlay 以 300ms 淡入出現

// 2. 更新副標題
setTimeout(() => updateSubtitle('正在嘗試重新連線... (第 2 次 / 5)'), 500);
// 預期：副標題文字更新

// 3. 淡出
setTimeout(() => hideOverlay(), 1500);
// 預期：overlay 以 300ms 淡出消失

// 4. fatal overlay
setTimeout(() => showFatalOverlay(), 2500);
// 預期：顯示「服務暫時無法使用」+ 「重新整理」按鈕
```

- [ ] **Step 3: Commit**

```bash
git add outscript/heygen-error-guard.user.js
git commit -m "feat: add showOverlay/hideOverlay/showFatalOverlay functions"
```

---

### Task 4: stopSTT() / restoreSTT()

**Files:**
- Modify: `outscript/heygen-error-guard.user.js`

- [ ] **Step 1: 在顯示控制函數之後加入 STT 控制函數**

```js
  // ============ STT control ============

  function stopSTT() {
    if (typeof AzureWebSTT !== 'undefined' && AzureWebSTT.isRecording) {
      State.wasRecording = true;
      try { AzureWebSTT.stopRecording(); } catch (e) { /* ignore */ }
      console.log('[HeyGenErrorGuard] STT recording stopped');
    } else {
      State.wasRecording = false;
    }
  }

  function restoreSTT() {
    if (State.wasRecording &&
        typeof AzureWebSTT !== 'undefined' &&
        AzureWebSTT.enableSTT) {
      try { AzureWebSTT.startRecording(); } catch (e) { /* ignore */ }
      console.log('[HeyGenErrorGuard] STT recording restored');
    }
    State.wasRecording = false;
  }
```

- [ ] **Step 2: 在 DevTools 驗證 stopSTT（AzureWebSTT 可用時）**

```js
// 情境 A：AzureWebSTT 正在錄音時
if (typeof AzureWebSTT !== 'undefined' && AzureWebSTT.isRecording) {
  stopSTT();
  console.log('wasRecording:', State.wasRecording); // 預期: true
  console.log('isRecording after:', AzureWebSTT.isRecording); // 預期: false
}

// 情境 B：AzureWebSTT 未錄音時
// State.wasRecording 預期: false
```

- [ ] **Step 3: Commit**

```bash
git add outscript/heygen-error-guard.user.js
git commit -m "feat: add stopSTT/restoreSTT for AzureWebSTT control"
```

---

### Task 5: ErrorGuard 物件、onError() 與 scheduleRetry()

**Files:**
- Modify: `outscript/heygen-error-guard.user.js`

- [ ] **Step 1: 在 STT 控制函數之後加入 ErrorGuard 物件與重試邏輯**

```js
  // ============ ErrorGuard ============

  const ErrorGuard = {
    // 儲存 patch 前的原始 createDirectSession，供 retry 直接呼叫（跳過 patch 包裝）
    _origCreateDirectSession: null,

    onError(source, error) {
      if (State.isError) return; // 防 cascade
      console.warn(`[HeyGenErrorGuard] Error from [${source}]:`, error && error.message);
      State.isError = true;
      stopSTT();
      if (typeof WebChat !== 'undefined') {
        try { WebChat.stopHeyGenKeepAlive(); } catch (e) { /* ignore */ }
      }
      injectOverlay();
      showOverlay();
      scheduleRetry();
    },
  };

  function scheduleRetry() {
    if (State.retryCount >= MAX_RETRIES) {
      console.warn('[HeyGenErrorGuard] Max retries reached. Showing fatal overlay.');
      showFatalOverlay();
      return;
    }

    State.retryTimerId = setTimeout(async () => {
      State.retryCount++;
      updateSubtitle(`正在嘗試重新連線... (第 ${State.retryCount} 次 / ${MAX_RETRIES})`);
      console.log(`[HeyGenErrorGuard] Retry ${State.retryCount}/${MAX_RETRIES}`);

      try {
        // 清除舊 session
        if (typeof Avatar !== 'undefined') {
          try { await Avatar.stopConversation(); } catch (e) { /* ignore */ }
        }
        // 呼叫原始（未 patch）的 createDirectSession，避免觸發 patch 造成遞迴
        await ErrorGuard._origCreateDirectSession.call(Avatar);

        // 重連成功
        console.log('[HeyGenErrorGuard] Reconnected successfully ✅');
        State.isError = false;
        State.retryCount = 0;
        State.retryTimerId = null;
        hideOverlay();
        if (typeof WebChat !== 'undefined') {
          try { WebChat.startHeyGenKeepAlive(); } catch (e) { /* ignore */ }
        }
        restoreSTT();
      } catch (err) {
        console.warn(`[HeyGenErrorGuard] Retry ${State.retryCount} failed:`, err && err.message);
        scheduleRetry();
      }
    }, RETRY_INTERVAL_MS);
  }
```

- [ ] **Step 2: 在 DevTools 驗證 cascade 防護**

```js
// 模擬第一次錯誤（需先完成 Task 6 的 patch，或手動設 _origCreateDirectSession）
ErrorGuard._origCreateDirectSession = async function() { throw new Error('service down'); };

ErrorGuard.onError('test', new Error('simulated'));
// 預期：overlay 出現，console 顯示 "Error from [test]"

// 立即再觸發，應被 cascade 防護擋住
ErrorGuard.onError('test2', new Error('cascade'));
// 預期：console 不出現 "Error from [test2]"
console.log('State.isError:', State.isError); // 預期: true

// 清理
State.isError = false;
State.retryCount = 0;
clearTimeout(State.retryTimerId);
State.retryTimerId = null;
hideOverlay();
```

- [ ] **Step 3: Commit**

```bash
git add outscript/heygen-error-guard.user.js
git commit -m "feat: add ErrorGuard.onError and scheduleRetry with 3s fixed interval"
```

---

### Task 6: Monkey-patch Avatar 與 WebChat

**Files:**
- Modify: `outscript/heygen-error-guard.user.js`

- [ ] **Step 1: 在 `scheduleRetry` 之後加入 `patchMethods()` 與 polling 啟動**

```js
  // ============ Monkey-patch ============

  function patchMethods() {
    if (typeof Avatar === 'undefined' || typeof WebChat === 'undefined') return false;
    if (Avatar.__heygenErrorGuardPatched) return true; // 防重複 patch

    console.log('[HeyGenErrorGuard] Patching Avatar and WebChat...');

    // 儲存原始 createDirectSession（retry 時直接呼叫，跳過 patch 包裝）
    ErrorGuard._origCreateDirectSession = Avatar.createDirectSession;

    // 1. Avatar.initAvatar
    const _origInit = Avatar.initAvatar;
    Avatar.initAvatar = async function (...args) {
      try { return await _origInit.apply(this, args); }
      catch (err) { ErrorGuard.onError('initAvatar', err); throw err; }
    };

    // 2. Avatar.createDirectSession
    const _origCreate = Avatar.createDirectSession;
    Avatar.createDirectSession = async function (...args) {
      try { return await _origCreate.apply(this, args); }
      catch (err) { ErrorGuard.onError('createDirectSession', err); throw err; }
    };

    // 3. Avatar.speakDirectMode
    const _origSpeak = Avatar.speakDirectMode;
    Avatar.speakDirectMode = async function (...args) {
      try { return await _origSpeak.apply(this, args); }
      catch (err) { ErrorGuard.onError('speakDirectMode', err); throw err; }
    };

    // 4. WebChat.keepAliveHeyGen
    const _origKeepAlive = WebChat.keepAliveHeyGen;
    WebChat.keepAliveHeyGen = function (...args) {
      try { return _origKeepAlive.apply(this, args); }
      catch (err) { ErrorGuard.onError('keepAliveHeyGen', err); throw err; }
    };

    Avatar.__heygenErrorGuardPatched = true;

    // Overlay 預先注入（等 #heygen-player 出現後嘗試，若尚未出現則稍後由 onError 注入）
    injectOverlay();

    console.log('[HeyGenErrorGuard] Patch complete ✅');
    return true;
  }

  // ============ Init: polling 等待 Avatar/WebChat 就緒 ============

  let pollElapsed = 0;
  const pollTimer = setInterval(() => {
    pollElapsed += POLL_MS;
    if (patchMethods()) {
      clearInterval(pollTimer);
    } else if (pollElapsed >= POLL_TIMEOUT_MS) {
      clearInterval(pollTimer);
      console.warn('[HeyGenErrorGuard] Timed out waiting for Avatar/WebChat — not patched');
    }
  }, POLL_MS);
```

- [ ] **Step 2: 在 DevTools 驗證 patch 套用**

```js
console.log('Patched:', Avatar.__heygenErrorGuardPatched);
// 預期: true

console.log('_origCreateDirectSession type:', typeof ErrorGuard._origCreateDirectSession);
// 預期: 'function'

// 確認 overlay 已預先注入
console.log('overlay exists:', !!document.getElementById('heygen-error-overlay'));
// 預期: true
```

- [ ] **Step 3: 在 DevTools 模擬 speakDirectMode 拋錯，驗證完整 E2E 流程**

```js
// 暫時讓 speakDirectMode 拋錯
const savedSpeak = Avatar.speakDirectMode;
Avatar.speakDirectMode = async function() { throw new Error('mock HeyGen 503'); };

// 觸發
Avatar.speakDirectMode('測試').catch(() => {});
// 預期：
// - console: "[HeyGenErrorGuard] Error from [speakDirectMode]: mock HeyGen 503"
// - overlay 出現「系統忙碌中」
// - 3 秒後 console: "Retry 1/5"

// 等待觀察後清理
setTimeout(() => {
  State.isError = false;
  State.retryCount = 0;
  clearTimeout(State.retryTimerId);
  State.retryTimerId = null;
  Avatar.speakDirectMode = savedSpeak;
  hideOverlay();
  console.log('Test cleanup done');
}, 1000);
```

- [ ] **Step 4: Commit**

```bash
git add outscript/heygen-error-guard.user.js
git commit -m "feat: monkey-patch Avatar/WebChat for HeyGen error detection"
```

---

### Task 7: 整合測試 — 完整重試流程

**Files:**
- Modify: `outscript/heygen-error-guard.user.js`（若測試發現 bug 才修改）

- [ ] **Step 1: 模擬連續失敗 5 次，驗證 fatal overlay**

在 DevTools console 執行：

```js
// 重置狀態
State.isError = false; State.retryCount = 0;
clearTimeout(State.retryTimerId); State.retryTimerId = null;
hideOverlay();

// 讓所有重試都失敗
ErrorGuard._origCreateDirectSession = async function() {
  throw new Error('service unavailable');
};

// 觸發
ErrorGuard.onError('integrationTest', new Error('initial error'));

// 觀察（約 15 秒）：
// t=0s  overlay 出現「系統忙碌中」
// t=3s  副標題「正在嘗試重新連線... (第 1 次 / 5)」
// t=6s  副標題更新為「第 2 次 / 5」
// t=9s  「第 3 次 / 5」
// t=12s 「第 4 次 / 5」
// t=15s 「第 5 次 / 5」
// t=18s overlay 切換為「服務暫時無法使用 + 重新整理按鈕」
```

- [ ] **Step 2: 模擬第 3 次重試成功，驗證 overlay 消失**

```js
// 重置
State.isError = false; State.retryCount = 0;
clearTimeout(State.retryTimerId); State.retryTimerId = null;
hideOverlay();

let callCount = 0;
ErrorGuard._origCreateDirectSession = async function() {
  callCount++;
  if (callCount < 3) throw new Error('still failing');
  console.log('[TEST] createDirectSession success on attempt', callCount);
  // 模擬 startConversation
};

ErrorGuard.onError('integrationTest', new Error('initial error'));

// 觀察（約 9 秒）：
// t=3s  Retry 1 失敗
// t=6s  Retry 2 失敗
// t=9s  Retry 3 成功 → console: "Reconnected successfully ✅"
//        overlay 淡出消失
//        State.isError === false，State.retryCount === 0
```

- [ ] **Step 3: 驗證最終狀態**

```js
console.log('isError:', State.isError);     // 預期: false
console.log('retryCount:', State.retryCount); // 預期: 0
console.log('overlay display:', document.getElementById('heygen-error-overlay').style.display);
// 預期: 'none' 或 ''（淡出後）
```

- [ ] **Step 4: Commit（若有修正）**

```bash
git add outscript/heygen-error-guard.user.js
git commit -m "fix: integration test corrections for HeyGen Error Guard"
```

---

### Task 8: 更新 README

**Files:**
- Modify: `outscript/README.md`

- [ ] **Step 1: 在 `outscript/README.md` 末尾追加 HeyGen Error Guard 說明**

在檔案最末加入以下內容（接在現有 README 之後）：

```markdown

---

# HeyGen Error Guard for LTC WebChat — Tampermonkey Userscript

A single-file userscript that detects HeyGen virtual assistant service errors, shows a "system busy" overlay over the avatar player, stops STT microphone recording, and auto-retries the connection every 3 seconds up to 5 times.

**Zero modification** to the host site — everything is runtime monkey-patching + DOM injection.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Firefox).
2. Open Tampermonkey dashboard → Utilities → Import from file → pick `heygen-error-guard.user.js`.

The script auto-activates on the same URLs as the Azure TTS script.

## How it works

Monkey-patches four methods after polling for `Avatar`/`WebChat` to be ready:

| Method | Error caught |
|--------|-------------|
| `Avatar.initAvatar` | 初始化失敗 |
| `Avatar.createDirectSession` | Session 建立失敗 |
| `Avatar.speakDirectMode` | 播放失敗 / session 斷線 |
| `WebChat.keepAliveHeyGen` | 保活失敗 |

On any error:
1. Shows semi-transparent overlay on `#heygen-player`: "系統忙碌中"
2. Stops `AzureWebSTT` recording (if active), saves `wasRecording` state
3. Stops HeyGen keep-alive timer
4. Auto-retries every **3 seconds**, up to **5 times**
5. On success: hides overlay, restarts keep-alive, restores STT if it was active
6. After 5 failures: shows "服務暫時無法使用，請重新整理頁面" with a reload button
```

- [ ] **Step 2: Commit**

```bash
git add outscript/README.md
git commit -m "docs: add HeyGen Error Guard section to outscript README"
```
