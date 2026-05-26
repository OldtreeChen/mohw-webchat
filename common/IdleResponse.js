/**
 * IdleResponse.js
 *
 * 當使用者送出訊息後，若虛擬人超過指定秒數仍未開始回應，
 * 則讓虛擬人先播一句隨機的過渡語（如「請稍等」），避免長時間沉默。
 *
 * ★ 不修改任何既有檔案。
 * ★ 使用 fetch 攔截偵測送出訊息 + MutationObserver 偵測回覆。
 */
(function () {

    // ========== 可調參數 ==========
    var IDLE_SECONDS = 5;                       // 幾秒沒回應就觸發
    var COOLDOWN_MS  = 10000;                   // 過渡語最短間隔（毫秒）
    var SEND_API_KEYWORD = "message/send";      // 送出訊息 API 的 URL 關鍵字

    // 過渡語句池（隨機挑選）
    var FILLER_PHRASES = [
        "請稍等一下，我正在為您查詢。",
        "我正在整理相關資訊，請您稍候。",
        "好的，請給我一點時間查找資料。",
        "收到您的問題了，讓我查一下。",
        "請稍候，我馬上為您處理。"
    ];

    // ========== 內部狀態 ==========
    var _idleTimer    = null;
    var _lastFillerAt = 0;
    var _armed        = false;

    // ========== 工具函式 ==========
    function pickRandom(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    function clearIdleTimer() {
        if (_idleTimer) {
            clearTimeout(_idleTimer);
            _idleTimer = null;
        }
        _armed = false;
    }

    function startIdleTimer() {
        clearIdleTimer();
        _armed = true;
        _idleTimer = setTimeout(function () {
            if (_armed) {
                speakFiller();
                _armed = false;
            }
        }, IDLE_SECONDS * 1000);
    }

    function speakFiller() {
        // 防止過於頻繁
        var now = Date.now();
        if (now - _lastFillerAt < COOLDOWN_MS) {
            return;
        }
        // 確認 Avatar 已連線且有 session
        if (typeof Avatar === "undefined" || !Avatar.directSession) {
            return;
        }

        var phrase = pickRandom(FILLER_PHRASES);
        console.log("[IdleResponse] 超過 " + IDLE_SECONDS + " 秒未回應，播放過渡語：", phrase);

        try {
            Avatar.speakDirectMode(phrase);
            _lastFillerAt = Date.now();
        } catch (e) {
            console.warn("[IdleResponse] 播放過渡語失敗：", e);
        }
    }

    // ========== 策略 1：攔截 fetch 偵測送出訊息 ==========
    var _origFetch = window.fetch;
    window.fetch = function (url, options) {
        var urlStr = typeof url === "string" ? url : (url && url.url ? url.url : "");

        // 偵測到使用者送出訊息的 API 呼叫
        if (urlStr.indexOf(SEND_API_KEYWORD) > -1 && options && options.method &&
            options.method.toUpperCase() === "POST") {
            startIdleTimer();
        }

        return _origFetch.apply(window, arguments);
    };

    // ========== 策略 2：監聽機器人回覆（取消計時器）==========
    function watchForResponse() {
        var messageList = document.getElementById("MessageList");
        if (!messageList) {
            setTimeout(watchForResponse, 1000);
            return;
        }

        var observer = new MutationObserver(function (mutations) {
            if (!_armed) return;

            for (var i = 0; i < mutations.length; i++) {
                var addedNodes = mutations[i].addedNodes;
                for (var j = 0; j < addedNodes.length; j++) {
                    var node = addedNodes[j];
                    if (node.nodeType === 1) {
                        // 偵測到新的機器人回覆訊息
                        var isBot = node.classList &&
                            (node.classList.contains("ChatMessageRobot") ||
                             node.classList.contains("ChatMessageGpt"));
                        if (isBot) {
                            clearIdleTimer();
                            return;
                        }
                    }
                }
            }
        });

        observer.observe(messageList, { childList: true, subtree: true });
    }

    // 同時攔截 sendTextToHeyGen 作為備用取消機制
    function wrapSendTextToHeyGen() {
        if (typeof WebChat === "undefined" || typeof WebChat.sendTextToHeyGen !== "function") {
            setTimeout(wrapSendTextToHeyGen, 500);
            return;
        }

        var orig = WebChat.sendTextToHeyGen;
        WebChat.sendTextToHeyGen = function () {
            if (_armed) {
                clearIdleTimer();
            }
            return orig.apply(WebChat, arguments);
        };
    }

    // ========== 啟動 ==========
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
            watchForResponse();
            wrapSendTextToHeyGen();
        });
    } else {
        watchForResponse();
        wrapSendTextToHeyGen();
    }
})();
