// ==UserScript==
// @name         360视觉云 - 显式控制面板 (V11.0 网页全屏版)
// @namespace    http://tampermonkey.net/
// @version      11.0
// @description  包含自动点击"继续播放"、屏蔽云台干扰，新增"网页全屏"模式（适配窗口大小）。
// @author       Assistant
// @match        *://*.360.cn/*
// @match        *://*.360.com/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // === 配置 ===
    const BUTTON_KEYWORDS = ["继续播放", "继续观看", "恢复播放"];
    const PANEL_ID = "my-360-control-panel";
    const CLICK_COOLDOWN = 5000;
    let lastClickTime = 0;
    
    // 状态记录
    let isUserHiddenMode = false; // 控件隐藏状态
    let isWebFullscreen = false;  // 网页全屏状态

    // === UI 样式 ===
    const css = `
        #${PANEL_ID} {
            position: fixed;
            top: 160px;
            right: 15px;
            width: 230px;
            background: #2c3e50;
            color: #ecf0f1;
            z-index: 2147483647 !important;
            border-radius: 6px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.7);
            font-family: "Microsoft YaHei", sans-serif;
            font-size: 12px;
            transition: opacity 0.3s, transform 0.3s;
            overflow: hidden;
            border: 1px solid #34495e;
        }
        #${PANEL_ID}.minimized {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            cursor: pointer;
            right: 15px;
            border: 3px solid #27ae60;
            background: #2c3e50;
        }
        #${PANEL_ID} .panel-header {
            padding: 10px;
            background: #34495e;
            cursor: pointer;
            font-weight: bold;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #465f76;
        }
        #${PANEL_ID}.minimized .panel-header {
            padding: 0;
            height: 100%;
            justify-content: center;
            background: transparent;
            border: none;
        }
        #${PANEL_ID}.minimized .header-text, 
        #${PANEL_ID}.minimized .toggle-btn {
            display: none;
        }
        #${PANEL_ID}.minimized::after {
            content: "🛡️";
            font-size: 24px;
            line-height: 48px;
            text-align: center;
            width: 100%;
        }
        #${PANEL_ID} .panel-content {
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        #${PANEL_ID}.minimized .panel-content {
            display: none;
        }
        .action-btn {
            background-color: #e67e22;
            color: white;
            border: none;
            padding: 8px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
            transition: background 0.2s;
            text-align: center;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }
        .action-btn:hover { background-color: #d35400; }
        .action-btn.hidden-mode { background-color: #7f8c8d; }
        
        /* 新增：全屏按钮样式 */
        .fullscreen-btn {
            background-color: #3498db;
        }
        .fullscreen-btn:hover { background-color: #2980b9; }
        .fullscreen-btn.active { background-color: #e74c3c; }

        .log-box {
            height: 110px;
            background: #1a252f;
            border: 1px solid #34495e;
            overflow-y: auto;
            padding: 6px;
            color: #bdc3c7;
            font-family: monospace;
            font-size: 11px;
            line-height: 1.5;
        }
        .log-box::-webkit-scrollbar { width: 4px; }
        .log-box::-webkit-scrollbar-thumb { background: #555; border-radius: 2px; }
        .status-running { color: #2ecc71; font-weight: bold; }
        .status-cooldown { color: #f39c12; font-weight: bold; }

        /* === 网页全屏 CSS 核心代码 === */
        body.tm-web-fullscreen {
            overflow: hidden !important;
        }
        /* 强制隐藏其他元素 */
        body.tm-web-fullscreen .navbar, 
        body.tm-web-fullscreen .sidebar-container,
        body.tm-web-fullscreen .monitor-top,
        body.tm-web-fullscreen .device-list-container,
        body.tm-web-fullscreen .g-sdk {
            display: none !important;
        }
        /* 调整主容器样式 */
        body.tm-web-fullscreen .app-wrapper,
        body.tm-web-fullscreen .main-container,
        body.tm-web-fullscreen .app-main,
        body.tm-web-fullscreen .play,
        body.tm-web-fullscreen .monitor,
        body.tm-web-fullscreen .device-main-container,
        body.tm-web-fullscreen .device-inner-container,
        body.tm-web-fullscreen .monitor-container,
        body.tm-web-fullscreen .monitor-content,
        body.tm-web-fullscreen .monitor-grid,
        body.tm-web-fullscreen .monitor-grid-item,
        body.tm-web-fullscreen .monitor-inner-content {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            margin: 0 !important;
            padding: 0 !important;
            z-index: 9999 !important;
            background-color: #000 !important;
        }
        /* 视频本身适配 */
        body.tm-web-fullscreen video {
            object-fit: contain !important; /* 保持比例 */
            width: 100% !important;
            height: 100% !important;
        }
        /* 播放器控件浮动到底部 */
        body.tm-web-fullscreen xg-controls {
            bottom: 0 !important;
            width: 100% !important;
            z-index: 10000 !important;
        }
    `;

    if (typeof GM_addStyle !== "undefined") {
        GM_addStyle(css);
    } else {
        const style = document.createElement('style');
        style.innerHTML = css;
        document.head.appendChild(style);
    }

    // === UI 创建 ===
    function createPanel() {
        if (document.getElementById(PANEL_ID)) return;

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.innerHTML = `
            <div class="panel-header">
                <span class="header-text">360监控助手 V11</span>
                <span class="toggle-btn">➖</span>
            </div>
            <div class="panel-content">
                <div>状态: <span id="${PANEL_ID}-status" class="status-running">扫描中...</span></div>
                
                <button id="${PANEL_ID}-toggle-fullscreen" class="action-btn fullscreen-btn">
                    <span>📺</span> 切换网页全屏
                </button>

                <button id="${PANEL_ID}-toggle-all" class="action-btn">
                    <span>👁️</span> 显示/隐藏控制面板
                </button>

                <div class="log-box" id="${PANEL_ID}-log"></div>
            </div>
        `;
        document.body.appendChild(panel);

        // 绑定事件
        panel.querySelector('.panel-header').onclick = () => {
            panel.classList.toggle('minimized');
        };
        document.getElementById(`${PANEL_ID}-toggle-all`).onclick = toggleUserHiddenMode;
        document.getElementById(`${PANEL_ID}-toggle-fullscreen`).onclick = toggleWebFullscreen;
    }

    // === 工具：获取干扰元素 ===
    function getDisturbingElements() {
        const targets = [];
        document.querySelectorAll('.rotatebox').forEach(box => {
            if (box.querySelector('.rotate')) targets.push(box);
        });
        document.querySelectorAll('div[class*="controlsBot"]').forEach(bar => {
            targets.push(bar);
        });
        return targets;
    }

    // === 功能1：网页全屏切换 ===
    function toggleWebFullscreen() {
        const btn = document.getElementById(`${PANEL_ID}-toggle-fullscreen`);
        isWebFullscreen = !isWebFullscreen;

        if (isWebFullscreen) {
            document.body.classList.add('tm-web-fullscreen');
            btn.classList.add('active');
            btn.querySelector('span').innerText = "❌";
            btn.childNodes[2].textContent = " 退出网页全屏";
            
            // 全屏时通常希望自动隐藏控件
            if (!isUserHiddenMode) {
                toggleUserHiddenMode(); 
            }
            
            // 触发一次 resize 事件，通知播放器调整大小
            window.dispatchEvent(new Event('resize'));
            log("已进入网页全屏模式", "#3498db");
        } else {
            document.body.classList.remove('tm-web-fullscreen');
            btn.classList.remove('active');
            btn.querySelector('span').innerText = "📺";
            btn.childNodes[2].textContent = " 切换网页全屏";
            
            window.dispatchEvent(new Event('resize'));
            log("已退出网页全屏", "#7f8c8d");
        }
    }

    // === 功能2：显隐控件 ===
    function toggleUserHiddenMode() {
        const btn = document.getElementById(`${PANEL_ID}-toggle-all`);
        const targets = getDisturbingElements();

        // 即使没找到元素也要切换状态（可能因为还没加载出来）
        isUserHiddenMode = !isUserHiddenMode; 
        applyVisibility(isUserHiddenMode);

        if (isUserHiddenMode) {
            btn.classList.add('hidden-mode');
            btn.querySelector('span').innerText = "🙈";
            if(!isWebFullscreen) log(`已隐藏控件`, "#9b59b6");
        } else {
            btn.classList.remove('hidden-mode');
            btn.querySelector('span').innerText = "👁️";
            log("已显示控件", "#3498db");
        }
    }

    // === 辅助：应用显隐 ===
    function applyVisibility(shouldHide) {
        const targets = getDisturbingElements();
        targets.forEach(el => {
            el.style.display = shouldHide ? 'none' : '';
        });
    }

    // === 核心逻辑：自动点击 + 云台压制 ===
    function checkAndClick() {
        if (!document.getElementById(PANEL_ID)) createPanel();
        if (Date.now() - lastClickTime < CLICK_COOLDOWN) return;

        const statusSpan = document.getElementById(`${PANEL_ID}-status`);
        if (statusSpan && statusSpan.innerText !== "扫描中...") {
            statusSpan.innerText = "扫描中...";
            statusSpan.className = "status-running";
        }

        const elements = document.querySelectorAll('span, button');
        for (let i = 0; i < elements.length; i++) {
            let el = elements[i];
            if (el.offsetParent === null) continue;
            
            const text = el.innerText ? el.innerText.trim() : "";
            if (!BUTTON_KEYWORDS.includes(text)) continue;

            // 修正点击目标
            if (el.tagName === 'SPAN' && el.parentElement && el.parentElement.tagName === 'BUTTON') {
                el = el.parentElement;
            }

            log(`发现目标: "${text}"`, "#e74c3c");

            // 1. 瞬间隐藏干扰
            applyVisibility(true); 

            // 2. 执行点击
            try {
                el.click();
                lastClickTime = Date.now();
                
                // 3. 持续压制 2秒 (防止云台弹出)
                let suppressionCount = 0;
                const suppressor = setInterval(() => {
                    applyVisibility(true);
                    suppressionCount++;
                    if (suppressionCount > 40) { // 2秒
                        clearInterval(suppressor);
                        // 压制结束，恢复用户状态
                        applyVisibility(isUserHiddenMode);
                        log("压制结束，恢复状态", "#7f8c8d");
                    }
                }, 50);

                log("✅ 点击成功 (压制中...)", "#2ecc71");
                
                if(statusSpan) {
                    statusSpan.innerText = "冷却中...";
                    statusSpan.className = "status-cooldown";
                }
                break; 
            } catch (e) {
                log("❌ 点击报错: " + e.message, "red");
            }
        }
    }

    // === 日志系统 ===
    function log(msg, color="#bdc3c7") {
        const logBox = document.getElementById(`${PANEL_ID}-log`);
        if (!logBox) return;
        const time = new Date().toLocaleTimeString('zh-CN', {hour12: false});
        const div = document.createElement('div');
        div.innerHTML = `<span style="color:#7f8c8d">[${time}]</span> <span style="color:${color}">${msg}</span>`;
        logBox.insertBefore(div, logBox.firstChild);
        if (logBox.children.length > 50) logBox.lastChild.remove();
    }

    // === 启动 ===
    setTimeout(() => {
        createPanel();
        log("脚本 V11 已加载 (全屏增强版)");
        setInterval(checkAndClick, 2000);
    }, 1500);

})();
