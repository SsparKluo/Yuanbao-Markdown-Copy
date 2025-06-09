// ==UserScript==
// @name         Yuanbao Markdown Copy
// @namespace    http://tampermonkey.net/
// @version      0.8
// @description  在腾讯元宝对话中添加一键复制Markdown按钮（含思考过程），可通过油猴菜单配置导出选项
// @author       LouisLUO
// @match        https://yuanbao.tencent.com/*
// @icon         https://cdn-bot.hunyuan.tencent.com/logo-v2.png
// @grant        GM_registerMenuCommand
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

    // 深灰背景，浅灰字体
    const btnBg = '#13172c';
    const btnBgHover = '#24293c';
    const btnColor = '#efefef';

    // --- Markdown 转换函数 ---
    function adjustHeaderLevels(text, increaseBy = 1) {
        if (!text) return '';
        // Adjusts existing markdown headers
        let adjustedText = text.replace(/^(#+)(\s*)(.*?)\s*$/gm, (match, hashes, existingSpace, content) => {
            return '#'.repeat(hashes.length + increaseBy) + ' ' + content.trim();
        });
        // Adjusts blockquoted headers like "> # user"
        adjustedText = adjustedText.replace(/^>\s*(#+)(\s*)(.*?)\s*$/gm, (match, blockquotePrefix, hashes, existingSpace, content) => {
            return blockquotePrefix + '#'.repeat(hashes.length + increaseBy) + ' ' + content.trim();
        });
        return adjustedText;
    }

    function convertYuanbaoJsonToMarkdown(jsonData, onlyIndex = null) {
        const settings = getSettings();
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
                if (settings.replaceFormulas) {
                    userTextMsg = userTextMsg
                        .replace(/\\\((.+?)\\\)/g, (m, p1) => `$${p1}$`)
                        .replace(/\\\[(.+?)\\\]/gs, (m, p1) => `$$${p1}$$`);
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
                                        let msg = block.msg || '';
                                        if (settings.replaceFormulas) {
                                            msg = msg
                                                .replace(/\\\((.+?)\\\)/g, (m, p1) => `$${p1}$`)
                                                .replace(/\\\[(.+?)\\\]/gs, (m, p1) => `$$${p1}$$`);
                                        }
                                        if (settings.keepSearchResults && msg && msg.includes('(@ref)')) {
                                            msg = msg.replace(/\[(\d+)\]\(@ref\)/g, function (_, n) {
                                                return `[^${n}]`;
                                            });
                                        } else if (!settings.keepSearchResults && msg && msg.includes('(@ref)')) {
                                            msg = msg.replace(/\[\d+\]\(@ref\)/g, '').trim(); // Remove ref tags
                                        }
                                        markdownContent += `${msg}\n\n`;
                                        break;
                                    case 'think':
                                        if (settings.exportThinkProcess) {
                                            let thinkContent = block.content || '';
                                            if (settings.replaceFormulas) {
                                                thinkContent = thinkContent
                                                    .replace(/\\\((.+?)\\\)/g, (m, p1) => `$${p1}$`)
                                                    .replace(/\\\[(.+?)\\\]/gs, (m, p1) => `$$${p1}$$`);
                                            }
                                            if (settings.thinkProcessFormat === 'markdown') {
                                                markdownContent += `> ${thinkContent.replace(/\n/g, '\n> ')}\n\n`;
                                            } else { // 'tag'
                                                markdownContent += `<think>\n${thinkContent}\n</think>\n\n`;
                                            }
                                        }
                                        break;
                                    case 'searchGuid':
                                        if (settings.keepSearchResults) {
                                            let localRefStart = refCount;
                                            if (block.docs && block.docs.length > 0) {
                                                block.docs.forEach((doc, docIndex) => {
                                                    refs.push({
                                                        idx: refCount,
                                                        title: doc.title || '无标题',
                                                        url: doc.url || '#'
                                                    });
                                                    refCount++;
                                                });
                                            }
                                            let text = block.msg || block.content || '';
                                            if (settings.replaceFormulas) {
                                                text = text
                                                    .replace(/\\\((.+?)\\\)/g, (m, p1) => `$${p1}$`)
                                                    .replace(/\\\[(.+?)\\\]/gs, (m, p1) => `$$${p1}$$`);
                                            }
                                            let refIdx = localRefStart;
                                            let replaced = text.replace(/\[(\d+)\]\(@ref\)/g, function (_, n) {
                                                return `[^${refIdx++}]`;
                                            });
                                            markdownContent += replaced + '\n\n';
                                        } else {
                                            // Optionally, still add the text content if search results are off
                                            let text = block.msg || block.content || '';
                                            if (text) {
                                                if (settings.replaceFormulas) {
                                                    text = text
                                                        .replace(/\\\((.+?)\\\)/g, (m, p1) => `$${p1}$`)
                                                        .replace(/\\\[(.+?)\\\]/gs, (m, p1) => `$$${p1}$$`);
                                                }
                                                text = text.replace(/\[\d+\]\(@ref\)/g, '').trim(); // Remove ref tags
                                                markdownContent += text + '\n\n';
                                            }
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
        if (settings.keepSearchResults && refs.length > 0) {
            markdownContent += '\n\n';
            refs.forEach(ref => {
                markdownContent += `[^${ref.idx}]: [${ref.title}](${ref.url})\n`;
            });
        }
        if (settings.headerDowngrade) {
            markdownContent = adjustHeaderLevels(markdownContent);
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

    // --- 配置管理 ---
    const DEFAULT_SETTINGS = {
        autoInjectCopyBtn: true,
        exportFormat: 'markdown', // 预留扩展
        replaceFormulas: true,
        exportThinkProcess: true,
        thinkProcessFormat: 'tag', // 'tag' or 'markdown'
        keepSearchResults: true,
        headerDowngrade: false
    };
    function getSettings() {
        try {
            return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem('yuanbao_md_settings') || '{}'));
        } catch {
            return { ...DEFAULT_SETTINGS };
        }
    }
    function saveSettings(settings) {
        localStorage.setItem('yuanbao_md_settings', JSON.stringify(settings));
    }
    function showSettingsDialog() {
        const settings = getSettings();
        const html = `
            <div style="font-size:14px; line-height: 1.8;">
                <label>
                    <input type="checkbox" id="autoInjectCopyBtn" ${settings.autoInjectCopyBtn ? 'checked' : ''}>
                    自动注入“复制MD”按钮 (刷新生效)
                </label>
                <br>
                <label>
                    <input type="checkbox" id="replaceFormulas" ${settings.replaceFormulas ? 'checked' : ''}>
                    替换行内/块公式语法 (<code>\\(..\\)</code> -> <code>$...$</code>, <code>\\[..\\]</code> -> <code>$$...$$</code>)
                </label>
                <br>
                <label>
                    <input type="checkbox" id="exportThinkProcess" ${settings.exportThinkProcess ? 'checked' : ''}>
                    导出思考过程
                </label>
                <br>
                <label style="padding-left: 20px;">
                    思考过程格式:
                    <select id="thinkProcessFormat" ${!settings.exportThinkProcess ? 'disabled' : ''}>
                        <option value="tag" ${settings.thinkProcessFormat === 'tag' ? 'selected' : ''}>&lt;think&gt;标签</option>
                        <option value="markdown" ${settings.thinkProcessFormat === 'markdown' ? 'selected' : ''}>Markdown引用</option>
                    </select>
                </label>
                <br>
                <label>
                    <input type="checkbox" id="keepSearchResults" ${settings.keepSearchResults ? 'checked' : ''}>
                    保留网页搜索内容和脚标
                </label>
                <br>
                <label>
                    <input type="checkbox" id="headerDowngrade" ${settings.headerDowngrade ? 'checked' : ''}>
                    标题降级 (例: # -> ##)
                </label>
                <br>
                <label style="display:none;">
                    导出格式：
                    <select id="exportFormat">
                        <option value="markdown" ${settings.exportFormat === 'markdown' ? 'selected' : ''}>Markdown</option>
                    </select>
                </label>
            </div>
        `;
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        // 简单弹窗
        const modal = document.createElement('div');
        modal.style.position = 'fixed';
        modal.style.left = '50%';
        modal.style.top = '50%';
        modal.style.transform = 'translate(-50%,-50%)';
        modal.style.background = '#222';
        modal.style.color = '#fff';
        modal.style.padding = '24px';
        modal.style.borderRadius = '12px';
        modal.style.zIndex = 99999;
        modal.style.boxShadow = '0 2px 16px #0008';
        modal.appendChild(wrapper);
        const btnSave = document.createElement('button');
        btnSave.textContent = '保存';
        btnSave.style.margin = '16px 8px 0 0';
        btnSave.onclick = () => {
            const newSettings = {
                autoInjectCopyBtn: wrapper.querySelector('#autoInjectCopyBtn').checked,
                exportFormat: wrapper.querySelector('#exportFormat').value,
                replaceFormulas: wrapper.querySelector('#replaceFormulas').checked,
                exportThinkProcess: wrapper.querySelector('#exportThinkProcess').checked,
                thinkProcessFormat: wrapper.querySelector('#thinkProcessFormat').value,
                keepSearchResults: wrapper.querySelector('#keepSearchResults').checked,
                headerDowngrade: wrapper.querySelector('#headerDowngrade').checked
            };
            saveSettings(newSettings);
            document.body.removeChild(modal);
            alert('设置已保存，部分设置需刷新页面生效');
        };
        const btnCancel = document.createElement('button');
        btnCancel.textContent = '取消';
        btnCancel.onclick = () => document.body.removeChild(modal);
        modal.appendChild(btnSave);
        modal.appendChild(btnCancel);
        document.body.appendChild(modal);

        // 联动思考过程格式的禁用状态
        const exportThinkProcessCheckbox = wrapper.querySelector('#exportThinkProcess');
        const thinkProcessFormatSelect = wrapper.querySelector('#thinkProcessFormat');
        exportThinkProcessCheckbox.addEventListener('change', function() {
            thinkProcessFormatSelect.disabled = !this.checked;
        });
    }

    // 注册菜单命令
    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('脚本设置', showSettingsDialog);
    }

    // --- 注入每个对话泡的复制按钮 ---
    function injectCopyButtons() {
        const settings = getSettings();
        if (!settings.autoInjectCopyBtn) return;
        // 遍历所有对话泡，注入“复制MD”按钮
        document.querySelectorAll('.agent-chat__toolbar__copy').forEach(copyBtn => {
            if (copyBtn.parentElement.querySelector('.agent-chat__toolbar__copy-md')) return;
            const mdBtn = document.createElement('button');
            mdBtn.className = 'agent-chat__toolbar__copy-md';
            mdBtn.title = '复制Markdown（接口数据）';
            mdBtn.textContent = '复制MD';
            mdBtn.style.marginLeft = '8px';
            mdBtn.style.padding = '2px 8px';
            mdBtn.style.border = 'none';
            mdBtn.style.background = btnBg;
            mdBtn.style.color = btnColor;
            mdBtn.style.borderRadius = '8px';
            mdBtn.style.cursor = 'pointer';
            mdBtn.style.fontSize = '14px';
            mdBtn.style.transition = 'background 0.2s';
            mdBtn.onmouseover = () => { mdBtn.style.background = btnBgHover; };
            mdBtn.onmouseout = () => { mdBtn.style.background = btnBg; };
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
                // 自动注入“复制MD”按钮（每次有新节点时都尝试）
                if (getSettings().autoInjectCopyBtn) {
                    injectCopyButtons();
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

        // 深灰背景，浅灰字体
        const btnBg = '#13172c';
        const btnBgHover = '#24293c';
        const btnColor = '#efefef';

        // SVG for ExportOutlined (Ant Design)
        // const exportIconSvg = `...`; // 删除原有 SVG

        // 使用 export-svgrepo-com.svg 作为“全部”按钮的 SVG
        const exportIconSvgAll = `
            <svg fill="#efefef" width="1em" height="1em" viewBox="0 0 20 20" style="margin-right:4px;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg"><path d="M15 15H2V6h2.595s.689-.896 2.17-2H1a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h15a1 1 0 0 0 1-1v-3.746l-2 1.645V15zm-1.639-6.95v3.551L20 6.4l-6.639-4.999v3.131C5.3 4.532 5.3 12.5 5.3 12.5c2.282-3.748 3.686-4.45 8.061-4.45z"/></svg>
        `;
        // “对话”按钮 SVG 替换为 dialogue-real-estate-svgrepo-com.svg
        const exportIconSvg = `
            <svg fill="#efefef" width="1em" height="1em" viewBox="0 0 24 24" style="margin-right:4px;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg"><path d="M21 2H3a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5v3.382a1 1 0 0 0 1.447.894L15.764 18H21a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Zm-1 14h-5.382a1 1 0 0 0-.447.105L10 17.618V16a1 1 0 0 0-1-1H4V4h16ZM7 7h10v2H7Zm0 4h7v2H7Z"/></svg>
        `;

        function createBtn(text, onclick, iconSvg) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.innerHTML = iconSvg + text;
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
            const settings = getSettings();
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
            let refs = [];
            let refCount = 1;
            // 正序导出
            jsonData.convs.slice().reverse().forEach(turn => {
                if (turn.speaker === 'human') {
                    md += (settings.headerDowngrade ? '> ## user\n' : '> # user\n');
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
                    // 数学公式替换
                    if (settings.replaceFormulas) {
                        userTextMsg = userTextMsg
                            .replace(/\\\((.+?)\\\)/g, (m, p1) => `$${p1}$`)
                            .replace(/\\\[(.+?)\\\]/gs, (m, p1) => `$$${p1}$$`);
                    }
                    md += (userTextMsg || '') + '\n\n';
                } else if (turn.speaker === 'ai') {
                    md += (settings.headerDowngrade ? '> ## agent\n' : '> # agent\n');
                    if (turn.speechesV2 && turn.speechesV2.length > 0) {
                        turn.speechesV2.forEach(speech => {
                            if (speech.content && speech.content.length > 0) {
                                speech.content.forEach(block => {
                                    if (block.type === 'text') {
                                        let msg = block.msg || '';
                                        if (settings.replaceFormulas) {
                                            msg = msg
                                                .replace(/\\\((.+?)\\\)/g, (m, p1) => `$${p1}$`)
                                                .replace(/\\\[(.+?)\\\]/gs, (m, p1) => `$$${p1}$$`);
                                        }
                                        // 处理引用格式
                                        if (settings.keepSearchResults && msg && msg.includes('(@ref)')) {
                                            msg = msg.replace(/\[(\d+)\]\(@ref\)/g, function (_, n) {
                                                return `[^${n}]`;
                                            });
                                        } else if (!settings.keepSearchResults && msg && msg.includes('(@ref)')) {
                                            msg = msg.replace(/\[\d+\]\(@ref\)/g, '').trim(); // Remove ref tags
                                        }
                                        md += msg + '\n\n';
                                    } else if (block.type === 'think') {
                                        if (settings.exportThinkProcess) {
                                            let thinkContent = block.content || '';
                                            if (settings.replaceFormulas) {
                                                thinkContent = thinkContent
                                                    .replace(/\\\((.+?)\\\)/g, (m, p1) => `$${p1}$`)
                                                    .replace(/\\\[(.+?)\\\]/gs, (m, p1) => `$$${p1}$$`);
                                            }
                                            if (settings.thinkProcessFormat === 'markdown') {
                                                md += `> ${thinkContent.replace(/\n/g, '\n> ')}\n\n`;
                                            } else { // 'tag'
                                                md += `<think>\n${thinkContent}\n</think>\n\n`;
                                            }
                                        }
                                    } else if (block.type === 'searchGuid') {
                                        if (settings.keepSearchResults) {
                                            // 记录引用
                                            if (block.docs && block.docs.length > 0) {
                                                block.docs.forEach(doc => {
                                                    refs.push({
                                                        idx: refCount,
                                                        title: doc.title || '无标题',
                                                        url: doc.url || '#'
                                                    });
                                                    refCount++;
                                                });
                                            }
                                            let text = block.msg || block.content || '';
                                            if (settings.replaceFormulas) {
                                                text = text
                                                    .replace(/\\\((.+?)\\\)/g, (m, p1) => `$${p1}$`)
                                                    .replace(/\\\[(.+?)\\\]/gs, (m, p1) => `$$${p1}$$`);
                                            }
                                            // 脚标替换
                                            let localRefStart = refCount - (block.docs ? block.docs.length : 0);
                                            let refIdx = localRefStart;
                                            let replaced = text.replace(/\[(\d+)\]\(@ref\)/g, function (_, n) {
                                                return `[^${refIdx++}]`;
                                            });
                                            md += replaced + '\n\n';
                                        } else {
                                            // Optionally, still add the text content if search results are off
                                            let text = block.msg || block.content || '';
                                            if (text) {
                                                if (settings.replaceFormulas) {
                                                    text = text
                                                        .replace(/\\\((.+?)\\\)/g, (m, p1) => `$${p1}$`)
                                                        .replace(/\\\[(.+?)\\\]/gs, (m, p1) => `$$${p1}$$`);
                                                }
                                                text = text.replace(/\[\d+\]\(@ref\)/g, '').trim(); // Remove ref tags
                                                md += text + '\n\n';
                                            }
                                        }
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
            // 追加引用链接
            if (settings.keepSearchResults && refs.length > 0) {
                md += '\n\n';
                refs.forEach(ref => {
                    md += `[^${ref.idx}]: [${ref.title}](${ref.url})\n`;
                });
            }
            // Note: headerDowngrade for "> # user/agent" is handled directly above.
            // If other headers exist in the content, adjustHeaderLevels could be applied here too,
            // but it's primarily for the single-turn export.
            // For "exportAllConversation", the main structural headers are already conditionally adjusted.
            navigator.clipboard.writeText(md);
        }

        const btnAll = createBtn('全部', exportAllConversation, exportIconSvgAll);
        const btnDialogue = createBtn('对话', () => { injectCopyButtons(); }, exportIconSvg);

        el.appendChild(btnAll);
        el.appendChild(btnDialogue);
        el.dataset.mdInjected = '1';
    }

    // --- 初始化 ---
    function init() {
        observeAgentDialogueTool();
        // 不再需要在这里调用 injectCopyButtons，交由 observer 统一管理
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();