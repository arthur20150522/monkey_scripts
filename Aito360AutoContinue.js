// ==UserScript==
// @name         360视觉云 - 显式控制面板 (V10.0 隐形打击版)
// @namespace    http://tampermonkey.net/
// @version      10.0
// @description  基于HTML源码深度优化：在自动点击前后强力压制云台弹出，确保"继续播放"时不干扰画面。
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
    
    // 全局状态：用户是否主动开启了“隐藏面板”模式
    let isUserHiddenMode = false; 

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
            transition: all 0.3s;
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
        .action-btn:hover {
            background-color: #d35400;
        }
        .action-btn.hidden-mode {
            background-color: #7f8c8d;
        }
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
        .status-running { color: #2ecc71; font-weight: bold; }
        .status-cooldown { color: #f39c12; font-weight: bold; }
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
                <span class="header-text">360监控助手 V10</span>
                <span class="toggle-btn">➖</span>
            </div>
            <div class="panel-content">
                <div>状态: <span id="${PANEL_ID}-status" class="status-running">扫描中...</span></div>
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
    }

    // === 核心工具：获取所有干扰元素 ===
    function getDisturbingElements() {
        const targets = [];
        // 1. 云台 (.rotatebox)
        document.querySelectorAll('.rotatebox').forEach(box => {
            if (box.querySelector('.rotate')) targets.push(box);
        });
        // 2. 底部栏 (controlsBot)
        document.querySelectorAll('div[class*="controlsBot"]').forEach(bar => {
            targets.push(bar);
        });
        return targets;
    }

    // === 功能：用户手动切换显隐 ===
    function toggleUserHiddenMode() {
        const btn = document.getElementById(`${PANEL_ID}-toggle-all`);
        const targets = getDisturbingElements();

        if (targets.length === 0) {
            log("未找到控件 (可能未加载)", "#f39c12");
            return;
        }

        isUserHiddenMode = !isUserHiddenMode; // 切换状态
        
        applyVisibility(isUserHiddenMode); // 应用状态

        if (isUserHiddenMode) {
            btn.classList.add('hidden-mode');
            btn.querySelector('span').innerText = "🙈";
            log(`已手动隐藏控件`, "#9b59b6");
        } else {
            btn.classList.remove('hidden-mode');
            btn.querySelector('span').innerText = "👁️";
            log("已手动显示控件", "#3498db");
        }
    }

    // === 辅助：应用显隐状态 ===
    function applyVisibility(shouldHide) {
        const targets = getDisturbingElements();
        targets.forEach(el => {
            el.style.display = shouldHide ? 'none' : '';
        });
    }

    // === 核心逻辑：隐形打击 ===
    function checkAndClick() {
        if (!document.getElementById(PANEL_ID)) createPanel();
        if (Date.now() - lastClickTime < CLICK_COOLDOWN) return;

        // 状态复位
        const statusSpan = document.getElementById(`${PANEL_ID}-status`);
        if (statusSpan && statusSpan.innerText !== "扫描中...") {
            statusSpan.innerText = "扫描中...";
            statusSpan.className = "status-running";
        }

        // 查找“继续播放”
        const elements = document.querySelectorAll('span, button');
        
        for (let i = 0; i < elements.length; i++) {
            let el = elements[i];
            if (el.offsetParent === null) continue;
            
            const text = el.innerText ? el.innerText.trim() : "";
            if (!BUTTON_KEYWORDS.includes(text)) continue;

            // 修正目标为 Button
            if (el.tagName === 'SPAN' && el.parentElement && el.parentElement.tagName === 'BUTTON') {
                el = el.parentElement;
            }

            // === 隐形打击逻辑 ===
            log(`发现目标: "${text}"，启动压制`, "#e74c3c");

            // 1. 瞬间隐藏所有干扰元素 (不管用户是否开启隐藏模式，点击瞬间必须隐藏)
            applyVisibility(true); 

            // 2. 执行点击
            try {
                el.click();
                lastClickTime = Date.now();
                
                // 3. 启动“持续压制器”
                // 原因：网页代码会在播放恢复后的几百毫秒内，尝试把云台弹出来。
                // 我们要在这段时间内，不断地把它按回去。
                let suppressionCount = 0;
                const suppressor = setInterval(() => {
                    applyVisibility(true); // 强制隐藏
                    suppressionCount++;
                    if (suppressionCount > 40) { // 压制 2秒 (40 * 50ms)
                        clearInterval(suppressor);
                        // 压制结束，恢复用户设定的状态
                        // 如果用户本来就是隐藏模式，就继续隐藏
                        // 如果用户是显示模式，这时候再显示出来
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
        log("脚本 V10 已加载 (隐形打击版)");
        setInterval(checkAndClick, 2000);
    }, 1500);

})();
