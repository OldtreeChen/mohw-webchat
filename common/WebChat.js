var WebChat = {
    version: "9.0.00.b2.10-20260415-100000",

    chatId: null,

    lastchatId: null,

    roomId: null,

    location: null,

    isWorkTime: false,

    isInAgentService: false,

    isSurveyFromAgent: false,

    submitedSurvey: "empty",

    isNormalStop: false,

    servicegroupId: null,

    socket: null,

    isEverInAgentService: false,

    messageIndex: 0,

    hintHtmlMap: {},

    tenantCode: "",

    tenantInfo: null,

    pictureId: null,

    Leave: null,

    newMessageTime: null,

    timer: null,

    timercount: 0,

    richmenuObject: null,

    preMessageRecord: [],

    lastMessageRecord: {},

    isStorage: true,

    isInQueue: false,

    currentReSendElement: null,

    whileListTags: ["a", "br", "iframe", "p", "img", "label"],

    gptModeFormat: ["GPT", "GPT_FAIL", "GPT_FUNCTION"],

    gptTextConfig: ["gptGenerateText", "webSearchGenerateText", "aIPromptGenerateText", "functionGenerateText"],

    enableConditions: {},
    
    isDoUrlParameterAction: false,

    
    loadingDotsInterval: null,
    
    keepAliveIntervalId: null,

    isNotActive: false,

    
    reSendMessage: true,

    reSendCount: 0,

    isReconnect: false,
    
    isDisconnectionDelay: false,
    
    isFocusWindow: true,
    
    isExistEditorText: false,

    
    sendMsgByUrlContent: "",
    
    sendMsgByUrlWording: "",
    
    isDrag: true,
    
    parentIFrameUrl: "",
    
    executeData: null,
    
    fontSize: "14px",
    
    messageParser: null,
    
    messageParsers: new Map(),
    
    isNeedSpeakGreetingMessageToHeyGen: true,
    greetingMessage: "",

    textNodeString: "",
    needSpeakTextToHeyGen: false,

    
    soundReminderShown: false,

    
    speechQueue: {
        queue: [],                    // 佇列項目 [{messageId, text, streamIsFinish}]
        timer: null,                  // 定時器
        isProcessing: false          // 是否正在處理
    },

    
    
    speechAndTextSyncQueue: [],

    
    speechAndTextSyncResultQueue: [],

    
    speechAndTextSyncProgress: {},

    
    speechAndTextSyncTimer: null,

    
    speechAndTextSyncIsProcessing: false,
    
    speechAndTextSyncCharIntervalMs: 187,

    
    latestMessageSendRequestId: 0,
    
    streamMessageRequestMap: {},
    
    SKIPPED_AVATAR_SPEECH_EVENT_ID: "__skipped_avatar_speak__",
    
    speechSyncDebugEnabled: false,

    
    isWebChatHistoryLoading: false,

    // isLockSendMessage: false,

    
    cleanupAllParsers: function () {
        WebChat.messageParsers.forEach((parser, messageId) => {
            parser.cleanup();
        });
        WebChat.messageParsers.clear();
    },
    
    addToSpeechQueue: function (messageId, text) {
        if (!text || text.trim() === "") return;
        // 檢查是否已存在此 messageId 的項目
        let existingItem = WebChat.speechQueue.queue.find(item => item.messageId === messageId);
        if (existingItem) {
            // 累積文字到現有項目
            existingItem.text += text.trim();
        } else {
            // 創建新的佇列項目
            const newItem = {
                messageId: messageId,
                text: text.trim(),
                streamIsFinish: false
            };
            WebChat.speechQueue.queue.push(newItem);
        }
        // 檢查是否有定時器在運作
        if (WebChat.speechQueue.timer) {
            return;
        }
        // 檢查佇列是否有待發送內容
        if (WebChat.speechQueue.queue.length > 0) {
            WebChat.speechQueue.timer = setInterval(
                () => WebChat.processSpeechQueueTimer(), 1000);
        }
    },

    
    processSpeechQueueTimer: function () {
        // 檢查佇列是否為空
        if (WebChat.speechQueue.queue.length === 0) {
            WebChat.clearSpeechQueueTimer();
            return;
        }
        // 檢查第一順位的 messageId
        const firstItem = WebChat.speechQueue.queue[0];
        // 檢查是否有文字要發送
        if (firstItem.text && firstItem.text.trim().length > 0) {
            try {
                WebChat.speechSyncDebugLog("speech_queue_send", {
                    queueMessageId: firstItem.messageId,
                    textLength: firstItem.text.length
                });
                WebChat.sendTextToHeyGen(firstItem.text, firstItem.messageId);
                firstItem.text = ""; // 清空已發送的文字
            } catch (error) {
            }
        } else {
            // 沒有文字要發送，檢查 streamIsFinish
            if (firstItem.streamIsFinish) {
                WebChat.speechQueue.queue.shift(); // 移除第一順位
                // 檢查是否還有其他項目
                if (WebChat.speechQueue.queue.length === 0) {
                    WebChat.clearSpeechQueueTimer();
                }
            } else {
                firstItem.checkCount = firstItem.checkCount ? firstItem.checkCount + 1 : 1;
                if (firstItem.checkCount > 7) {
                    WebChat.speechQueue.queue.shift(); // 移除第一順位
                }
            }
        }
    },

    
    clearSpeechQueueTimer: function () {
        if (WebChat.speechQueue.timer) {
            clearInterval(WebChat.speechQueue.timer);
            WebChat.speechQueue.timer = null;
        }
    },

    
    markMessageStreamComplete: function (messageId) {
        // 找到對應的佇列項目並標記完成
        const item = WebChat.speechQueue.queue.find(item => item.messageId === messageId);
        if (item) {
            item.streamIsFinish = true;
        }
    },

    
    clearSpeechQueue: function () {
        WebChat.clearSpeechQueueTimer();
        WebChat.speechQueue.queue = [];
        WebChat.speechQueue.isProcessing = false;
    },

    
    handelSpeechAndTextSyncQueue: function (result) {
        if (!result || !result.eventId || !result.messageId || !result.text) {
            console.warn('[handelSpeechAndTextSyncQueue] 缺少必要參數', result);
            return;
        }

        // 將 result 加入佇列
        WebChat.speechAndTextSyncResultQueue.push(result);
        WebChat.speechSyncDebugLog("enqueue_result", {
            eventId: result.eventId,
            messageId: result.messageId,
            textLength: (result.text || "").length,
            isStaleMessage: WebChat.isStaleStreamMessageByMessageId(result.messageId)
        });

        // 啟動定時器（如果還沒啟動）
        if (!WebChat.speechAndTextSyncTimer) {
            WebChat.speechAndTextSyncTimer = setInterval(() => {
                WebChat.processSpeechAndTextSyncQueue();
            }, 100); // 每 100ms 檢查一次
        }
    },

    
    processSpeechAndTextSyncQueue: function () {
        // 如果正在處理中，跳過
        if (WebChat.speechAndTextSyncIsProcessing) {
            WebChat.speechSyncDebugLog("skip_processing", {});
            return;
        }

        // 檢查是否有待處理的 result 和對應的 queue 項目
        if (WebChat.speechAndTextSyncResultQueue.length === 0) {
            // 檢查是否所有 progress 都已完成（所有 messageId 的項目都已處理完）
            let hasRemainingProgress = false;
            for (const messageId in WebChat.speechAndTextSyncProgress) {
                const processedCount = WebChat.speechAndTextSyncProgress[messageId];
                // 檢查 queue 中是否還有該 messageId 的項目
                const hasItems = WebChat.speechAndTextSyncQueue.some(item => WebChat.isSameMessageId(item.messageId, messageId));
                if (hasItems) {
                    hasRemainingProgress = true;
                    break;
                }
            }

            // 如果沒有待處理的 result 且沒有剩餘的 progress，清除定時器
            if (!hasRemainingProgress) {
                WebChat.clearSpeechAndTextSyncTimer();
                // 清理已完成的 progress
                WebChat.speechAndTextSyncProgress = {};
                WebChat.speechSyncDebugLog("timer_cleared_no_progress", {});
            }
            return;
        }

        // 選擇「第一個已有對應 speechAndTextSyncQueue 項目」的 result，避免佇列頭卡住後續 messageId
        let processIdx = 0;
        let matchedItemsWithIndex = [];
        for (; processIdx < WebChat.speechAndTextSyncResultQueue.length; processIdx++) {
            const cand = WebChat.speechAndTextSyncResultQueue[processIdx];
            const mid = cand.messageId;
            const matches = [];
            for (let i = 0; i < WebChat.speechAndTextSyncQueue.length; i++) {
                if (WebChat.isSameMessageId(WebChat.speechAndTextSyncQueue[i].messageId, mid)) {
                    matches.push({
                        index: i,
                        item: WebChat.speechAndTextSyncQueue[i]
                    });
                }
            }
            if (matches.length > 0) {
                matchedItemsWithIndex = matches;
                break;
            }
        }

        if (matchedItemsWithIndex.length === 0) {
            WebChat.speechSyncDebugLog("no_match_wait", {
                pendingResultMessageIds: WebChat.speechAndTextSyncResultQueue.map(function (x) { return x.messageId; }).slice(0, 5),
                queueMessageIds: WebChat.speechAndTextSyncQueue.map(function (x) { return x.messageId; }).slice(0, 10)
            });
            return;
        }

        if (processIdx > 0) {
            const picked = WebChat.speechAndTextSyncResultQueue.splice(processIdx, 1)[0];
            WebChat.speechAndTextSyncResultQueue.unshift(picked);
        }

        const result = WebChat.speechAndTextSyncResultQueue[0];
        const { eventId, messageId, text } = result;
        const targetTextLength = text.length;
        WebChat.speechSyncDebugLog("start_result", {
            eventId: eventId,
            messageId: messageId,
            targetTextLength: targetTextLength,
            processIdx: processIdx,
            queueMatchedCount: matchedItemsWithIndex.length,
            requestId: WebChat.streamMessageRequestMap[messageId],
            isStaleMessage: WebChat.isStaleStreamMessageByMessageId(messageId)
        });

        // 獲取該 messageId 已處理的字元數
        const processedCount = WebChat.speechAndTextSyncProgress[messageId] || 0;

        // 累積文字：跳過已處理的字元，只處理新的字元
        let accumulatedText = '';
        let accumulatedLength = 0;
        let currentProcessedCount = 0; // 當前已累積處理的字元數（相對於 queue）
        const itemsToProcess = [];
        
        for (let i = 0; i < matchedItemsWithIndex.length && accumulatedLength < targetTextLength; i++) {
            const { index, item } = matchedItemsWithIndex[i];
            const itemText = item.text || (item.textNode ? item.textNode.nodeValue : '') || '';
            const itemTextLength = itemText.length;
            
            if (itemTextLength > 0) {
                // 計算這個項目中哪些字元需要處理
                let startOffset = 0;
                
                // 如果這個項目在已處理範圍內，跳過已處理的部分
                if (currentProcessedCount < processedCount) {
                    const remainingProcessed = processedCount - currentProcessedCount;
                    if (remainingProcessed >= itemTextLength) {
                        // 整個項目都已被處理，跳過
                        currentProcessedCount += itemTextLength;
                        continue;
                    } else {
                        // 部分項目已被處理，從剩餘部分開始
                        startOffset = remainingProcessed;
                        currentProcessedCount += remainingProcessed;
                    }
                }
                
                // 計算這個項目要使用的文字長度
                const remainingLength = targetTextLength - accumulatedLength;
                const availableLength = itemTextLength - startOffset;
                const textToUseLength = Math.min(availableLength, remainingLength);
                const textToUse = itemText.substring(startOffset, startOffset + textToUseLength);
                
                if (textToUse.length > 0) {
                    accumulatedText += textToUse;
                    accumulatedLength += textToUse.length;
                    currentProcessedCount += textToUseLength;
                    
                    itemsToProcess.push({
                        originalIndex: index,
                        item: item,
                        textToRender: textToUse,
                        startOffset: startOffset,
                        endOffset: startOffset + textToUseLength,
                        originalText: itemText
                    });
                }
            }
        }

        if (accumulatedText.length === 0) {
            // 沒有可渲染的文字，移除這個 result
            WebChat.speechAndTextSyncResultQueue.shift();
            WebChat.speechSyncDebugLog("empty_accumulated_shift", {
                eventId: eventId,
                messageId: messageId,
                processedCount: processedCount
            });

            // 檢查該 messageId 是否還有其他 result 待處理
            const hasOtherResults = WebChat.speechAndTextSyncResultQueue.some(item => WebChat.isSameMessageId(item.messageId, messageId));

            if (!hasOtherResults) {
                delete WebChat.speechAndTextSyncProgress[messageId];
                // 直接過濾掉該 messageId 的所有 queue 項目
                WebChat.speechAndTextSyncQueue = WebChat.speechAndTextSyncQueue.filter(
                    item => !WebChat.isSameMessageId(item.messageId, messageId)
                );
            }
            return;
        }

        // 標記為正在處理
        WebChat.speechAndTextSyncIsProcessing = true;

        // 更新處理進度
        WebChat.speechAndTextSyncProgress[messageId] = processedCount + accumulatedText.length;

        // 將文字分成多個片段，以固定速度逐字渲染
        const charCount = accumulatedText.length;
        const intervalMs = WebChat.isStaleStreamMessageByMessageId(messageId)
            ? 0
            : (WebChat.speechAndTextSyncCharIntervalMs || 28);
        WebChat.speechSyncDebugLog("render_prepare", {
            eventId: eventId,
            messageId: messageId,
            charCount: charCount,
            intervalMs: intervalMs,
            processedCount: processedCount
        });
        let currentCharIndex = 0;
        let currentItemIndex = 0;
        let currentItemCharIndex = 0;

        const tickMs = intervalMs <= 0 ? 0 : Math.max(1, Math.floor(intervalMs));
        const renderInterval = setInterval(() => {
            const stepsThisTick = intervalMs <= 0 ? Math.max(1, charCount - currentCharIndex) : 1;
            for (let step = 0; step < stepsThisTick && currentCharIndex < charCount; step++) {
                // 找到當前應該渲染的字元屬於哪個項目
                while (currentItemIndex < itemsToProcess.length) {
                    const currentItem = itemsToProcess[currentItemIndex];
                    const itemTextLength = currentItem.textToRender.length;

                    if (currentItemCharIndex < itemTextLength) {
                        const charToRender = currentItem.textToRender[currentItemCharIndex];

                        let targetNode = currentItem.item.currentNode;

                        if (!targetNode || !targetNode.isConnected) {
                            const tn = currentItem.item.textNode;
                            if (tn && tn.parentElement && tn.parentElement.isConnected) {
                                targetNode = tn.parentElement;
                                currentItem.item.currentNode = targetNode;
                            } else if (currentItem.item.syncRootEl && currentItem.item.syncRootEl.isConnected) {
                                targetNode = currentItem.item.syncRootEl;
                                currentItem.item.currentNode = targetNode;
                            } else {
                                const $target = $(`#${messageId}`);
                                if ($target.length > 0) {
                                    let $messageText = $target.find("div.ChatMessageContent.ChatMessageTextContent.WordBreakAll");

                                    if ($messageText.length === 0) {
                                        $messageText = $target.find("div.ChatMessageContent.ChatMessageTextContent");
                                    }

                                    if ($messageText.length > 0) {
                                        targetNode = $messageText[0];
                                        currentItem.item.currentNode = targetNode;
                                        WebChat.speechSyncDebugLog("target_rebind_by_query", {
                                            messageId: messageId,
                                            eventId: eventId,
                                            itemIndex: currentItemIndex
                                        });
                                    } else {
                                        currentItemCharIndex++;
                                        currentCharIndex++;
                                        break;
                                    }
                                } else {
                                    currentItemCharIndex++;
                                    currentCharIndex++;
                                    break;
                                }
                            }
                        }

                        if (targetNode && targetNode.appendChild) {
                            let textNode = currentItem.item.textNode;

                            if (!textNode || !textNode.isConnected) {
                                console.warn(`[processSpeechAndTextSyncQueue] ⚠️ placeholder textNode 不存在或已不在 DOM，新建一個 (messageId: ${messageId}, eventId: ${eventId}, itemIndex: ${currentItemIndex})`);
                                textNode = document.createTextNode('');
                                targetNode.appendChild(textNode);
                                currentItem.item.textNode = textNode;
                                WebChat.speechSyncDebugLog("placeholder_recreated", {
                                    messageId: messageId,
                                    eventId: eventId,
                                    itemIndex: currentItemIndex
                                });
                            }

                            try {
                                textNode.nodeValue += charToRender;
                            } catch (error) {
                                console.error(`[processSpeechAndTextSyncQueue] ❌ 渲染字元時發生錯誤 (messageId: ${messageId}, eventId: ${eventId}, itemIndex: ${currentItemIndex}, charIndex: ${currentCharIndex}):`, error);
                            }
                        } else {
                            console.error(`[processSpeechAndTextSyncQueue] ❌ targetNode 無效或無 appendChild 方法 (messageId: ${messageId}, eventId: ${eventId}, itemIndex: ${currentItemIndex}, targetNode: ${targetNode})`);
                        }

                        currentItemCharIndex++;
                        currentCharIndex++;
                        break;
                    } else {
                        currentItemIndex++;
                        currentItemCharIndex = 0;
                    }
                }
            }

            if (currentCharIndex >= charCount) {
                clearInterval(renderInterval);

                WebChat.speechAndTextSyncResultQueue.shift();
                WebChat.speechSyncDebugLog("render_done_shift", {
                    messageId: messageId,
                    eventId: eventId,
                    charCount: charCount
                });

                const hasOtherResults = WebChat.speechAndTextSyncResultQueue.some(item => WebChat.isSameMessageId(item.messageId, messageId));

                if (!hasOtherResults) {
                    delete WebChat.speechAndTextSyncProgress[messageId];
                    WebChat.speechAndTextSyncQueue = WebChat.speechAndTextSyncQueue.filter(
                        item => !WebChat.isSameMessageId(item.messageId, messageId)
                    );
                }
                WebChat.speechAndTextSyncIsProcessing = false;
            }
        }, tickMs);
    },

    
    clearSpeechAndTextSyncTimer: function () {
        if (WebChat.speechAndTextSyncTimer) {
            clearInterval(WebChat.speechAndTextSyncTimer);
            WebChat.speechAndTextSyncTimer = null;
        }
        WebChat.speechAndTextSyncIsProcessing = false;
    },

    speechSyncDebugLog: function (stage, payload) {
        if (!WebChat.speechSyncDebugEnabled) return;
        try {
            console.log("[speech-sync][" + stage + "]", {
                latestRequestId: WebChat.latestMessageSendRequestId,
                resultQueueSize: WebChat.speechAndTextSyncResultQueue.length,
                syncQueueSize: WebChat.speechAndTextSyncQueue.length,
                processing: WebChat.speechAndTextSyncIsProcessing,
                payload: payload || {}
            });
        } catch (e) {
            console.warn("[speech-sync] debug log failed", e);
        }
    },

    normalizeMessageId: function (messageId) {
        if (messageId == null) return "";
        return String(messageId).trim().toLowerCase();
    },

    isSameMessageId: function (leftId, rightId) {
        return WebChat.normalizeMessageId(leftId) === WebChat.normalizeMessageId(rightId);
    },

    registerStreamMessageSendRequestId: function (messageId, sendRequestId) {
        if (messageId == null || sendRequestId == null) return;
        WebChat.streamMessageRequestMap[WebChat.normalizeMessageId(messageId)] = sendRequestId;
        WebChat.speechSyncDebugLog("bind_message_request", {
            messageId: messageId,
            sendRequestId: sendRequestId
        });
    },

    isStaleSendRequestId: function (sendRequestId) {
        return sendRequestId != null && sendRequestId !== WebChat.latestMessageSendRequestId;
    },

    isStaleStreamMessageByMessageId: function (messageId) {
        var rid = WebChat.streamMessageRequestMap[WebChat.normalizeMessageId(messageId)];
        return rid != null && WebChat.isStaleSendRequestId(rid);
    },

    
    Parser: class {
        constructor(...targetKeys) {
            this.result = { key: null };
            this.setKeys = new Set(targetKeys);
            this.stateCurrent = "initial";
            this.stateEscapeNext = false;
            this.stateInsideString = false;
            this.stateIsTargetValue = false;
            this.stateValueStarted = false;
            this.stringCurrentKey = "";
        }
        processChunk(chunk) {
            this.result = { key: null };
            for (let loop = 0; loop < chunk.length; loop++) {
                const char = chunk[loop];
                if (this.stateEscapeNext) {
                    this.stateEscapeNext = false;
                    if (this.stateIsTargetValue) {
                        this.stateValueStarted = true;
                        this.result = { key: this.stringCurrentKey, state: "starting" };
                    }
                    continue;
                }
                if (char === "\\") {
                    this.stateEscapeNext = true;
                }
                if (char === '"' && !this.stateEscapeNext) {
                    this.stateInsideString = !this.stateInsideString;
                    if (this.stateInsideString && this.stateCurrent === "initial") {
                        this.stateCurrent = "key";
                        this.stringCurrentKey = "";
                    } else if (!this.stateInsideString && this.stateCurrent === "key") {
                        this.stateCurrent = "afterKey";
                    } else if (this.stateInsideString && this.stateCurrent === "value" && this.setKeys.has(this.stringCurrentKey)) {
                        this.stateIsTargetValue = true;
                        this.stateValueStarted = false;
                        this.result = { key: null };
                    } else if (!this.stateInsideString && this.stateCurrent === "value" && this.stateIsTargetValue) {
                        this.result = { key: this.stringCurrentKey, state: "ended" };
                        this.stateIsTargetValue = false;
                        this.stateValueStarted = false;
                        this.stateCurrent = "initial";
                        this.stringCurrentKey = "";
                    }
                    continue;
                }
                if (this.stateInsideString && this.stateCurrent === "key") {
                    this.stringCurrentKey += char;
                }
                if (!this.stateInsideString) {
                    if (char === "{") {
                        this.stateCurrent = "initial";
                        this.stringCurrentKey = "";
                        this.stateIsTargetValue = false;
                        this.stateValueStarted = false;
                    } else if (char === "}") {
                        this.stateCurrent = "initial";
                        this.stringCurrentKey = "";
                        this.stateIsTargetValue = false;
                        this.stateValueStarted = false;
                    } else if (char === "[") {
                        this.stateCurrent = "initial";
                        this.stringCurrentKey = "";
                        this.stateIsTargetValue = false;
                        this.stateValueStarted = false;
                    } else if (char === "]") {
                        this.stateCurrent = "initial";
                        this.stringCurrentKey = "";
                        this.stateIsTargetValue = false;
                        this.stateValueStarted = false;
                    } else if (char === ":" && this.stateCurrent === "afterKey") {
                        this.stateCurrent = "value";
                    } else if (char === "," && !this.stateInsideString) {
                        this.stateCurrent = "initial";
                        this.stringCurrentKey = "";
                        this.stateIsTargetValue = false;
                        this.stateValueStarted = false;
                    }
                } else if (this.stateIsTargetValue && !this.stateValueStarted) {
                    this.stateValueStarted = true;
                    this.result = { key: this.stringCurrentKey, state: "starting" };
                } else if (this.stateIsTargetValue && this.stateValueStarted) {
                    this.result = { key: this.stringCurrentKey, state: "starting" };
                }
            }
            return this.result;
        }
    },
    
    StreamHtmlParser: class {
        constructor(targetElement, messageId) {
            this.currentNode = targetElement;
            this.originalNode = targetElement;
            this.messageId = messageId;
            this.htmlBuffer = "";
            this.textBuffer = "";
            this.inTag = false;
            this.isPotentialTag = false;

            // 為每個解析器實例創建獨立的文字累積器
            this.textNodeString = "";
            this.needSpeakTextToHeyGen = false;
        }
        flushTextBuffer() {
            if (this.textBuffer) {
                // 驗證 currentNode 是否有效
                if (!this.currentNode || !this.currentNode.appendChild) {
                    this.currentNode = this.originalNode;
                }

                // 在解析階段就先插入一個空的文字節點，作為之後 Streaming 逐字填入的位置
                const placeholderNode = document.createTextNode('');
                this.currentNode.appendChild(placeholderNode);

                // 將要顯示的文字內容和對應的 placeholder 一起放入同步佇列
                WebChat.speechAndTextSyncQueue.push({
                    messageId: this.messageId,
                    sendRequestId: WebChat.streamMessageRequestMap[this.messageId],
                    syncRootEl: this.originalNode,
                    currentNode: this.currentNode,
                    textNode: placeholderNode,
                    text: this.textBuffer,
                    textLength: this.textBuffer.length
                });

                // 使用實例自己的屬性，避免全域變數混亂
                if (this.textNodeString.length > 120 || this.needSpeakTextToHeyGen) {
                    WebChat.addToSpeechQueue(this.messageId, this.textNodeString + this.textBuffer);
                    this.textNodeString = "";
                    this.needSpeakTextToHeyGen = false;
                } else {
                    this.textNodeString += this.textBuffer;
                }

                this.textBuffer = "";
            }
        }
        processTag() {
            if (this.htmlBuffer.startsWith("</")) {
                if (this.currentNode.parentNode) {
                    const oldNode = this.currentNode;
                    this.currentNode = this.currentNode.parentNode;
                }
            } else if (this.htmlBuffer.endsWith("/>")) {
                const tempDiv = document.createElement("div");
                tempDiv.innerHTML = this.htmlBuffer;
                const newElement = tempDiv.firstChild;
                if (newElement) {
                    this.currentNode.appendChild(newElement);
                } else {
                    console.error(`❌ 自閉合 Tag 解析失敗: "${this.htmlBuffer}"`);
                }
            } else {
                const tempDiv = document.createElement("div");
                tempDiv.innerHTML = this.htmlBuffer;
                const newElement = tempDiv.firstChild;
                if (newElement) {
                    this.currentNode.appendChild(newElement);
                    const oldNode = this.currentNode;
                    this.currentNode = newElement;
                }
            }
            this.htmlBuffer = "";
        }
        parse(chunk) {
            // 驗證 currentNode 是否仍然有效
            if (!this.currentNode || !this.currentNode.appendChild) {
                this.currentNode = this.originalNode;
            }

            let processedChunk = "";
            let i = 0;

            // 使用實例自己的屬性，避免全域變數混亂
            let matchText = chunk.match(/[。，！？]/);
            if (matchText) {
                this.needSpeakTextToHeyGen = true;
            }
            while (i < chunk.length) {
                if (chunk[i] === "\\") {
                    if (i + 1 < chunk.length && chunk[i + 1] === "n") {
                        processedChunk += "<br/>";
                        i += 2;
                    } else {
                        let slashCount = 1;
                        i++;
                        while (i < chunk.length && chunk[i] === "\\") {
                            slashCount++;
                            i++;
                        }
                        if (i < chunk.length && chunk[i] === "n") {
                            i++;
                        }
                    }
                } else {
                    processedChunk += chunk[i];
                    i++;
                }
            }
            for (const char of processedChunk) {
                if (this.inTag) {
                    this.htmlBuffer += char;
                    if (char === ">") {
                        this.processTag();
                        this.inTag = false;
                    }
                } else if (this.isPotentialTag) {
                    if (/[a-zA-Z\/]/.test(char)) {
                        this.inTag = true;
                        this.isPotentialTag = false;
                        this.htmlBuffer += char;
                    } else {
                        this.textBuffer += this.htmlBuffer + char;
                        this.htmlBuffer = "";
                        this.isPotentialTag = false;
                    }
                } else if (char === "<") {
                    this.flushTextBuffer();
                    this.isPotentialTag = true;
                    this.htmlBuffer = "<";
                } else {
                    this.textBuffer += char;
                }
            }
            this.flushTextBuffer();
        }
        end() {
            if (this.isPotentialTag) {
                this.textBuffer += this.htmlBuffer;
                this.htmlBuffer = "";
            }
            this.flushTextBuffer();

            // 發送剩餘的文字到 HeyGen（如果有的話）
            if (this.textNodeString.length > 0) {
                WebChat.addToSpeechQueue(this.messageId, this.textNodeString);
            }

            // 標記此 messageId 的 Stream 已完成
            WebChat.markMessageStreamComplete(this.messageId);

            // 在這裡才真正清理解析器實例
            setTimeout(() => {
                if (WebChat.messageParsers.has(this.messageId)) {
                    WebChat.messageParsers.delete(this.messageId);
                }
            }, 100); // 短暫延遲確保沒有更多 chunk
        }

        // 清理方法
        cleanup() {
            this.textNodeString = "";
            this.needSpeakTextToHeyGen = false;
        }
    },
    
    
    

    
    detectMaliciousContent: function (content) {
        if (!content || typeof content !== 'string') {
            return false;
        }

        // 先將 HTML 實體解碼以便檢測
        let decodedContent = content
            .replace(/&#39;/g, "'")
            .replace(/&#039;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');

        // 定義惡意模式
        const maliciousPatterns = [
            // JavaScript 執行相關
            /javascript\s*:/gi,
            /on\w+\s*=\s*["'][^"']*["']/gi,
            /on\w+\s*=\s*[^>\s]+/gi,

            // 常見攻擊函數
            /alert\s*\(/gi,
            /confirm\s*\(/gi,
            /prompt\s*\(/gi,
            /eval\s*\(/gi,
            /fetch\s*\(/gi,
            /XMLHttpRequest/gi,

            // DOM 操作
            /document\./gi,
            /window\./gi,
            /location\./gi,
            /cookie/gi,

            // Script 標籤
            /<script[\s\S]*?>/gi,
            /<\/script>/gi,
            /<iframe[\s\S]*?>/gi,
            /<\/iframe>/gi,

            // 危險的 link 標籤內容
            /\[link[^\]]*\][^[]*(?:alert|fetch|eval|script|javascript|onclick|onerror|onload)[^[]*\[\/link\]/gi
        ];

        // 檢測原始內容和解碼後的內容
        return maliciousPatterns.some(pattern =>
            pattern.test(content) || pattern.test(decodedContent)
        );
    },

    
    convertToFullWidth: function (text) {
        if (!text || typeof text !== 'string') {
            return text;
        }

        // 首先處理 HTML 實體
        const htmlEntityMap = {
            "&#39;": "＇",     // HTML 實體單引號轉全形
            "&#039;": "＇",    // HTML 實體單引號轉全形（另一種格式）
            "&quot;": "＂",    // HTML 實體雙引號轉全形
            "&lt;": "＜",      // HTML 實體小於號轉全形
            "&gt;": "＞",      // HTML 實體大於號轉全形
            "&amp;": "＆"      // HTML 實體 & 符號轉全形
        };

        // 然後處理普通符號
        const conversionMap = {
            "'": "＇",    // 單引號轉全形
            '"': "＂",    // 雙引號轉全形
            "<": "＜",    // 小於號轉全形
            ">": "＞",    // 大於號轉全形
            "&": "＆",    // & 符號轉全形
            "(": "（",    // 左括號轉全形
            ")": "）",    // 右括號轉全形
            ";": "；",    // 分號轉全形
            ":": "：",    // 冒號轉全形
            "=": "＝",    // 等號轉全形
            "/": "／",    // 斜線轉全形
            "\\": "＼",   // 反斜線轉全形
            "+": "＋",    // 加號轉全形
            "-": "－",    // 減號轉全形
            "*": "＊",    // 星號轉全形
            "?": "？",    // 問號轉全形
            "!": "！",    // 驚嘆號轉全形
            "[": "［",    // 左方括號轉全形
            "]": "］",    // 右方括號轉全形
            "{": "｛",    // 左大括號轉全形
            "}": "｝",    // 右大括號轉全形
            "|": "｜",    // 豎線轉全形
            "^": "＾",    // 插入符號轉全形
            "~": "～",    // 波浪號轉全形
            "`": "｀",    // 反引號轉全形
            "%": "％",    // 百分號轉全形
            "$": "＄",    // 美元符號轉全形
            "#": "＃"     // 井號轉全形
        };

        let result = text;

        // 先處理 HTML 實體
        for (const [entity, fullWidth] of Object.entries(htmlEntityMap)) {
            result = result.replace(new RegExp(entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), fullWidth);
        }

        // 再處理普通符號
        for (const [halfWidth, fullWidth] of Object.entries(conversionMap)) {
            result = result.replace(new RegExp('\\' + halfWidth, 'g'), fullWidth);
        }

        return result;
    },

    
    sanitizeUserInput: function (input) {
        if (!input || typeof input !== 'string') {
            return input;
        }

        // 檢測是否包含惡意內容
        if (WebChat.detectMaliciousContent(input)) {
            return WebChat.convertToFullWidth(input);
        }

        return input;
    },

    
    
    

    doLoad: function () {
        if (!!Util.getConfig("isDraggable")) {
            document.getElementById("left-header").style.cursor = "grab";
            document.getElementById("left-header").addEventListener("mousedown", function (e) {
                const data = {
                    type: "mousedown",
                    data: {
                        clientX: e.clientX,
                        clientY: e.clientY,
                    },
                };
                Util.log(data);
                if (parent.window != window && !!WebChat.parentIFrameUrl && WebChat.isDrag) WebChat.postMessage(data);
            });
            document.getElementById("left-header").addEventListener("dragend", function (e) {
                const data = {
                    type: "dragend",
                    target: e.dataTransfer.dropEffect === "none" ? "other" : "self",
                    data: {
                        clientX: e.clientX,
                        clientY: e.clientY,
                    },
                };
                Util.log(data);
                if (parent.window != window && !!WebChat.parentIFrameUrl && WebChat.isDrag) WebChat.postMessage(data);
            });
        } else document.getElementById("left-header").style.cursor = "default";
        WebChat.enableConditions = {
            ApplyAgentButton: "WebChat.chatId != null && !WebChat.isInAgentService",
            AttachmentButton: "WebChat.chatId != null && WebChat.isInAgentService",
            ImageButton: "WebChat.chatId != null && WebChat.isInAgentService",
            EmojiButton: "WebChat.chatId != null",
            HotTopicButton: "",
            ChangeRichMenuButton: Util.getConfig("richMenu"),
            RightZone: Util.getConfig("contact"),
            RestartChatButton: "WebChat.chatId == null",
            EditorZone: "WebChat.chatId != null",
        };
        WebChat.isInAgentService = WebChat.forageStorage.getItem("isInAgentService") == "true" ? true : false;
        WebChat.isDisconnectionDelay = !WebChat.isInAgentService;
        WebChat.isEverInAgentService = WebChat.forageStorage.getItem("isInAgentService") == "true" ? true : false;
        WebChat.submitedSurvey = WebChat.forageStorage.getItem("submitedSurvey");

        let history = WebChat.forageStorage.getItem("historyMessage");
        if (history && history != "null") WebChat.preMessageRecord = JSON.parse(history);
        else WebChat.preMessageRecord = [];

        WebChat.queryTenantInfo();

        // 控制RichMenuButton triangle icon
        if ($("#RichMenuImg").is(":visible")) $("#RichMenuButton").removeClass("menu-open").addClass("menu-close");
        WebChat.handleImagePaste();
        WebChat.MonitorPageFocus();
        WebChat.setI18nLanguage();
        // 初始化 HeyGen AI 虛擬人
        WebChat.initHeyGen();
    },
    handleImagePaste: function () {
        document.getElementById("Editor").addEventListener("paste", function (event) {
            var clipboardData = (event.clipboardData || event.originalEvent.clipboardData);
            if (clipboardData && clipboardData.items) {
                let data = {
                    files: []
                };
                for (var i = 0; i < clipboardData.items.length; i++) {
                    var item = clipboardData.items[i];
                    if (item.kind === 'file') {
                        var file = item.getAsFile();
                        data.files.push(file);
                    }
                }
                $('#fileupload').fileupload('add', data);
            }
        });

    },

    processImageFile: function (file, callback) {
        var reader = new FileReader();
        reader.onload = function (e) {
            var img = new Image();
            img.src = e.target.result;
            img.onload = function () {
                // 創建 canvas 元素並設置寬高
                var canvas = document.createElement("canvas");
                var ctx = canvas.getContext("2d");
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                // 將處理後的圖像轉為 Blob 並執行回調
                canvas.toBlob(function (blob) {
                    callback(blob, file.name);
                }, "image/jpeg");
            };
        };
        reader.readAsDataURL(file);
    },
    uploadImage: function (formData, isHandle) {
        const data = {
            originalFiles: formData.getAll('file'),
            files: formData.getAll('file'),
            submit: function () {
                $("#fileupload").fileupload('send', {
                    files: formData.getAll('file'),
                    formData: {
                        args: JSON.stringify({
                            isImage: true,
                            tenantCode: WebChat.tenantCode,
                            channel: "web",
                        })
                    }
                });
            }
        };
        File.doUploadAdd(null, data, isHandle);
    },
    setConfig: function () {
        // const title = Util.getConfig("isShowGWBotName")
        // ? WebChat.tenantInfo.botName
        //     ? WebChat.tenantInfo.botName
        //     : WebChat.text("Title")
        // : WebChat.text("Title");
        const title = "1966長照專線";
        $("#nvbarTitle").text(title);
        $("#nvbarTitle").attr("title", title);

        if (Util.getConfig("isShowLogoImage")) {
            $("#logoImage").attr("src", Util.getConfig("LogoImageUrl") || "image/logo.png");
            $("#logo").show();
        }

        if (Util.getConfig("isShowHelpButton")) {
            WebChat.hintHtmlMap["help"] = WebChat.text("HelpMessage");
            $("#HelpButton").text(WebChat.text("HelpButtonText"));
            $("#HelpButton").attr("aria-label", WebChat.text("HelpButtonText"));
            $("#HelpButton").on("click keypress", function () {
                WebChat.showHint("help");
            });
        } else $("#HelpListItem").hide();

        if (Util.getConfig("isHotquestion")) {
            HotTopic.ini();
            $("#HotQuestionButton").text(WebChat.text("FocusTopic"));
            $("#HotQuestionButton").attr("aria-label", WebChat.text("FocusTopic"));
            $("#HotTopicModalTitle").text(WebChat.text("FocusTopic"));
            $("#HotQuestionButton").on("click keypress", function () {
                $("#HotTopicModal").modal("show");
            });
        } else $("#HotQuestionListItem").hide();

        if (Util.getConfig("isShowAttentionButton")) {
            WebChat.hintHtmlMap["attention"] = WebChat.text("AttentionMessage");
            $("#AttentionButton").text(WebChat.text("AttentionButtonText"));
            $("#AttentionButton").attr("aria-label", WebChat.text("AttentionButtonText"));
            $("#AttentionButton").on("click keypress", function () {
                WebChat.showHint("attention");
            });
        } else $("#AttentionListItem").hide();

        if (Util.getConfig("isShowVersionButton")) {
            WebChat.hintHtmlMap["version"] = WebChat.version;
            $("#VersionButton").text(WebChat.text("VersionButtonText"));
            $("#VersionButton").attr("aria-label", WebChat.text("VersionButtonText"));
            $("#VersionButton").on("click keypress", function () {
                WebChat.showHint("version");
            });
        } else $("#VersionListItem").hide();

        if (Util.getConfig("isShowSurveyButton")) {
            $("#SurveyButton").text(WebChat.text("SurveyButtonText"));
            $("#VersionButton").attr("aria-label", WebChat.text("SurveyButtonText"));
            $("#SurveyButton").on("click keypress", WebChat.showSurvey);
        } else $("#SurveyListItem").hide();

        if (
            (!!Util.getParameterByName("useMode") && Util.getParameterByName("useMode") === "full") ||
            !Util.getConfig("isShowExitButton")
        )
            $("#ExitButton").hide();

        if (!Util.getConfig("isShowAgentIcon")) $("#ApplyAgentButton").hide();

        if (!Util.getConfig("isShowEmojiIcon")) $("#EmojiButton").hide();

        if (Util.getConfig("isShowDropdownMenuIcon")) {
            $("#hamburger-menu").on("keypress", function () {
                $("#hamburger-menu").dropdown("toggle");
            });
        } else $("#hamburger-menu").hide();

        if (Util.getConfig("contact")) {
            WebChat.hintHtmlMap["SetPdSuccess"] = WebChat.text("SetPdSuccessMsg");
            Auth.doLoad();
            Contact.doLoad();
        } else $("#MemberServiceListItem").hide();

        if (Util.getConfig("webCall")) WebCallStart.doload();

        if (Util.getConfig("openVidu")) OpenVidu.doload();

        if (Util.getConfig("richMenu")) RichMenu.Ini();

        if (Util.getConfig("isQueryquestion")) WebChat.setAutocomplete();

        if (Util.getConfig("isGetLocation")) WebChat.getLocation();

        if (Util.getConfig("isSpeechRecognition")) WebSpeechRecognition.doLoad();
        else {
            $("#SpeechToTextBtn").remove();
            $("#toggle-mic-btn").remove();
            $("#SpeechToTextEndBtn").remove();
            $("#audio-wave").remove();
        }

        if (Util.getConfig("isSpeechSynthesis")) {
            if (Util.getConfig("sttMode") === "browser") {
                WebSpeechSynthesis.doLoad();
            } else {
                $("#DefaultStartTTSBtn").hide();
                $("#DefaultCloseTTSBtn").hide();
            }
        } else {
            $("#DefaultStartTTSBtn").remove();
            $("#DefaultCloseTTSBtn").remove();
        }
        if (Util.getConfig("loginType") === "member") {
            if (Util.getConfig("ecpLoginType") === "otp") {
                $("#login-password").remove();
                $("#login-password-hint").remove();
            }
        }

        
        // if (!Util.getConfig("isShowLineLogin")) $(".loginLineBtn").remove();
        // if (!Util.getConfig("isShowGoogleLogin")) $(".loginGoogleBtn").remove();
        // if (!Util.getConfig("isShowFbLogin")) $(".loginFbBtn").remove();
        // if (!Util.getConfig("isShowMicrosoftLogin")) $(".loginMicrosoftBtn").remove();

        
        if (!Util.checkshowIcon("isShowLineLogin")) $(".loginLineBtn").remove();
        if (!Util.checkshowIcon("isShowGoogleLogin")) $(".loginGoogleBtn").remove();
        if (!Util.checkshowIcon("isShowFbLogin")) $(".loginFbBtn").remove();
        if (!Util.checkshowIcon("isShowMicrosoftLogin")) $(".loginMicrosoftBtn").remove();

        WebChat.setQueueBtnStatus("hide");
    },

    setAutocomplete: function () {
        $("#Editor").autocomplete();
        WebChat.ajax({
            url: Util.getConfig("CRMGatewayUrl") + "openapi/web/message/getAllQuestion",
            data: {
                tenantCode: WebChat.tenantCode,
            },
            success: function (ret) {
                Util.debug("allQuestion", ret.result);
                let questionData = [];

                for (let key in ret.result) {
                    let items = ret.result[key];
                    questionData.push({
                        
                        label: key,
                        key: key,
                    });
                    for (let i = 0; i < items.length; i++) {
                        
                        questionData.push({
                            label: items[i],
                            key: key,
                        });
                    }
                }

                let editor = $("#Editor");
                editor.autocomplete({
                    select: function (event, ui) {
                        if (event.keyCode == 13) {
                            $(this).autocomplete("close");
                            return false;
                        }
                    },
                    source: function (request, response) {
                        var results = $.ui.autocomplete.filter(questionData, request.term);
                        let result = [];
                        let filter = [];
                        for (let i = 0; i < results.length; i++) {
                            
                            let key = results[i].key;
                            if (!!~filter.indexOf(key)) continue;
                            else {
                                switch (Util.getConfig("queryQuestion_QType")) {
                                    case "standard":
                                        result.push({
                                            label: results[i].key,
                                            key: results[i].key,
                                        });
                                        break;
                                    case "all":
                                        result.push(results[i]);
                                        break;
                                }
                                filter.push(key);
                            }
                            if (Util.getConfig("QueryquestionLimits") === result.length) break;
                        }
                        Util.debug("autoCompleteContent: ", result);
                        response(result);
                    },
                    classes: {},
                });
                editor.autocomplete("option", "position", {
                    my: "top",
                    at: "bottom",
                });
            },
        });
    },

    setRichMenuWidth: function () {
        RichMenu.getRichMenuArea();
        WebChat.refreshMessageListLayout();
    },

    optionClicked: function (optionNo, innerNo) {
        var messageShow = {
            type: Constant.TYPE_TEXT,
            content: "" + optionNo,
        };
        var elementId = WebChat.addMessage(messageShow);

        var messageSend = {
            type: Constant.TYPE_TEXT,
            content: "" + innerNo,
        };
        WebChat.sendMessage(messageSend, elementId);
    },
    
    optionSurveyClicked: function (surveyText) {
        if (!!WebChat.chatId) {
            var messageShow = {
                type: Constant.TYPE_TEXT,
                content: "" + surveyText,
            };
            var elementId = WebChat.addMessage(messageShow);

            var messageSend = {
                type: Constant.TYPE_TEXT,
                content: "" + surveyText,
            };
            WebChat.sendMessage(messageSend, elementId);
        }
    },

    linkClicked: function (surveyText) {
        if (WebChat.isEverInAgentService) {
            return false;
        }
        var messageShow = {
            type: Constant.TYPE_TEXT,
            content: "" + surveyText,
        };
        var elementId = WebChat.addMessage(messageShow);
        var messageSend = {
            type: Constant.TYPE_TEXT,
            content: "" + surveyText,
        };
        WebChat.sendMessage(messageSend, elementId);
    },

    swiper_li_button: function (link) {
        if (WebChat.isReconnect) return;
        if (WebChat.chatId != null) {
            if (!!$(link).attr("oauthtype")) {
                
                const question = $(link).attr("oauthquestion");
                const questionKeyId = $(link).attr("oauthquestionkeyid");
                const channel = $(link).attr("oauthchannel");
                let isNeedSatisfaction = $(link).attr("isNeedSatisfaction");
                let sendCodeIsNeedSatisfaction = "1";
                if (isNeedSatisfaction === null || isNeedSatisfaction === undefined) {
                    isNeedSatisfaction = true;
                    sendCodeIsNeedSatisfaction = "1";
                }
                else {
                    if (isNeedSatisfaction === "true") {
                        isNeedSatisfaction = true;
                        sendCodeIsNeedSatisfaction = "1";
                    }
                    else if (isNeedSatisfaction === "false") {
                        isNeedSatisfaction = false;
                        sendCodeIsNeedSatisfaction = "0";
                    }
                }
                const sendCode = {
                    name: question,
                    type: "QA",
                    keyId: questionKeyId,
                    action: "ReSend",
                    isNeedSatisfaction: sendCodeIsNeedSatisfaction,
                };

                const data = {
                    question,
                    questionKeyId,
                    sendCode,
                    channel,
                    isNeedSatisfaction,
                };
                WebChat.executeData = data;
                Auth.doChannelLoginBtnClick(channel);
            } else {
                let ShowSatis = true;
                if (link.hasOwnProperty("isShowSatis") && link.isShowSatis == false) {
                    ShowSatis = false;
                }
                var messageShow = {
                    type: Constant.TYPE_TEXT,
                    content: decodeURIComponent($(link).attr("reply")),
                    FCode: decodeURIComponent($(link).attr("q")),
                    ShowSatis: ShowSatis
                };
                if (!Util.getConfig("azureOpenAIEngineEnable")) {
                    var elementId = WebChat.addMessage(messageShow);
                }
                var messageSend = {
                    type: Constant.TYPE_TEXT,
                    content: decodeURIComponent($(link).attr("q")),
                    showMessage: ShowSatis
                };
                if (link.hasOwnProperty("isClear") && link.isClear == true) {
                    let messageSendTemp = JSON.parse(messageSend.content);
                    messageSendTemp.MSId = messageSendTemp.MSId.replace(/.*#/, 'clear#');
                    messageSend.content = messageSendTemp;
                    link["isClear"] = false;
                }
                if (Util.getConfig("azureOpenAIEngineEnable")) {
                    WebChat.sendMessage(messageSend, elementId, "azureOpenAIEngine");
                }
                else {
                    WebChat.sendMessage(messageSend, elementId);
                }
            }
        } else $("#DisconnectModal").modal("show");
    },

    editorChanged: function (e) {
        if (WebChat.isInAgentService) {
            clearInterval(WebChat.timer);
            WebChat.timercount = 0;
            var content = Util.getHtmlValueById("Editor");
            WebChat.timer = setInterval(function () {
                WebChat.timercount++;
                if (WebChat.timercount == 5) {
                    
                    WebChat.sendPreviewMessage(content);
                    WebChat.timercount = 0;
                    clearInterval(WebChat.timer);
                }
            }, 100);
        }
    },

    checkWordLimit: function () {
        var content = $("#Editor").val();
        if (content.length > WebChat.tenantInfo.sendMessageMaxLength) {
            $("#Editor").val(content.substring(0, WebChat.tenantInfo.sendMessageMaxLength));
            alert(WebChat.text("OverInputLimit"));
            return;
        }
    },

    editorKeyUp: function (e) {
        var content = $("#Editor").val();
        if (content.length > 0) {
            // if (!$("#SendButton").hasClass("active")) $("#SendButton").addClass("active");
            if (!!Util.getConfig("isSpeechRecognition")) WebSpeechRecognition.setSpeechBtn();
            if (!WebChat.isExistEditorText && (WebChat.isDisconnectionDelay && !WebChat.isInAgentService)) {
                WebChat.setDisconnectionDelay(Util.getConfig("disconnectionDelay"));
                WebChat.startHeyGenKeepAlive();
            }
            WebChat.isExistEditorText = true;
        } else {
            // $("#SendButton").removeClass("active");
            if (!!Util.getConfig("isSpeechRecognition")) WebSpeechRecognition.init();
            if (WebChat.isExistEditorText && (WebChat.isDisconnectionDelay && !WebChat.isInAgentService)) {
                WebChat.setDisconnectionDelay(0);
                WebChat.keepAliveHeyGen();
                WebChat.stopHeyGenKeepAlive();
            }
            WebChat.isExistEditorText = false;
        }
    },

    editorKeyDown: function (e) {
        if (e.shiftKey == true) {
            if (e.keyCode == 13) {
                
            }
        } else {
            if (e.keyCode == 13) {
                e.preventDefault();
                if (Util.getConfig("isQueryquestion")) $(this).autocomplete("close");
                WebChat.doSendButtonClick();
            }
        }
    },

    OpenP4Page: function (url) {
        let urlstr = new URL(url);

        // 獲取指定的參數值
        let questionValue = urlstr.searchParams.get('question');
        let isShowQuestionValue = urlstr.searchParams.get('isShowQuestion');

        // 移除指定的參數值
        urlstr.searchParams.delete('question');
        urlstr.searchParams.delete('isShowQuestion');
        url = urlstr.toString();

        if (!!Util.isSafeUrl(url)) {

            if (WebChat.chatId != null) {
                if (questionValue != undefined && questionValue != "" && questionValue != null) {
                    var message = {
                        type: Constant.TYPE_TEXT,
                        content: questionValue,
                    };
                    if (isShowQuestionValue == "1") {
                        var elementId = WebChat.addMessage(message);
                        WebChat.sendMessage(message, elementId);
                    }
                    if (isShowQuestionValue == "0") {
                        WebChat.sendMessage(message);
                    }
                }
            }
            if (parent.window != window && !!WebChat.parentIFrameUrl) {
                
                new Promise(function (resolve, reject) {
                    resolve(Util.setCookieToStorage("webview", url));
                }).then(() => {
                    window.parent.postMessage(
                        JSON.stringify({
                            type: "openP4Page",
                        }),
                        WebChat.parentIFrameUrl
                    );
                    WebChat.isDrag = false;
                });
            } else if (window.parent.EcpWebChatEntry != null) {
                window.parent.EcpWebChatEntry.OpenP4Page(url);
                WebChat.isDrag = false;
            } else WebChat.OpenInternalP4Page(url);
        }
    },

    OpenInternalP4Page: function (url) {
        $("#ifP4Url").attr("allow", "camera *; microphone *; fullscreen; display-capture;");
        $("#ifP4Url").attr("src", url);
        $("#dvP4Page").css("display", "block");
        var timer = null;

        const myDiv = document.getElementById('dvP4Page');
        // 當元素聚焦時啟動timer
        WebChat.keepAliveHeyGen();
        myDiv.addEventListener('mouseenter', () => {
            timer = setInterval(() => {
                // console.log("hello");
                WebChat.ajax({
                    url: Util.getConfig("CRMGatewayUrl") + "openapi/extendChatTime",
                    data: {
                        chatId: WebChat.chatId,
                    }, error: function () { },
                    success: function (ret) {
                        WebChat.keepAliveHeyGen();
                    },
                });
            }, 30000);
        });

        // 當元素失去焦點時停止timer
        myDiv.addEventListener('mouseleave', () => {
            clearInterval(timer);  // 停止計時器
            timer = null;  // 將 timer 重置為 null
        });
    },
    setDisconnectionDelay(delayTime) {
        WebChat.ajax({
            url: Util.getConfig("CRMGatewayUrl") + "openapi/setDisconnectionDelay",
            data: {
                chatId: WebChat.chatId,
                disconnectionDelay: delayTime,
            },
            error: function () {
            },
            success: function (ret) {
            },
        });
    },
    MonitorPageFocus() {
        try {
            if (Util.getConfig("disconnectionDelay")) {
                // 使用 visibilitychange 事件來監測頁面是否可見
                document.addEventListener("visibilitychange", () => {
                    if (document.visibilityState === "visible") {
                        WebChat.logFocus();
                    } else {
                        WebChat.logBlur();
                    }
                });
                // 使用 focus 和 blur 事件來檢測頁面聚焦和失焦
                if (Util.doDetectMobile()) {
                    window.top.addEventListener("pageshow", WebChat.logFocus);
                    window.top.addEventListener("pagehide", WebChat.logBlur);
                } else {
                    window.top.addEventListener("focus", WebChat.logFocus);
                    window.top.addEventListener("blur", WebChat.logBlur);
                }

            }
        } catch {
            console.warn("跨域限制，無法訪問當前視窗");
        }
    },
    startHeyGenKeepAlive: function () {
        if (!WebChat.chatId) {
            return;
        }
        if (WebChat.keepAliveIntervalId) {
            clearInterval(WebChat.keepAliveIntervalId);
        }
        WebChat.keepAliveHeyGen();
        WebChat.keepAliveIntervalId = setInterval(function () {
            WebChat.keepAliveHeyGen();
        }, 30000);
    },
    stopHeyGenKeepAlive: function () {
        if (WebChat.keepAliveIntervalId) {
            clearInterval(WebChat.keepAliveIntervalId);
            WebChat.keepAliveIntervalId = null;
        }
    },
    logFocus: function () {
        //輸入框有文字則永遠Blur狀態
        if (!WebChat.isExistEditorText && !WebChat.isFocusWindow
            && document.visibilityState === "visible" && (WebChat.isDisconnectionDelay && !WebChat.isInAgentService)) {
            WebChat.setDisconnectionDelay(0);

            WebChat.stopHeyGenKeepAlive();
            WebChat.isFocusWindow = true;
        }
    },
    logBlur: function () {
        //輸入框有文字則永遠Blur狀態
        if (!WebChat.isExistEditorText && WebChat.isFocusWindow
            && document.visibilityState !== "visible" && (WebChat.isDisconnectionDelay && !WebChat.isInAgentService)) {
            WebChat.setDisconnectionDelay(Util.getConfig("disconnectionDelay"));
            WebChat.keepAliveHeyGen();
            WebChat.startHeyGenKeepAlive();
            WebChat.isFocusWindow = false;
        }
    },

    CloseP4Page: function () {
        $("#ifP4Url").attr("allow", "");
        $("#ifP4Url").attr("src", "");
        $("#dvP4Page").css("display", "none");
    },

    zoomInP4Page: function () {
        $("#dvP4Page").css("height", "");
        $("#dvP4Page").css("width", "");
        $("#ifP4Url").css("display", "block");
        $("#btnP4PageMinimum").css("display", "block");
        $("#btnP4PageZoomIn").css("display", "none");
    },

    minimumP4Page: function () {
        $("#dvP4Page").css("height", "50px");
        $("#dvP4Page").css("width", "130px");
        $("#ifP4Url").css("display", "none");
        $("#btnP4PageZoomIn").css("display", "block");
        $("#btnP4PageMinimum").css("display", "none");
    },

    OpenUrl: function (url) {
        location.href = url;
    },

    doBeforeUnload: function () {
        if (!!$("#statusMessage").length) $("#statusMessage").remove();
        WebChat.forageStorage.setItem("isInAgentService", WebChat.isInAgentService);
        WebChat.forageStorage.setItem("tenantCode", WebChat.tenantCode);

        // 清理所有解析器實例
        WebChat.cleanupAllParsers();

        // 清理語音佇列
        WebChat.clearSpeechQueue();
        WebChat.forageStorage.setItem("submitedSurvey", WebChat.submitedSurvey);

        if (Util.getConfig("isSpeechSynthesis") && WebSpeechSynthesis.synth.speaking) WebSpeechSynthesis.synth.cancel();
        if (WebChat.tenantInfo) WebChat.forageStorage.setItem("tenantInfo", JSON.stringify(WebChat.tenantInfo));
        if (WebChat.chatId) WebChat.forageStorage.setItem("historyMessage", JSON.stringify(WebChat.preMessageRecord));
        if (Util.getConfig("webCall")) WebCallStart.webcallStop();
        if (WebChat.isInQueue) WebChat.doCancelQueueButtonClick();
        else {
            if (WebChat.socket != null) {
                WebChat.socket.close(4500);
                WebChat.socket = null;
            }
        }
    },

    sendBeaconDisconnectionDelay: function () {
        const data = JSON.stringify({
            chatId: WebChat.chatId,
            disconnectionDelay: 0,
        });
        const url = Util.getConfig("CRMGatewayUrl") + "openapi/setDisconnectionDelay";
        navigator.sendBeacon(url, new Blob([data], { type: 'application/json' }));
    },

    doApplyAgentButtonClick: function () {
        QuickReply.closeQuickReplyPool();
        if (WebChat.isButtonDisabled(this)) return;

        
        $("#ApplyAgentButton").attr("disabled", "disabled");
        setTimeout(function () {
            $("#ApplyAgentButton").removeAttr("disabled");
        }, 1000);
        
        
        if (WebChat.tenantInfo.isAnonymousToAgent) {
            
            WebChat.resetQueueZoneModal();
            WebChat.queueZoneModal("show");
            setTimeout(function () {
                // WebChat.isAgentWorkTime();
                WebChat.selectServiceGroup();
            }, 500);
        } else {
            if (Util.getCookieToStorage("tokenId") != undefined && Util.getCookieToStorage("tokenId") != null) {
                WebChat.resetQueueZoneModal();
                WebChat.queueZoneModal("show");
                setTimeout(function () {
                    // WebChat.isAgentWorkTime();
                    WebChat.selectServiceGroup();
                }, 500);
            } else {
                Auth.doLoginButtonClick();
            }
            Auth.loginnext = "toAgent";
        }
    },

    doAttachmentButtonClick: function () {
        if (WebChat.isButtonDisabled(this)) return;

        $("#fileupload").attr("accept", Util.getConfig("uploadFileAccept"));
        $("#fileupload").click();
    },

    doImageButtonClick: function () {
        if (WebChat.isButtonDisabled(this)) return;

        $("#fileupload").attr("accept", Util.getConfig("uploadImageAccept"));
        $("#fileupload").click();
    },

    doEmojiButtonClick: function () {
        if (WebChat.isButtonDisabled(this)) {
            return;
        }
        $("#EmojiButton").StickerEmotion("#Editor");
    },

    doCancelQueueButtonClick: function () {
        WebChat.isInQueue = false;
        WebChat.queueZoneModal("hide");
        WebChat.agentStop();
        WebChat.addSystemMessage(WebChat.text("CancelWaitMessage"));
    },

    setQueueBtnStatus: function (action) {
        
        if (Util.getConfig("isWaitQueue")) $("#waitQueue")[action]();
        $("#cancelQueue")[action]();
    },

    doWaitQueueButtonClick: function () {
        $("#waitQueue").hide();

        let showWaitQueueBtnTimeMin = WebChat.tenantInfo.chatTimeoutMinutes - 1;

        setTimeout(function () {
            $("#waitQueue").show();
        }, showWaitQueueBtnTimeMin * 60 * 1000);

        $("#queueZoneModal .wording").text(WebChat.text("ContinueSuccess"));

        var elementId = WebChat.addSystemMessage(WebChat.text("ContinueWaitMessage"));

        var messageSend = {
            type: Constant.TYPE_TEXT,
            content: "#queue?action=continue",
        };
        WebChat.sendMessage(messageSend, elementId);
    },

    doCloseButtonClick: function () {
        var callback = function () {
            WebChat.chatId = null;
            window.close();
        };
        WebChat.ajax({
            url: Util.getConfig("CRMGatewayUr") + "openapi/web/chat/stop",
            data: {
                chatId: WebChat.chatId,
            },
            error: callback,
            success: callback,
        });
    },

    doSendButtonClick: function (event) {
        if (WebChat.isButtonDisabled(this)) return;
        if (WebChat.isReconnect) return;
        // if (WebChat.isLockSendMessage) return;
        // WebChat.isLockSendMessage = true;
        
        if (
            !WebChat.tenantInfo.isAnonymousToChatBot &&
            !WebChat.isInAgentService &&
            Util.getCookieToStorage("tokenId") == undefined
        ) {
            Auth.doLoginButtonClick();
            Auth.loginnext = "sendMessage";
            return;
        }
        var msg = Util.getHtmlValueById("Editor")
            .replace(/<div>/g, "<br>")
            .replace(/<\/div>/g, "");
        var content = Util.unescapeHtml(msg);
        if (Util.getConfig("userInputFilter") === "symbol") content = content.replace(/\>/g, "").replace(/\</g, "");

        // XSS 防護：檢測並處理用戶輸入的惡意內容
        if (content != null && content.trim() != "") {
            content = WebChat.sanitizeUserInput(content);
        }

        if (content != null && content.trim() != "") {
            $("#Editor").val("");
            if (!!WebSpeechRecognition.isSupport) WebSpeechRecognition.init();
            // $("#SendButton").removeClass("active");
            var message = {
                type: Constant.TYPE_TEXT,
                content: content,
            };
            var elementId = WebChat.addMessage(message);
            

            setTimeout(function () {
                if (content == WebChat.tenantInfo.applyAgentCode && WebChat.isInAgentService == false) {
                    WebChat.doApplyAgentButtonClick();
                } else {
                    if (elementId != null) WebChat.sendMessage(message, elementId);
                    if (WebChat.isEverInAgentService) {
                        clearInterval(WebChat.timer); 
                        WebChat.sendPreviewMessage("");
                    }
                }
            }, 100);
        }
    },

    doSendMessage: function (SendMessage) {
        if (WebChat.isButtonDisabled(this)) return;
        var msg = SendMessage.replace(/<div>/g, "<br>").replace(/<\/div>/g, "");
        var content = Util.unescapeHtml(msg);

        // XSS 防護：檢測並處理用戶輸入的惡意內容
        if (content != null && content.trim() != "") {
            content = WebChat.sanitizeUserInput(content);
        }

        if (content != null && content.trim() != "") {
            var message = {
                type: Constant.TYPE_TEXT,
                content: content,
            };

            var elementId = "";
            if (msg.indexOf("faqvote:") != 0) elementId = WebChat.addMessage(message);
            else elementId = "ChatMessage_" + ++WebChat.messageIndex;

            WebChat.sendMessage(message, elementId);
        }
    },

    doImageClick: function (event) {
        var image = event.srcElement || event.target;
        var url = $(image).attr("url");
        if (!Util.isEmpty(url)) {
            window.open(url);
        }
    },

    doExitButtonClick: function () {
        WebChat.isDrag = true;
        if (parent.window != window) {
            WebChat.postMessage({
                type: "doExitButtonClick",
            });
        }
    },

    queueZoneModal: function (status) {
        if (status == "show") {
            $("#queueZoneModal").modal("show");
            $("div.modal-backdrop.fade.in").css("opacity", "1");
        } else {
            WebChat.resetQueueZoneModal();
            $("#queueZoneModal").modal("hide");
            $("div.modal-backdrop.fade.in").css("opacity", "0.5");
            $("img.clock").css("width", "200px");
            $("#queueZoneModal .wording").text(WebChat.tenantInfo.applyingAgentWord);
            WebChat.setQueueBtnStatus("hide");
        }
    },

    
    resetQueueZoneModal: function () {
        var firstChild = $("#queueZoneModal").children()[0];
        $(firstChild).addClass("modal-dialog_cust");
        $("#queueZoneModal").html(firstChild);
    },

    
    
    

    
    checkTenantStatus: function (res) {
        if (res && res.resultInfo) {
            const tenantInfo = res.resultInfo;
            if (tenantInfo.success) {
                WebChat.tenantInfo = res.tenantInfo;
                return true;
            } else {
                
                const chatId = WebChat.forageStorage.getItem("chatId");
                WebChat.tenantInfo = JSON.parse(WebChat.forageStorage.getItem("tenantInfo")) || null;
                if (chatId == null || chatId == undefined) WebChat.isNotActive = true;
                switch (tenantInfo.errorCode.toString()) {
                    case "10201":
                        localStorage.setItem("TenantErrMsg", tenantInfo.errorMessage || WebChat.text("Termination"));
                        location.href = Util.getConfig("WebChatUrl") + "inactive.html?tenantCode=" + WebChat.tenantCode;
                        break;
                    case "10207":
                        localStorage.setItem("TenantErrMsg", tenantInfo.errorMessage || WebChat.text("Termination"));
                        if (chatId == null || chatId == undefined)
                            location.href =
                                Util.getConfig("WebChatUrl") + "inactive.html?tenantCode=" + WebChat.tenantCode;
                        else
                            WebChat.notActiveUrl =
                                Util.getConfig("WebChatUrl") + "inactive.html?tenantCode=" + WebChat.tenantCode;
                        break;
                    case "10208":
                        localStorage.setItem("TenantErrMsg", tenantInfo.errorMessage || WebChat.text("Termination"));
                        if (chatId == null || chatId == undefined)
                            location.href =
                                Util.getConfig("WebChatUrl") + "inactive.html?tenantCode=" + WebChat.tenantCode;
                        else
                            WebChat.notActiveUrl =
                                Util.getConfig("WebChatUrl") + "inactive.html?tenantCode=" + WebChat.tenantCode;
                        break;
                    default:
                        localStorage.setItem("TenantErrMsg", WebChat.text("Termination"));
                        location.href = Util.getConfig("WebChatUrl") + "inactive.html?tenantCode=" + WebChat.tenantCode;
                        break;
                }
                return false;
            }
        } else {
            localStorage.setItem("TenantErrMsg", WebChat.text("Termination"));
            location.href = Util.getConfig("WebChatUrl") + "inactive.html?tenantCode=" + WebChat.tenantCode;
            return false;
        }
    },

    queryTenantInfo: function (reason) {
        if (WebChat.tenantCode != null) {
            WebChat.ajax({
                url: Util.getConfig("CRMGatewayUrl") + "openapi/web/ivr/tenantInfo",
                async: false,
                contentType: "application/json",
                data: {
                    _header_: {
                        tokenId: "",
                        language: Util.getConfig("language"),
                    },
                    tenantCode: WebChat.tenantCode,
                },
                error: function (e) {
                    WebChat.checkTenantStatus();
                },
                success: function (ret) {
                    if (WebChat.checkTenantStatus(ret) || !WebChat.isNotActive) {
                        if (reason !== "restart") {
                            let html =
                                '<div style="display: none;">' +
                                '<label for="fileupload"></label>' +
                                '<label for="avatarupload"></label>' +
                                '<label for="imgupload1"></label>' +
                                '<label for="imgupload2"></label>' +
                                '<label for="imgupload3"></label>' +
                                '<input id="fileupload" type="file" name="file[]" multiple tabindex="-1" title="fileupload">' +
                                '<input id="avatarupload" type="file" name="file" accept="image/*" tabindex="-1" title="avatarupload">' +
                                '<input id="imgupload1" type="file" name="file1" accept="image/*" tabindex="-1" title="imgupload1">' +
                                '<input id="imgupload2" type="file" name="file2" accept="image/*" tabindex="-1" title="imgupload2">' +
                                '<input id="imgupload3" type="file" name="file3" accept="image/*" tabindex="-1" title="imgupload3">' +
                                "</div>";
                            $("#upload_div").append(html);
                            WebChat.showLoadingOverlay();
                            File.initialize();
                            Stickertable.doLoad();
                            QuickReply.initQuickReplyPool();
                            WebChat.forageStorage.setItem("defaultspeak", true);

                            WebChat.toggleheygenControls(true);
                            $("#StopChatButton").text(WebChat.text("StopChatButton"));
                            $("#StopChatButton").attr("aria-label", WebChat.text("StopChatButton"));
                            $("#StopChatButton").on("click keypress", function () {
                                sessionStorage.removeItem("chatId");
                                WebChat.stopChat();
                            });

                            $("#RestartChatButton").on("click keypress", function () {
                                WebChat.restartChat();
                            });

                            $("#dvSurveyModalBody").html(Survey.getForm(WebChat.isInAgentService));
                            $("#dvSatisfyModalBody").html(Satisfy.getForm());
                            $("#dvSatisfyConfirmModalBody").html(Satisfy.getConfirmForm());

                            $("#submitSurveyButton").text(WebChat.text("Ok"));
                            $("#confirmSatisfy").html(WebChat.text("Ok"));
                            $("#sendFeedback").text(WebChat.text("Submit"));
                            $("#SurveyModalTitle").html(WebChat.text("SurveyButtonText"));
                            $("#SatisfyModalTitle").html(WebChat.text("SatisfyModalTitle"));
                            $("#SatisfyConfirmModalTitle").html(WebChat.text("SatisfyModalTitle"));

                            $("#submitSurveyButton").click(function () {
                                Survey.submitSurvey();
                            });
                            $("#sendFeedback").click(function () {
                                let messageSend = $(this).data("messageSend");
                                Satisfy.submitSatisfy(messageSend);
                            });
                            $("#confirmSatisfy").click(function () {
                                Satisfy.confirmSatisfy(false);
                            });
                            $("#ExitButton").on("keypress click", WebChat.doExitButtonClick);

                            $("#ApplyAgentButton").attr("title", WebChat.text("ApplyAgentButtonHint"));
                            $("#ApplyAgentButton").on("click keypress", WebChat.doApplyAgentButtonClick);

                            $("#AttachmentButton").attr("title", WebChat.text("UploadFile"));
                            $("#AttachmentButton").on("click keypress", WebChat.doAttachmentButtonClick);

                            $("#ImageButton").attr("title", WebChat.text("ImageButtonHint"));
                            $("#ImageButton").on("click keypress", WebChat.doImageButtonClick);

                            $("#EmojiButton").attr("title", WebChat.text("EmojiButtonHint"));
                            $("#EmojiButton").click(WebChat.doEmojiButtonClick);

                            $("#CloseButton").text(WebChat.text("Close"));
                            $("#CloseButton").on("click keypress", WebChat.doCloseButtonClick);

                            $("#SendButton").on("click keypress", WebChat.doSendButtonClick);

                            $("#Editor").keyup(WebChat.editorKeyUp);
                            $("#Editor").keydown(WebChat.editorKeyDown);
                            $("#Editor").attr("placeholder", WebChat.text("EditorPlaceHolder"));
                            
                            $("#Editor").on("input", WebChat.editorChanged);

                            $(".modal").on("hidden.bs.modal", function (e) {
                                $("input", this).val("");
                            });

                            
                            $("#LeaveWordModalTitle").html(WebChat.text("LeaveWord"));
                            $("#LeaveWordButton").on("click keypress", LeaveWord.send);
                            $("#LeaveWordClose").on("click keypress", LeaveWord.close);

                            $("#btnP4PageClose").on("click keypress", WebChat.CloseP4Page);

                            $("#btnP4PageMinimum").on("click keypress", WebChat.minimumP4Page);

                            $("#btnP4PageZoomIn").on("click keypress", WebChat.zoomInP4Page);

                            
                            $(document).on("keypress click", ".navbar-collapse.in", function (e) {
                                if ($(e.target).is("a") && $(e.target).attr("class") != "dropdown-toggle")
                                    $(this).collapse("hide");
                            });

                            $(window).on("resize", function () {
                                WebChat.setRichMenuWidth();
                            });

                            WebChat.setConfig();
                            WebChat.checkisChatIdExist();
                        } else WebChat.startChat();
                        Avatar.initAvatar().then(() => {
                            Avatar.createDirectSession()
                        });
                        $("#loading").remove();
                    }
                },
            });
        }
    },

    toggleheygenControls: function (toggle) {
        if (toggle) {
            $("#heygen-controls").show();
            $("#heygen-controls").css("display", "flex");
        } else {
            $("#heygen-controls").hide();
            $("#heygen-controls").css("display", "none");
        }
    },
    isAgentWorkTime: function (groupId) {
        WebChat.ajax({
            url: Util.getConfig("CRMGatewayUrl") + "openapi/web/agent/isworktime",
            async: false,
            data: {
                chatId: WebChat.chatId,
                groupId: groupId
            },
            success: function (ret) {
                if (ret.isWorkTime) {
                    // WebChat.selectServiceGroup();
                    WebChat.applyAgent(groupId);
                } else {
                    if (ret.offWorkService === "offWork") {
                        if (ret.offWorkMessage !== "" && ret.offWorkMessage !== null) {
                            WebChat.addSystemMessageAsDialog(ret.offWorkMessage);
                        }
                        else {
                            WebChat.addSystemMessageAsDialog(WebChat.tenantInfo.notInServiceTimeHint);
                        }
                        WebChat.queueZoneModal("hide");
                        if (ret.isAgentRouting) {
                            WebChat.stopChat();
                        }
                    }
                    else if (ret.offWorkService === "offlineMessage") {
                        if (ret.offWorkMessage !== "" && ret.offWorkMessage !== null) {
                            LeaveWord.messageBox(ret.leaveMessageUrl, ret.offWorkMessage);
                        }
                        else {
                            LeaveWord.messageBox(ret.leaveMessageUrl);
                        }
                        WebChat.queueZoneModal("hide");
                    }
                    else {
                        if (ret.offWorkMessage !== "" && ret.offWorkMessage !== null) {
                            WebChat.addSystemMessageAsDialog(ret.offWorkMessage);
                        }
                        else {
                            WebChat.addSystemMessageAsDialog(WebChat.tenantInfo.notInServiceTimeHint);
                        }
                        WebChat.queueZoneModal("hide");
                    }
                }
            },
            error: function (e) {
                if (e.statusText && !!~e.statusText.indexOf("NetworkError"))
                    WebChat.addSystemMessage(WebChat.text("NetWorkAbortError"), true);
                else Util.debug("Connection to ECP Server refused. ErrorMsg: " + e);
                WebChat.queueZoneModal("hide");
            },
        });
    },

    startChat: function () {
        let cookieId = Util.getCookieToStorage("cookieId");
        if (!cookieId) {
            cookieId = Random.nextUuid();
            Util.setCookieToStorage("cookieId", cookieId);
        }
        WebChat.ajax({
            url: Util.getConfig("CRMGatewayUrl") + "openapi/web/chat/start",
            async: false,
            data: {
                _header_: {
                    tokenId: "",
                    language: Util.getConfig("language"),
                },
                from: Util.getConfig("from"),
                tenantCode: WebChat.tenantCode,
                moduleType: WebChat.tenantInfo.moduleType,
                fromDevice: Util.getConfig("fromDevice"),
                fromTitle: Util.getConfig("fromTitle"),
                fromUrl: Util.getConfig("fromUrl"),
                treeId: "001",
                rootTreeId: "001",
                identifyBy: Util.getCookieToStorage("identifyBy") || Util.getConfig("identifyBy"),
                identifyValue: Util.getCookieToStorage("identifyValue") || "GUEST",
                cookieId: cookieId,
            },
            error: function (e) {
                if (e.statusText && !!~e.statusText.indexOf("NetworkError"))
                    WebChat.addSystemMessage(WebChat.text("NetWorkAbortError"), true);
                else WebChat.addSystemMessage("StartChatErrorMessage", true);
                Util.debug("StartChatErrorMessage:", e);
            },
            success: function (ret) {
                if (ret._header_) {
                    if (ret._header_.success) {
                        Util.debug("[chat/start] chatId = %s", ret.chatId);
                        $("#webmakecallbtn").hide();
                        $("#openvidubtn").hide();
                        WebChat.isNormalStop = false;
                        WebChat.chatId = ret.chatId;
                        WebChat.lastchatId = ret.chatId;
                        WebChat.isSurveyFromAgent = false;
                        WebChat.submitedSurvey = "empty";
                        WebChat.forageStorage.setItem("chatId", WebChat.chatId);
                        WebChat.forageStorage.setItem("submitedSurvey", WebChat.submitedSurvey);
                        WebChat.forageStorage.setItem("defaultspeak", true);
                        WebSpeechSynthesis.changeDefaultSpeak(true)
                        WebChat.jocketInit();
                        WebChat.isInAgentService = false;
                        WebChat.isEverInAgentService = false;
                        WebChat.configEnableConditions();
                        WebChat.tenantInfo['onlyAgent'] = ret.isRoutingAgent;
                        if (Util.getConfig("contact")) Contact.transferToAgent(ret);
                        else WebChat.addGreeting(ret);

                        WebChat.doUrlParameterAction();
                        WebChat.refreshButtonStatus();

                        AzureWebSTT.startChatRoom();
                    }
                } else WebChat.checkTenantStatus(ret);
            },
        });

        ContactApi.chatupdate();
    },
    
    doUrlParameterAction: function () {
        const action = Util.getParameterByName("action");
        switch (action) {
            case "otc":
                const urlType = Util.getParameterByName("type");
                if (urlType === 'send') {
                    
                    if (action === "otc") {
                        WebChat.sendMsgByUrlWording = WebChat.text("OtcInit");
                        if (!WebChat.tenantInfo.isAnonymousToAgent && !Util.getCookieToStorage("tokenId")) {
                            WebChat.isDoUrlParameterAction = true;
                            Auth.doLoginButtonClick();
                            return;
                        }
                    }
                    
                    if (WebChat.sendMsgByUrlWording) WebChat.addSystemMessage(WebChat.sendMsgByUrlWording);
                    
                    WebChat.sendMessage({
                        type: "text",
                        content: WebChat.sendMsgByUrlContent,
                    });
                }
                break;
            case "activity":
                WebChatActivity.doJoin();
                break;
            default:
                break;
        }
        WebChat.isDoUrlParameterAction = false;
    },

    configEnableConditions: function () {
        if (WebChat.chatId && Util.getConfig("richMenu")) WebChat.getRichMenu();

        if (Util.getConfig("contact")) Auth.changeLoginDisplay();
        else {
            $("#LoginButton").css("display", "none");
            $("#RightZone").remove();
        }
    },

    getRichMenu: function () {
        WebChat.ajax({
            url: Util.getConfig("CRMGatewayUrl") + "openapi/gateway/richmenu/getRichMenu",
            async: false,
            data: {
                _header_: {
                    tokenId: "",
                    language: Util.getConfig("language"),
                },
                tenantCode: WebChat.tenantCode,
                channel: Util.getConfig("from"),
            },
            success: function (ret) {
                WebChat.richmenuObject = ret.richmenu;
                if (!!ret.richmenu && !!ret.richmenu.imageUrl) RichMenu.create();
                else WebChat.enableConditions.ChangeRichMenuButton = false;
            },
        });
    },

    jocketInit: function () {
        WebChat.socket = new Jocket({
            server: Util.getConfig("CRMGatewayUrl"),
            path: "/jocket/gw/webchat",
            params: {
                chatId: WebChat.chatId,
            },
            upgrade: false,
        });
        WebChat.socket.on("open", WebChat.doSocketOpen);
        WebChat.socket.on("close", WebChat.doSocketClose);
        WebChat.socket.on("message", WebChat.doSocketMessage);
    },

    addGreeting: function (ret) {
        if (ret.senderType.toLowerCase() == "icr") {
            WebChat.addMessage({
                category: Constant.CATEGORY_CHAT,
                senderType: "icr",
                type: Constant.TYPE_TEXT,
                content: ret.content,
                isGreeting: true,
            });
        } else {
            var greetingWords = ret.greeting;
            if (ret.type !== "Multiple") {
                if (ret.type == "Image") greetingWords = Util.JsonParse(greetingWords);
                if (ret.type === "Execute" && Util.isJSON(greetingWords)) AnswerDisplay.setExecute(greetingWords);
                else {
                    WebChat.addMessage({
                        category: Constant.CATEGORY_CHAT,
                        senderType: Constant.SENDER_TYPE_ROBOT,
                        type: ret.type,
                        content: greetingWords,
                        isGreeting: true,
                    });
                }
            } else {
                let parseGreetingContent = Util.JsonParse(greetingWords);
                WebChat.addMultipleMessage(parseGreetingContent, ret, "greeting");
            }
            $("#ApplyAgentButton").removeClass("ButtonDisabled");
        }
        if (parent.window != window) {
            WebChat.postMessage({
                type: "isWebChatLoaded",
            });
        }
    },

    checkisChatIdExist: function (type) {
        var chatId = WebChat.forageStorage.getItem("chatId");
        var tenantCode = WebChat.forageStorage.getItem("tenantCode");
        if (chatId == null || chatId == undefined || tenantCode != WebChat.tenantCode) {
            WebChat.startChat();
            return;
        }
        WebChat.ajax({
            url: Util.getConfig("CRMGatewayUrl") + "openapi/web/chat/isChatIdExist",
            async: false,
            data: {
                chatId: chatId,
            },
            error: function () {
                WebChat.startChat();
            },
            success: function (ret) {
                WebChat.chatId = chatId;
                var closeReason = ret.hasOwnProperty("closeReason") ? ret.closeReason : "";
                WebChat.reviewMessage(closeReason);

                if (ret.isChatIdExist) {
                    WebChat.lastchatId = chatId;
                    setTimeout(() => {
                        const jocketPromise = new Promise((resolve, reject) => {
                            resolve(WebChat.createNewJocket());
                        });
                        jocketPromise.then(() => {
                            if (parent.window != window) {
                                WebChat.postMessage({
                                    type: "isWebChatLoaded",
                                });
                            }
                        });
                    }, 1000);
                    WebChat.refreshButtonStatus();
                } else if (WebChat.isNotActive) {
                    location.href = WebChat.notActiveUrl;
                } else {
                    WebChat.chatId = null;
                    WebChat.forageStorage.removeItem("chatId");
                    if (!!Util.getConfig("isShowUnRead")) {
                        WebChat.postMessage({
                            type: "chatId",
                            isExist: false,
                        });
                    }
                    WebChat.forageStorage.removeItem("historyMessage");
                    WebChat.isNormalStop = true;
                    WebChat.refreshButtonStatus();
                }
                WebChat.configEnableConditions();
            },
        });
    },
    postMessage: function (data) {
        const postData = typeof data === "string" ? data : JSON.stringify(data);
        window.parent.postMessage(postData, WebChat.parentIFrameUrl);
    },
    createNewJocket: function () {
        if (WebChat.reSendMessage == true) {
            WebChat.reSendCount += 1;
            if (WebChat.reSendCount >= 2) {
                WebChat.reSendMessage = false;
            }
        }
        WebChat.socket = new Jocket({
            server: Util.getConfig("CRMGatewayUrl"),
            path: "/jocket/gw/webchat",
            params: {
                chatId: WebChat.chatId,
            },
            upgrade: false,
        });

        WebChat.socket.on("open", WebChat.doSocketOpen);
        WebChat.socket.on("close", WebChat.doSocketClose);
        WebChat.socket.on("message", WebChat.doSocketMessage);
    },

    reviewMessage: function (closeReason) {
        WebChat.isWebChatHistoryLoading = true;
        for (let item in WebChat.preMessageRecord) {
            var message = WebChat.preMessageRecord[item];
            message.isReload = true;
            let elementId = WebChat.addMessage(message, true);
            if (message.disconnectStatus.split("_")[2] == "true") WebChat.setMessageFailed(elementId, true);
        }
        if (closeReason) {
            WebChat.createNewJocket();
        }
        WebChat.isWebChatHistoryLoading = false;
    },

    recordMessageFormat: function (message) {
        let content = message.content;
        if (
            message.type == Constant.TYPE_IMAGE ||
            message.type == Constant.TYPE_STICKER ||
            message.type == Constant.TYPE_FILE
        ) {
            if (Util.isJSON(message.content)) content = JSON.parse(message.content);
        }
        return content;
    },

    stopChat: function (data) {
        AzureWebSTT.disconnect();

        AzureWebSTT.closeChatRoom();
        Util.debug("WebChat.chatId:");
        Util.debug(WebChat.chatId);
        if (WebChat.chatId != null) {
            WebChat.ajax({
                url: Util.getConfig("CRMGatewayUrl") + "openapi/web/chat/stop",
                data: {
                    _header_: {
                        tokenId: "",
                        language: Util.getConfig("language"),
                    },
                    chatId: WebChat.chatId,
                },
                async: false,
                success: function (ret) {
                    if (Util.getCookieToStorage("tenantCode") != null && WebChat.tenantCode != Util.getCookieToStorage("tenantCode")) {
                        WebChat.stopOldTenantCodeEvent(data);
                    }
                    else {
                        WebChat.stopEvent(data);
                    }

                    if ($("#MessageList")) {
                        $("#MessageList").css("bottom", "");
                    }
                },
            });
        }
    },

    stopEvent: function (data) {
        WebChat.stopHeyGenKeepAlive();
        Avatar.stopConversation();
        console.log('stopEvent:執行關閉虛擬人對話行為');
        
        $("#ChatMessage_" + WebChat.messageIndex).addClass("timeout");
        WebChat.forageStorage.removeItem("chatId");
        WebChat.forageStorage.removeItem("historyMessage");
        WebChat.forageStorage.removeItem("chatRoomInfo");
        $("#HTMLPopupModal").modal("hide");
        WebChat.isNormalStop = true;
        WebChat.chatId = null;
        WebChat.socket.close();
        WebChat.socket = null;
        WebChat.isInAgentService = false;
        WebChat.isInQueue = false;
        $("#Editor").val("");
        if (WebSpeechRecognition.isSupport) WebSpeechRecognition.cancelRecognition("stopEvent");
        WebChat.refreshButtonStatus();
        WebChat.queueZoneModal("hide");
        $("#ToolZone").hide();
        if (Util.getConfig("webCall")) WebCallStart.webcallStop();
        if (Util.getConfig("openVidu")) $("#openvidubtn").hide();;
        
        if (data !== "pushMessageTimeout") {
            
            if (data == undefined || (!data.reason && data.type != "Timeout"))
                WebChat.addSystemMessage(WebChat.text("StopChat"));
            else if (data.reason == "Harass") WebChat.addSystemMessage(WebChat.tenantInfo.agentStopServiceWord);
            else WebChat.addSystemMessage(data.description);
        }
        
        if (window.parent.EcpWebChatEntry != null) {
            if (!(window.parent.EcpWebChatEntry.ifP4Url.src === "" || window.parent.EcpWebChatEntry.ifP4Url.src === null || window.parent.EcpWebChatEntry.ifP4Url.src === undefined)) {
                const webviewPage = window.parent.EcpWebChatEntry.ifP4Url.contentWindow;
                webviewPage.postMessage(JSON.stringify({
                    "action": "disconnect",
                    "from": location.origin
                }), window.parent.EcpWebChatEntry.ifP4Url.src);
            }
        }
        else {
            if (!(document.getElementById('ifP4Url').src === "" || document.getElementById('ifP4Url').src === null || document.getElementById('ifP4Url').src === undefined)) {
                const webviewPage = document.getElementById('ifP4Url').contentWindow;
                webviewPage.postMessage(JSON.stringify({
                    "action": "disconnect",
                    "from": location.origin
                }), document.getElementById('ifP4Url').src);
            }
        };
        if (Util.getCookieToStorage("contactName") !== undefined && Util.getCookieToStorage("contactName") !== null) {
            $("#log-out-remind").html(WebChat.text("LogoutRemind"));
            Contact.openRightZone();
            document.getElementById('memberCont').childNodes[2].scrollTop = document.getElementById('memberCont').childNodes[2].scrollHeight
        }
        WebChat.preMessageRecord = [];
        if (WebChat.tenantInfo["stopChatWebViewUrl"] != "" && WebChat.tenantInfo["stopChatWebViewUrl"] != undefined && WebChat.tenantInfo["stopChatWebViewUrl"] != null) {
            stopUrl = WebChat.tenantInfo["stopChatWebViewUrl"]
            let urlstr = new URL(stopUrl);
            let checkWebview = urlstr.searchParams.get('_webview');
            urlstr.searchParams.delete('_webview');
            stopUrl = urlstr.toString();

            if (checkWebview == "1") {
                WebChat.OpenP4Page(stopUrl);
            }
            else {
                if (window.parent.EcpWebChatEntry != null) {
                    parent.location.href = stopUrl;
                }
                else if (!!WebChat && !!WebChat.tenantInfo && WebChat.tenantInfo.hasOwnProperty("stopChatWebViewUrl")) {
                    window.location.href = stopUrl;
                }
            }

        }
        WebChat.refreshMessageListLayout();
        $(".EditorZone").css("height", "50px");
        $("#MessageList").css("bottom", "50px");
    },

    stopOldTenantCodeEvent: function (data) {
        
        $("#ChatMessage_" + WebChat.messageIndex).addClass("timeout");
        WebChat.forageStorage.removeItem("chatId");
        WebChat.forageStorage.removeItem("historyMessage");
        WebChat.forageStorage.removeItem("chatRoomInfo");
        $("#HTMLPopupModal").modal("hide");
        WebChat.isNormalStop = true;
        WebChat.chatId = null;
        WebChat.isInAgentService = false;
        WebChat.isInQueue = false;
        $("#Editor").val("");
        if (WebSpeechRecognition.isSupport) WebSpeechRecognition.cancelRecognition("stopEvent");
        WebChat.refreshButtonStatus();
        $("#ToolZone").hide();

        if (Util.getConfig("webCall")) WebCallStart.webcallStop();
        if (Util.getConfig("openVidu")) $("#openvidubtn").hide();;
        
        if (window.parent.EcpWebChatEntry != null) {
            if (!(window.parent.EcpWebChatEntry.ifP4Url.src === "" || window.parent.EcpWebChatEntry.ifP4Url.src === null || window.parent.EcpWebChatEntry.ifP4Url.src === undefined)) {
                const webviewPage = window.parent.EcpWebChatEntry.ifP4Url.contentWindow;
                webviewPage.postMessage(JSON.stringify({
                    "action": "disconnect",
                    "from": location.origin
                }), window.parent.EcpWebChatEntry.ifP4Url.src);
            }
        }
        else {
            if (!(document.getElementById('ifP4Url').src === "" || document.getElementById('ifP4Url').src === null || document.getElementById('ifP4Url').src === undefined)) {
                const webviewPage = document.getElementById('ifP4Url').contentWindow;
                webviewPage.postMessage(JSON.stringify({
                    "action": "disconnect",
                    "from": location.origin
                }), document.getElementById('ifP4Url').src);
            }
        };
        if (Util.getCookieToStorage("contactName") !== undefined && Util.getCookieToStorage("contactName") !== null) {
            $("#log-out-remind").html(WebChat.text("LogoutRemind"));
            Contact.openRightZone();
            document.getElementById('memberCont').childNodes[2].scrollTop = document.getElementById('memberCont').childNodes[2].scrollHeight
        }
        WebChat.preMessageRecord = [];
    },

    chatUpdate: function () {
        var identifyValue = Util.getCookieToStorage("identifyValue");
        var identifyBy = Util.getCookieToStorage("identifyBy");

        WebChat.getLocation().then((result) => {
            WebChat.ajax({
                url: Util.getConfig("CRMGatewayUrl") + "openapi/web/chat/update",
                data: {
                    chatId: WebChat.chatId,
                    identifyValue: identifyValue,
                    identifyBy: identifyBy,
                    customData: {
                        latitude: (parseFloat(WebChat.location.latitude) ? parseFloat(WebChat.location.latitude) : 0),
                        longitude: (parseFloat(WebChat.location.longitude) ? parseFloat(WebChat.location.longitude) : 0)
                    },
                },
                success: function (ret) {
                    if (Auth.loginnext == "toAgent") WebChat.doApplyAgentButtonClick();
                    if (Auth.loginnext == "sendMessage") $("#SendButton").click();
                    Auth.loginnext = "";

                    if (WebChat.isDoUrlParameterAction) WebChat.doUrlParameterAction();
                },
            });
        });
    },

    restartChat: function () {
        $("#MessageList").html("");
        $("#MessageList").css("bottom", "125px");
        $(".EditorZone").css("height", "125px");
        $("#SendButton").click(WebChat.doSendButtonClick);
        WebChat.isInAgentService = false;
        WebChat.isEverInAgentService = false;
        WebChat.forageStorage.removeItem("chatId");
        WebChat.forageStorage.removeItem("historyMessage");
        WebChat.preMessageRecord = [];
        WebChat.messageIndex = 0;
        WebChat.queryTenantInfo("restart");
    },

    selectServiceGroup: function () {
        
        var select = true;
        WebChat.ajax({
            url: Util.getConfig("CRMGatewayUrl") + "openapi/web/servicegroup/list",
            data: {
                chatId: WebChat.chatId,
            },
            error: "ServiceGroupErrorMessage",

            success: function (ret) {
                if (ret.groups.length == 0) {
                    WebChat.addSystemMessageAsDialog(WebChat.tenantInfo.noServiceGroup);
                    WebChat.queueZoneModal("hide");
                } else if (ret.groups.length == 1) {
                    // WebChat.applyAgent(ret.groups[0].id);
                    WebChat.isAgentWorkTime(ret.groups[0].id);
                } else {
                    
                    for (var i = 0; i < ret.groups.length; ++i) {
                        var group = ret.groups[i];
                        if (
                            (Contact.servicetoAgent && group.id == Contact.groupId) ||
                            Util.getConfig("groupId") == group.id ||
                            Util.getConfig("groupId") == group.name
                        ) {
                            // WebChat.applyAgent(group.id);
                            WebChat.isAgentWorkTime(group.id);
                            select = false;
                        }
                    }
                    // if (select == true) ServiceGroupSelect.show(ret.groups, WebChat.applyAgent);
                    if (select == true) ServiceGroupSelect.show(ret.groups, WebChat.isAgentWorkTime);
                }
            },
        });
    },

    gotoLeaveWord: function () {
        LeaveWord.show();
    },

    agentStop: function () {
        WebChat.ajax({
            url: Util.getConfig("CRMGatewayUrl") + "openapi/web/agent/stop",
            data: {
                chatId: WebChat.chatId,
            },
            error: function () { },
            success: function (ret) {

            },
        });
    },

    applyAgent: function (serviceGroup) {
        WebChat.resetQueueZoneModal();
        WebChat.queueZoneModal("show");

        var data = {
            chatId: WebChat.chatId,
            serviceGroup: serviceGroup,
            identifyBy: "FPId",
            identifyValue: "GUEST",
            fromUrl: Util.getConfig("fromUrl"),
            fromTitle: WebChat.text("SourceUrl"),
            customData: {
                fromDevice: "web",
                fromTitle: Util.getConfig("fromTitle"),
                fromUrl: Util.getConfig("fromUrl"),
            },
        };

        if (Util.getCookieToStorage("tokenId") != undefined) {
            data.identifyBy = Util.getCookieToStorage("identifyBy");
            data.identifyValue = Util.getCookieToStorage("identifyValue");
        }
        
        if (Contact.servicetoAgent == true) {
            
            data.customData.unitId = "32c8c225-2422-4a20-9e4d-1947f0548a1a";
            data.customData.entityId = Contact.entityId;
        }

        if (Util.getConfig("entityId") != "") {
            data.customData.unitId = Util.getConfig("unitId");
            data.customData.entityId = Util.getConfig("entityId");
            data.identifyBy = Util.getConfig("identifyBy");
            data.identifyValue = Util.getConfig("identifyValue");
            data.statusId = Util.getConfig("statusId");
        }

        if (WebChatActivity.isAvailable) {
            data.customData.token = Util.getParameterByName("token");
        }
        WebChat.setDisconnectionDelay(0);
        WebChat.isDisconnectionDelay = false;
        WebChat.ajax({
            url: Util.getConfig("CRMGatewayUrl") + "openapi/web/agent/apply",
            data: data,
            error: function () {
                if (WebChat.chatId != null) {
                    if (WebChat.reSendMessage == false && WebChat.reSendCount >= 2) {
                        WebChat.stopChat();
                    } else if (WebChat.reSendMessage == true && WebChat.reSendCount < 2) {
                        WebChat.createNewJocket(); // 重新建立jocket
                        // 等待1秒後再次要求轉接專人
                        setTimeout(function () {
                            WebChat.applyAgent(serviceGroup);
                        }, 1000);
                    } else {
                        WebChat.addSystemMessage(WebChat.text("ApplyAgentErrorMessage"));
                        WebChat.queueZoneModal("hide");
                        WebChat.refreshButtonStatus();
                    }
                } else {
                    WebChat.addSystemMessage(WebChat.text("ApplyAgentErrorMessage"));
                    WebChat.queueZoneModal("hide");
                    WebChat.refreshButtonStatus();
                }
            },
            success: function (ret) {
                if (WebChat.socket == null && WebChat.chatId != null) {
                    WebChat.createNewJocket(); // 重新建立jocket
                } else {
                    WebChat.reSendCount = 0;
                }
                Util.debug("[agent/apply] applying, please wait...");

                WebChat.roomId = ret.roomId;
                Util.debug("roomId = " + ret.roomId);
                
                if (Contact.getServiceItemData != "" && Contact.servicetoAgent) {
                    WebChat.addSystemMessage(WebChat.text("ServiceRequest") + ": " + Contact.getServiceItemData.FName);
                    Contact.getServiceItemData = "";
                    Contact.servicetoAgent = false;
                }
                if (ret.chatId != null) {
                    WebChat.chatId = ret.chatId;
                }
                if (ret.isNeedToLeaveMessage) {
                    LeaveWord.messageBox(ret.leaveMessageUrl);
                    WebChat.sendRecievedMessage(ret);
                }
                if (ret.roomId == "") {
                    WebChat.doCancelQueueButtonClick();
                    WebChat.addMessage({
                        category: "am",
                        senderType: "robot",
                        type: "Text",
                        content: WebChat.text("QueueExceeded"),
                    });
                }
                WebChat.refreshButtonStatus();
                if (WebChatActivity.isAvailable) {
                    if (ret.redirect) {
                        window.location.assign(ret.redirect);
                        return;
                    }
                }
            },
        });
    },

    disconnectIconClick: function (element, data) {
        WebChat.currentReSendElement = element.offsetParent;
        $("#ReSendModal").modal("show");
    },

    disconnectAction: function (action) {
        let deleteElementId = WebChat.currentReSendElement.id;
        switch (action) {
            case "resend":
                WebChat.preMessageRecord.map(function (v) {
                    if (v.disconnectStatus.indexOf(deleteElementId + "_true") != -1) {
                        let addMessageInfo = {
                            type: v.type,
                            content: v.content,
                        };

                        let sendMessageInfo = {
                            type: v.type,
                            content: v.content,
                        };
                        if ("FCode" in v) {
                            addMessageInfo["FCode"] = v.FCode;
                            sendMessageInfo["content"] = v.FCode;
                        }

                        let elementId = WebChat.addMessage(addMessageInfo);
                        if (elementId != null) WebChat.sendMessage(sendMessageInfo, elementId);
                    }
                });
                WebChat.removeMessage(deleteElementId);
                break;
            case "delete":
                WebChat.removeMessage(deleteElementId);
                break;
            default:
                break;
        }
    },

    removeMessage: function (deleteElementId) {
        let deletePosition;
        WebChat.preMessageRecord.map(function (v, index) {
            let elementId = v.disconnectStatus.split("_")[0] + "_" + v.disconnectStatus.split("_")[1];
            if (elementId == deleteElementId) deletePosition = index;

            if (index > deletePosition) WebChat.preMessageRecord[index - 1] = v;

            if (index == WebChat.preMessageRecord.length - 1) {
                WebChat.preMessageRecord.length = index;
            }
        });
        $("#" + deleteElementId).remove();
    },
    sendMessage: function (message, elementId, from) {
        if (WebChat.isReconnect || WebChat.isWebChatHistoryLoading) return;
        let content = message.content;
        if ((message.showMessage || message.showMessage == null)) {
            QuickReply.closeQuickReplyPool();
        }
        if (Util.isJSON(content)) {
            content = typeof content !== "string" ? JSON.stringify(content) : content;
            try {
                content = JSON.parse(content);
                
                if (content.type) {
                    switch (content.type) {
                        case "pushRegistrationBtn":
                            if (WebChat.tenantInfo.socialMediaAlert) {
                                if (!Util.getCookieToStorage("tokenId")) {
                                    Auth.doLoginButtonClick();
                                    return;
                                }
                            }
                            break;
                        case "trf":
                            if (!WebChat.isInAgentService) {
                                WebChat.resetQueueZoneModal();
                                WebChat.queueZoneModal("show");
                            }
                            break;
                        default:
                            if (content == WebChat.tenantInfo.applyAgentCode && !WebChat.isInAgentService) {
                                WebChat.doApplyAgentButtonClick();
                                return;
                            }
                            break;
                    }
                }
            } catch (e) { }
        } else if (content.indexOf("#pushRegistrationBtn") == 0 && WebChat.tenantInfo.socialMediaAlert) {
            if (!Util.getCookieToStorage("tokenId")) {
                Auth.doLoginButtonClick();
                return;
            }
        } else if (content.indexOf("#trf") == 0 && !WebChat.isInAgentService) {
            WebChat.resetQueueZoneModal();
            WebChat.queueZoneModal("show");
        } else if (content == WebChat.tenantInfo.applyAgentCode && !WebChat.isInAgentService) {
            WebChat.doApplyAgentButtonClick();
            return;
        }
        message.chatId = WebChat.chatId;
        if (WebChat.socket == null) {
            WebChat.createNewJocket(); // 重新建立jocket
            if (WebChat.socket == null) {
                message.chatId = null;
            }
        }
        
        // if (Util.getCookieToStorage("identifyValue") != undefined) {
        //     message.identifyBy = Util.getCookieToStorage("identifyBy");
        //     message.identifyValue = Util.getCookieToStorage("identifyValue");
        // } else {
        //     message.identifyBy = Util.getConfig("identifyBy");
        //     message.identifyValue = Util.getConfig("identifyValue");
        // }

        // message.from = Util.getConfig("from");

        
        if (Util.getCookieToStorage("identifyValue") != undefined) {
            message.identifyBy = Util.escapeHtml(Util.getCookieToStorage("identifyBy"));
            message.identifyValue = Util.escapeHtml(Util.getConfig("identifyValue"));
        } else {
            message.identifyBy = Util.escapeHtml(Util.getCookieToStorage("identifyBy"));
            message.identifyValue = Util.escapeHtml(Util.getConfig("identifyValue"));
        }
        message.from = Util.escapeHtml(Util.getConfig("from"));
        // 使用 streamingAjax 替代 ajax，支援 JSON 和 streaming 回應
        try {
            WebChat.latestMessageSendRequestId += 1;
            var outboundSendRequestId = WebChat.latestMessageSendRequestId;
            WebChat.streamingAjax({
                url: Util.getConfig("CRMGatewayUrl") + "openapi/web/message/send",
                data: message,
                error: function () {
                    if (elementId != null) {
                        if (from == "fileUpload" || from == "imageUpload") {
                            WebChat.removeMessage(elementId);
                            File.showSystemResult("fail");
                        } else {
                            if (WebChat.chatId != null) {
                                if (WebChat.reSendMessage == false && WebChat.reSendCount >= 2) {
                                    WebChat.stopChat();
                                } else if (WebChat.reSendMessage == true && WebChat.reSendCount < 2) {
                                    // 若是此訊息還沒重送過，則等待1秒後再次發送
                                    WebChat.createNewJocket(); // 重新建立jocket
                                    setTimeout(function () {
                                        WebChat.sendMessage(message, elementId);
                                    }, 1000);
                                } else {
                                    WebChat.setMessageFailed(elementId, true);
                                    WebChat.reSendMessage = true;
                                }
                            }
                            WebChat.queueZoneModal("hide");
                        }
                    }
                },
                success: function (ret) {
                    
                    if (from == "azureOpenAIEngine") {
                        return;
                    }
                    else {
                        WebChat.isNeedSpeakGreetingMessageToHeyGen = false;
                        if (ret.isNeedToLeaveMessage) {
                            LeaveWord.messageBox(ret.leaveMessageUrl);
                            return;
                        }
                        
                        if (from == "fileUpload" || from == "imageUpload") File.showSystemResult("success");
                        
                        WebChat.preMessageRecord.map(function (v) {
                            if (v.disconnectStatus == elementId) {
                                v["disconnectStatus"] = elementId + "_false";
                            }
                        });
                        if (ret.result && ret.hasOwnProperty("result") && (message.showMessage || message.showMessage == null)) {
                            if (!!$("#statusMessage").length) $("#statusMessage").remove();
                            WebChat.reSendCount = 0;
                            ret.result.forEach(function (item, index, array) {
                                let NewDate = Util.formatDate(new Date());
                                item.messageTime = NewDate;
                                item.time = NewDate;
                                let parseContent = item?.robotCommand || Util.JsonParse(item.content);
                                if (parseContent?.mode && WebChat.gptModeFormat.includes(parseContent.mode) && WebChat.doCheckGptMode(parseContent)) {
                                    WebChat.addQbiCopilotMessage(parseContent, item, "GPTmessageSend", false);
                                } else {
                                    switch (item.type) {
                                        case "Multiple":
                                            
                                            WebChat.addMultipleMessage(parseContent, item, "messageSend");
                                            break;
                                        case "QuickReply":
                                            
                                            if (parseContent.QuickReply && parseContent.QuickReply.WebViewUrl)
                                                item["webViewUrl"] = parseContent.QuickReply.WebViewUrl;
                                            item["isSatis"] = parseContent.isSatis;
                                            WebChat.addMessage(item);
                                            break;
                                        case "Execute":
                                            if (Util.isJSON(item.content)) AnswerDisplay.setExecute(item.content);
                                            break;
                                        default:
                                            WebChat.addMessage(item);
                                            break;
                                    }
                                }
                            });
                        } else {
                            if (ret.chatId != null) {
                                WebChat.chatId = ret.chatId;
                            }
                            if (ret.needAgent) {
                                WebChat.addMessage({
                                    category: Constant.CATEGORY_CHAT,
                                    senderType: Constant.SENDER_TYPE_ROBOT,
                                    type: Constant.TYPE_TEXT,
                                    content: ret.content,
                                });
                            } else if (ret.content != null) {
                                if (ret.type == "Image") {
                                    ret.content = JSON.parse(ret.content);
                                }
                                if (ret.statusCode === 10301) {
                                    if (WebChat.chatId != null) {
                                        if (WebChat.reSendMessage == false && WebChat.reSendCount >= 2) {
                                            WebChat.stopChat();
                                        } else if (WebChat.reSendMessage == true && WebChat.reSendCount < 2) {
                                            // 若是此訊息還沒重送過，則等待1秒後再次發送
                                            WebChat.createNewJocket(); // 重新建立jocket
                                            setTimeout(function () {
                                                WebChat.sendMessage(message, elementId);
                                            }, 1000);
                                        } else {
                                            WebChat.setMessageFailed(elementId, true);
                                        }
                                    }
                                }
                                else {
                                    if (ret?.messageTime) {
                                        ret.messageTime = Util.formatDate(new Date());
                                    }
                                    WebChat.addMessage(ret);
                                }
                                Util.debug("MessageSendAPI response: ", ret);
                            }
                            if (message.hasOwnProperty("content") && message.content.hasOwnProperty("type") && message.content.type == "feedback") {
                                Satisfy.confirmSatisfy(true);
                            }
                        }
    
                    }
                    // WebChat.isLockSendMessage = false;
                },
                // 新增 streaming 處理
                onStream: function (streamData) {
                    WebChat.isNeedSpeakGreetingMessageToHeyGen = false;
                    WebChat.streamKm(streamData, outboundSendRequestId);
                }
            });
        } catch (error) {
            // WebChat.isLockSendMessage = false;
            console.warn(error);
        }
    },
    mather(topN, chunkId, count) {
        let returnValue = null;
        try {
            const item = topN.find((entry) => entry.metadata.chunkId === chunkId);
            if (item) {
                const match = {
                    id: item.metadata.sourceId,
                    knowledgeId: item.metadata.knowledgeId,
                    count: count,
                    content: item.metadata.sourceName,
                    page_content: item.page_content,
                    type: item.metadata.type,
                };
                returnValue = match;
            }
        } catch (e) {
            console.warn(e);
        }
        return returnValue;
    },
    stripHTML(content) {
        return content
            .replace(/<[^>]+>/g, "")
            .replace(/\n/g, " ")
            .replace(/\t/g, " ");
    },
    streamController(sendRequestId) {
        let textQueue = [];
        let statePendingBackslash = false;
        let isStreamFinish = false;
        let streamCharPumpTimer = null;
        const enqueueText = (text, showContent) => {
            if (text) {
                for (let char of text) {
                    textQueue.push(char);
                    if (showContent?.isFirstChunk) {
                        processQueue(showContent);
                    }
                }
            }
        };
        const processQueue = (showContent) => {
            if (streamCharPumpTimer != null) {
                return;
            }
            const pump = () => {
                const burst =
                    sendRequestId != null && WebChat.isStaleSendRequestId(sendRequestId);
                const perTick = burst ? 200 : 1;
                for (let tick = 0; tick < perTick; tick++) {
                    const shift_text = textQueue.shift();
                    let text = shift_text;
                    if (text != null) {
                        if (statePendingBackslash) {
                            statePendingBackslash = false;
                            if (text === "n") {
                                text = "<br/>";
                            } else {
                                text = "\\" + text;
                            }
                        } else if (text === "\n") {
                            text = "<br/>";
                        } else if (text === "\\") {
                            text = "";
                            statePendingBackslash = true;
                        }
                        if (text?.length > 0) {
                            WebChat.updateMessage(showContent?.messageId, text, false);
                        }
                    }
                    if (!burst) {
                        break;
                    }
                    if (textQueue.length === 0) {
                        break;
                    }
                }
                if (textQueue.length > 0 || isStreamFinish == false) {
                    const chatBox = document.getElementById("MessageList");
                    if (chatBox) {
                        chatBox.scrollTop = chatBox.scrollHeight;
                    }
                    streamCharPumpTimer = setTimeout(pump, burst ? 0 : 30);
                } else {
                    streamCharPumpTimer = null;
                }
            };
            streamCharPumpTimer = setTimeout(pump, 0);
        };
        const finishStream = (messageId) => {
            isStreamFinish = true;
            // 只標記完成狀態，解析器會在所有 chunk 處理完後自動清理
            let existingItem = WebChat.speechQueue.queue.find(item => item.messageId === messageId);
            if (messageId && existingItem) {
                setTimeout(() => {
                    existingItem.streamIsFinish = true;
                }, 3000);
            }
        }
        const checkTextQueue = () => {
            if (textQueue.length === 0 && isStreamFinish == true) {
                return true;
            } else {
                return false;
            }
        }
        const checkSpeechAndTextSyncQueue = (messageId) => {
          // 更穩妥的判斷：檢查所有相關的 queue 和處理狀態
            // 1. 檢查 resultQueue 中是否還有該 messageId 的項目
            const hasResult = WebChat.speechAndTextSyncResultQueue.some(item => WebChat.isSameMessageId(item.messageId, messageId));
            if (hasResult) {
                return false; // 還有待處理的 result
            }
            
            // 2. 檢查 queue 中是否還有該 messageId 的項目
            const hasQueueItem = WebChat.speechAndTextSyncQueue.some(item => WebChat.isSameMessageId(item.messageId, messageId));
            if (hasQueueItem) {
                return false; // 還有待處理的 queue 項目
            }
            
            // 3. 檢查是否正在處理該 messageId 的渲染
            // 如果正在處理中，且 progress 中有該 messageId，可能還在處理
            if (WebChat.speechAndTextSyncIsProcessing) {
                // 檢查 progress 中是否有該 messageId，如果有則可能還在處理
                if (WebChat.speechAndTextSyncProgress.hasOwnProperty(messageId)) {
                    return false; // 可能還在處理中
                }
            }
            
            // 所有檢查都通過，表示該 messageId 的文字渲染已完成
            return true;
        }
        return { enqueueText, finishStream, checkTextQueue, checkSpeechAndTextSyncQueue };
    },
    async streamKm(responseFromFetch, sendRequestId) {
        const objectParser = new WebChat.Parser("matched", "answer", "chunkId");
        const objectStreamController = WebChat.streamController(sendRequestId);
        let stringAnswerChunkId = null;
        let stringCurrentChunkIdList = [];
        let stringCurrentChunkId = null;
        let stringFullResponse = "";
        let stringMatched = "";
        let lastChunk = null;
        let isFirstChunk = true;
        let isAIJson = false;
        let messageId = null;
        let streamingRequest = responseFromFetch;
        let answerMode = "knowledge";
        let isFirstChangeAnswerMode = true;

        try {
            let response = responseFromFetch;
            const objectReader = response.body.getReader();
            const objectDecoder = new TextDecoder("utf-8");
            let stringBuffer = "";
            if (!WebChat.activeStreamingRequests) {
                WebChat.activeStreamingRequests = [];
            }
            WebChat.activeStreamingRequests.push(streamingRequest);

            while (true) {
                let { done, value } = await objectReader.read();
                if (done) {
                    if (stringFullResponse && !!stringFullResponse && (stringMatched.includes("Yes") || answerMode === "function")) {
                        objectStreamController.finishStream(messageId);
                        let NewDate = Util.formatDate(new Date());
                        let isHasInfoSource = true;
                        let timeDiv = null;
                        let sourceMessage = null;
                        let newMessage = null;
                        lastChunk.messageTime = NewDate;
                        lastChunk.time = NewDate;
                        const time = Util.formatDate(new Date(), "HH:mm:ss")
                        lastChunk.senderType = Constant.SENDER_TYPE_ROBOT;
                        lastChunk.category = Constant.CATEGORY_CHAT;
                        
                        if(answerMode === "function") {
                            let functionAnswer = JSON.parse(lastChunk.answer);
                            lastChunk.excuteTask = answerMode;
                            lastChunk.text = functionAnswer.text;
                            if(functionAnswer?.mode == "GPT") {
                                lastChunk.type = Constant.TYPE_TEXT;
                            }
                            if(functionAnswer?.mode == "GPT_FUNCTION") {
                                lastChunk.QuickReply = functionAnswer.QuickReply;
                                lastChunk.type = Constant.TYPE_QUICKREPLY;
                            }
                            isHasInfoSource = false;
                            newMessage = WebChat.addQbiCopilotMessage(lastChunk, lastChunk, "GPTmessageSend", true);
                            newMessage["MessageId"] = messageId;
                            newMessage["disconnectStatus"] = messageId;
                            newMessage["isSatis"] = false;
                            newMessage["answerMode"] = answerMode;
                            if (newMessage) {
                                let isttsbar = false;
                                if ((!!Util.getConfig("isSpeechSynthesis") && (Util.getConfig("ttsModel") == "browser" ? WebSpeechSynthesis.isSupport : true))) {
                                    isttsbar = true;
                                }
                                let quick_reply_items = WebChat.findQuickReply(newMessage);
                                if (quick_reply_items) {
                                    if (newMessage.hasOwnProperty("satisClickedRecord")) {
                                        quick_reply_items.satisClickedRecord = newMessage.satisClickedRecord;
                                    }
                                }
                                timeDiv = WebChat.doSatisBarMessage(isttsbar, quick_reply_items, time)
                                let functionGenerateText = Util.getConfig("functionGenerateText") || "";
                                sourceMessage = WebChat.addGPTMessage({
                                    content: lastChunk,
                                    messageTime: NewDate,
                                    generalText: functionGenerateText,
                                    isHasInfoSource: isHasInfoSource,
                                    type: "Text",
                                }, 1, "{steaming_messagetext}", true);
                            }
                        } else {
                            if (!lastChunk.hasOwnProperty("ans")) {
                                lastChunk.mode = "GPT";
                                lastChunk.type = Constant.TYPE_QUICKREPLY;
                                isHasInfoSource = false;
                            } else {
                                lastChunk.type = Constant.TYPE_TEXT;
                            }
                            newMessage = WebChat.addQbiCopilotMessage(lastChunk, lastChunk, "GPTmessageSend", true);
                            newMessage["MessageId"] = messageId;
                            newMessage["disconnectStatus"] = messageId;
                            newMessage["isSatis"] = true;
                            newMessage["answerMode"] = answerMode;
                            if (newMessage) {
                                let isttsbar = false;
                                if ((!!Util.getConfig("isSpeechSynthesis") && (Util.getConfig("ttsModel") == "browser" ? WebSpeechSynthesis.isSupport : true))) {
                                    isttsbar = true;
                                }
                                let quick_reply_items = WebChat.findQuickReply(newMessage);
                                if (quick_reply_items) {
                                    if (newMessage.hasOwnProperty("satisClickedRecord")) {
                                        quick_reply_items.satisClickedRecord = newMessage.satisClickedRecord;
                                    }
                                }
                                timeDiv = WebChat.doSatisBarMessage(isttsbar, quick_reply_items, time)
                                let gptGenerateText = Util.getConfig("gptGenerateText") || "";
                                sourceMessage = WebChat.addGPTMessage({
                                    content: JSON.stringify(newMessage.GPTmessageTemp.find(x => x.type === "QuickReply")),
                                    messageTime: NewDate,
                                    generalText: gptGenerateText,
                                    isHasInfoSource: isHasInfoSource,
                                    type: "QuickReply",
                                }, 1, "{steaming_messagetext}", true);
    
                            }
                        }
                        // 自動播音判斷
                        let message = null;
                        let Chat_answer = null;
                        if(answerMode === "function") {
                            message = stringFullResponse;
                            Chat_answer = stringFullResponse;
                        } else {
                            Chat_answer = JSON.parse(WebChat.cleanJsonBlock(stringFullResponse)) || stringFullResponse;
                            message = WebChat.stripHTML(Chat_answer?.answers.map((item) => item.answer).join(""), true) || Chat_answer;
                        } 
                        if (!!Util.getConfig("isSpeechSynthesis") &&
                            WebSpeechSynthesis.isSupport &&
                            WebChat.forageStorage.getItem("defaultspeak") == "true") {
                            WebSpeechSynthesis.textToSpeak(WebChat.stripHTML(message, true));
                        }

                        
                        let sourceInterval = setInterval(() => {
                            if (objectStreamController.checkTextQueue() && objectStreamController.checkSpeechAndTextSyncQueue(messageId)) {
                                clearInterval(sourceInterval);
                                let MessageMessageBox = document.getElementById(messageId);
                                MessageMessageBox.removeChild(MessageMessageBox.querySelector(".ChatMessageGptSatisBar"));
                                MessageMessageBox.innerHTML += timeDiv;
                                if(sourceMessage !== "{steaming_messagetext}") {
                                    MessageMessageBox.querySelector(".ChatMessageTextContent").innerHTML += `<br/><br/>${sourceMessage}`;
                                }
                                isFirstChunk = true;
                                WebChat.preMessageRecord.pop();
                                WebChat.preMessageRecord.push(newMessage);
                                let messageList = $("#MessageList")[0];
                                messageList.scrollTop = messageList.scrollHeight;
                                // WebChat.isLockSendMessage = false;
                            }
                        }, 100);
                    }
                    break;
                }
                stringBuffer += objectDecoder.decode(value, { stream: true });
                const lines = stringBuffer.split("\n");
                stringBuffer = lines.pop();
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (line.startsWith("data:")) {
                        const stringData = line.substring("data:".length).trim();
                        try {
                            const chunk = JSON.parse(stringData);
                            if (!chunk?.choices?.[0]?.hasOwnProperty("finish_reason")) {
                                lastChunk = chunk;
                            }
                            // AI 任務 Streaming 串流文字顯示
                            if(i === 0 && isFirstChangeAnswerMode) {
                                isFirstChangeAnswerMode = false;
                                if(chunk.responseType==="KM") {
                                    answerMode = "knowledge";
                                } else {
                                    answerMode = "function";
                                }
                            }

                            if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) {
                                let contentPart = chunk.choices[0].delta.content;
                                let formattedContent = contentPart;
                                const showContent = { needSpeechSynthesis: true, content: " ", isFirstChunk: false };
                                stringFullResponse += contentPart;
                                if(answerMode === "knowledge") {
                                    formattedContent = Util.escapeHtml(contentPart).replace(/\n/g, "<br/>");
                                    const stateParsing = objectParser.processChunk(contentPart);
                                    if (stateParsing && !!stateParsing && stateParsing.key && !!stateParsing.key && stateParsing.key !== null) {
                                        switch (String(stateParsing.key).trim()) {
                                            case "matched":
                                                if (stateParsing.state && !!stateParsing.state) {
                                                    if (stateParsing.state !== "ended") {
                                                        stringMatched += contentPart;
                                                    }
                                                }
                                                break;
                                            case "answer":
                                                if (isFirstChunk) {
                                                    if(contentPart==="{"){
                                                        isAIJson = true;
                                                        isFirstChunk = false;
                                                    }else{
                                                        WebChat.messageParser = null;
                                                        messageId = WebChat.addMessage({
                                                            category: Constant.CATEGORY_CHAT,
                                                            senderType: Constant.SENDER_TYPE_ROBOT,
                                                            type: Constant.TYPE_TEXT,
                                                            content: "",
                                                        });
                                                        WebChat.registerStreamMessageSendRequestId(messageId, sendRequestId);
                                                        showContent.messageId = messageId;
                                                        showContent.isFirstChunk = isFirstChunk;
                                                        isFirstChunk = false;
                                                    }
                                                }
                                                if ((stateParsing?.state !== "ended")) {
                                                    if (stringMatched == "Yes") {
                                                        objectStreamController.enqueueText(contentPart, showContent);
                                                    }
                                                } else if (stateParsing?.state === "ended") {
                                                    contentPart = contentPart.split('"')[0];
                                                    objectStreamController.enqueueText(contentPart, showContent);
                                                }
                                                break;
                                            case "chunkId":
                                                if (stateParsing.state && !!stateParsing.state && stateParsing.state === "ended") {
                                                    stringAnswerChunkId = stringCurrentChunkId;
                                                    if (stringAnswerChunkId != null && stringAnswerChunkId !== "") stringCurrentChunkIdList.push(stringAnswerChunkId);
                                                    stringCurrentChunkId = null;
                                                } else {
                                                    stringCurrentChunkId = stringCurrentChunkId != null ? stringCurrentChunkId + contentPart : contentPart;
                                                }
                                                break;
                                        }
                                    }
                                } else {
                                    if (isFirstChunk) {
                                        WebChat.messageParser = null;
                                        messageId = WebChat.addMessage({
                                            category: Constant.CATEGORY_CHAT,
                                            senderType: Constant.SENDER_TYPE_ROBOT,
                                            type: Constant.TYPE_TEXT,
                                            content: "",
                                        });
                                        WebChat.registerStreamMessageSendRequestId(messageId, sendRequestId);
                                        showContent.messageId = messageId;
                                        showContent.isFirstChunk = isFirstChunk;
                                        isFirstChunk = false;
                                    }
                                    objectStreamController.enqueueText(contentPart, showContent);
                                }
                            }
                        } catch (e) {
                            console.warn(e, line);
                        }
                    }
                }
            }
        } catch (error) {
            // 錯誤處理時也要清理請求
            if (streamingRequest && WebChat.activeStreamingRequests) {
                var index = WebChat.activeStreamingRequests.indexOf(streamingRequest);
                if (index > -1) {
                    WebChat.activeStreamingRequests.splice(index, 1);
                }
            }
            console.error('streamKm error:', error);
        }
    },
    updateMessage(messageId, content, ResultType) {
        const targetId = messageId;
        let $target = $(`#${targetId}`);
        let messageList = $("#MessageList")[0];
        if (ResultType === "handleSpeakMessageVolume") {
            let $speakBtn = $target.find(".SpeakMessageVolume");
            $speakBtn.attr("onclick", `WebSpeechSynthesis.textToSpeak('${Util.escapeHtml(content)}')`);
        } else if (ResultType === "innerSource") {
            let $messageText = $target.find("div.ChatMessageContent.ChatMessageTextContent.WordBreakAll");
            content.forEach((item) => {
                WebChat.insertTemplateAfterText({
                    element: $messageText[0],
                    targetText: item.answer,
                    template: item.content,
                });
            });
        } else {
            let $messageText = $target.find("div.ChatMessageContent.ChatMessageTextContent.WordBreakAll");
            if ($messageText.length) {
                let formattedContent = Util.streamEscapeHtml(content);
                formattedContent = (formattedContent === undefined ? "" : formattedContent).replace(/\n/g, "<br/>");

                // 使用獨立的解析器實例，避免多個 Stream 之間的混亂
                let parser = WebChat.messageParsers.get(messageId);

                if (!parser) {
                    parser = new WebChat.StreamHtmlParser($messageText[0], messageId);
                    WebChat.messageParsers.set(messageId, parser);
                }

                parser.parse(formattedContent);
                requestAnimationFrame(() => {
                    messageList.scrollTop = messageList.scrollHeight;
                })
            } else {
                let $fallbackText = $target.find(".MessageText");
                if ($fallbackText.length) {
                    let formattedContent = Util.escapeHtml(content);
                    formattedContent = (formattedContent === undefined ? "" : formattedContent).replace(/\n/g, "<br/>");
                    $fallbackText.append(`<font class="WordBreakAll">${formattedContent}</font>`);
                    let $newMessageText = $fallbackText.find("font.WordBreakAll");
                    if ($newMessageText.length) {
                        let currentContent = $newMessageText[0].innerHTML;
                        currentContent = currentContent.replace(/(\(\[\[\d+\]\]\)|\[\[\d+\]\])/g, "");
                        $newMessageText[0].innerHTML = currentContent;
                    }
                } else {
                    console.error(`未找到 .MessageText in ${targetId}`);
                }
            }
        }
    },
    cleanJsonBlock(str) {
        return str
            .replace(/^```json\s*/i, "") // 移除開頭 ```json（忽略大小寫）
            .replace(/```$/, "") // 移除結尾 ```
            .trim(); // 去掉多餘空白
    },
    doCheckGptMode: function (parseContent) {
        //用文字比對確認是否為GPT Mode
        let filterContent = parseContent?.ans?.[0]?.text || parseContent?.QuickReply?.text
            || parseContent?.text || "";
        const gptTextItems = WebChat.gptTextConfig
            .map(key => (Util.getConfig(key) || "").replace(/\n/g, "<br>"))
            .filter(text => text !== "");

        return gptTextItems.some(gptTextItem => gptTextItem && filterContent.includes(gptTextItem));
    },

    
    
    
    getLocation: function () {
        return new Promise((resolve, reject) => {
            if (navigator.geolocation) {
                
                navigator.geolocation.getCurrentPosition(
                    function (position) {
                        WebChat.location = position.coords;
                        WebChat.updateLocation();
                        resolve()
                    },
                    function (error) {
                        Util.error("get location failed. error" + error);
                    }
                );
            }
        })
    },

    
    updateLocation: function () {
        if (WebChat.chatId == null) {
            setTimeout(WebChat.updateLocation, 2000);
            return;
        }
        let longitude = parseFloat(WebChat.location.longitude) ? parseFloat(WebChat.location.longitude) : 0;
        let latitude = parseFloat(WebChat.location.latitude) ? parseFloat(WebChat.location.latitude) : 0;

        var data = {
            chatId: WebChat.chatId,
            location: {
                longitude: longitude,
                latitude: latitude,
            },
        };
        WebChat.ajax({
            url: Util.getConfig("CRMGatewayUrl") + "openapi/web/location/update",
            data: data,
            error: function () {
                Util.error("update location failed.");
            },
        });
    },

    submitSurvey: function (data) {
        data.chatId = WebChat.lastchatId;
        WebChat.ajax({
            url: Util.getConfig("CRMGatewayUrl") + "openapi/web/survey/score",
            data: data,
            error: "SurveyErrorMessage",
            success: function () {
                Survey.clearSurveyForm();
                WebChat.addSystemMessage(WebChat.text("SurveySuccessMessage"));
                $("#SurveyListItem").hide();
                WebChat.submitedSurvey = WebChat.isInAgentService == true ? "all" : "robot";
            },
        });
    },
    submitSatisfy: function (messageSend) {
        WebChat.sendMessage(messageSend);
    },

    
    
    
    addSystemMessage: function (content, notSave) {
        let id = WebChat.addMessage(
            {
                category: Constant.CATEGORY_SYSTEM,
                content: content,
            },
            notSave
        );
        return id;
    },

    addSystemMessageAsDialog: function (message, senderType, time) {
        var message = {
            type: Constant.TYPE_TEXT,
            senderType: senderType || Constant.SENDER_TYPE_ROBOT,
            content: message,
        };
        if (time) message["time"] = time;
        WebChat.addMessage(message);
    },

    addMessage: function (message, notSave) {
        // 修復 RichMenu 招呼語推播問題修復
        // webchat推播錯誤問題修復
        if (!!message.answer) {
            try {
                if (JSON.parse(message.answer)?.type === "Html") {
                    var answerVal = JSON.parse(message.answer).value;
                    var contentObj = JSON.parse(message.content);
                    contentObj.value = answerVal;
                    message.content = JSON.stringify(contentObj);
                }
            } catch (error) {
                message.content = message.answer;
            }
        }

        

        if (message.ShowSatis === false && message.ShowSatis == null) {
            QuickReply.closeQuickReplyPool();
        }
        WebChat.newMessageTime = new Date().getTime();
        var category = (message.category || Constant.CATEGORY_CHAT).toLowerCase();
        var senderType = (message.senderType || Constant.SENDER_TYPE_USER).toLowerCase();
        var type =
            message.type == "QuickReply"
                ? Util.JsonParse(message.content).QuickReply.type || Constant.TYPE_TEXT
                : message.type || Constant.TYPE_TEXT;
        var content = message.content;
        var time = Util.formatDate(new Date(), "HH:mm:ss");
        var id = "ChatMessage_" + ++WebChat.messageIndex;
        let lastRecord = WebChat.preMessageRecord[WebChat.preMessageRecord.length - 1];
        let newId = "";
        let lastRecordDate = lastRecord?.messageTime?.split(" ")[1] ||
            lastRecord?.time?.split(" ")[1];
        let isReload = message.isReload ? true : false
        var sender = message.sender ? message.sender : {};
        var messageList = $("#MessageList")[0];
        var timeDiv = ""
        const isGreeting = !!message.isGreeting ? true : false;
        const isGPTmessageSend = !!message.GPTmessageSend ? true : false;
        let isStatusMessage = false;
        
        if (!!message.time) {
            if (typeof message.time == "number") time = Util.formatDate(new Date(message.time), "HH:mm:ss");
            else time = Util.formatStringDate(message.time);
        } else if (!!message.messageTime) {
            if (!!Monitor.mode) time = message.messageTime;
            else time = Util.formatStringDate(message.messageTime);
        } else message.messageTime = Util.formatDate(new Date());

        if (typeof content !== "object") {
            var regex = /\[(\s=|=)*[^\[\]]*\]([^\[\]]+)\[\/link\]/g;
            var upper = function (match, p1) {
                return match.replace(/\\"/g, "'").replace(/"/g, "'");
            };
            content = content.replace(regex, upper);
            if (Util.isJSON(content)) content = JSON.parse(content);
            if (content.type == "statusMessage") {
                isStatusMessage = true;
                notSave = true;
                content = content.message.text;
            }
        }
        
        if (message.type == "QuickReply") content = content.QuickReply;

        if (category == Constant.CATEGORY_SYSTEM) {
            if (!!$("#inputing")) $("#inputing").remove();
            
            const systemHtml =
                "<div class=ChatSystemMessage id=" + id + ">" + message.content + "<br>" + time + "</div>";
            messageList.insertAdjacentHTML("beforeend", DOMPurify.sanitize(systemHtml));
        } else if (category == Constant.CATEGORY_AD) {
            if (!!$("#inputing")) $("#inputing").remove();
            if (
                !notSave &&
                message.hasOwnProperty("time") &&
                WebChat.lastReceivedTime - new Date(message.time).getTime() > 0
            )
                notSave = true;
            else AnswerDisplay.setAdvertisement(id, content, messageList);
        } else {
            var align = senderType == Constant.SENDER_TYPE_USER ? "Right" : "Left";
            var senderClass = Util.upperFirstLetter(senderType);
            var contentHtml = "";
            if (senderType.toLowerCase() == "textivr") {
                
                if (message.dataType == "answer") {
                    
                    var url = message.answerDetail.url;
                    var imageUrl = message.answerDetail.imageUrl;
                    if (!Util.isEmpty(url)) {
                        contentHtml =
                            "<div class='ChatMessageContent ChatMessageTextContent'>" +
                            WebChat.text("HasOpenTheUrl") +
                            "<br>" +
                            "<a target=_blank href='" +
                            url +
                            "'>" +
                            url +
                            "</a>" +
                            "</div>";

                        if (!Util.isEmpty(url)) window.open(url);
                    }
                    
                    if (!Util.isEmpty(imageUrl)) {
                        contentHtml =
                            contentHtml +
                            "<div class='ChatMessageContent ChatMessageTextContent'>" +
                            "<img width='100%' height='100%' src='" +
                            imageUrl +
                            "' alt=" +
                            WebChat.text("PictureWithLink") +
                            "/>" +
                            "</div>";
                    }
                    
                    if (!Util.isEmpty(content)) {
                        contentHtml =
                            contentHtml +
                            "<div class='ChatMessageContent ChatMessageTextContent'>" +
                            +WebChat.processTextContent(content) +
                            "</div>";
                    }
                } else {
                    
                    if (content == Constant.CONTENT_TYPE) {
                        $.when(WebChat.getleaveword()).done(function () {
                            contentHtml =
                                "<div class='ChatMessageContent ChatMessageTextContent'>" +
                                WebChat.processTextContent(WebChat.Leave) +
                                "</div>";
                        });
                    } else {
                        contentHtml =
                            "<div class='ChatMessageContent ChatMessageTextContent'>" +
                            WebChat.processTextContent(content) +
                            "</div>";
                    }
                }
            } else {
                if (isGPTmessageSend) {
                    let speakText = "";
                    let isttsbar = false;
                    let isHasInfoSource = false;

                    let filterContent = "";
                    if (message.GPTmessageTemp[0].hasOwnProperty("QuickReply")) filterContent = message.GPTmessageTemp[0].QuickReply.text.replace(/\n/g, "<br>")
                    else filterContent = message.GPTmessageTemp[0].text.replace(/\n/g, "<br>")

                    if (align == "Left" && ((!!Util.getConfig("isSpeechSynthesis") && (Util.getConfig("ttsModel") == "browser" ? WebSpeechSynthesis.isSupport : true)))) {
                        isttsbar = true;
                    }
                    contentHtml = `
                    {messagetext}
                    `;
                    let quick_reply_items = WebChat.findQuickReply(message);
                    if (quick_reply_items) {
                        if (message.hasOwnProperty("satisClickedRecord")) {
                            quick_reply_items.satisClickedRecord = message.satisClickedRecord;
                        }
                    }
                    message.GPTmessageTemp.forEach(function (ansItem, index, array) {
                        if (ansItem.hasOwnProperty("FQACardColumn") && ansItem.FQACardColumn[0].title.includes("資料來源")) {
                            isHasInfoSource = true;
                        } else {
                            if (ansItem.hasOwnProperty("QuickReply") && ansItem.QuickReply.hasOwnProperty("FQACardColumn") && ansItem.QuickReply.FQACardColumn[0].title.includes("資料來源")) {
                                isHasInfoSource = true;
                            }
                        }
                    })
                    message.GPTmessageTemp.forEach(function (ansItem, index, array) {
                        let newMessage = {};
                        let deepAsnItem = JSON.parse(JSON.stringify(ansItem));
                        delete deepAsnItem.type;
                        isHasInfoSource === true ? newMessage["isHasInfoSource"] = true : newMessage["isHasInfoSource"] = false;
                        if (ansItem.hasOwnProperty("WebViewUrl")) message["webViewUrl"] = ansItem.WebViewUrl;
                        else if (ansItem.hasOwnProperty("QuickReply")) message["webViewUrl"] = ansItem.QuickReply.WebViewUrl;

                        const gptTextItems = WebChat.gptTextConfig
                            .map(key => (Util.getConfig(key) || "").replace(/\n/g, "<br>"))
                            .filter(text => text !== "");

                        newMessage["generalText"] = gptTextItems.find(
                            gptTextItem => gptTextItem && filterContent.includes(gptTextItem)) || "";

                        newMessage["messageTime"] = message.messageTime;
                        newMessage["type"] =
                            ansItem.type === "Html" && (Monitor.mode === "analyzer" || Monitor.mode === "mock")
                                ? "Text"
                                : ansItem.hasOwnProperty("QuickReply")
                                    ? "QuickReply"
                                    : ansItem.type;
                        newMessage["content"] =
                            ansItem.type === "Html" && (Monitor.mode === "analyzer" || Monitor.mode === "mock")
                                ? WebChat.text("HtmlFormat")
                                : ansItem.hasOwnProperty("QuickReply")
                                    ? JSON.stringify(ansItem)
                                    : deepAsnItem;
                        if (newMessage["type"].toUpperCase() == Constant.TYPE_TEXT.toUpperCase()) {
                            speakText += WebChat.stripHTML(WebChat.processSpeechTextContent(newMessage["content"]["text"]), true);
                        }
                        else if (newMessage["type"].toUpperCase() == Constant.TYPE_HTML.toUpperCase()) {
                            speakText += WebChat.stripHTML(newMessage["content"]["value"], true);
                        }
                        else if (newMessage["type"].toUpperCase() == Constant.TYPE_QUICKREPLY.toUpperCase()) {
                            content = Util.JsonParse(newMessage["content"]);
                            if (content["QuickReply"]["type"].toUpperCase() == Constant.TYPE_TEXT.toUpperCase()) {
                                speakText += WebChat.stripHTML(WebChat.processSpeechTextContent(content["QuickReply"]["text"]), true);
                            }
                            else if (content["QuickReply"]["type"].toUpperCase() == Constant.TYPE_HTML.toUpperCase()) {
                                speakText += WebChat.stripHTML(content["QuickReply"]["value"], true);
                            }
                            else if (content["QuickReply"]["type"].toUpperCase() == Constant.TYPE_QUICKREPLY.toUpperCase()) {
                                if (content["QuickReply"]["QuickReply"]["type"].toUpperCase() == Constant.TYPE_TEXT.toUpperCase()) {
                                    speakText = speakText + WebChat.stripHTML(WebChat.processSpeechTextContent(content["QuickReply"]["QuickReply"]["text"]), true)
                                }
                                else if (content["QuickReply"]["QuickReply"]["type"].toUpperCase() == Constant.TYPE_HTML.toUpperCase()) {
                                    speakText = speakText + WebChat.stripHTML(content["QuickReply"]["QuickReply"]["value"], true)
                                }
                            }
                        }

                        contentHtml = WebChat.addGPTMessage(newMessage, index, contentHtml, message.GPTmessageSend);
                    });

                    if (contentHtml.includes("{related}")) {
                        contentHtml = contentHtml.replaceAll('{related}', "");
                    }
                    if (
                        speakText != "" &&
                        !!Util.getConfig("isSpeechSynthesis") &&
                        WebChat.forageStorage.getItem("defaultspeak") == "true"
                    ) {
                        if (Util.getConfig("AvatarModel") && (Util.getConfig("ttsModel") == "heygen") && !isGreeting && !notSave) {
                            WebChat.sendTextToHeyGen(speakText);
                        } else if (WebSpeechSynthesis.isSupport) {
                            WebSpeechSynthesis.textToSpeak(speakText);
                        }
                    }
                } else {
                    let SatisCheck = message.isSatis;
                    let contentTemp = content
                    let contentType = type;
                    if (content.hasOwnProperty("QuickReply") && !isGPTmessageSend) {
                        SatisCheck = false;
                        contentTemp = contentTemp.QuickReply;
                        contentType = contentTemp.type;
                    }
                    
                    switch (contentType) {
                        case Constant.TYPE_TEXT:
                            if (isStatusMessage) {
                                contentHtml = contentTemp;
                            } else {
                                contentHtml = AnswerDisplay.setTextHTML(contentTemp);
                            }
                            break;
                        case Constant.TYPE_IMAGE:
                            contentHtml = AnswerDisplay.setImageHTML(contentTemp);
                            setTimeout(function () {
                                messageList.scrollTop = messageList.scrollHeight;
                            }, 500);
                            break;
                        case Constant.TYPE_LINKIMAGE:
                            contentHtml = AnswerDisplay.setLinkImageHTML(contentTemp);
                            setTimeout(function () {
                                messageList.scrollTop = messageList.scrollHeight;
                            }, 500);
                            break;
                        case Constant.TYPE_STICKER:
                            contentHtml = AnswerDisplay.setStickerHTML(contentTemp);
                            break;
                        case Constant.TYPE_FILE:
                            contentHtml = AnswerDisplay.setFileHTML(contentTemp);
                            break;
                        case Constant.TYPE_LIST:
                            contentHtml = AnswerDisplay.setEcpListHTML(id);
                            break;
                        case Constant.TYPE_CARDS:
                            contentHtml = AnswerDisplay.setCardHTML(id);
                            break;
                        case Constant.TYPE_MEDIACARD:
                            contentHtml = AnswerDisplay.setMediaCardHTML(id);
                            break;
                        case Constant.TYPE_AUDIO:
                            contentHtml = AnswerDisplay.setAudioHTML(contentTemp);
                            break;
                        case Constant.TYPE_VIDEO:
                            contentHtml = AnswerDisplay.setVideoHTML(contentTemp);
                            break;
                        case Constant.TYPE_HTML:
                            contentHtml = AnswerDisplay.setHtmlHTML(contentTemp, notSave);
                            break;
                        case Constant.TYPE_QUICKREPLY:
                            if (!SatisCheck) {
                                contentHtml = AnswerDisplay.setQuickReplyHTML(contentTemp);
                            }

                            break;
                        default:
                            contentHtml = AnswerDisplay.setDefaultHtml(contentTemp);
                            break;
                    }
                }
                if ((message.type == Constant.TYPE_QUICKREPLY && Util.getConfig("azureOpenAIEngineEnable"))) {
                    if (!message.isSatis) {
                        contentHtml = contentHtml + AnswerDisplay.setChatListQuickReplyHTML(content);
                    }
                }

                
                let isWebView = (content.hasOwnProperty("QuickReply") && content.QuickReply.WebViewUrl && !isGPTmessageSend)
                if ((isWebView || (message.webViewUrl || content.WebViewUrl)) && message.xiaoIType != 11 && !isGreeting)
                    isWebView ? (WebChat.OpenP4Page(content.QuickReply.WebViewUrl)) : (WebChat.OpenP4Page(message.webViewUrl || content.WebViewUrl));
                else Util.delCookieToStorage("webview");
            }

            if (senderClass == "System") {
                if (!Util.isEmpty(content)) WebChat.addSystemMessage(content);
            } else {
                let isShowEditing = true;
                if (!Monitor.mode) {
                    
                    if (
                        message.content === WebChat.tenantInfo.applyAgentCode ||
                        message.FCode === WebChat.tenantInfo.applyAgentCode
                    )
                        isShowEditing = false;
                    else if (!!message.FCode) {
                        const newCode = ["trf", "lmsg", "pushRegistrationBtn", "queue", "videoConnect"];
                        const oldCode = ["#trf?", "#lmsg?", "#pushRegistrationBtn", "#queue"];
                        const FCode = message.FCode;

                        if (Util.isJSON(FCode)) {
                            const FCodeType = JSON.parse(FCode).type || "";
                            
                            isShowEditing = !newCode.some((item) => FCodeType === item);
                        } else {
                            
                            isShowEditing = !oldCode.some((item) => !!~message.FCode.indexOf(item));
                        }
                    }
                } else isShowEditing = false;
                const isShowMessage = (type === "Html" && !!content && content.mode === "popup") || message?.noMessage ? false : true;

                if (message.isSatis) {
                    let isttsbar = false;
                    if (type == "QuickReply" && content.hasOwnProperty("QuickReply")) {
                        isttsbar = true;
                    }
                    if ((type.toUpperCase() == Constant.TYPE_TEXT.toUpperCase() ||
                        type.toUpperCase() == Constant.TYPE_HTML.toUpperCase()) &&
                        align == "Left" &&
                        ((!!Util.getConfig("isSpeechSynthesis") &&
                            (Util.getConfig("ttsModel") == "browser" ? WebSpeechSynthesis.isSupport : true)))) {
                        isttsbar = true;
                    }
                    if (message.hasOwnProperty("satisClickedRecord")) {
                        content.quick_reply_items.satisClickedRecord = message.satisClickedRecord;
                    }
                    timeDiv = WebChat.doSatisBarMessage(isttsbar, content.quick_reply_items, time)
                }
                if (isShowMessage) {
                    
                    if (message.hasOwnProperty("ShowSatis") && message.ShowSatis == false) {

                    } else {
                        let contentType = type;
                        if (content.hasOwnProperty("QuickReply") && !isGPTmessageSend) {
                            contentType = content.QuickReply.type;
                        }
                        var html = AnswerDisplay.setChatMessage(
                            senderClass,
                            align,
                            id,
                            contentHtml,
                            time,
                            sender,
                            isShowEditing,
                            contentType,
                            isGPTmessageSend,
                            message.isSatis,
                            timeDiv,
                            isStatusMessage
                        );
                        
                        messageList.insertAdjacentHTML(
                            "beforeend",
                            DOMPurify.sanitize(html, {
                                ADD_ATTR: ["onclick", "reply", "q", "onkeypress", "onerror", "url", "target"],
                                ADD_TAGS: ["iframe", "script"],
                                CUSTOM_ELEMENT_HANDLING: {
                                    tagNameCheck: /^embedded-webview/,
                                },
                            })
                        );
                        // 執行插入的腳本
                        WebChat.executeScripts(messageList);
                        // 紀錄時間戳順序判斷
                        if (lastRecordDate > time && (lastRecord?.identifyValue === "GUEST" || lastRecord.category == Constant.CATEGORY_SYSTEM)
                            && !isReload && !isStatusMessage && (message.ShowSatis === false || message.ShowSatis == null)) {
                            document.getElementById(lastRecord.MessageId)?.remove();
                            newId = "ChatMessage_" + ++WebChat.messageIndex;
                            if (lastRecord.category == Constant.CATEGORY_SYSTEM) {
                                
                                let smHtml =
                                    "<div class=ChatSystemMessage id=" + newId + ">" + lastRecord.content + "<br>" + lastRecordDate + "</div>";
                                messageList.insertAdjacentHTML("beforeend", DOMPurify.sanitize(smHtml));
                            } else if (lastRecord?.identifyValue === "GUEST") {
                                let Newhtml = AnswerDisplay.setChatMessage(
                                    WebChat.lastMessageRecord?.senderClass,
                                    WebChat.lastMessageRecord?.align,
                                    newId,
                                    WebChat.lastMessageRecord?.contentHtml,
                                    WebChat.lastMessageRecord?.time,
                                    WebChat.lastMessageRecord?.sender,
                                    WebChat.lastMessageRecord?.isShowEditing,
                                    WebChat.lastMessageRecord?.contentType,
                                    WebChat.lastMessageRecord?.isGPTmessageSend,
                                    WebChat.lastMessageRecord?.message?.isSatis,
                                    WebChat.lastMessageRecord?.timeDiv,
                                    WebChat.lastMessageRecord?.isStatusMessage
                                );
                                
                                messageList.insertAdjacentHTML(
                                    "beforeend",
                                    DOMPurify.sanitize(Newhtml, {
                                        ADD_ATTR: ["onclick", "reply", "q", "onkeypress", "onerror", "url", "target"],
                                        ADD_TAGS: ["iframe", "script"],
                                        CUSTOM_ELEMENT_HANDLING: {
                                            tagNameCheck: /^embedded-webview/,
                                        },
                                    })
                                );
                                WebChat.lastMessageRecord = {
                                    "senderClass": WebChat.lastMessageRecord?.senderClass,
                                    "align": WebChat.lastMessageRecord?.align,
                                    "id": WebChat.lastMessageRecord?.id,
                                    "contentHtml": WebChat.lastMessageRecord?.contentHtml,
                                    "time": WebChat.lastMessageRecord?.time,
                                    "sender": WebChat.lastMessageRecord?.sender,
                                    "isShowEditing": WebChat.lastMessageRecord?.isShowEditing,
                                    "contentType": WebChat.lastMessageRecord?.contentType,
                                    "isGPTmessageSend": WebChat.lastMessageRecord?.isGPTmessageSend,
                                    "isSatis": WebChat.lastMessageRecord?.message?.isSatis,
                                    "timeDiv": WebChat.lastMessageRecord?.timeDiv,
                                    "isStatusMessage": WebChat.lastMessageRecord?.isStatusMessage
                                }
                            }
                        } else {
                            WebChat.lastMessageRecord = {
                                "senderClass": senderClass,
                                "align": align,
                                "id": id,
                                "contentHtml": contentHtml,
                                "time": time,
                                "sender": sender,
                                "isShowEditing": isShowEditing,
                                "contentType": contentType,
                                "isGPTmessageSend": isGPTmessageSend,
                                "isSatis": message.isSatis,
                                "timeDiv": timeDiv,
                                "isStatusMessage": isStatusMessage
                            }
                        }
                    }

                    qrType = ""
                    if (type.toUpperCase() == Constant.TYPE_QUICKREPLY.toUpperCase()) {
                        qrType = content?.QuickReply?.type || Constant.TYPE_QUICKREPLY;
                    }
                    if (
                        ((type.toUpperCase() == Constant.TYPE_TEXT.toUpperCase() ||
                            type.toUpperCase() == Constant.TYPE_HTML.toUpperCase()) ||
                            (qrType.toUpperCase() == Constant.TYPE_TEXT.toUpperCase() ||
                                qrType.toUpperCase() == Constant.TYPE_HTML.toUpperCase())) &&
                        align == "Left" &&
                        !!Util.getConfig("isSpeechSynthesis") &&
                        (Util.getConfig("ttsModel") == "browser" ? WebSpeechSynthesis.isSupport : true) &&
                        WebChat.forageStorage.getItem("defaultspeak") == "true"
                    ) {
                        
                        var LeftChatMessage = messageList.querySelectorAll('.ChatMessage.ChatMessageLeft');
                        var lastLeftChatMessage = LeftChatMessage[LeftChatMessage.length - 1];
                        if (lastLeftChatMessage != undefined && !isStatusMessage) {
                            var lastPlayButton = lastLeftChatMessage.querySelector('#play-tts-btn');
                            
                            if (lastPlayButton) {
                                if (isGreeting) {
                                    WebChat.greetingMessage = lastPlayButton;
                                } else {
                                    lastPlayButton.click();
                                }
                            }
                        }
                    }
                } else $("#inputing").remove();

                
                if (!isGPTmessageSend) {
                    let contentTemp = content
                    let contentType = type;
                    if (content.hasOwnProperty("QuickReply")) {
                        contentTemp = contentTemp.QuickReply;
                        contentType = contentTemp.type;
                    }
                    switch (contentType) {
                        case Constant.TYPE_LIST:
                            AnswerDisplay.appendListSwiper(id, contentTemp);
                            break;
                        case Constant.TYPE_CARDS:
                            AnswerDisplay.appendCardSwiper(id, contentTemp);
                            break;
                        case Constant.TYPE_MEDIACARD:
                            if (!!!message.noMessage) {
                                if (contentTemp?.MediaCardList) {
                                    AnswerDisplay.appendMediaCardSwiper(id, contentTemp);
                                } else {
                                    contentTemp = { MediaCardList: [contentTemp] };
                                    AnswerDisplay.appendMediaCardSwiper(id, contentTemp);
                                }
                            }
                            break;
                    }

                    if ((message.type == Constant.TYPE_QUICKREPLY && !notSave && !Util.getConfig("azureOpenAIEngineEnable")) && (!message.isSatis || content.hasOwnProperty("QuickReply"))) {
                        if (typeof content == "string") { QuickReply.initQuickReply(Util.JsonParse(message.content)) }
                        else {
                            QuickReply.closeQuickReplyPool();
                            if (content.hasOwnProperty("QuickReply")) {
                                content = content.QuickReply;
                                QuickReply.initQuickReply(content)
                            } else {
                                QuickReply.initQuickReply(content)
                            }
                        };
                    }
                }
            }
        }

        
        if (!!Util.getConfig("isShowUnRead") && parent.window != window && !!WebChat.parentIFrameUrl) {
            WebChat.postMessage({
                type: "unread",
            });
        }

        if (!notSave) {
            
            message.webViewUrl = "";
            
            message["disconnectStatus"] = id;
            message["MessageId"] = id;
            if ("FCode" in message) {
                
                message["FCode"] = message.FCode;
            }
            if (lastRecordDate > time && (lastRecord?.identifyValue === "GUEST" || lastRecord.category == Constant.CATEGORY_SYSTEM)
                && !isReload && !isStatusMessage && (message.ShowSatis === false || message.ShowSatis == null)) {
                WebChat.preMessageRecord.pop();
                WebChat.preMessageRecord.push(message);
                lastRecord.disconnectStatus = newId
                lastRecord.MessageId = newId
                WebChat.preMessageRecord.push(lastRecord);
            } else {
                WebChat.preMessageRecord.push(message);
            }
        } else {
            
            if (message.hasOwnProperty("disconnectStatus")) {
                if (message.disconnectStatus.indexOf("true") != -1) message["disconnectStatus"] = id + "_true";
                else message["disconnectStatus"] = id + "_false";
            }
        }
        messageList.scrollTop = messageList.scrollHeight;
        return id;
    },

    addGPTMessage: function (message, index, Html, GPTmessageSend) {
        var type =
            message.type == "QuickReply"
                ? Util.JsonParse(message.content).QuickReply.type || Constant.TYPE_TEXT
                : message.type || Constant.TYPE_TEXT;
        var content = message.content;
        if (message.type == "QuickReply") content = Util.JsonParse(content).QuickReply;
        let itemTitle = ""
        if (message.type == "Cards" || message.type == "QuickReply") {
            if (content.hasOwnProperty("FQACardColumn")) {
                itemTitle = content.FQACardColumn[0].title;
            }
        }
        switch (type) {
            case Constant.TYPE_TEXT:
                content = Array.isArray(content.text) ? content.text[0] : content.text;
                let filterContent =
                    Util.getConfig("userInputFilter") === "clearTag"
                        ? WebChat.clearTag(WebChat.processTextContent(EmojiUtil.parseEmoji(content)))
                        : WebChat.processTextContent(EmojiUtil.parseEmoji(content)); Util.getConfig("language");
                if (!message.isHasInfoSource && message.generalText !== "") {
                    filterContent = filterContent.replace(/\n/g, "<br>").replace(message.generalText, `<div style="display: inline-block;width:100%"><font class="GenerateText">${message.generalText}</font></div>`)
                } else if (message.isHasInfoSource && message.generalText === "") {
                    filterContent = filterContent.replace(/\n/g, "<br>") + "{generalText}"
                }
                contentHtml =
                    "<div class='ChatMessageContent ChatMessageTextContent' tabindex='0' >" + filterContent + "</div>";
                if (Html.includes('{steaming_messagetext}')) {
                    if (message.generalText !== "") {
                        Html = `<div style="display: inline-block;width:100%"><font class="GenerateText">${message.generalText}</font></div>`;
                    }
                } else {
                    Html = Html.replaceAll('{messagetext}', contentHtml);
                }
                break;
            case Constant.TYPE_CARDS:
                if (itemTitle.includes("資料來源")) {
                    let sources = `
                    <div class="sourceBox">
                        <font class="messagetitle">{messagetitle}</font>
                        <br>
                        <div id="source">
                            {sources}
                        </div>
                        <div class="GenerateText"><font >${message.generalText}</font></div>
                    </div>
                    `;
                    let result = "";
                    content.FQACardColumn.forEach(function (FQACardColumnItem, index, array) {
                        FQACardColumnItem.FQACardAnswer.forEach(function (CardAnswerItem, index, array) {
                            let resultItem = "";
                            if (CardAnswerItem.FName.includes("_webview=1")) {
                                resultItem = "<a href='#' tabindex='0' onclick=\"WebChat.OpenP4Page('" + CardAnswerItem.FName + "')\" onkeypress=\"WebChat.OpenP4Page('" + CardAnswerItem.FName + "')\"  title='{content}'>{content}</a></br>";
                            } else {

                                resultItem = "<a href='#' tabindex='0' onclick=\"WebChat.checkOpenUrl(' " + CardAnswerItem.FName + " ')\"  onkeypress=\"WebChat.checkOpenUrl(' " + CardAnswerItem.FName + " ')\" title='{content}'>{content}</a></br>";
                            }
                            resultItem = resultItem.replaceAll('{content}', CardAnswerItem.FDisplayText);
                            result += resultItem;
                        });
                    });
                    sources = sources.replaceAll('{messagetitle}', WebChat.text("DataSourceText"));
                    sources = sources.replaceAll('{sources}', result)
                    if (Html.includes('{steaming_messagetext}')) {
                        Html = Html.replaceAll("{steaming_messagetext}", sources);
                    } else {
                        if (!(message.generalText === "")) {
                            Html = Html.replaceAll(message.generalText, sources);
                        } else {
                            Html = Html.replaceAll("{generalText}", sources);
                        }
                    }
                } else if (itemTitle.includes("相關問題")) {
                    let related = "";
                    content.FQACardColumn.forEach(function (FQACardColumnItem, index, array) {
                        FQACardColumnItem.FQACardAnswer.forEach(function (CardAnswerItem, index, array) {
                            let relatedItem = "<li class='GptRelated' tabindex='0' " +
                                "q='" +
                                encodeURIComponent(CardAnswerItem.FName).replace(/'/g, '&apos;').replace(/"/g, '&quot;') +
                                "'  reply='" +
                                encodeURIComponent(CardAnswerItem.FDisplayText || CardAnswerItem.FName || CardAnswerItem.FShowText).replace(/'/g, '&apos;').replace(/"/g, '&quot;') +
                                '\' onKeypress="WebChat.swiper_li_button(this);"  onclick="WebChat.swiper_li_button(this);" >' +
                                "{content}</li>";
                            relatedItem = relatedItem.replaceAll('{content}', CardAnswerItem.FDisplayText);
                            relatedItem = relatedItem.replaceAll('{FDisplayText}', CardAnswerItem.FDisplayText);
                            related += relatedItem;
                        });
                    });
                    Html = Html.replaceAll('{related}', related);
                }
                break;
        }
        return Html;
    },

    doSatisBarMessage: function (isttsbar, quick_reply_items, time) {
        let ttsbar = ` <div onclick="WebSpeechSynthesis.speak(this)" title="${WebChat.text("VoicePlayBtn")}" aria-label="${WebChat.text("VoicePlayBtn")}" tabindex="0" class="Satisfypannel icon-color " id="play-tts-btn"></div> `;
        let satisBar = "";
        if (!(quick_reply_items == null)) {
            for (let i = 0; i < quick_reply_items.length; i++) {
                let item = quick_reply_items[2 - i];
                let display = item.DisplayText || item.ShowText;
                if (typeof item.Code == "object") item.Code = JSON.stringify(item.Code);
                let SatisClass = "";
                switch (i) {
                    case 0:
                        SatisClass = "ChatMessageGptSatisLike";
                        if (quick_reply_items.hasOwnProperty("satisClickedRecord") && quick_reply_items.satisClickedRecord == "ChatMessageGptSatisLike") {
                            SatisClass = "ChatMessageGptSatisLike_clicked clicked"
                        }
                        break;
                    case 1:
                        SatisClass = "ChatMessageGptSatisOK";
                        if (quick_reply_items.hasOwnProperty("satisClickedRecord") && quick_reply_items.satisClickedRecord == "ChatMessageGptSatisOK") {
                            SatisClass = "ChatMessageGptSatisOK_clicked clicked"
                        }
                        break;
                    case 2:
                        SatisClass = "ChatMessageGptSatisDislike";
                        if (quick_reply_items.hasOwnProperty("satisClickedRecord") && quick_reply_items.satisClickedRecord == "ChatMessageGptSatisDislike") {
                            SatisClass = "ChatMessageGptSatisDislike_clicked clicked"
                        }
                        break;
                }
                if (i == 0) {
                    continue;
                }
                satisBar +=
                    "<div  class='Satisfypannel icon-color " + SatisClass + "' q='" +
                    encodeURIComponent(item.Code).replace(/'/g, '&apos;').replace(/"/g, '&quot;') +
                    "' reply='" +
                    encodeURIComponent(display).replace(/'/g, '&apos;').replace(/"/g, '&quot;') +
                    '\'  tabindex="0"   onKeypress=" QuickReply.clickQuickReply(this);"   onclick=" QuickReply.clickQuickReply(this); " >' +
                    "</div>";
            }
        }
        timeDiv =
            '<div class=ChatMessageGptSatisBar tabindex="0">' +
            (isttsbar == true ? ttsbar : "") +
            satisBar +
            "</div>";
        return timeDiv
    },

    refreshMessageListLayout: function () {
        let toolHeight = 0;
        let messagelistBottom = 0;
        let tool = $("#ToolZone");
        let editor = $("#EditorZone");
        messagelistBottom = parseInt(editor.outerHeight());
        if (tool.is(":visible")) toolHeight = parseInt(tool.outerHeight());
        const listBottom = toolHeight + messagelistBottom;
        $("#MessageList").css("bottom", listBottom + "px");
    },

    executeScripts: function (container) {
        const scripts = container.getElementsByTagName('script');
        for (let i = 0; i < scripts.length; i++) {
            const script = document.createElement('script');
            script.text = `if (true) { ${scripts[i].text} }`;
            document.body.appendChild(script).parentNode.removeChild(script);
        }
    },

    getFileIconClass: function (fileName) {
        var map = {
            Excel: /\.(xls|xlsx)$/i,
            Exe: /\.(exe|bat|cmd|sh|msi)$/i,
            Image: /\.(bmp|gif|jpg|jpeg|png)$/i,
            Ppt: /\.(ppt|pptx)$/i,
            Text: /\.(txt|log)$/i,
            Word: /\.(doc|docx)$/i,
            Zip: /\.(7z|cab|gz|iso|jar|rar|tar|z|zip)$/i,
        };
        for (var key in map) {
            if (map[key].test(fileName)) return "ChatMessageFileContentIcon ChatMessageFileContentIcon" + key;
        }
        return "ChatMessageFileContentIcon";
    },

    getAvatar: function (senderClass) {
        var robottype = "A";
        var picId = "";
        switch (senderClass) {
            case "Robot":
                if (robottype == "A")
                    picId =
                        WebChat.tenantInfo.robotAPic == undefined
                            ? "17c3af79-2360-06ee-76bf-f8ffc25f657a"
                            : WebChat.tenantInfo.robotAPic;
                if (robottype == "B")
                    picId =
                        WebChat.tenantInfo.robotBPic == undefined
                            ? "17c3af80-bd30-06ee-76bf-f8ffc25f657a"
                            : WebChat.tenantInfo.robotBPic;
                break;
            case "User":
                picId =
                    WebChat.tenantInfo.userIdPic == undefined
                        ? "17c3af73-4750-06ee-76bf-f8ffc25f657a"
                        : WebChat.tenantInfo.userIdPic;
                break;
            case "Agent":
                picId =
                    WebChat.tenantInfo.agentIdPic == undefined
                        ? "17c3af7f-16b0-06ee-76bf-f8ffc25f657a"
                        : WebChat.tenantInfo.agentIdPic;
                break;
            case "Icr":
                picId = WebChat.tenantInfo.iCRIdPic;
                break;
        }
        return picId;
    },
    
    streamingAjax: function (settings, isReturn) {
        var success = settings.success;
        var error = settings.error;
        var onStream = settings.onStream;

        if (settings.contentType == undefined || settings.contentType == null) {
            settings.contentType = "application/json;charset=UTF-8";
        }
        if (typeof error == "string") {
            var errorCode = error;
            error = settings.error = function () {
                WebChat.addSystemMessage(WebChat.text(errorCode), true);
            };
        }
        if (typeof success == "string") {
            var successCode = success;
            success = settings.success = function () {
                WebChat.addSystemMessage(WebChat.text(successCode));
            };
        }
        if (settings.method == null) {
            var method = Util.checkMethod("POST");
            settings.method = method;
        }

        // 準備 fetch 選項
        var headers = { "Content-Type": settings.contentType };
        if (settings.headers) {
            Object.keys(settings.headers).forEach(function (key) {
                headers[key] = settings.headers[key];
            });
        }
        // 自動附帶 CSRF（若存在）
        var csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content");
        if (csrfToken && !headers["X-CSRF-Token"]) headers["X-CSRF-Token"] = csrfToken;

        var body = settings.data;
        if (typeof body === "object") body = JSON.stringify(body);
        var upper = (settings.method || "").toUpperCase();
        var fetchOptions = { method: settings.method, headers: headers };
        if (upper !== "GET" && body != null) fetchOptions.body = body;

        var exec = async function () {
            try {
                var resp = await fetch(settings.url, fetchOptions);
                if (!resp.ok) {
                    if (error) error({ status: resp.status, message: resp.statusText });
                    return isReturn ? Promise.reject({ status: resp.status, message: resp.statusText }) : undefined;
                }
                var ct = resp.headers && resp.headers.get ? (resp.headers.get("content-type") || "") : "";

                // Streaming 分流
                if (ct.indexOf("text/event-stream") !== -1) {
                    if (onStream) onStream(resp);
                    return isReturn ? { __stream: true } : undefined;
                }

                // JSON 分流
                try {
                    var json = await resp.json();
                    WebChat.processAjaxResult(json, success, error);
                    return isReturn ? json : undefined;
                } catch (e) {
                    var text = await resp.text();
                    try {
                        var jsonFallback = JSON.parse(text);
                        WebChat.processAjaxResult(jsonFallback, success, error);
                        return isReturn ? jsonFallback : undefined;
                    } catch (_e) {
                        if (error) error({ message: "Invalid JSON response" });
                        return isReturn ? text : undefined;
                    }
                }
            } catch (err) {
                if (error) error({ message: err && err.message ? err.message : "Network error" });
                return isReturn ? Promise.reject(err) : undefined;
            }
        };

        if (!!isReturn) {
            return exec();
        } else {
            exec();
        }
    },

    ajax: function (settings, isReturn) {
        var success = settings.success;
        var error = settings.error;
        if (settings.contentType == undefined || settings.contentType == null) {
            settings.contentType = "application/json;charset=UTF-8";
        }
        if (typeof error == "string") {
            var errorCode = error;
            error = settings.error = function () {
                WebChat.addSystemMessage(WebChat.text(errorCode), true);
            };
        }
        if (typeof success == "string") {
            var successCode = success;
            success = settings.success = function () {
                WebChat.addSystemMessage(WebChat.text(successCode));
            };
        }
        if (settings.method == null) {
            var method = Util.checkMethod("POST");
            settings.method = method;
        }

        if (typeof settings.data == "object") {
            settings.data = JSON.stringify(settings.data);
        }
        settings.success = function (result) {
            WebChat.processAjaxResult(result, success, error);
        };

        if (!!isReturn) return $.ajax(settings);
        else $.ajax(settings);
    },

    processAjaxResult: function (result, success, error) {
        if (result._header_ != null && !result._header_.success) {
            if (error) error(result._header_);
        } else {
            if (success) success(result);
        }
    },

    
    addStreamingMessage: function (data) {
        if (data.content) {
            // 檢查是否已有 streaming 訊息元素
            var streamingElement = $("#streaming-message-" + data.id);
            if (streamingElement.length === 0) {
                // 建立新的 streaming 訊息元素
                var messageElement = $('<div id="streaming-message-' + (data.id || Date.now()) + '" class="streaming-message"></div>');
                $("#messageZone").append(messageElement);
                streamingElement = messageElement;
            }

            // 更新內容
            streamingElement.html(data.content);

            // 自動滾動到底部
            WebChat.scrollToBottom();
        }
    },

    
    addStreamingText: function (text) {
        if (text && text.trim() !== '') {
            var textElement = $('<div class="streaming-text">' + text + '</div>');
            $("#messageZone").append(textElement);

            // 自動滾動到底部
            WebChat.scrollToBottom();
        }
    },

    
    updateStreamingStatus: function (status) {
        if (status) {
            var statusElement = $("#streaming-status");
            if (statusElement.length === 0) {
                statusElement = $('<div id="streaming-status" class="streaming-status"></div>');
                $("#messageZone").append(statusElement);
            }
            statusElement.text(status);
        }
    },

    
    completeStreamingMessage: function (data) {
        // 移除 streaming 狀態
        $("#streaming-status").remove();

        // 移除 streaming 訊息 ID
        if (data.id) {
            $("#streaming-message-" + data.id).removeAttr('id');
        }

        // 如果有最終內容，更新為完整訊息
        if (data.finalContent) {
            var streamingElement = $("#messageZone .streaming-message").last();
            if (streamingElement.length > 0) {
                streamingElement.html(data.finalContent);
                streamingElement.removeClass('streaming-message');
            }
        }

        // 自動滾動到底部
        WebChat.scrollToBottom();
    },

    
    scrollToBottom: function () {
        var messageZone = $("#messageZone");
        if (messageZone.length > 0) {
            messageZone.scrollTop(messageZone[0].scrollHeight);
        }
    },

    
    initResizeBar: function () {
        var resizeBar = $("#ResizeBar");
        var messageList = $("#MessageList");
        var isDragging = false;
        var startY = 0;
        var startTopPercent = 0;
        var startbottom = 0;

        // 最小和最大 top 位置限制（百分比）
        var minTopPercent = 10;   // 最小 10%
        var maxTopPercent = 70;   // 最大 80%
        resizeBar.on("mousedown touchstart", function (e) {
            e.preventDefault();
            isDragging = true;
            resizeBar.addClass("dragging");

            var clientY = e.type === "touchstart" ? e.originalEvent.touches[0].clientY : e.clientY;
            startY = clientY;

            // 獲取當前容器高度和 MessageList 的 top 值
            var containerHeight = messageList.parent().height();
            var currentTopPx = parseInt(messageList.css("top"), 10);
            startTopPercent = (currentTopPx / containerHeight) * 100;

            // 防止文字選取
            $("body").addClass("user-select-none");

            // 綁定移動和結束事件到 document
            $(document).on("mousemove.resize touchmove.resize", handleDrag);
            $(document).on("mouseup.resize touchend.resize", handleDragEnd);
        });

        function handleDrag(e) {
            if (!isDragging) return;
            e.preventDefault();

            var clientY = e.type === "touchmove" ? e.originalEvent.touches[0].clientY : e.clientY;
            var deltaY = clientY - startY;

            // 獲取當前容器高度
            var containerHeight = messageList.parent().height();

            // 將像素變化轉換為百分比變化
            var deltaPercent = (deltaY / containerHeight) * 100;
            var newTopPercent = startTopPercent + deltaPercent;

            // 限制百分比範圍
            newTopPercent = Math.max(minTopPercent, Math.min(maxTopPercent, newTopPercent));

            // 更新 MessageList 和 ResizeBar 位置
            WebChat.updateMessageListPositionByPercent(newTopPercent);
            WebChat.updateHeygenContentPosition();
        }

        function handleDragEnd(e) {
            if (!isDragging) return;

            isDragging = false;
            resizeBar.removeClass("dragging");
            $("body").removeClass("user-select-none");

            // 解除事件綁定
            $(document).off("mousemove.resize touchmove.resize");
            $(document).off("mouseup.resize touchend.resize");

            // 觸發視窗大小調整完成事件
            WebChat.onResizeComplete();
            WebChat.updateHeygenContentPosition();
        }
    },

    
    updateMessageListPosition: function (newTop) {
        var messageList = $("#MessageList");
        var resizeBar = $("#ResizeBar");

        // 更新 MessageList top
        messageList.css("top", newTop + "px");

        // ResizeBar 位置跟隨 (距離 MessageList 頂部 1px)
        resizeBar.css("top", (newTop + 1) + "px");
    },

    
    updateMessageListPositionByPercent: function (newTopPercent) {
        var messageList = $("#MessageList");
        var resizeBar = $("#ResizeBar");

        // 更新 MessageList top 使用百分比
        messageList.css("top", newTopPercent + "%");

        // ResizeBar 位置跟隨（稍微偏移一點）
        resizeBar.css("top", "calc(" + newTopPercent + "% + 1px)");
    },
    updateHeygenContentPosition: function () {
        WebChat.checkAndMoveHeyGenContent();
        var messageList = $("#MessageList");
        var messagelisttop = parseInt(messageList.css("top"));
        const fullContainer = $("#LeftZone-HeyGen-Full");
        if (fullContainer.children().length > 0) {
            $("#heygen-controls").css("bottom", "0px");
        } else {
            $("#heygen-controls").css("bottom", "");
            $("#heygen-controls").css("top", messagelisttop - 62 + "px");
        }
    },

    
    updateChatWindowSize: function (messageListTop) {
        var windowHeight = $(window).height();
        var editorZoneHeight = $("#EditorZone").outerHeight() || 125;
        var toolZoneHeight = $("#ToolZone").is(":visible") ? $("#ToolZone").outerHeight() : 0;
        // 計算聊天區域可用高度
        var availableHeight = windowHeight - messageListTop - editorZoneHeight - toolZoneHeight - 40; // 40px 為邊距
        // 觸發訊息列表布局重新計算
        WebChat.refreshMessageListLayout();
    },

    
    onResizeComplete: function () {
        // 滾動到底部保持最新訊息可見
        setTimeout(function () {
            var messageList = $("#MessageList");
            if (messageList.length > 0) {
                messageList.scrollTop(messageList[0].scrollHeight);
            }
        }, 100);

        // 儲存使用者偏好設定到本地存儲（百分比）
        var messageList = $("#MessageList");
        var containerHeight = messageList.parent().height();
        var currentTopPx = parseInt(messageList.css("top"), 10);
        var currentTopPercent = (currentTopPx / containerHeight) * 100;

        if (WebChat.forageStorage) {
            WebChat.forageStorage.setItem("messageListTopPercent", currentTopPercent);
            // 保留舊的像素值作為備用
            WebChat.forageStorage.setItem("messageListTop", currentTopPx);
        }
    },

    
    loadMessageListPosition: function () {
        if (WebChat.forageStorage) {
            // 優先使用百分比值
            var savedTopPercent = WebChat.forageStorage.getItem("messageListTopPercent");
            if (savedTopPercent && savedTopPercent !== null) {
                WebChat.updateMessageListPositionByPercent(parseFloat(savedTopPercent));
                console.log(`📍 載入 MessageList 位置: ${savedTopPercent}%`);
            } else {
                // 回退到像素值（向下相容）
                var savedTop = WebChat.forageStorage.getItem("messageListTop");
                if (savedTop && savedTop !== null) {
                    WebChat.updateMessageListPosition(parseInt(savedTop, 10));
                    console.log(`📍 載入 MessageList 位置: ${savedTop}px (舊格式)`);
                }
            }
        }
    },

    
    heyGenState: {
        isInitialized: false,
        isMicActive: false,
        isAvatarMuted: false,
        isChatZoneVisible: true
    },

    
    initHeyGen: function () {
        // 先移動共用內容到對應容器
        WebChat.updateHeyGenContentDisplayMode(true);

        // 內容移動完成後，再綁定控制按鈕事件
        setTimeout(function () {
            WebChat.bindHeyGenControls();
        }, 100);

        // 設置簡單的 HeyGen 內容移動監聽器
        WebChat.setupSimpleHeyGenMover();
    },
    updateHeyGenContentDisplayMode: function (isInitialized) {
        switch (isInitialized) {
            case true:
                WebChat.heyGenDisplayInit();
                break;
            case false:
                WebChat.heyGenDisplayUpdate();
                break;
        }
    },
    heyGenDisplayInit: function () {
        WebChat.initResizeBar();
        const isMobile = Util.doDetectMobile(); // 檢測是否為手機
        var sharedContent = $("#heygen-shared-content").html();
        var targetContainer;
        if (window.name === "Iframe-AI3-WebChat" || (window.name !== "Iframe-AI3-WebChat" && isMobile)) {
            setTimeout(function () {
                WebChat.loadMessageListPosition();
            }, 100);
            targetContainer = $("#LeftZone-HeyGen-Half");
            WebChat.heyGenState.isChatZoneVisible = true;
            $("#LeftZone-HeyGen-Half").show();
            $("#LeftZone-HeyGen-Full").hide();
        } else {
            targetContainer = $("#LeftZone-HeyGen-Full");
            WebChat.heyGenState.isChatZoneVisible = false;
            $("#LeftZone-HeyGen-Full").show();
            $("#LeftZone-HeyGen-Half").hide();
        }
        // 將共用內容移動到目標容器
        if (sharedContent && targetContainer.length > 0) {
            targetContainer.html(sharedContent);
        }
    },
    heyGenDisplayUpdate: function () {
        const isMobile = Util.doDetectMobile(); // 檢測是否為手機
        if (window.name === "Iframe-AI3-WebChat" || (window.name !== "Iframe-AI3-WebChat" && isMobile)) {
            // 載入使用者偏好的 MessageList 位置
            setTimeout(function () {
                WebChat.loadMessageListPosition();
            }, 100);
            // iframe 模式 或 (非iframe但是手機版) - 使用 Half 容器
            targetContainer = $("#LeftZone-HeyGen-Half");
            // iframe 模式 或 (非iframe但是手機版) - 使用 Half 模式
            WebChat.heyGenState.isChatZoneVisible = true;
            $("#LeftZone-HeyGen-Half").show();
            $("#LeftZone-HeyGen-Full").hide();
            console.log('📱 使用 HeyGen Half 模式', window.name === "Iframe-AI3-WebChat" ? '(iframe模式)' : '(手機版)');
        } else {
            // 桌面版全螢幕模式 - 使用 Full 容器
            targetContainer = $("#LeftZone-HeyGen-Full");
            // 桌面版全螢幕模式 - 使用 Full 模式
            WebChat.heyGenState.isChatZoneVisible = false;
            $("#LeftZone-HeyGen-Full").show();
            $("#LeftZone-HeyGen-Half").hide();
            console.log('🖥️ 使用 HeyGen Full 模式 (桌面版全螢幕)');
        }
        var sharedContent = $("#heygen-shared-content").html();
        var targetContainer;
        // 將共用內容移動到目標容器
        if (sharedContent && targetContainer.length > 0) {
            targetContainer.html(sharedContent);
        }
    },

    
    setupSimpleHeyGenMover: function () {
        let resizeTimeout;

        // 初始檢查並移動
        WebChat.checkAndMoveHeyGenContent();

        // 視窗大小變化監聽器
        $(window).on('resize.simpleHeyGenMover', function () {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(function () {
                WebChat.checkAndMoveHeyGenContent();
            }, 250);
        });
    },

    
    checkAndMoveHeyGenContent: function () {
        const windowWidth = $(window).width();
        const breakpoint = 768;

        if (windowWidth < breakpoint) {
            // 視窗小於768，檢查 Full 容器內容並移到 Half
            const fullContainer = $("#LeftZone-HeyGen-Full");
            const halfContainer = $("#LeftZone-HeyGen-Half");

            if (fullContainer.children().length > 0) {
                // 真正的移動 DOM 元素，保持所有狀態和事件監聽器
                fullContainer.children().appendTo(halfContainer);
                $("#heygen-controls").css("bottom", "");
                $("#ChatZone").css("display", "");
            }
        } else {
            // 視窗大於等於768，檢查 Half 容器內容並移到 Full
            const fullContainer = $("#LeftZone-HeyGen-Full");
            const halfContainer = $("#LeftZone-HeyGen-Half");

            if (halfContainer.children().length > 0) {
                // 真正的移動 DOM 元素，保持所有狀態和事件監聽器
                halfContainer.children().appendTo(fullContainer);
                $("#heygen-controls").css("bottom", "0px");
                if (WebChat.heyGenState.isChatZoneVisible) {
                    $("#ChatZone").css("display", "");
                } else {
                    $("#ChatZone").css("display", "none");
                }
            }
        }
    },

    
    cleanupSimpleHeyGenMover: function () {
        $(window).off('resize.simpleHeyGenMover');
        console.log('🧹 已清理簡單 HeyGen 內容移動器');
    },

    
    bindHeyGenControls: function () {
        WebChat.bindHeyGenControlsChatZone();
        WebChat.bindHeyGenControlsMute();
        WebChat.bindHeyGenControlsSTT();
    },
    bindHeyGenControlsSTT: function () {
        if (Util.getConfig("sttMode") === "server") {
            AzureWebSTT.doLoad();
            $("#SpeechToTextBtn").on("click", async function () {
                if (!AzureWebSTT.enableSTT) {
                    AzureWebSTT.showSTTDisabledMessage();
                    return;
                }
                if (AzureWebSTT.isRecording) {
                    await AzureWebSTT.stopRecording();
                } else {
                    if (AzureWebSTT.featureFlags.enableVoiceFilter) {
                        await AzureWebSTT.startRecordingWithFilter();
                    } else {
                        await AzureWebSTT.startRecording();
                    }
                }
            });
        } else {
            // $("#toggle-mic-btn").off("click");
            // var micBtn = $("#toggle-mic-btn");
            // if (micBtn.length > 0) {
            //     micBtn.on("click", function() {
            //         WebChat.browsweSTTControl();
            //     });
            // }
        }
    },
    browsweSTTControl: function () {
        var micBtn = $("#toggle-mic-btn");
        if (WebChat.heyGenState.isMicActive) {
            // 關閉麥克風
            WebChat.stopHeyGenMicrophone();
            micBtn.removeClass("active");
            WebChat.heyGenState.isMicActive = false;
        } else {
            // 開啟麥克風
            WebChat.startHeyGenMicrophone();
            micBtn.addClass("active");
            WebChat.heyGenState.isMicActive = true;
        }
    },
    azureSTTControl: function () {
    },
    bindHeyGenControlsChatZone: function () {
        $("#toggle-chatzone-btn").off("click");
        var chatBtn = $("#toggle-chatzone-btn");
        if (chatBtn.length > 0) {
            chatBtn.on("click", function () {
                WebChat.toggleChatZone();
            });
        }
    },
    bindHeyGenControlsMute: function () {
        $("#toggle-avatar-mute-btn").off("click");
        var muteBtn = $("#toggle-avatar-mute-btn");
        if (muteBtn.length > 0) {
            muteBtn.on("click", function () {
                WebChat.toggleAvatarMute();
            });
        }
    },

    
    toggleChatZone: function () {
        if (window.name === "Iframe-AI3-WebChat") return;
        var leftZone_HeyGen = $("#LeftZone-HeyGen-Full");
        var leftZone_ChatZone = $("#ChatZone");
        var toggleBtn = $("#toggle-chatzone-btn");

        if (WebChat.heyGenState.isChatZoneVisible) {
            // 隱藏聊天區域，全屏顯示虛擬人
            leftZone_ChatZone.css("display", "none");
            leftZone_HeyGen.css("width", "100%");
            toggleBtn.addClass("active");
            WebChat.heyGenState.isChatZoneVisible = false;
        } else {
            // 顯示聊天區域，分割視圖
            leftZone_ChatZone.css("display", "block");
            leftZone_HeyGen.css("width", "68.8%");
            toggleBtn.removeClass("active");
            WebChat.heyGenState.isChatZoneVisible = true;
        }
    },

    
    toggleMicrophone: function () {
        var micBtn = $("#toggle-mic-btn");
        if (WebChat.heyGenState.isMicActive) {
            micBtn.removeClass("active");
            WebChat.heyGenState.isMicActive = false;
        } else {
            micBtn.addClass("active");
            WebChat.heyGenState.isMicActive = true;
        }
    },

    
    startHeyGenMicrophone: function () {
        try {
            if (typeof WebSpeechRecognition !== 'undefined' && WebSpeechRecognition.isSupport) {
                // 初始化雜音過濾系統
                WebChat.initNoiseFilter();
                // 設置專用的語音辨識處理器
                WebChat.setupHeyGenSpeechHandler();
                // 設置語音辨識參數（優化雜音處理）
                WebSpeechRecognition.finalTranscript = "";
                WebSpeechRecognition.recognition.lang = Util.getConfig("speechRecognitionLang");
                // 優化語音辨識設定來減少雜音
                WebSpeechRecognition.recognition.continuous = false; // 單次辨識，減少背景雜音
                WebSpeechRecognition.recognition.interimResults = true; // 啟用即時結果
                WebSpeechRecognition.recognition.maxAlternatives = 1; // 只要最佳結果

                WebSpeechRecognition.recognition.start();
                WebSpeechRecognition.startTimestamp = Date.now();
                // 更新狀態指示
                $("#toggle-mic-btn").attr("title", "正在監聽... (點擊關閉)");
            }
        } catch (error) {
            console.error('HeyGen 麥克風啟動失敗:', error);
        }
    },

    
    stopHeyGenMicrophone: function () {
        try {
            if (typeof WebSpeechRecognition !== 'undefined' && WebSpeechRecognition.recognition) {
                WebSpeechRecognition.recognition.stop();

                // 恢復原始處理器
                if (WebChat.originalHeyGenOnResult) {
                    WebSpeechRecognition.recognition.onresult = WebChat.originalHeyGenOnResult;
                }
                if (WebChat.originalHeyGenOnEnd) {
                    WebSpeechRecognition.recognition.onend = WebChat.originalHeyGenOnEnd;
                }
                // 恢復按鈕狀態
                $("#toggle-mic-btn").attr("title", "麥克風開關");
            }
        } catch (error) {
            console.error('❌ HeyGen 麥克風停止失敗:', error);
        }
    },

    
    initNoiseFilter: function () {
        // 雜音過濾配置（調鬆一點，避免過濾掉正常語音）
        WebChat.noiseFilterConfig = Util.getConfig("noiseFilterConfig");
        // 設置全域啟用狀態
        WebChat.noiseFilterEnabled = WebChat.noiseFilterConfig.enabled;
        // 初始化音量偵測
        WebChat.initVolumeDetection();
    },

    
    initVolumeDetection: function () {
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(function (stream) {
                WebChat.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                WebChat.audioSource = WebChat.audioContext.createMediaStreamSource(stream);
                WebChat.audioAnalyser = WebChat.audioContext.createAnalyser();
                WebChat.audioAnalyser.fftSize = WebChat.noiseFilterConfig.fftSize;
                WebChat.audioSource.connect(WebChat.audioAnalyser);
                WebChat.audioDataArray = new Uint8Array(WebChat.audioAnalyser.frequencyBinCount);
                WebChat.isVolumeDetectionActive = true;
            })
            .catch(function (error) {
                console.warn('⚠️ 無法啟用音量偵測:', error);
            });
    },

    
    getCurrentVolume: function () {
        if (!WebChat.audioAnalyser || !WebChat.audioDataArray) return 0;

        WebChat.audioAnalyser.getByteFrequencyData(WebChat.audioDataArray);
        let sum = 0;
        for (let i = 0; i < WebChat.audioDataArray.length; i++) {
            sum += WebChat.audioDataArray[i];
        }
        return sum / WebChat.audioDataArray.length / 255; // 標準化到 0-1
    },

    
    processSpeechInput: function (text, confidence, volume, audioContext) {
        if (typeof SpeechProcessor === 'undefined') {
            // 如果新處理器不可用，回退到舊方法
            return this.filterNoiseText(text, confidence);
        }

        // 使用新的語音處理器
        var result = SpeechProcessor.processResult(text, confidence, volume, audioContext);

        // 根據處理結果決定行動
        switch (result.action) {
            case 'send':
                // 直接發送
                $('#Editor').val(result.processedText);
                this.sendMessage();
                // 記錄成功發送
                if (result.autoCorrection) {
                    SpeechProcessor.saveUserCorrection(result.originalText, result.processedText, 'auto_sent');
                }
                break;
            case 'confirm':
                // 顯示確認對話框
                SpeechProcessor.showConfirmDialog(result,
                    // 確認回調
                    function (confirmedResult) {
                        $('#Editor').val(confirmedResult.processedText);
                        WebChat.sendMessage();
                        SpeechProcessor.saveUserCorrection(
                            confirmedResult.originalText,
                            confirmedResult.processedText,
                            'user_confirmed'
                        );
                    },
                    // 取消回調
                    function (cancelledResult) {
                        $('#Editor').val('');
                        SpeechProcessor.saveUserCorrection(
                            cancelledResult.originalText,
                            cancelledResult.processedText,
                            'user_rejected'
                        );
                    }
                );
                break;

            case 'reject':
                // 拒絕並清空
                $('#Editor').val('');
                if (Config.speechProcessorConfig.debugging.enabled) {
                    console.log('語音輸入被拒絕:', result.reason.join(', '));
                }
                break;
        }

        return result;
    },

    
    filterNoiseText: function (text, confidence) {
        if (!text || text.trim() === '') return false;

        var config = Config.noiseFilterConfig;
        // 1. 檢查文字長度
        if (text.length < config.minSpeechLength) {
            return false;
        }
        // 2. 檢查信心度
        if (confidence && confidence < config.confidenceThreshold) {
            return false;
        }
        // 3. 檢查是否為無意義詞彙
        var isKeyword = config.keywordFilter.some(keyword =>
            text.trim() === keyword || text.trim().startsWith(keyword)
        );
        if (isKeyword) {
            return false;
        }
        // 4. 檢查音量（如果可用）
        var currentVolume = WebChat.getCurrentVolume();
        if (currentVolume < config.volumeThreshold) {
            return false;
        }
        return true;
    },

    
    setupHeyGenSpeechHandler: function () {
        if (typeof WebSpeechRecognition === 'undefined' || !WebSpeechRecognition.recognition) {
            return;
        }

        // 保存原始處理器
        if (!WebChat.originalHeyGenOnResult) {
            WebChat.originalHeyGenOnResult = WebSpeechRecognition.recognition.onresult;
        }
        if (!WebChat.originalHeyGenOnEnd) {
            WebChat.originalHeyGenOnEnd = WebSpeechRecognition.recognition.onend;
        }
        
        WebSpeechRecognition.recognition.onresult = function (event) {
            var interim_transcript = "";
            var finalConfidence = 0;
            for (var i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalConfidence = event.results[i][0].confidence || 0;
                    if (WebSpeechRecognition.device === "android" || WebSpeechRecognition.device === "ipad")
                        WebSpeechRecognition.finalTranscript = event.results[i][0].transcript;
                    else WebSpeechRecognition.finalTranscript += event.results[i][0].transcript;
                }
            }
            WebSpeechRecognition.finalTranscript = WebSpeechRecognition.capitalize(
                WebSpeechRecognition.finalTranscript
            );
            let sttWord = WebSpeechRecognition.finalTranscript;
            if (WebSpeechRecognition.device !== "android" && WebSpeechRecognition.device !== "ipad")
                sttWord = WebSpeechRecognition.finalTranscript + interim_transcript;

            // 雜音過濾檢查（可選）
            if (sttWord) {
                // 檢查是否啟用過濾器
                if (WebChat.noiseFilterEnabled !== false && !WebChat.filterNoiseText(sttWord, finalConfidence)) {
                    // 被過濾掉，清空 Editor
                    $("#Editor").val('');
                } else {
                    // 通過過濾或過濾器已關閉，賦值給 Editor
                    $("#Editor").val(sttWord);
                }
            }
        };

        
        WebSpeechRecognition.recognition.onend = function () {
            console.log('🎤 HeyGen 語音辨識結束');

            // 只有在 Editor 有內容時才執行 doSendButtonClick
            var editorContent = $("#Editor").val();
            if (editorContent && editorContent.trim() !== '') {
                WebChat.doSendButtonClick();
            }

            WebSpeechRecognition.status = "end";
            WebSpeechRecognition.setSpeechBtn();

            // 即時對話模式：如果麥克風仍然是開啟狀態，立即重新開始監聽
            if (WebChat.heyGenState.isMicActive) {
                setTimeout(function () {
                    // 重新啟動語音辨識
                    WebSpeechRecognition.finalTranscript = "";
                    WebSpeechRecognition.recognition.lang = Util.getConfig("speechRecognitionLang");

                    // 重新設置優化參數
                    WebSpeechRecognition.recognition.continuous = false;
                    WebSpeechRecognition.recognition.interimResults = true;
                    WebSpeechRecognition.recognition.maxAlternatives = 1;

                    WebSpeechRecognition.recognition.start();
                    WebSpeechRecognition.startTimestamp = Date.now();
                }, WebChat.noiseFilterConfig.restartDelay); // 使用配置的延遲時間
            }
        };
    },

    
    disableNoiseFilter: function () {
        WebChat.noiseFilterEnabled = false;
    },

    enableNoiseFilter: function () {
        WebChat.noiseFilterEnabled = true;
    },

    
    sendTextToHeyGen: function (text,messageId) {
        try {
            Avatar.speakDirectMode(text,messageId);
        } catch (error) {
            console.error('發送文字到 HeyGen 失敗:', error);
        }
    },

    
    keepAliveHeyGen: function (text) {
        try {
            if (Avatar.directSession != null) {
                if (Avatar.directSession.sessionState == 'connected') {
                    Avatar.speakDirectMode("                          ");
                }
            }
        } catch (error) {
            console.error('維持HeyGen生命週期失敗:', error);
        }
    },

    
    toggleAvatarMute: function () {
        var muteBtn = $("#toggle-avatar-mute-btn");

        // 如果提醒還在顯示，第一次點擊就隱藏提醒
        if (WebChat.soundReminderShown) {
            WebChat.hideSoundReminder();
            if (WebChat.isNeedSpeakGreetingMessageToHeyGen) {
                WebChat.greetingMessage.click();
                WebChat.isNeedSpeakGreetingMessageToHeyGen = false;
            }
        }

        if (WebChat.heyGenState.isAvatarMuted) {
            // 取消靜音
            WebChat.unmuteHeyGenAudio();
            muteBtn.removeClass("muted");
            WebChat.heyGenState.isAvatarMuted = false;
        } else {
            // 靜音
            Avatar.directSession.interrupt();
            WebChat.muteHeyGenAudio();
            muteBtn.addClass("muted");
            WebChat.heyGenState.isAvatarMuted = true;
        }
    },

    
    showSoundReminder: function () {
        // 只有在靜音狀態下且未顯示過才顯示提醒
        if (WebChat.heyGenState.isAvatarMuted && !WebChat.soundReminderShown) {
            $("#sound-reminder").fadeIn(500);
            WebChat.soundReminderShown = true;
        }
    },

    
    hideSoundReminder: function () {
        var reminder = $("#sound-reminder");
        if (reminder.is(":visible")) {
            reminder.addClass("sound-reminder-fade-out");
            setTimeout(function () {
                reminder.hide().removeClass("sound-reminder-fade-out");
                WebChat.soundReminderShown = false;
            }, 300);
        }
    },

    
    muteHeyGenAudio: function () {
        try {
            // 直接使用 Avatar 的 mute 方法
            if (typeof Avatar !== 'undefined' && Avatar.player && typeof Avatar.player.mute === 'function') {
                Avatar.player.mute();
            } else {
                var videoElement = document.getElementById('heygen-video');
                var audioElement = document.getElementById('heygen-audio');
                if (videoElement) videoElement.muted = true;
                if (audioElement) audioElement.muted = true;
            }
        } catch (error) {
            console.error('靜音失敗:', error);
        }
    },

    
    unmuteHeyGenAudio: function () {
        try {
            // 直接使用 Avatar 的 unmute 方法
            if (typeof Avatar !== 'undefined' && Avatar.player && typeof Avatar.player.unmute === 'function') {
                Avatar.player.unmute();
            } else {
                var videoElement = document.getElementById('heygen-video');
                var audioElement = document.getElementById('heygen-audio');
                if (videoElement) videoElement.muted = false;
                if (audioElement) audioElement.muted = false;
            }
        } catch (error) {
            console.error('取消靜音失敗:', error);
        }
    },

    
    showLoadingOverlay: function () {
        $("#ai-loading-overlay").css("display", "flex");
    },

    
    hideLoadingOverlay: async function () {
        $("#ai-loading-overlay").fadeOut(500, function () {
            $("#ai-loading-overlay").css("display", "none");
        });
        return true;
    },

    showHint: function (key) {
        switch (key) {
            case "attention":
                $("#HintModalTitle").html(WebChat.text("AttentionButtonText"));
                break;
            case "help":
                $("#HintModalTitle").html(WebChat.text("HelpButtonText"));
                break;
            case "version":
                $("#HintModalTitle").html(WebChat.text("VersionButtonText"));
                break;
            case "cookie":
                $("#HintModalTitle").html(WebChat.text("CookieButtonText"));
                break;
            case "SetPdSuccess":
                $("#HintModalTitle").html(WebChat.text("SetPdSuccess"));
                break;
            case "noSpeech":
            case "notAllowSpeech":
            case "audioCapture":
                $("#HintModalTitle").html(WebChat.text("Warn"));
                break;
            default:
                $("#HintModalTitle").html("");
        }

        $("#dvHintModalBody").html(WebChat.hintHtmlMap[key]);
        $("#HintModal").modal("show");
    },

    showSurvey: function () {
        if (WebChat.isEverInAgentService == true) {
            $("#SurveyAgentZone").css("display", "block");
        } else {
            $("#SurveyAgentZone").css("display", "none");
        }
        $("#SurveyModal").modal("show");
    },

    showHotTopic: function () {
        $("#HotTopicModal").modal("show");
    },

    processTextContent: function (text) {
        if (text == null) {
            text = "";
        }
        text = text
            .replace(/^\s+|\s+$/g, "")
            .replace(/\n/g, "<br>")
            
            .replace(
                /\[link\s+action=['"](\w+)['"]\]([^\[]+)\[\/link\]/g,
                '<label action="$1" onclick="LinkAction.doClick(event);" tabindex="0"  onkeypress="LinkAction.doClick(event);">$2</label>'
            )

            
            .replace(
                /\[link\](.*?)\[\/link\]/gi,
                '<label action="SendMessage" onclick="LinkAction.doSendMessage(\'$1\');" tabindex="0" onkeypress="LinkAction.doSendMessage(\'$1\');">$1</label>'
            )

            
            .replace(
                /\[link\s+submit=[\'\"]+([^\[\]\'\"]+)[\'\"]+\s*[^\[\]]*\]([^\[\]]+)\[\/link\]/gi,
                '<label action="SendMessage" onclick="LinkAction.doSendMessage(\'$1\');" tabindex="0" onkeypress="LinkAction.doSendMessage(\'$1\');">$2</label>'
            )
            .replace(
                /\[link\s+submit=([^\s\[\]\'\"]+)\s*[^\[\]]*\]([^\[\]]+)\[\/link\]/gi,
                '<label action="SendMessage" onclick="LinkAction.doSendMessage(\'$1\');" tabindex="0"  onkeypress="LinkAction.doSendMessage(\'$1\');">$2</label>'
            )

            
            .replace(
                /\[link\s+url=[\'\"]+([^\[\]\'\"]+)[\'\"]+\s*[^\[\]]*\]([^\[\]]+)\[\/link\]/gi,
                "<a class=\"link-text\" style=\" cursor: pointer; \" onKeypress=\"WebChat.checkOpenUrl('$1');\" onclick=\"WebChat.checkOpenUrl('$1');\" tabindex=\"0\" >$2</a>"
            )
            .replace(
                /\[link\s+url=([^\s\[\]\'\"]+)\s*[^\[\]]*\]([^\[\]]+)\[\/link\]/gi,
                "<a class=\"link-text\" style=\" cursor: pointer; \" onKeypress=\"WebChat.checkOpenUrl('$1');\" onclick=\"WebChat.checkOpenUrl('$1');\" tabindex=\"0\" >$2</a>"
            )
            .replace(
                /(^|[^"'=])((https?|ftp|file):\/\/[-A-Za-z0-9+&@#\/%?=~_|!:,.;]+[-A-Za-z0-9+&@#\/%=~_|])/gi,
                "$1<a class=\"link-text\" style=\" cursor: pointer; \" onKeypress=\"WebChat.checkOpenUrl('$2');\" onclick=\"WebChat.checkOpenUrl('$2');\" tabindex=\"0\" >$2</a>"
            )
            .replace(/(http|ftp|https)_/gi, "<a class=\"link-text\" style=\" cursor: pointer; \" onKeypress=\"WebChat.checkOpenUrl('$1');\" onclick=\"WebChat.checkOpenUrl('$1');\" tabindex=\"0\" >$2</a>")

            
            .replace(
                /\[link\s+p4=[\'\"]+([^\[\]\'\"]+)[\'\"]+\s*[^\[\]]*\]([^\[\]]+)\[\/link\]/gi,
                '<label action="OpenUrl" onclick="LinkAction.doOpenP4Url(\'$1\');" tabindex="0" onkeypress="LinkAction.doOpenP4Url(\'$1\');">$2</label>'
            )
            .replace(
                /\[link\s+p4=([^\s\[\]\'\"]+)\s*[^\[\]]*\]([^\[\]]+)\[\/link\]/gi,
                '<label action="OpenUrl" onclick="LinkAction.doOpenP4Url(\'$1\');" tabindex="0" onkeypress="LinkAction.doOpenP4Url(\'$1\');">$2</label>'
            )

            
            .replace(/\<a\s+href=[\'\"]([^\[\]\'\"]+)([\'\"])/g, "<a href='$1' tabindex=\"0\" target='_blank' ")

            
            .replace(
                /\[emoji_0x([0-9a-fA-F]*)\]/g,
                '<img class="emoji" src="' +
                Util.getConfig("CRMGatewayUrl") +
                'gateway/image/emoji/emoji_0x$1.png" alt=' +
                WebChat.text("EmojiButtonHint") +
                ' border="0" />'
            );

        return text;
    },

    processSpeechTextContent: function (text) {
        if (text == null) {
            text = "";
        }
        text = text
            .replace(/^\s+|\s+$/g, "")
            .replace(/\n/g, "<br>")
            
            .replace(
                /\[link\s+action=['"](\w+)['"]\]([^\[]+)\[\/link\]/g,
                '$2'
            )

            
            .replace(
                /\[link\](.*?)\[\/link\]/gi,
                '$1'
            )

            
            .replace(
                /\[link\s+submit=[\'\"]+([^\[\]\'\"]+)[\'\"]+\s*[^\[\]]*\]([^\[\]]+)\[\/link\]/gi,
                '$2'
            )
            .replace(
                /\[link\s+submit=([^\s\[\]\'\"]+)\s*[^\[\]]*\]([^\[\]]+)\[\/link\]/gi,
                '$2'
            )

            
            .replace(
                /\[link\s+url=[\'\"]+([^\[\]\'\"]+)[\'\"]+\s*[^\[\]]*\]([^\[\]]+)\[\/link\]/gi,
                "$2"
            )
            .replace(
                /\[link\s+url=([^\s\[\]\'\"]+)\s*[^\[\]]*\]([^\[\]]+)\[\/link\]/gi,
                "$2"
            )
            .replace(
                /(^|[^"'=])((https?|ftp|file):\/\/[-A-Za-z0-9+&@#\/%?=~_|!:,.;]+[-A-Za-z0-9+&@#\/%=~_|])/gi,
                "$2"
            )
            .replace(/(http|ftp|https)_/gi, "$2")

            
            .replace(
                /\[link\s+p4=[\'\"]+([^\[\]\'\"]+)[\'\"]+\s*[^\[\]]*\]([^\[\]]+)\[\/link\]/gi,
                '$2'
            )
            .replace(
                /\[link\s+p4=([^\s\[\]\'\"]+)\s*[^\[\]]*\]([^\[\]]+)\[\/link\]/gi,
                '$2'
            )

            
            .replace(/\<a\s+href=[\'\"]([^\[\]\'\"]+)([\'\"])/g, "")

            
            .replace(
                /\[emoji_0x([0-9a-fA-F]*)\]/g, WebChat.text("EmojiButtonHint")
            );

        return text;
    },

    
    stripHTML: function (input, filterLine) {
        var output = '';
        if (typeof (input) == 'string') {
            var output = input.replace(/(<([^>]+)>)/ig, "");
            if (filterLine) {
                output = output.replace(/\r\n|\n|\/|\\|"|&nbsp;/g, "");
            } else {
                output = output.replace(/\/|\\|\"|&nbsp;/g, "");
            }
        }
        return output;
    },

    isButtonDisabled: function (element) {
        
        let result = false;
        if (typeof element === "string") result = document.getElementById(element).classList.contains("ButtonDisabled");
        else {
            try {
                result = element.classList.contains("ButtonDisabled");
            } catch (e) { }
        }
        return result;
    },

    refreshButtonStatus: function () {
        if (WebChat.chatId == null && WebChat.isInQueue == false) {
            // $("#SendButton").hide();
            $("#Editor").attr("disabled", "disabled");
        } else {
            // $("#SendButton").show();
            if (
                !!Util.getConfig("isSpeechRecognition") &&
                WebSpeechRecognition.isSupport &&
                WebSpeechRecognition.status === "recognizing"
            )
                $("#Editor").attr("disabled", "disabled");
            else $("#Editor").removeAttr("disabled");

            // $("#SendButton").removeClass("SendButtonDisabled");
        }

        if (SurveyButton) $("#StopChatListItem").show();
        else $("#StopChatListItem").hide();

        if (WebChat.submitedSurvey == "all") $("#SurveyListItem").hide();
        else {
            if (
                (WebChat.submitedSurvey == "robot" && !WebChat.isInAgentService) ||
                !Util.getConfig("isShowSurveyButton")
            )
                $("#SurveyListItem").hide();
            else $("#SurveyListItem").show();
        }

        if (WebChat.chatId != null && WebChat.isInAgentService) $("#StopChatListItem").show();
        else $("#StopChatListItem").hide();

        if (WebChat.chatId == null && $("#ChangeEditorButton").length > 0) {
            $("#ChangeEditorButton").trigger("click");
        }

        for (var id in WebChat.enableConditions) {
            if (eval(WebChat.enableConditions[id])) $("#" + id).removeClass("ButtonDisabled");
            else $("#" + id).addClass("ButtonDisabled");
        }
    },

    setMessageFailed: function (elementId, failed) {
        var elementJq = $("#" + elementId);
        if (failed || arguments.length == 1) {
            Util.debug(elementJq.find(".ChatMessageIcon").isEmpty);
            if (elementJq.find(".ChatMessageIcon").length == 0) {
                var html =
                    "<div class=ChatMessageIcon title='" +
                    WebChat.text("MessageSendFailed") +
                    "'onclick=WebChat.disconnectIconClick(this);>";
                $(html).insertAfter(elementJq.find(".ChatMessageSenderName"));
            }
            
            WebChat.preMessageRecord.map(function (v) {
                if (v.disconnectStatus == elementId) {
                    v["disconnectStatus"] = elementId + "_true";
                }
            });
            elementJq.addClass("ChatMessageFailed");
        } else {
            elementJq.removeClass("ChatMessageFailed");
        }
    },

    leaveMessageContent: function () {
        var html = "";
        html.concat = "";
    },

    
    
    
    socketHandlers: {
        "agent/ready": "doSocketAgentReady",
        "message/send": "doSocketMessageSend",
        "agent/stop": "doSocketAgentStop",
        "chat/survey": "doSocketChatSurvey",
    },

    doSocketOpen: function () {
        WebChat.chatId = WebChat.forageStorage.getItem("chatId");
        if (WebChat.isReconnect) {
            WebChat.handleOnline();
        }
    },

    doSocketClose: function (reason) {
        Util.debug("doSocketClose : socket closed: " + JSON.stringify(reason));
        if (!WebChat.isNormalStop && WebChat.newMessageTime != null) {
            // 3605:網頁Crtl+S; 1000、4500:Close By User
            if (!WebChat.isReconnect && reason.code !== 3605 && reason.code !== 1000 && reason.code !== 4500) {
                WebChat.handleOffline();
            }
            if (reason.code === 4500) WebChat.sendBeaconDisconnectionDelay();
            var now = new Date().getTime();
            var timeOut = WebChat.isInAgentService
                ? WebChat.tenantInfo.serviceTimeoutMinutes
                : WebChat.tenantInfo.chatTimeoutMinutes;

            if ((now - WebChat.newMessageTime) / 1000 / 60 > timeOut) {
                WebChat.chatId = null;
                WebChat.refreshButtonStatus();
            }
        }
    },

    doSocketError: function () {
        Util.debug("web socket error");
        var message = {
            type: Constant.TYPE_TEXT,
            content: WebChat.text("WebsocketFailed"),
        };
        elementId = WebChat.addMessage(message);
    },

    doSocketMessage: function (code, data) {
        Util.debug("[jocket] %s, %o", code, data);
        WebChat.setSocketCodeInfo(code, data);
        let handler = WebChat[WebChat.socketHandlers[code]];
        if (handler == null) {
            Util.error("unknown WebSocket data code: %s", code);
        } else {
            handler(data);
        }
    },
    setSocketCodeInfo: function (code, data) {
        switch (code) {
            case "agent/ready":
                if (data.success) {
                    WebChat.isDisconnectionDelay = false;
                } else {
                    WebChat.isDisconnectionDelay = true;
                }
                break;
            case "message/send":
                break;
            case "agent/stop":
                WebChat.isDisconnectionDelay = true;
                break;
            case "chat/survey":
                break;
        }
    },

    sendRecievedMessage: function (data) {
        WebChat.ajax({
            url: Util.getConfig("CRMGatewayUrl") + "openapi/web/message/isReceived",
            data: {
                messageId: data.messageId,
                isReceived: true,
            },
            async: false,
            error: null,
            success: function (ret) {
                Util.debug("messageId: " + data.messageId + ", is confirmed: " + ret.confirmed);
            },
        });
    },

    doSocketAgentReady: function (data) {
        if (data.success) {
            if (!!data.roomId) WebChat.roomId = data.roomId;

            WebChat.isInQueue = false;
            WebChat.queueZoneModal("hide");
            WebChat.sendRecievedMessage(data);
            WebChat.isInAgentService = true;
            let messageContent = {
                category: "cm",
                senderType: "agent",
                type: "Text",
                content: data.greeting,
            };

            if (data.sender) messageContent.sender = data.sender;
            WebChat.addMessage(messageContent);
            if (Util.getConfig("webCall")) WebCallStart.getChatroomInfo();
            if (Util.getConfig("openVidu")) OpenVidu.getChatroomInfo();
            WebChat.isEverInAgentService = true;
            WebChat.submitedSurvey = data.submitedSurvey;
            
            if (!!Util.getCookieToStorage("tokenId") && Util.getParameterByName("action") === "otc")
                WebChat.chatUpdate();
        } else {
            if (data.busyService) {
                if (data.busyService === "offWork") {
                    WebChat.addSystemMessageAsDialog(data.busyMessage);
                    WebChat.queueZoneModal("hide");
                }
                else if (data.busyService === "offlineMessage") {
                    LeaveWord.messageBox(data.leaveMessageUrl, data.busyMessage);
                }
                else {
                    WebChat.addSystemMessageAsDialog(data.busyMessage);
                    WebChat.queueZoneModal("hide");
                }
            }
            else {
                
                LeaveWord.messageBox(data.leaveMessageUrl);
            }
        }
        WebChat.refreshButtonStatus();
    },

    doSocketAgentStop: function (data) {
        Util.debug("doSocketAgentStop : " + data);
        WebChat.stopEvent(data);
    },

    doSocketMessageSend: function (data) {
        data.category = (data.category || Constant.CATEGORY_CHAT).toLowerCase();
        if (data.category == "am") {
            data.category = Constant.CATEGORY_CHAT;
        }
        if (data.category == "sm" && data.content == "authRequest") {
            
            if (Util.getCookieToStorage("tokenId") != undefined) {
                data.content = WebChat.text("OtpVerified");
                data.senderType = Constant.SENDER_TYPE_AGENT;
                WebChat.addMessage(data);
            } else {
                Auth.doOtp();
            }
        } else if (data.category == "sm" && data.type == "Timeout") {
            var time = data.time.split(" ")[1];
            $(".timeout .NewChatMessageTime").html(time);
            data.senderType = Constant.SENDER_TYPE_ROBOT;
            data.category = "";
            WebChat.addMessage(data);
        } else if (data.category == "sm" && data.hasOwnProperty("queueIndex")) {
            
            if (data.content != "") {
                $("#queueZoneModal .wording").text(data.content);
                WebChat.queueZoneModal("show");
            }
            if (!WebChat.isInQueue) {
                WebChat.isInQueue = true;
                WebChat.setQueueBtnStatus("show");
            }
        } else if (data.hasOwnProperty("busyService")) {
            if (data.busyService) {
                if (data.busyService === "offWork") {
                    WebChat.addSystemMessageAsDialog(data.busyMessage);
                    WebChat.queueZoneModal("hide");
                    Util.debug("stop agent");
                    if (!!Util.getConfig("onlyAgent")) WebChat.stopChat();
                }
                else if (data.busyService === "offlineMessage") {
                    LeaveWord.messageBox(data.leaveMessageUrl, data.busyMessage);
                }
                else {
                    WebChat.addSystemMessageAsDialog(data.busyMessage);
                    WebChat.queueZoneModal("hide");
                }
            }
            else {
                
                LeaveWord.messageBox(data.leaveMessageUrl);
                WebChat.sendRecievedMessage(data);
            }

            return;
        } else if (data.hasOwnProperty("leaveMessage")) {
            // data.category = Constant.CATEGORY_CHAT;
            if (data.content == WebChat.tenantInfo.agentStopServiceWord) {
                $("#btnP4PageClose").click();
                WebChat.stopEvent();
            } else if (data.category === "sm" && data.isNeedToLeaveMessage) {
                WebChat.addMessage(data);
                LeaveWord.messageBox(data.leaveMessageUrl);
                WebChat.sendRecievedMessage(data);
            } else {
                WebChat.addMessage(data);
            }

        } else if (data.category === "cm" && data.type === "Timeout") {
            
            let content = Util.JsonParse(data.content);
            if (content.ans && content.ans.length > 0) {
                WebChat.addMultipleMessage(content, data, "pushMessageTimeout");
                WebChat.stopEvent("pushMessageTimeout");
            } else {
                let messageObj = JSON.parse(JSON.stringify(data));
                messageObj.type = content.type;
                WebChat.addMessage(messageObj);
                WebChat.stopEvent("pushMessageTimeout");
            }
        } else if (
            data.content == WebChat.tenantInfo.notInServiceTimeHint ||
            data.content == WebChat.tenantInfo.chatQueueFull
        ) {
            
            WebChat.queueZoneModal("hide");
            WebChat.isInQueue = false;
            
            WebChat.addMessage(data);
        } else if (data.submitedSurvey == "empty" || data.submitedSurvey == "all" || data.submitedSurvey == "robot") {
            
            WebChat.addMessage(data);
        } else {
            if (typeof data.content === "string") {
                
                let dataContent = data.content;
                if (data.type === "Multiple") {
                    
                    if (Util.isJSON(data.content)) {
                        dataContent = JSON.parse(data.content);
                        for (let i = 0; i < dataContent.ans.length; i++) {
                            let checkContent = JSON.stringify(dataContent.ans[i]);
                            let number = checkContent.search(/"type":"Html"/i);
                            if (number === -1) {
                                checkContent = Util.unescapeHtml(checkContent);
                                dataContent.ans[i] = JSON.parse(checkContent);
                            }
                        }
                        data.content = JSON.stringify(dataContent);
                    }
                }
                else {
                    
                    let number = data.content.search(/"type":"Html"/i);
                    if (number === -1) {
                        data.content = Util.unescapeHtml(data.content);
                    }
                }
            }
            if (data.type === "Multiple") {
                
                let parseContent = JSON.parse(data.content);
                WebChat.addMultipleMessage(parseContent, data, "doSocketMessageSend");
            } else {
                if (data.type === "Execute" && Util.isJSON(data.content)) AnswerDisplay.setExecute(data.content);
                else WebChat.addMessage(data);
            }
        }
        
        WebChat.sendRecievedMessage(data);
    },

    addMultipleMessage: function (content, message, from) {
        var speakText = "";
        let MediaMessage = { type: "MediaCard", MediaCardList: [] };
        let newContent = { ...content };
        let ConetntAnsTemp = [];
        newContent.ans = [];
        content.ans.forEach(function (ansItem, index, array) {
            if (ansItem.type == "QuickReply" && ansItem.QuickReply.type == "MediaCard") {
                MediaMessage.MediaCardList.push({ ...ansItem.QuickReply });
                ansItem.noMessage = true;
                ConetntAnsTemp.push({ ...ansItem });
                delete ansItem.noMessage;
            } else if (ansItem.type == "MediaCard") {
                MediaMessage.MediaCardList.push({ ...ansItem });
            } else {
                ConetntAnsTemp.push({ ...ansItem });
            }
        });
        MediaMessage.MediaCardList.length > 0 ? newContent.ans.push(MediaMessage) : null;
        ConetntAnsTemp.forEach(function (item, index, array) {
            newContent.ans.push(item);
        });
        newContent.ans.forEach(function (ansItem, index, array) {
            let newMessage = {};
            let deepAsnItem = JSON.parse(JSON.stringify(ansItem));
            delete deepAsnItem.type;

            if (ansItem.hasOwnProperty("WebViewUrl")) message["webViewUrl"] = ansItem.WebViewUrl;
            else if (ansItem.hasOwnProperty("QuickReply")) message["webViewUrl"] = ansItem.QuickReply.WebViewUrl;

            if (message.xiaoIType) newMessage["xiaoIType"] = message.xiaoIType;
            if (ansItem.noMessage) newMessage["noMessage"] = true;
            if (array.length === 1) {
                newMessage["isSatis"] = ((index === array.length - 1) && newContent.isSatis);
                if (ansItem?.isSatis) newMessage["isSatis"] = ((index === array.length - 1) && ansItem.isSatis);
            } else {
                newMessage["isSatis"] = ((index === array.length - 1) && ansItem.isSatis);
            }
            newMessage["senderType"] = from === "greeting" ? Constant.SENDER_TYPE_ROBOT : message.senderType;
            newMessage["sender"] = message.sender || "";
            newMessage["messageTime"] = message.messageTime;
            newMessage["type"] =
                ansItem.type === "Html" && (Monitor.mode === "analyzer" || Monitor.mode === "mock")
                    ? "Text"
                    : ansItem.hasOwnProperty("QuickReply")
                        ? "QuickReply"
                        : ansItem.type;
            newMessage["content"] =
                ansItem.type === "Html" && (Monitor.mode === "analyzer" || Monitor.mode === "mock")
                    ? WebChat.text("HtmlFormat")
                    : ansItem.hasOwnProperty("QuickReply")
                        ? JSON.stringify(ansItem)
                        : deepAsnItem;
            newMessage["isGreeting"] = from === "greeting" ? true : false;
            if (newMessage["type"].toUpperCase() == Constant.TYPE_TEXT.toUpperCase()) {
                speakText = speakText + WebChat.stripHTML(WebChat.processSpeechTextContent(newMessage["content"]["text"]), true)
            }
            else if (newMessage["type"].toUpperCase() == Constant.TYPE_HTML.toUpperCase()) {
                speakText = speakText + WebChat.stripHTML(newMessage["content"]["value"], true)
            }
            else if (newMessage["type"].toUpperCase() == Constant.TYPE_QUICKREPLY.toUpperCase()) {
                newContent = Util.JsonParse(newMessage["content"])
                if (newContent["QuickReply"]["type"].toUpperCase() == Constant.TYPE_TEXT.toUpperCase()) {
                    speakText = speakText + WebChat.stripHTML(WebChat.processSpeechTextContent(newContent["QuickReply"]["text"]), true)
                }
                else if (newContent["QuickReply"]["type"].toUpperCase() == Constant.TYPE_HTML.toUpperCase()) {
                    speakText = speakText + WebChat.stripHTML(newContent["QuickReply"]["value"], true)
                }
                else if (newContent["QuickReply"]["type"].toUpperCase() == Constant.TYPE_QUICKREPLY.toUpperCase()) {
                    if (newContent["QuickReply"]["QuickReply"]["type"].toUpperCase() == Constant.TYPE_TEXT.toUpperCase()) {
                        speakText = speakText + WebChat.stripHTML(WebChat.processSpeechTextContent(newContent["QuickReply"]["QuickReply"]["text"]), true)
                    }
                    else if (newContent["QuickReply"]["QuickReply"]["type"].toUpperCase() == Constant.TYPE_HTML.toUpperCase()) {
                        speakText = speakText + WebChat.stripHTML(newContent["QuickReply"]["QuickReply"]["value"], true)
                    }
                }
            }

            WebChat.addMessage(newMessage);
        });
        if (
            speakText != "" &&
            !!Util.getConfig("isSpeechSynthesis") &&
            WebChat.forageStorage.getItem("defaultspeak") == "true"
        ) {
            if (Util.getConfig("AvatarModel") && (Util.getConfig("ttsModel") == "heygen")) {
                WebChat.sendTextToHeyGen(speakText);
            } else if (WebSpeechSynthesis.isSupport) {
                WebSpeechSynthesis.textToSpeak(speakText);
            }
        }
    },
    addQbiCopilotMessage: function (content, message, from, isStreaming) {
        var speakText = "";
        let ansItem;
        if (!content?.ans) {
            const deepContent = JSON.parse(JSON.stringify(content));
            content.ans = [];;
            content.ans[0] = deepContent;
            ansItem = {
                text: content?.QuickReply?.text || content?.text,
                type: "Text"
            };
        } else {
            ansItem = content.ans[0];
        }
        let deepAsnItem = JSON.parse(JSON.stringify(ansItem));
        delete deepAsnItem.type;

        let newMessage = {};

        if (ansItem.hasOwnProperty("WebViewUrl")) message["webViewUrl"] = ansItem.WebViewUrl;
        else if (ansItem.hasOwnProperty("QuickReply")) message["webViewUrl"] = ansItem.QuickReply.WebViewUrl;

        if (message.xiaoIType) newMessage["xiaoIType"] = message.xiaoIType;

        newMessage["senderType"] = from === "greeting" ? Constant.SENDER_TYPE_ROBOT : message.senderType;
        newMessage["sender"] = message.sender || "";
        newMessage["messageTime"] = message.messageTime;
        newMessage["type"] =
            ansItem.type === "Html" && (Monitor.mode === "analyzer" || Monitor.mode === "mock")
                ? "Text"
                : ansItem.hasOwnProperty("QuickReply")
                    ? "QuickReply"
                    : ansItem.type;
        newMessage["content"] =
            ansItem.type === "Html" && (Monitor.mode === "analyzer" || Monitor.mode === "mock")
                ? WebChat.text("HtmlFormat")
                : ansItem.hasOwnProperty("QuickReply")
                    ? JSON.stringify(ansItem)
                    : deepAsnItem;
        newMessage["isGreeting"] = from === "greeting" ? true : false;
        newMessage["GPTmessageSend"] = from === "GPTmessageSend" ? true : false;
        newMessage["isSatis"] = true;
        newMessage["GPTmessageTemp"] = from === "GPTmessageSend" ? content.ans : null;
        if (newMessage["type"].toUpperCase() == Constant.TYPE_TEXT.toUpperCase()) {
            speakText = speakText + WebChat.stripHTML(WebChat.processSpeechTextContent(newMessage["content"]["text"]), true)
        }
        else if (newMessage["type"].toUpperCase() == Constant.TYPE_HTML.toUpperCase()) {
            speakText = speakText + WebChat.stripHTML(newMessage["content"]["value"], true)
        }
        else if (newMessage["type"].toUpperCase() == Constant.TYPE_QUICKREPLY.toUpperCase()) {
            content = Util.JsonParse(newMessage["content"])
            if (content["QuickReply"]["type"].toUpperCase() == Constant.TYPE_TEXT.toUpperCase()) {
                speakText = speakText + WebChat.stripHTML(WebChat.processSpeechTextContent(content["QuickReply"]["text"]), true)
            }
            else if (content["QuickReply"]["type"].toUpperCase() == Constant.TYPE_HTML.toUpperCase()) {
                speakText = speakText + WebChat.stripHTML(content["QuickReply"]["value"], true)
            }
            else if (content["QuickReply"]["type"].toUpperCase() == Constant.TYPE_QUICKREPLY.toUpperCase()) {
                if (content["QuickReply"]["QuickReply"]["type"].toUpperCase() == Constant.TYPE_TEXT.toUpperCase()) {
                    speakText = speakText + WebChat.stripHTML(WebChat.processSpeechTextContent(content["QuickReply"]["QuickReply"]["text"]), true)
                }
                else if (content["QuickReply"]["QuickReply"]["type"].toUpperCase() == Constant.TYPE_HTML.toUpperCase()) {
                    speakText = speakText + WebChat.stripHTML(content["QuickReply"]["QuickReply"]["value"], true)
                }
            }
        }
        if (isStreaming) {
            return newMessage;
        } else {
            WebChat.addMessage(newMessage);
            if (
                speakText != "" &&
                !!Util.getConfig("isSpeechSynthesis") &&
                WebChat.forageStorage.getItem("defaultspeak") == "true"
            ) {
                if (Util.getConfig("AvatarModel") && (Util.getConfig("ttsModel") == "heygen")) {
                    WebChat.sendTextToHeyGen(speakText);
                } else if (WebSpeechSynthesis.isSupport) {
                    WebSpeechSynthesis.textToSpeak(speakText);
                }
            }
        }
    },

    processMessageContent: function (message) {
        // 处理并返回消息内容的 HTML 字符串
        // 可以根据需要调整此函数以适应你的消息格式
        switch (message.type) {
            case Constant.TYPE_TEXT:
                return AnswerDisplay.setTextHTML(message.content);
            case Constant.TYPE_IMAGE:
                return AnswerDisplay.setImageHTML(message.content);
            case Constant.TYPE_LINKIMAGE:
                return AnswerDisplay.setLinkImageHTML(message.content);
            case Constant.TYPE_STICKER:
                return AnswerDisplay.setStickerHTML(message.content);
            case Constant.TYPE_FILE:
                return AnswerDisplay.setFileHTML(message.content);
            case Constant.TYPE_LIST:
                return AnswerDisplay.setEcpListHTML(message.content);
            case Constant.TYPE_CARDS:
                return AnswerDisplay.setCardHTML(message.content);
            case Constant.TYPE_MEDIACARD:
                return AnswerDisplay.setMediaCardHTML(message.content);
            case Constant.TYPE_AUDIO:
                return AnswerDisplay.setAudioHTML(message.content);
            case Constant.TYPE_VIDEO:
                return AnswerDisplay.setVideoHTML(message.content);
            case Constant.TYPE_HTML:
                return AnswerDisplay.setHtmlHTML(message.content, false);
            case Constant.TYPE_QUICKREPLY:
                return AnswerDisplay.setQuickReplyHTML(message.content);
            default:
                return AnswerDisplay.setDefaultHtml(message.content);
        }
    },
    doSocketChatSurvey: function (data) {
        WebChat.isSurveyFromAgent = true;
        
        WebChat.submitedSurvey = data.submitedSurvey;
        WebChat.showSurvey();
        WebChat.stopChat(data);
    },

    sendPreviewMessage: function (text) {
        var messageJson = {
            type: Constant.TYPE_TEXT,
            content: text,
            chatId: WebChat.chatId,
            senderType: WebChat.tenantInfo.moduleType,
        };

        WebChat.ajax({
            url: Util.getConfig("CRMGatewayUrl") + "openapi/web/previewmessage/send",
            data: messageJson,
            error: function () {
                Util.debug("sendPreviewMessage error");
            },
            success: function (ret) {
                Util.debug("sendPreviewMessage success");
            },
        });
    },

    checkOpenUrl: function (url) {
        if (url.includes("_webview=1")) {
            urlStr = url.replace(/_webview=1/g, "");
            WebChat.OpenP4Page(urlStr);
        }
        else {
            window.open(url, '_blank');
        }
    },

    
    
    

    text: function (code) {
        let i18nLanguage = navigator.cookieEnabled && !!sessionStorage ? sessionStorage.getItem("i18nLanguage") : ""
        if (!(!!i18nLanguage)) {
            i18nLanguage = Util.getParameterByName("i18nLanguage") || Util.getConfig("i18nLanguage");
        }
        var text = code;
        if (i18nLanguage === "zh_tw") {
            text = zh_tw[code] || code;
        }
        else if (i18nLanguage === "en_us") {
            text = en_us[code] || code;
        }
        else if (i18nLanguage === "ja_jp") {
            text = ja_jp[code] || code;
        }
        else if (i18nLanguage === "zh_cn") {
            text = zh_cn[code] || code;
        }
        for (var i = 1; i < arguments.length; ++i) {
            text = text.replace("${" + (i - 1) + "}", arguments[i]);
        }
        return text;
    },

    forageStorage: {
        getItem: function (key) {
            if (WebChat.isStorage) {
                try {
                    var value = sessionStorage.getItem(key);
                    return value;
                } catch (error) {
                    Util.error(error);
                    return null;
                }
            } else return null;
        },

        setItem: function (key, value) {
            if (WebChat.isStorage) {
                try {
                    sessionStorage.setItem(key, value);
                    if (!!WebChat.parentIFrameUrl) {
                        WebChat.postMessage({
                            type: "setSessionStorage",
                            key,
                            value,
                        });
                    }
                } catch (error) {
                    Util.error(error);
                }
            }
        },

        removeItem: function (key) {
            if (WebChat.isStorage) {
                try {
                    sessionStorage.removeItem(key);
                    if (!!WebChat.parentIFrameUrl) {
                        WebChat.postMessage({
                            type: "removeSessionStorage",
                            key,
                        });
                    }
                } catch (error) {
                    Util.error(error);
                }
            }
        },

        clear: function () {
            if (WebChat.isStorage) {
                try {
                    sessionStorage.clear();
                    if (!!WebChat.parentIFrameUrl) {
                        WebChat.postMessage({
                            type: "clearSessionStorage",
                        });
                    }
                } catch (error) {
                    Util.error(error);
                }
            }
        },
    },

    clearTag: function (message) {
        
        messageTags = Util.parseHTML(message.replace(/\\(\W)/g, "$1"));
        retMessage = "";
        if (messageTags.length > 0) {
            if (messageTags.length == 1 && messageTags[0].tagName == undefined) {
                return Util.escapeHtml(message);
            }
            for (const messageTag of messageTags) {
                if (!WebChat.whileListTags.indexOf(messageTag.localName) == -1) {
                    if (messageTag.tagName == undefined) {
                        retMessage += Util.escapeHtml(messageTag.textContent);
                    } else {
                        retMessage += Util.escapeHtml("<" + messageTag.localName + ">");
                    }
                } else {
                    if (messageTag.outerHTML == undefined) {
                        retMessage += messageTag.textContent;
                    } else {
                        retMessage += messageTag.outerHTML;
                    }
                }
            }
            return retMessage;
        } else {
            return Util.escapeHtml(message);
        }
    },
    switchFontSize: function () {
        switch (WebChat.fontSize) {
            case '18px':
                WebChat.fontSize = '14px';
                break;
            case '16px':
                WebChat.fontSize = '18px';
                break;
            case '14px':
                WebChat.fontSize = '16px';
                break;
        }
        // 獲取頁面樣式表清單
        let styleSheets = document.styleSheets;
        // 定義你想要查找的選擇器、樣式表
        let selector = '.ChatMessage';
        let cssSelect = "styles/WebChat.css";
        // 遍歷樣式表中的所有規則
        for (let i = 0; i < styleSheets.length; i++) {
            // 檢查規則是否為想要查找的樣式表
            if (styleSheets[i].href && styleSheets[i].href.includes(cssSelect)) {
                let rules = styleSheets[i].cssRules;
                for (let j = 0; j < rules.length; j++) {
                    let rule = rules[j];
                    // 檢查規則是否為樣式規則以及選擇器是否匹配
                    if (rule instanceof CSSStyleRule && rule.selectorText === selector) {
                        rule.style.fontSize = WebChat.fontSize;
                        break; // 中斷循環
                    }
                }
                break; // 中斷循環
            }
        }
    },
    findQuickReply(message) {
        for (let i = 0; i < message.GPTmessageTemp.length; i++) {
            const item = message.GPTmessageTemp[i];
            if (item.type == "QuickReply" && item.hasOwnProperty("QuickReply") && item.QuickReply.hasOwnProperty("quick_reply_items")) {
                return item.QuickReply.quick_reply_items;
            }
        }
        return null;  // 没有找到
    },
    removeElement() {
        
        $("#header-user-avatar").remove();
        $("#webmakecallbtn").remove();
        $("#openvidubtn").remove();
        $("#dropdown-menu").remove();
        $("#WebCallStatus").remove();
        $("#RightZone").remove();
        $("#LoginButton").remove();
        $("#hamburger-menu").remove();
        $("#ChatZone").remove();
        $("#loading").remove();
        $(".RichMenuZone").remove();
        $("#RestartChatButton").remove();
        $("#EditorZone").remove();
        $("#ExitButton").on("keypress click", WebChat.doExitButtonClick);
        WebChat.hintHtmlMap["cookie"] = WebChat.text("CookieMessage");
        WebChat.showHint("cookie");
    },
    isSafari: function () {
        const { userAgent, vendor } = navigator;
        return vendor.includes("Apple") && userAgent.includes("Safari") && !userAgent.includes("Chrome")
    },
    createShinyText: function (text) {
        return Array.from(text)
            .map((char, index) =>
                `<span style="animation-delay: ${index * 0.03}s;">${char}</span>`
            )
            .join("");
    },
    handleOffline() {
        if (!WebChat.isReconnect) {
            WebChat.isReconnect = true;
            $("#inputing, #statusMessage").remove();
            WebChat.addSystemMessage(WebChat.text("NetWorkReConnect"));
            $("#disConnectOverlay").show();
        }
    },
    handleOnline() {
        if (WebChat.isReconnect) {
            WebChat.isReconnect = false;
            WebChat.addSystemMessage(WebChat.text("NetWorkRecovery"));
            $("#Editor").removeAttr("disabled"); // 啟用編輯器
            $("#disConnectOverlay").hide();
        }
    },
    transLanguage: function (i18nLanguage) {
        sessionStorage.setItem("i18nLanguage", i18nLanguage);
        if (parent.window != window && !!WebChat.parentIFrameUrl) {
            const iframe = parent.window.document.getElementById("ifMain");
            iframe.contentWindow.location.reload();
        } else {
            window.location.reload();
        }
    },
    setI18nLanguage: function () {
        // Config.i18nLanguageArray可供切換語系下-顯示控制
        let i18nLanguageArray = Util.getConfig("i18nLanguageArray")
        let i18nLanguage = navigator.cookieEnabled && !!sessionStorage ? sessionStorage.getItem("i18nLanguage") : ""
        if (!(!!i18nLanguage)) {
            i18nLanguage = Util.getParameterByName("i18nLanguage") || Util.getConfig("i18nLanguage");
        }
        //
        $("#language-menu").css({
            "background": `url(image/${SystemConfig.templateStyle}/i18n_${i18nLanguage}.svg) no-repeat center center`,
            "background-size": "contain",
        });
        WebChat.doSwitchLangCss(i18nLanguage);
        //下拉顯示
        for (let i = 0; i18nLanguageArray.length > i; i++) {
            document.getElementById("i18n_" + i18nLanguageArray[i]).style.display = "block"
        }
        //更新貓頭title
        if (parent.window != window && !!WebChat.parentIFrameUrl) {
            parent.window.document.getElementById('dvICONTitle').textContent = Util.text("AiCustomerService");
        }
    },
    doSwitchLangCss: function (i18nLanguage) {
        //切換html的lang參數，讀取[lang="en_us"] .title 等特定樣式
        document.documentElement.setAttribute('lang', i18nLanguage);
    }

};

window.onload = function () {
    if (parent !== window) {
        try {
            WebChat.parentIFrameUrl = parent.location.href;
        } catch (e) {
            WebChat.parentIFrameUrl = document.referrer;
        }
    }

    WebChat.tenantCode = Config.tenantCode;
    let iscookieEnabled = navigator.cookieEnabled
    if (!navigator.cookieEnabled) {
        if (WebChat.isSafari()) {
            iscookieEnabled = true;
        }
    }
    if (iscookieEnabled) {
        
        if (!!Monitor.mode) {
            WebChatInner.loadDefaultCss();
            Monitor.doLoad();
        } else {
            
            if (Util.getCookieToStorage("tenantCode") != null && WebChat.tenantCode != Util.getCookieToStorage("tenantCode")) {
                Util.debug("sessionStorage TenantCode:");
                Util.debug(Util.getCookieToStorage("tenantCode"));
                Util.debug("url TenantCode:");
                Util.debug(WebChat.tenantCode);
                Util.debug("stopChat...")
                WebChat.chatId = Util.getCookieToStorage("chatId");
                Auth.loginnext = null;
                Util.delCookieToStorage("identifyBy");
                Util.delCookieToStorage("identifyValue");
                Util.delCookieToStorage("tokenId");
                Util.delCookieToStorage("contactName");
                Util.delCookieToStorage("LoginName");
                Util.delCookieToStorage("FLoginMobile");
                Contact.contactProfile = {
                    FFbId_GW: "",
                    FGoogleId: "",
                    FId: "",
                    FLineId: "",
                    FLoginMobile: "",
                    FMicrosoftId: "",
                    FName: "",
                };

                Auth.channel.forEach((item) => {
                    const siteId = ContactApi.getSiteId(item);
                    Util.delCookieToStorage(item + "Data");
                    Util.delCookieToStorage(siteId);
                    Auth[item + "Data"] = null;
                });
                WebChat.stopChat();
            }
            WebChat.sendMsgByUrlContent = Util.getParameterByName("message") || "";
            WebChat.forageStorage.setItem("tenantCode", WebChat.tenantCode);
            if (Config.useCustomConfig) WebChatInner.generateJsAndCss(WebChat.doLoad);
            else {
                Util.debug("%c %s", "font-weight:bold;  color: green;", "多租戶功能未啟用");
                const script = WebChatInner.loadI18nText();
                WebChatInner.loadDefaultCss();
                script.onload = function () {
                    WebChat.doLoad();
                };

                script.onerror = function () {
                    WebChat.doLoad();
                };

            }
        }
    } else {
        if (Config.useCustomConfig) {
            WebChatInner.loadI18nText_Sync().then(() => {
                WebChatInner.generateJsAndCss();
                WebChat.removeElement();
            });
        }
        else {
            WebChatInner.loadI18nText_Sync().then(() => {
                WebChatInner.loadDefaultCss();
                WebChat.removeElement()
            });
        }
    }
};

// 頁面關閉刷新時啟動
var isOnIOS = navigator.userAgent.match(/iPad/i) || navigator.userAgent.match(/iPhone/i);
var eventName = !!isOnIOS ? "pagehide" : "beforeunload";
window.addEventListener(eventName, function (event) {
    window.event.cancelBubble = true;
    WebChat.doBeforeUnload();
});

document.ondragover = function (e) {
    e.preventDefault();
    e.returnValue = false;
};

document.ondrop = function (e) {
    e.preventDefault();
    e.returnValue = false;
};

window.addEventListener("message", function (e) {
    let data = e.data;
    try {
        data = JSON.parse(data);
        switch (data.type) {
            case "closeRightZone":
                if (data.width < 464) {
                    $("#LeftZone").css("display", "block");
                    $("#RightZone").css("width", "390px");
                }
                break;
            case "openRightZone":
                if (data.width < 464) {
                    $("#LeftZone").css("display", "none");
                    $("#RightZone").css("width", "100%");
                }
                break;
            case "openPanel":
                if (!navigator.cookieEnabled) WebChat.showHint("cookie");
                break;
            case "messageSend":
                if (!!data.message && data.message.length > 0) {
                    if (!WebChat.chatId) WebChat.restartChat();
                    //解決源掃問題
                    Util.checkContent(data.message, function (message) {
                        let messageShow = {
                            type: Constant.TYPE_TEXT,
                            content: message,
                        };
                        let elementId = WebChat.addMessage(messageShow);
                        let messageSend = {
                            type: Constant.TYPE_TEXT,
                            content: message,
                        };
                        WebChat.sendMessage(messageSend, elementId);
                    });
                }
                break;
            case "closePanel":
                WebChat.doExitButtonClick();
                break;
            case "closeP4Page":
                parent.$("#ifP4Url").attr("allow", "");
                parent.$("#ifP4Url").attr("src", "");
                parent.$("#dvP4Page").css("display", "none");
                WebChat.isDrag = true;
                break;
        }
    } catch (e) {
        switch (data) {
            case "stopChat":
                WebChat.stopChat();
                break;
            case "closeP4Page":
                WebChat.isDrag = true;
                break;
        }
    }
});
// 初始狀態檢查
if (!navigator.onLine) {
    WebChat.handleOffline;
}
// 監控離線事件
window.addEventListener("offline", WebChat.handleOffline);

// 監控線上事件
window.addEventListener("online", WebChat.handleOnline);

window.addEventListener("unload", function () {
    const data = JSON.stringify({
        chatId: WebChat.chatId,
        disconnectionDelay: 0,
    });
    const url = Util.getConfig("CRMGatewayUrl") + "openapi/setDisconnectionDelay";
    navigator.sendBeacon(url, new Blob([data], { type: 'application/json' }));
});
class EmbeddedWebview extends HTMLElement {
    connectedCallback() {
        var method = Util.checkMethod("get");
        $[method](this.getAttribute("src")).then((htmlStr) => {
            const shadow = this.attachShadow({
                mode: "closed",
            });
            AnswerDisplay.setWebComponentHTML(shadow, htmlStr);
        });
    }
}

window.customElements.define("embedded-webview", EmbeddedWebview);
