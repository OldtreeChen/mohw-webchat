/**
 * HeyGen Error Guard v1.0.0
 * 偵測 HeyGen 服務異常，顯示系統忙碌 Overlay，停止收音，自動重試（最多 5 次）
 * 以 monkey-patch 方式運作，無需修改 Avatar.js / WebChat.js
 */
(function () {
  'use strict';

  const RETRY_INTERVAL_MS = 3000;
  const MAX_RETRIES = 5;
  const POLL_MS = 100;
  const POLL_TIMEOUT_MS = 30000;

  const State = {
    isError: false,
    retryCount: 0,
    retryTimerId: null,
    wasRecording: false,
  };

  let hideTimerId = null;

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

  // ============ Overlay show / hide ============

  function showOverlay() {
    const overlay = document.getElementById('heygen-error-overlay');
    if (!overlay) return;
    overlay.style.transition = 'opacity 300ms';
    overlay.style.opacity = '0';
    overlay.style.display = 'flex';
    requestAnimationFrame(() => requestAnimationFrame(() => { overlay.style.opacity = '1'; }));
  }

  function hideOverlay() {
    const overlay = document.getElementById('heygen-error-overlay');
    if (!overlay) return;
    overlay.style.transition = 'opacity 300ms';
    overlay.style.opacity = '0';
    hideTimerId = setTimeout(() => {
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
    if (hideTimerId) { clearTimeout(hideTimerId); hideTimerId = null; }
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
        if (!ErrorGuard._origCreateDirectSession) {
          console.error('[HeyGenErrorGuard] _origCreateDirectSession not set — aborting retry');
          showFatalOverlay();
          return;
        }
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

  console.log('[HeyGenErrorGuard] v1.0.0 loaded');
})();
