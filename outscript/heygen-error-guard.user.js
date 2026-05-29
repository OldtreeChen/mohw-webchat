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

  console.log('[HeyGenErrorGuard] userscript loaded v1.0.0');
})();
