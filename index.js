// ==UserScript==
// @name         Yuanbao Markdown Copy
// @namespace    http://tampermonkey.net/
// @version      0.6
// @description  在腾讯元宝对话中添加一键复制Markdown按钮（含思考过程），需点击右上角按钮激活
// @author       LouisLUO
// @match        https://yuanbao.tencent.com/*
// @icon         https://cdn-bot.hunyuan.tencent.com/logo-v2.png
// @grant        none
// @license MIT
// ==/UserScript==

// 鸣谢：本脚本部分思路和实现参考了 [腾讯元宝对话导出器 | Tencent Yuanbao Exporter](https://greasyfork.org/zh-CN/scripts/532431-%E8%85%BE%E8%AE%AF%E5%85%83%E5%AE%9D%E5%AF%B9%E8%AF%9D%E5%AF%BC%E5%87%BA%E5%99%A8-tencent-yuanbao-exporter)（by Gao + Gemini 2.5 Pro），并受益于 GitHub Copilot 及 GPT-4.1 的辅助。
// Thanks: Some logic and implementation are inspired by [腾讯元宝对话导出器 | Tencent Yuanbao Exporter](https://greasyfork.org/zh-CN/scripts/532431-%E8%85%BE%E8%AE%AF%E5%85%83%E5%AE%9D%E5%AF%B9%E8%AF%9D%E5%AF%BC%E5%87%BA%E5%99%A8-tencent-yuanbao-exporter) (by Gao + Gemini 2.5 Pro), with help from GitHub Copilot and GPT-4.1.

(function () {
    // --- State Management ---
    let state = {
        latestDetailResponse: null,
        latestResponseSize: 0,
        latestResponseUrl: null,
        lastUpdateTime: null
    };

    // --- Markdown 转换函数 ---
    function adjustHeaderLevels(text, increaseBy = 1) {
        if (!text) return '';
        return text.replace(/^(#+)(\s*)(.*?)\s*$/gm, (match, hashes, existingSpace, content) => {
            return '#'.repeat(hashes.length + increaseBy) + ' ' + content.trim();
        });
    }

    function convertYuanbaoJsonToMarkdown(jsonData, onlyIndex = null) {
        // 转换单轮对话为 Markdown
        if (!jsonData || !jsonData.convs || !Array.isArray(jsonData.convs)) {
            return '# 错误：无效的JSON数据\n\n无法解析对话内容。';
        }
        let markdownContent = '';
        let refs = [];
        let refCount = 1;
        let convs = jsonData.convs;
        if (onlyIndex !== null) {
            convs = convs.filter(turn => turn.index === onlyIndex);
        }
        if (!convs.length) return '';
        convs.forEach(turn => {
            if (turn.speaker === 'human') {
                let userTextMsg = '';
                if (turn.speechesV2 && turn.speechesV2.length > 0 && turn.speechesV2[0].content) {
                    const textBlock = turn.speechesV2[0].content.find(block => block.type === 'text');
                    if (textBlock && typeof textBlock.msg === 'string') {
                        userTextMsg = textBlock.msg;
                    } else if (typeof turn.displayPrompt === 'string') {
                        userTextMsg = turn.displayPrompt;
                    }
                } else if (typeof turn.displayPrompt === 'string') {
                    userTextMsg = turn.displayPrompt;
                }
                markdownContent += userTextMsg + '\n';
                if (turn.speechesV2 && turn.speechesV2.length > 0 && turn.speechesV2[0].content) {
                    let uploadedMedia = [];
                    turn.speechesV2[0].content.forEach(block => {
                        if (block.type !== 'text' && block.fileName && block.url) {
                            uploadedMedia.push(`[${block.fileName || '未知文件'}](${block.url || '#'})`);
                        }
                    });
                    if (uploadedMedia.length > 0) {
                        markdownContent += `\n${uploadedMedia.join('\n')}\n`;
                    }
                }
            } else if (turn.speaker === 'ai') {
                if (turn.speechesV2 && turn.speechesV2.length > 0) {
                    turn.speechesV2.forEach(speech => {
                        if (speech.content && speech.content.length > 0) {
                            speech.content.forEach(block => {
                                switch (block.type) {
                                    case 'text':
                                        // 处理引用格式
                                        let msg = block.msg || '';
                                        if (msg && msg.includes('(@ref)')) {
                                            msg = msg.replace(/\[(\d+)\]\(@ref\)/g, function (_, n) {
                                                return `[^${n}]`;
                                            });
                                        }
                                        markdownContent += `${msg}\n\n`;
                                        break;
                                    case 'think':
                                        markdownContent += `<think>\n${block.content || ''}\n</think>\n\n`;
                                        break;
                                    case 'searchGuid':
                                        if (block.docs && block.docs.length > 0) {
                                            let localRefStart = refCount;
                                            block.docs.forEach((doc, docIndex) => {
                                                refs.push({
                                                    idx: refCount,
                                                    title: doc.title || '无标题',
                                                    url: doc.url || '#'
                                                });
                                                refCount++;
                                            });
                                            let text = block.msg || block.content || '';
                                            let refIdx = localRefStart;
                                            let replaced = text.replace(/\[(\d+)\]\(@ref\)/g, function (_, n) {
                                                return `[^${refIdx++}]`;
                                            });
                                            markdownContent += replaced + '\n\n';
                                        }
                                        break;
                                    case 'image':
                                    case 'code':
                                    case 'pdf':
                                        markdownContent += `[${block.fileName || '未知文件'}](${block.url || '#'})\n\n`;
                                        break;
                                    default:
                                }
                            });
                        }
                    });
                }
            }
        });
        markdownContent = markdownContent.trim();
        // 追加引用链接
        if (refs.length > 0) {
            markdownContent += '\n\n';
            refs.forEach(ref => {
                markdownContent += `[^${ref.idx}]: [${ref.title}](${ref.url})\n`;
            });
        }
        return markdownContent.trim();
    }

    // --- 网络拦截，保存最新对话 JSON ---
    function processYuanbaoResponse(text, url) {
        // 拦截接口，保存最新对话 JSON 数据
        if (!url || !url.includes('/api/user/agent/conversation/v1/detail')) {
            return;
        }
        try {
            if (text && text.includes('"convs":') && text.includes('"createTime":')) {
                state.latestDetailResponse = text;
                state.latestResponseSize = text.length;
                state.latestResponseUrl = url;
                state.lastUpdateTime = new Date().toLocaleTimeString();
            }
        } catch (e) { }
    }
    // fetch 拦截
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const url = args[0] instanceof Request ? args[0].url : args[0];
        let response;
        try {
            response = await originalFetch.apply(this, args);
            if (typeof url === 'string' && url.includes('/api/user/agent/conversation/v1/detail')) {
                const clonedResponse = response.clone();
                clonedResponse.text().then(text => {
                    processYuanbaoResponse(text, url);
                });
            }
        } catch (error) {
            throw error;
        }
        return response;
    };
    // XMLHttpRequest 拦截
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;
    const xhrUrlMap = new WeakMap();
    XMLHttpRequest.prototype.open = function (method, url) {
        xhrUrlMap.set(this, url);
        if (typeof url === 'string' && url.includes('/api/user/agent/conversation/v1/detail')) {
            this.addEventListener('load', function () {
                if (this.readyState === 4 && this.status === 200) {
                    const requestUrl = xhrUrlMap.get(this);
                    try {
                        processYuanbaoResponse(this.responseText, requestUrl);
                    } catch (e) { }
                }
            });
        }
        return originalXhrOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
        return originalXhrSend.apply(this, arguments);
    };

    // --- 注入每个对话泡的复制按钮 ---
    function injectCopyButtons() {
        // 遍历所有对话泡，注入“复制MD”按钮
        document.querySelectorAll('.agent-chat__toolbar__copy').forEach(copyBtn => {
            if (copyBtn.parentElement.querySelector('.agent-chat__toolbar__copy-md')) return;
            const mdBtn = document.createElement('button');
            mdBtn.className = 'agent-chat__toolbar__copy-md';
            mdBtn.title = '复制Markdown（接口数据）';
            mdBtn.textContent = '复制MD';
            // 深灰背景，浅灰字体
            mdBtn.style.marginLeft = '8px';
            mdBtn.style.padding = '2px 8px';
            mdBtn.style.border = 'none';
            mdBtn.style.background = '#13172c';
            mdBtn.style.color = '#efefef';
            mdBtn.style.borderRadius = '8px';
            mdBtn.style.cursor = 'pointer';
            mdBtn.style.fontSize = '14px';
            mdBtn.style.transition = 'background 0.2s';
            mdBtn.onmouseover = () => { mdBtn.style.background = '#24293c'; };
            mdBtn.onmouseout = () => { mdBtn.style.background = '#13172c'; };
            mdBtn.onclick = function (e) {
                e.stopPropagation();
                if (!state.latestDetailResponse) {
                    alert('未捕获到对话数据，请刷新页面或重新进入对话。');
                    return;
                }
                let bubble = copyBtn.closest('.agent-chat__bubble');
                if (!bubble) {
                    alert('未找到对话泡');
                    return;
                }
                // 通过 DOM 顺序反向查找 JSON index
                const allBubbles = Array.from(document.querySelectorAll('.agent-chat__bubble'));
                const domIdx = allBubbles.indexOf(bubble);
                let jsonData;
                try {
                    jsonData = JSON.parse(state.latestDetailResponse);
                } catch (e) {
                    alert('JSON 解析失败');
                    return;
                }
                // JSON 顺序与 DOM 反向
                const jsonConvs = jsonData && Array.isArray(jsonData.convs) ? jsonData.convs : [];
                const jsonIdx = jsonConvs.length - 1 - domIdx;
                let targetIndex = null;
                if (jsonConvs[jsonIdx]) {
                    targetIndex = jsonConvs[jsonIdx].index;
                }
                if (targetIndex === null || targetIndex === undefined) {
                    alert('无法匹配到正确的对话轮次');
                    return;
                }
                const md = convertYuanbaoJsonToMarkdown(jsonData, targetIndex);
                if (!md) return alert('未提取到Markdown内容');
                navigator.clipboard.writeText(md).then(() => {
                    mdBtn.title = '已复制！';
                    mdBtn.style.opacity = 0.5;
                    setTimeout(() => {
                        mdBtn.title = '复制Markdown（接口数据）';
                        mdBtn.style.opacity = 1;
                    }, 1000);
                });
            };
            copyBtn.parentElement.insertBefore(mdBtn, copyBtn.nextSibling);
        });
    }

    // --- MutationObserver 监听 agent-dialogue__tool 元素创建 ---
    function observeAgentDialogueTool() {
        // 监听 agent-dialogue__tool 元素的创建，注入导出按钮
        const observer = new MutationObserver((mutationsList) => {
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1 && node.classList && node.classList.contains('agent-dialogue__tool')) {
                            injectButtonToAgentDialogueTool(node);
                        }
                        if (node.nodeType === 1 && node.querySelectorAll) {
                            node.querySelectorAll('.agent-dialogue__tool').forEach(el => {
                                injectButtonToAgentDialogueTool(el);
                            });
                        }
                    });
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // --- 注入导出按钮到 agent-dialogue__tool ---
    function injectButtonToAgentDialogueTool(el) {
        if (!el || el.dataset.mdInjected) return;
        el.innerHTML = '';
        el.style.display = 'flex';
        el.style.gap = '4px';
        el.style.width = '150px';
        el.style.alignItems = 'center';
        el.style.height = '34px';

        // SVG for ExportOutlined (Ant Design)
        const exportIconSvg = `
            <svg viewBox="64 64 896 896" focusable="false" width="1em" height="1em" fill="currentColor" aria-hidden="true" style="margin-right:4px;">
                <path d="M868 732h-70.3c-4.5 0-8.2 3.5-8.5 8-4.4 61.2-56.1 110-119.2 110H354c-65.2 0-118-53.2-118-118V354c0-63.1 48.8-114.8 110-119.2 4.5-0.3 8-4 8-8.5V156c0-4.4-3.6-8-8-8H156c-17.7 0-32 14.3-32 32v712c0 17.7 14.3 32 32 32h712c17.7 0 32-14.3 32-32V740c0-4.4-3.6-8-8-8z"></path>
                <path d="M534 352V136c0-4.4-3.6-8-8-8h-28c-4.4 0-8 3.6-8 8v216H296c-7.7 0-11.5 9.3-6.1 14.7l200 200c3.1 3.1 8.2 3.1 11.3 0l200-200c5.4-5.4 1.6-14.7-6.1-14.7H534z"></path>
            </svg>
        `;

        // 深灰背景，浅灰字体
        const btnBg = '#13172c';
        const btnBgHover = '#24293c';
        const btnColor = '#efefef';

        function createBtn(text, onclick) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.innerHTML = exportIconSvg + text;
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.style.flex = '1 1 0';
            btn.style.padding = '4px 0';
            btn.style.margin = '4px';
            btn.style.background = btnBg;
            btn.style.color = btnColor;
            btn.style.border = 'none';
            btn.style.borderRadius = '8px';
            btn.style.cursor = 'pointer';
            btn.style.fontSize = '14px';
            btn.style.gap = '4px';
            btn.style.transition = 'background 0.2s';
            btn.onmouseover = () => { btn.style.background = btnBgHover; };
            btn.onmouseout = () => { btn.style.background = btnBg; };
            btn.onclick = onclick;
            return btn;
        }

        // 导出全部对话，分割符 > # user 和 > # agent，顺序正序
        function exportAllConversation() {
            if (!state.latestDetailResponse) {
                alert('未捕获到对话数据，请刷新页面或重新进入对话。');
                return;
            }
            let jsonData;
            try {
                jsonData = JSON.parse(state.latestDetailResponse);
            } catch (e) {
                alert('JSON 解析失败');
                return;
            }
            if (!jsonData || !Array.isArray(jsonData.convs)) {
                alert('无效的对话数据');
                return;
            }
            let md = '';
            // 正序导出
            jsonData.convs.slice().reverse().forEach(turn => {
                if (turn.speaker === 'human') {
                    md += '> # user\n';
                    let userTextMsg = '';
                    if (turn.speechesV2 && turn.speechesV2.length > 0 && turn.speechesV2[0].content) {
                        const textBlock = turn.speechesV2[0].content.find(block => block.type === 'text');
                        if (textBlock && typeof textBlock.msg === 'string') {
                            userTextMsg = textBlock.msg;
                        } else if (typeof turn.displayPrompt === 'string') {
                            userTextMsg = turn.displayPrompt;
                        }
                    } else if (typeof turn.displayPrompt === 'string') {
                        userTextMsg = turn.displayPrompt;
                    }
                    md += (userTextMsg || '') + '\n\n';
                } else if (turn.speaker === 'ai') {
                    md += '> # agent\n';
                    if (turn.speechesV2 && turn.speechesV2.length > 0) {
                        turn.speechesV2.forEach(speech => {
                            if (speech.content && speech.content.length > 0) {
                                speech.content.forEach(block => {
                                    if (block.type === 'text') {
                                        let msg = block.msg || '';
                                        if (msg && msg.includes('(@ref)')) {
                                            msg = msg.replace(/\[(\d+)\]\(@ref\)/g, function (_, n) {
                                                return `[^${n}]`;
                                            });
                                        }
                                        md += msg + '\n\n';
                                    } else if (block.type === 'think') {
                                        md += `<think>\n${block.content || ''}\n</think>\n\n`;
                                    } else if (block.type === 'searchGuid') {
                                        let text = block.msg || block.content || '';
                                        md += text + '\n\n';
                                    } else if (block.type === 'image' || block.type === 'code' || block.type === 'pdf') {
                                        md += `[${block.fileName || '未知文件'}](${block.url || '#'})\n\n`;
                                    }
                                });
                            }
                        });
                    }
                }
            });
            md = md.trim();
            navigator.clipboard.writeText(md);
        }

        const btnAll = createBtn('全部', exportAllConversation);
        const btnDialogue = createBtn('对话', () => { injectCopyButtons(); });

        el.appendChild(btnAll);
        el.appendChild(btnDialogue);
        el.dataset.mdInjected = '1';
    }

    // --- 初始化 ---
    function init() {
        observeAgentDialogueTool();
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();