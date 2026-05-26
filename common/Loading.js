(function () {
    var loadingEl = document.getElementById("loading");
    if (!loadingEl) return;

    var titleText = "長照AI智慧助理";
    var nvbarTitle = document.getElementById("nvbarTitle");
    if (nvbarTitle && nvbarTitle.textContent.trim()) {
        titleText = nvbarTitle.textContent.trim();
    }

    loadingEl.innerHTML =
        '<div class="loading-content">' +
            '<div class="loading-icon">' +
                '<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                    '<circle cx="40" cy="40" r="36" fill="#e8f4f8" stroke="#2e86c1" stroke-width="3"/>' +
                    '<path d="M28 52c0-8 5-14 12-14s12 6 12 14" stroke="#2e86c1" stroke-width="2.5" stroke-linecap="round"/>' +
                    '<circle cx="40" cy="30" r="7" fill="#2e86c1"/>' +
                    '<path d="M20 58c2-6 6-10 12-12M60 58c-2-6-6-10-12-12" stroke="#5dade2" stroke-width="2" stroke-linecap="round"/>' +
                    '<path d="M55 22l4-4M25 22l-4-4M40 16v-5" stroke="#2e86c1" stroke-width="2" stroke-linecap="round"/>' +
                '</svg>' +
            '</div>' +
            '<h2 class="loading-title">' + titleText + '</h2>' +
            '<p class="loading-subtitle">衛生福利部 AI智慧助理</p>' +
            '<div class="loading-spinner">' +
                '<div class="spinner-dot"></div>' +
                '<div class="spinner-dot"></div>' +
                '<div class="spinner-dot"></div>' +
            '</div>' +
            '<p class="loading-text">系統載入中，請稍候...</p>' +
        '</div>';

    // 攔截原本的 $("#loading").remove()，改為淡出
    var origRemove = $.fn.remove;
    $.fn.remove = function () {
        if (this.is("#loading")) {
            // 不立刻移除，改為等虛擬人載入完成
            return this;
        }
        return origRemove.apply(this, arguments);
    };

    // 監聽 #ai-loading-overlay 被隱藏（虛擬人載入完成）
    var observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
            if (m.type === "attributes" && m.attributeName === "style") {
                var overlay = document.getElementById("ai-loading-overlay");
                if (overlay && (overlay.style.display === "none" || overlay.style.opacity === "0")) {
                    dismissLoading();
                }
            }
        });
    });

    // 等 DOM 就緒後開始監聽
    function startObserver() {
        var overlay = document.getElementById("ai-loading-overlay");
        if (overlay) {
            observer.observe(overlay, { attributes: true, attributeFilter: ["style"] });
        } else {
            // overlay 還沒建立，等一下再看
            setTimeout(startObserver, 500);
        }
    }
    startObserver();

    // 安全網：最多等 30 秒就強制退出 loading
    var maxTimeout = setTimeout(function () {
        dismissLoading();
    }, 30000);

    var dismissed = false;
    function dismissLoading() {
        if (dismissed) return;
        dismissed = true;
        clearTimeout(maxTimeout);
        observer.disconnect();

        // 還原 $.fn.remove
        $.fn.remove = origRemove;

        // 淡出 loading 招呼畫面
        var el = document.getElementById("loading");
        if (el) {
            el.classList.add("fade-out");
            setTimeout(function () { el.remove(); }, 400);
        }
    }
})();
