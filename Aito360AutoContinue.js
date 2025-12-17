// ==UserScript==
// @name         360视觉云 - 显式控制面板 (V6.0全功能版)
// @namespace    http://tampermonkey.net/
// @version      6.0
// @description  监控"继续播放"弹窗并自动点击，同时提供隐藏云台控制器功能，解决画面遮挡问题。
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
        /* 新增：功能按钮样式 */
        .action-btn {
            background-color: #e67e22;
            color: white;
            border: none;
            padding: 6px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
            transition: background 0.2s;
            text-align: center;
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
                <span class="header-text">360监控助手 V6</span>
                <span class="toggle-btn">➖</span>
            </div>
            <div class="panel-content">
                <!-- 状态区 -->
                <div>状态: <span id="${PANEL_ID}-status" class="status-running">扫描中...</span></div>
                
                <!-- 功能区 -->
                <button id="${PANEL_ID}-toggle-cam" class="action-btn">👁️ 隐藏云台控制器</button>

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
        document.getElementById(`${PANEL_ID}-toggle-cam`).onclick = toggleController;
    }

    // === 功能：显隐云台控制器 (健壮版) ===
    function toggleController() {
        const btn = document.getElementById(`${PANEL_ID}-toggle-cam`);
        
        // 健壮性选择器：
        // 1. 优先找 .rotatebox
        // 2. 验证它内部是否包含 .rotate 或 .sector，确保不是页面上其他同名元素
        let target = null;
        const boxes = document.querySelectorAll('.rotatebox');
        
        for (let box of boxes) {
            // 检查子元素特征，确保这是我们要找的那个云台
            if (box.querySelector('.rotate') || box.querySelector('.sector')) {
                target = box;
                break;
            }
        }

        if (!target) {
            log("未检测到云台，请先选择摄像头", "#f39c12");
            return;
        }

        // 切换显示状态
        if (target.style.display === 'none') {
            // 当前是隐藏的，改为显示
            target.style.display = ''; 
            btn.innerText = "👁️ 隐藏云台控制器";
            btn.classList.remove('hidden-mode');
            log("已恢复显示云台", "#3498db");
        } else {
            // 当前是显示的，改为隐藏
            target.style.display = 'none';
            btn.innerText = "🙈 显示云台控制器";
            btn.classList.add('hidden-mode');
            log("已隐藏云台遮挡", "#9b59b6");
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
        log("脚本 V6 已加载 (含云台控制)");
        setInterval(checkAndClick, 2000);
    }, 1500);

})();
