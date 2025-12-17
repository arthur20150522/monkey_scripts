// ==UserScript==
// @name         360视觉云 - 显式控制面板 (V7.0 终极版)
// @namespace    http://tampermonkey.net/
// @version      7.0
// @description  自动点击"继续播放"弹窗，并提供一键隐藏/显示页面遮挡元素（云台、底部控制栏）的功能。
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
    const CLICK_COOLDOWN = 10000;
    let lastClickTime = 0;
    
    // 标记当前遮挡物是显示还是隐藏 (false=显示中, true=已隐藏)
    let isHiddenMode = false;

    // === UI 样式 ===
    const css = `
        #${PANEL_ID} {
            position: fixed;
            top: 150px;
            right: 10px;
            width: 220px;
            background: #2c3e50;
            color: #ecf0f1;
            z-index: 2147483647;
            border-radius: 6px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.6);
            font-family: "Microsoft YaHei", sans-serif;
            font-size: 12px;
            transition: all 0.3s;
            overflow: hidden;
            border: 1px solid #34495e;
        }
        #${PANEL_ID}.minimized {
            width: 45px;
            height: 45px;
            border-radius: 50%;
            cursor: pointer;
            right: 15px;
            border: 2px solid #27ae60;
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
            background: #27ae60;
            border: none;
        }
        #${PANEL_ID}.minimized .header-text, 
        #${PANEL_ID}.minimized .toggle-btn {
            display: none;
        }
        #${PANEL_ID}.minimized::after {
            content: "⚡";
            font-size: 24px;
            line-height: 45px;
            text-align: center;
            width: 100%;
            color: white;
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
        /* 功能按钮样式 */
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
            gap: 5px;
        }
        .action-btn:hover {
            background-color: #d35400;
        }
        .action-btn.hidden-mode {
            background-color: #7f8c8d; /* 灰色表示已隐藏 */
        }
        .log-box {
            height: 100px;
            background: #1a252f;
            border: 1px solid #34495e;
            overflow-y: auto;
            padding: 6px;
            color: #bdc3c7;
            font-family: monospace;
            font-size: 11px;
            line-height: 1.4;
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
                <span class="header-text">360监控助手 V7</span>
                <span class="toggle-btn">➖</span>
            </div>
            <div class="panel-content">
                <!-- 状态区 -->
                <div>状态: <span id="${PANEL_ID}-status" class="status-running">扫描中...</span></div>
                
                <!-- 功能区 -->
                <button id="${PANEL_ID}-toggle-all" class="action-btn">
                    <span>👁️</span> 显示/隐藏控制面板
                </button>

                <!-- 日志区 -->
                <div class="log-box" id="${PANEL_ID}-log"></div>
            </div>
        `;
        document.body.appendChild(panel);

        // 收起/展开逻辑
        panel.querySelector('.panel-header').onclick = () => {
            panel.classList.toggle('minimized');
        };

        // 绑定显隐按钮事件
        document.getElementById(`${PANEL_ID}-toggle-all`).onclick = togglePageControls;
    }

    // === 功能：一键显隐所有遮挡控件 (健壮版) ===
    function togglePageControls() {
        const btn = document.getElementById(`${PANEL_ID}-toggle-all`);
        const targets = []; // 存放所有要操作的元素

        // --- 1. 寻找云台控制器 (.rotatebox) ---
        const rotateBoxes = document.querySelectorAll('.rotatebox');
        for (let box of rotateBoxes) {
            // 健壮性校验：必须包含 .rotate 或 .sector 才是真的云台
            if (box.querySelector('.rotate') || box.querySelector('.sector')) {
                targets.push(box);
            }
        }

        // --- 2. 寻找底部操作栏 (.controlsBot) ---
        // 使用属性包含匹配，防止 ID 变化 (data-v 忽略，id 忽略)
        const potentialBars = document.querySelectorAll('div[class*="controlsBot"]');
        for (let bar of potentialBars) {
            // 健壮性校验：检查内部特征，确保不误伤
            // 只要包含以下任意一个特征，就认为是底部栏
            const hasVideoText = bar.innerText && bar.innerText.includes("查看卡录像");
            const hasVolume = bar.querySelector('.volumeItem');
            const hasClarity = bar.querySelector('.Clarityselect');
            
            if (hasVideoText || hasVolume || hasClarity) {
                targets.push(bar);
            }
        }

        // --- 3. 执行切换 ---
        if (targets.length === 0) {
            log("未检测到任何遮挡控件", "#f39c12");
            log("请先选择并在播放摄像头画面", "#7f8c8d");
            return;
        }

        // 切换状态
        isHiddenMode = !isHiddenMode;

        targets.forEach(el => {
            if (isHiddenMode) {
                el.style.display = 'none'; // 隐藏
            } else {
                el.style.display = ''; // 恢复默认
            }
        });

        // 更新按钮外观
        if (isHiddenMode) {
            btn.classList.add('hidden-mode');
            btn.querySelector('span').innerText = "🙈";
            log(`已隐藏 ${targets.length} 个页面控件`, "#9b59b6");
        } else {
            btn.classList.remove('hidden-mode');
            btn.querySelector('span').innerText = "👁️";
            log("已恢复显示页面控件", "#3498db");
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

    // === 自动点击核心逻辑 ===
    let checkCount = 0;
    function checkAndClick() {
        if (!document.getElementById(PANEL_ID)) createPanel();
        
        // 冷却检测
        if (Date.now() - lastClickTime < CLICK_COOLDOWN) return;

        // 恢复状态文字
        const statusSpan = document.getElementById(`${PANEL_ID}-status`);
        if (statusSpan && statusSpan.innerText !== "扫描中...") {
            statusSpan.innerText = "扫描中...";
            statusSpan.className = "status-running";
        }

        // 查找按钮
        const candidates = document.querySelectorAll('button, div, span, a');
        for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i];
            if (el.offsetParent === null) continue; // 必须可见
            
            const text = el.innerText ? el.innerText.trim() : "";
            if (BUTTON_KEYWORDS.includes(text)) {
                log(`发现目标: "${text}"`, "#e74c3c");
                try {
                    el.click();
                    lastClickTime = Date.now();
                    log("✅ 已触发点击指令", "#2ecc71");
                    if(statusSpan) {
                        statusSpan.innerText = "等待冷却...";
                        statusSpan.className = "status-cooldown";
                    }
                    break;
                } catch (e) {
                    log("❌ 点击报错: " + e.message, "red");
                }
            }
        }
    }

    // === 启动 ===
    setTimeout(() => {
        createPanel();
        log("脚本 V7 已加载 (全控模式)");
        setInterval(checkAndClick, 2000);
    }, 1500);

})();
