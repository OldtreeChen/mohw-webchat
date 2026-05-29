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
