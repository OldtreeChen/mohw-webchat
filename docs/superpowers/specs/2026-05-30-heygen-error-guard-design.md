# HeyGen Error Guard — Design Spec

**Date:** 2026-05-30
**Feature:** 偵測 HeyGen 服務異常，顯示系統忙碌 Overlay，停止收音，自動重試
**Approach:** Tampermonkey Userscript（零修改原始碼，monkey-patch 方式）

---

## 1. 背景與目標

HeyGen 虛擬人服務在初始化或運行過程中可能發生異常（API 失敗、WebSocket 斷線、session 建立失敗等）。目前框架對這些錯誤只做 `console.error`，使用者看不到任何提示，也無法自動復原。

**目標：**
- 偵測所有 HeyGen 相關錯誤（初始化 + 運行中）
- 在 HeyGen 播放區域顯示半透明錯誤 Overlay
- 立即停止 STT 收音
- 每 3 秒自動重試，最多 5 次
- 重連成功後自動恢復，Overlay 消失

**限制：不修改任何現有程式碼**，以新 Tampermonkey userscript 實作。

---

## 2. 架構

### 2.1 新增檔案

```
outscript/
  heygen-error-guard.user.js   ← 本功能的 userscript
```

### 2.2 模組結構

```
ErrorGuard
  ├── State          { isError, retryCount, retryTimerId, wasRecording }
  ├── patch()        monkey-patch 四個目標方法
  ├── onError()      錯誤統一入口
  ├── showOverlay()  顯示錯誤 Overlay
  ├── hideOverlay()  淡出 Overlay，重置狀態
  ├── stopSTT()      停止 AzureWebSTT 收音
  ├── restoreSTT()   重連成功後恢復收音
  └── scheduleRetry() 排程重試（3 秒固定間隔）
```

---

## 3. Monkey-patch 攔截點

等待 `Avatar` 與 `WebChat` 物件就緒（polling 100ms），再包裝以下四個方法：

| 攔截目標 | 觸發時機 |
|---------|---------|
| `Avatar.initAvatar` | 初始化 API 失敗 |
| `Avatar.createDirectSession` | 建立 LiveAvatar session 失敗 |
| `Avatar.speakDirectMode` | 播放失敗（含 session 斷線） |
| `WebChat.keepAliveHeyGen` | 保活 API 失敗 |

包裝原則：
- 保留原始函數回傳值（`return original.apply(this, args)`）
- 在 catch 區塊呼叫 `ErrorGuard.onError(source, error)`
- 若 `ErrorGuard.State.isError === true` 則 `onError` 直接 return（防 cascade）

---

## 4. Overlay UI

### 4.1 DOM 結構

動態注入到 `#heygen-player` 內部（`position: absolute`）：

```html
<div id="heygen-error-overlay">
  <div class="heg-err-box">
    <div class="heg-err-icon">⚠️</div>
    <div class="heg-err-title">系統忙碌中</div>
    <div class="heg-err-subtitle">正在嘗試重新連線... (第 N 次 / 5)</div>
    <div class="heg-err-spinner"></div>
  </div>
</div>
```

超過 5 次後切換為：

```html
<div class="heg-err-title">服務暫時無法使用</div>
<div class="heg-err-subtitle">請重新整理頁面</div>
<button class="heg-err-reload-btn" onclick="location.reload()">重新整理</button>
```

### 4.2 樣式

- `#heygen-error-overlay`：`position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.65); display:flex; align-items:center; justify-content:center; z-index:999`
- `#heygen-player`：確保 `position:relative`
- Spinner：純 CSS `@keyframes` 旋轉動畫，無外部依賴
- 隱藏時：`opacity` 淡出 300ms 後 `display:none`

---

## 5. 自動重試邏輯

### 5.1 onError() 流程

```
onError(source, error) 被呼叫
  │
  ├─ State.isError === true → return（防 cascade）
  │
  ├─ State.isError = true
  ├─ stopSTT()              停止 AzureWebSTT（記錄 wasRecording）
  ├─ WebChat.stopHeyGenKeepAlive()
  ├─ showOverlay()
  └─ scheduleRetry()
```

### 5.2 scheduleRetry() 流程

```
scheduleRetry()
  │
  ├─ State.retryCount >= 5
  │    └─ 切換 Overlay 為「服務暫時無法使用」+ 刷新按鈕 → return
  │
  └─ setTimeout(3000)
       ├─ retryCount++
       ├─ 更新 Overlay 副標題「第 N 次 / 5」
       ├─ Avatar.stopConversation()   清除舊 session
       ├─ Avatar.createDirectSession()
       │    ├─ 成功
       │    │    ├─ hideOverlay()
       │    │    ├─ State.isError = false, retryCount = 0
       │    │    ├─ WebChat.startHeyGenKeepAlive()
       │    │    └─ restoreSTT()
       │    └─ 失敗
       │         └─ scheduleRetry()（遞迴，retryCount 累加）
       └─ （捕捉 createDirectSession 拋出的錯誤）
```

### 5.3 重試參數

| 參數 | 值 |
|------|---|
| 重試間隔 | 固定 3000ms |
| 最大重試次數 | 5 次 |
| 超過上限行為 | 顯示「服務暫時無法使用，請重新整理頁面」+ 刷新按鈕 |

---

## 6. STT 處理

### 6.1 停止收音（stopSTT）

```js
if (typeof AzureWebSTT !== 'undefined' && AzureWebSTT.isRecording) {
  State.wasRecording = true;
  AzureWebSTT.stopRecording();
} else {
  State.wasRecording = false;
}
```

### 6.2 恢復收音（restoreSTT）

```js
if (State.wasRecording &&
    typeof AzureWebSTT !== 'undefined' &&
    AzureWebSTT.enableSTT) {
  AzureWebSTT.startRecording();
}
State.wasRecording = false;
```

---

## 7. Userscript Header

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
```

---

## 8. 不在範圍內

- 不修改 `WebChat.js`、`Avatar.js` 或任何現有檔案
- 不提供手動重試按鈕（僅自動重試）
- 不處理網路完全斷線（非 HeyGen API 層錯誤）的情境
- 不修改聊天室訊息列
