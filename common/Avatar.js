var Avatar = {
    // 原有屬性
    client: null,
    avatarId: null,
    voiceId: null,
    avatarName: null,

    // STT 相關屬性（簡化版本）
    sttSession: null,
    mediaRecorder: null,
    mediaStream: null,
    isRecording: false,
    // HeyGen 直接模式相關
    directSession: null,
    directSocket: null,
    player: null, // LiveKit Player

    // 會話超時管理
    sessionCreatedAt: null,
    sessionTimeout: null,

    // 功能開關
    enableSTT: true, // 重新啟用 STT 功能
    isInitialized: false,

    doLoad: function () {
        // 檢查必要的依賴
        if (!Avatar.checkDependencies()) {
            return;
        }
    },

    checkDependencies: function() {
        // 檢查 AI3STTS SDK（僅用於語音播放）
        if (typeof AI3STTS === 'undefined') {
            console.error('❌ AI3STTS SDK 未載入');
            return false;
        }
        // 檢查 Util 配置
        if (typeof Util_HeyGen === 'undefined' || typeof Util_HeyGen.getConfig !== 'function') {
            console.error('❌ Util 物件或 getConfig 函數未找到');
            return false;
        }    
        return true;
    },

    initAvatar: async function () {
        try {
            // 取得配置
            const apiUrl = Util_HeyGen.getConfig("avaterApiUrl");
            const apiKey = Util_HeyGen.getConfig("avaterApiKey");
            if (!apiUrl) {
                throw new Error('Avatar API URL 未配置');
            }
            Avatar.client = new AI3STTS({ apiUrl, apiKey});
            const config = await Avatar.client.getConfig();
            if (config.avatarId) Avatar.avatarId = config.avatarId;
            if (config.voiceId) Avatar.voiceId = config.voiceId;
            Avatar.isInitialized = true;
            return true;
        } catch (error) {
            console.error('❌ Avatar 初始化失敗:', error);
        }
    },

    speakDirectMode: async function(text,messageId) {
        if(text == "" || text == null || text == " " || WebChat.isWebChatHistoryLoading)return;
        try {
            // 確保有活動的直接會話
            if (!Avatar.directSession) {
                await Avatar.createDirectSession();
            }
            
            if (!Avatar.directSession) {
                throw new Error('無法建立直接會話');
            }

            // 非當前最新的 /send 串流：不送 HeyGen，改以固定 eventId 推進文字同步佇列
            if (messageId != null && WebChat.isStaleStreamMessageByMessageId(messageId)) {
                WebChat.speechSyncDebugLog("avatar_skip_stale", {
                    messageId: messageId,
                    requestId: WebChat.streamMessageRequestMap[messageId]
                });
                WebChat.handelSpeechAndTextSyncQueue({
                    eventId: WebChat.SKIPPED_AVATAR_SPEECH_EVENT_ID,
                    messageId: messageId,
                    text: text
                });
                return;
            }

            // 先取得這次播報的 eventId，再交給 WebChat 進行文字 parser 排程
            const eventId = await Avatar.directSession.speak(text);
            if (!eventId) {
                console.warn('[Avatar.speakDirectMode] speak 沒有回傳 eventId，跳過同步排程');
                WebChat.speechSyncDebugLog("avatar_no_event_id", {
                    messageId: messageId
                });
                return;
            }
            WebChat.speechSyncDebugLog("avatar_speak_ok", {
                messageId: messageId,
                eventId: eventId
            });
            WebChat.handelSpeechAndTextSyncQueue({
                eventId: eventId,
                messageId: messageId,
                text: text
            });
        } catch (error) {
            console.error('[Avatar.speakDirectMode] 直接模式播放失敗:', error);
            // 嘗試重新建立會話
            Avatar.directSession = null;
            throw error;
        }
    },

    createDirectSession: async function(options = {}) {
        try {
            if (!Avatar.client) {
                throw new Error('AI3STTS 客戶端未初始化');
            }
            var maxSessionDuration = (Util.getConfig("chatTimeoutMinutes")+1)*60 ? (Util.getConfig("chatTimeoutMinutes")+1)*60: 60
            console.log("生命週期:");
            console.log(maxSessionDuration);
            // 使用 LiveAvatar SDK 建立會話
            const isSandbox = false;
            const container = document.getElementById('heygen-player');
            const videoElement = container.querySelector('#heygen-video') || 
                   container.querySelector('video')
            Avatar.directSession = await Avatar.client.createLiveAvatarSession({
                avatarId: Avatar.avatarId,
                voiceId: Avatar.voiceId,
                quality: "medium",
                language: "zh",
                isSandbox,
                maxSessionDuration: maxSessionDuration,
                voiceSettings: { speed:1, stability:0.5, style: undefined },
                mediaElement: videoElement,
            });
            // 設定會話超時管理
            Avatar.sessionCreatedAt = new Date();
            Avatar.sessionTimeout = options.timeout || null; // 接受測試傳入的超時時間
            if (Avatar.sessionTimeout) {
                const timeoutSeconds = Math.round(Avatar.sessionTimeout / 1000);
            }
            Avatar.startConversation();
            return Avatar.directSession;

        } catch (error) {
            console.error('[Avatar.createDirectSession] 建立直接會話失敗:', error);
            throw error;
        }
    },
    // HeyGen 對話控制方法
    startConversation: async function() {
        if (!Avatar.isInitialized) {
            console.error('❌ Avatar 系統未初始化');
            return;
        }
        try {
            if (!Avatar.directSession) {
                await Avatar.createDirectSession();
            }
            // 建立/附上 LiveAvatar 會話之後：
            const container = document.getElementById('heygen-player');
            const videoElement = container.querySelector('#heygen-video') || container.querySelector('video');

            // 確保 video 有大小、可見
            videoElement.style.display = 'block';
            videoElement.playsInline = true;

            // 第一步：**一定** 先靜音自動播放，保證畫面
            videoElement.muted = true;
            WebChat.hideLoadingOverlay().then(() => {
                WebChat.isWebChatHistoryLoading = false;
                WebChat.heyGenState.isAvatarMuted = true;
                $('#toggle-avatar-mute-btn').addClass('muted');
            });
            setTimeout(() => {
                Avatar.tryAutoUnmute(videoElement);
            }, 500);
            WebChat.updateHeygenContentPosition();
        } catch (error) {
            WebChat.updateHeygenContentPosition();
        }
    },
    tryAutoUnmute: function(videoElement) {
        videoElement.muted = false;             // 嘗試解靜音
        const p = videoElement.play();          // 再觸發一次播放
      
        if (!p) return;                         // 有些瀏覽器 play() 不回 Promise
      
        p.then(() => {
          // ✅ 成功：真的變成有聲自動播放
          WebChat.heyGenState.isAvatarMuted = false;
          videoElement.play();  
          $('#toggle-avatar-mute-btn').removeClass('muted');
          // 這裡就可以自動播 greeting
          if (WebChat.isNeedSpeakGreetingMessageToHeyGen) {
            WebChat.greetingMessage.click();
            WebChat.isNeedSpeakGreetingMessageToHeyGen = false;
          }
        }).catch(err => {
          // ❌ 被 autoplay policy 擋住：瀏覽器不讓「有聲自動播放」
          console.warn('Auto-unmute blocked by browser:', err);
          videoElement.muted = true;             // 嘗試解靜音
          videoElement.play();  
          WebChat.heyGenState.isAvatarMuted = true;
          $('#toggle-avatar-mute-btn').addClass('muted');
          WebChat.showSoundReminder();   // 提示使用者按一下開聲音
        });
    },
    stopConversation: async function() {
        console.log('結束 HeyGen 對話');
        try {
            // 直接模式：停止活動的會話
            if (Avatar.directSession) {
                await Avatar.directSession.stop();
                Avatar.directSession = null;
                console.log('✅ 直接會話已停止');
            }
            // 清理超時相關狀態
            Avatar.sessionCreatedAt = null;
            Avatar.sessionTimeout = null;
            console.log('✅ 直接模式對話已結束');
        } catch (error) {
            console.error('❌ 結束對話失敗:', error);
        }
    },
    attachVideoEventListeners: function(videoElement, resetSessionTime) {
        // 記錄已附加的監聽器，避免重複添加
        if (videoElement._avatarListenersAttached) {
            return;
        }
        // canplay 事件：視頻可以開始播放（已載入足夠數據）
        const onCanPlay = () => {
            resetSessionTime('canplay');
        };
        // loadeddata 事件：第一幀數據已載入
        const onLoadedData = () => {
            resetSessionTime('loadeddata');
        };
        // play 事件：開始播放
        const onPlay = () => {
            resetSessionTime('play');
        };
        // 添加事件監聽器
        videoElement.addEventListener('canplay', onCanPlay, { once: true });
        videoElement.addEventListener('loadeddata', onLoadedData, { once: true });
        videoElement.addEventListener('play', onPlay, { once: true });
        // 標記已添加監聽器
        videoElement._avatarListenersAttached = true;
        // 檢查視頻是否已經處於就緒狀態
        if (videoElement.readyState >= 3) { // HAVE_FUTURE_DATA
            resetSessionTime('already-ready');
        }
    },
    disconnect: function () {
        Avatar.isInitialized = false;
    },
};
function allowPermission() {
    console.log('用戶允許麥克風權限（STT 功能已禁用）');
    if (Avatar.permissionModal) {
        Avatar.permissionModal.classList.add('hidden');
    }
}

function denyPermission() {
    console.log('用戶拒絕麥克風權限（STT 功能已禁用）');
    if (Avatar.permissionModal) {
        Avatar.permissionModal.classList.add('hidden');
    }
}

// 當頁面載入完成時初始化應用
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM 載入完成，準備初始化 Avatar...');
    if (typeof Avatar !== 'undefined') {
        Avatar.doLoad();
    } else {
        console.error('❌ Avatar 物件未找到！');
    }
});

// 錯誤處理
window.addEventListener('error', (event) => {
    console.error('應用程式錯誤:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('未處理的 Promise 拒絕:', event.reason);
});

// 錯誤處理
window.addEventListener('error', (event) => {
    console.error('應用程式錯誤:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('未處理的 Promise 拒絕:', event.reason);
});

