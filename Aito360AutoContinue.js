// ==UserScript==
// @name         360视觉云自动继续 - 显式控制面板
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  在屏幕右侧显示可伸缩面板，监控"继续播放"弹窗，解决看不见脚本运行状态的问题。
// @author       Alex_AI_CREATE
// @match        *://*.360.cn/*
// @match        *://*.360.com/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // === 配置 ===
    const TARGET_TEXT = "继续播放";
    const CONTEXT_TEXT = "视频播放很久了";
    const PANEL_ID = "my-360-control-panel";

    // === UI 样式 (强制高层级) ===
    const css = `
        #${PANEL_ID} {
            position: fixed;
            top: 150px;
            right: 10px;
            width: 200px;
            background: #333;
            color: #fff;
            z-index: 2147483647; /* 最大层级 */
            border-radius: 8px;
            box-shadow: 0 0 10px rgba(0,0,0,0.5);
            font-family: "Microsoft YaHei", sans-serif;
            font-size: 12px;
            transition: all 0.3s;
            overflow: hidden;
            border: 1px solid #555;
        }
        #${PANEL_ID}.minimized {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            cursor: pointer;
            right: 10px;
        }
        #${PANEL_ID} .panel-header {
            padding: 10px;
            background: #2980b9;
            cursor: pointer;
            font-weight: bold;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        #${PANEL_ID}.minimized .panel-header {
            padding: 0;
            height: 100%;
            justify-content: center;
            background: #27ae60; /* 收起时变绿 */
        }
        #${PANEL_ID}.minimized .header-text,
        #${PANEL_ID}.minimized .toggle-btn {
            display: none;
        }
        #${PANEL_ID}.minimized::after {
            content: "🤖";
            font-size: 20px;
            line-height: 40px;
            text-align: center;
            width: 100%;
        }
        #${PANEL_ID} .panel-content {
            padding: 10px;
        }
        #${PANEL_ID}.minimized .panel-content {
            display: none;
        }
        .log-box {
            height: 100px;
            background: #222;
            border: 1px solid #444;
            overflow-y: auto;
            margin-top: 5px;
            padding: 5px;
            color: #bbb;
            font-family: monospace;
        }
        .status-running { color: #2ecc71; font-weight: bold; }
        .status-clicked { color: #e74c3c; font-weight: bold; }
    `;

    // 注入 CSS
    if (typeof GM_addStyle !== "undefined") {
        GM_addStyle(css);
    } else {
        const style = document.createElement('style');
        style.innerHTML = css;
        document.head.appendChild(style);
    }

    // === UI 创建函数 ===
    function createPanel() {
        if (document.getElementById(PANEL_ID)) return; // 已存在则不创建

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.innerHTML = `
            <div class="panel-header" id="${PANEL_ID}-header">
                <span class="header-text">360监控助手</span>
                <span class="toggle-btn">➖</span>
            </div>
            <div class="panel-content">
                <div>状态: <span id="${PANEL_ID}-status" class="status-running">监控中...</span></div>
                <div>检测次数: <span id="${PANEL_ID}-count">0</span></div>
                <div class="log-box" id="${PANEL_ID}-log"></div>
                <div style="margin-top:5px; font-size:10px; color:#777;">如果不显示，请刷新页面</div>
            </div>
        `;
        document.body.appendChild(panel);

        // 绑定点击收起/展开
        const header = panel.querySelector('.panel-header');
        header.onclick = () => {
            panel.classList.toggle('minimized');
        };
    }

    // === 日志辅助函数 ===
    function log(msg, type="info") {
        const logBox = document.getElementById(`${PANEL_ID}-log`);
        const statusSpan = document.getElementById(`${PANEL_ID}-status`);
        if (!logBox) return;

        const time = new Date().toLocaleTimeString();
        const div = document.createElement('div');
        div.innerText = `[${time}] ${msg}`;
        div.style.color = type === "error" ? "#e74c3c" : (type === "success" ? "#2ecc71" : "#bbb");

        logBox.insertBefore(div, logBox.firstChild);
        if (logBox.children.length > 50) logBox.lastChild.remove();

        if (type === "success") {
            statusSpan.innerText = "已点击!";
            statusSpan.className = "status-clicked";
            // 3秒后恢复
            setTimeout(() => {
                const s = document.getElementById(`${PANEL_ID}-status`);
                if(s) {
                    s.innerText = "监控中...";
                    s.className = "status-running";
                }
            }, 3000);
        }
    }

    // === 核心逻辑 ===
    let checkCount = 0;

    function checkAndClick() {
        // 1. 确保面板存在 (防止SPA页面切换导致面板消失)
        if (!document.getElementById(PANEL_ID)) {
            createPanel();
        }

        // 更新扫描计数
        checkCount++;
        const countSpan = document.getElementById(`${PANEL_ID}-count`);
        if (countSpan && checkCount % 10 === 0) { // 每10次更新一次UI，减少闪烁
            countSpan.innerText = checkCount;
        }

        // 2. 检测弹窗文字
        const bodyText = document.body.innerText || "";
        if (bodyText.indexOf(CONTEXT_TEXT) === -1) {
            return; // 没看到“视频播放很久了”，不操作
        }

        // 3. 查找按钮
        const elements = document.querySelectorAll('button, div, span, a');
        for (let el of elements) {
            // 必须可见
            if (el.offsetParent === null) continue;

            let text = el.innerText ? el.innerText.trim() : "";
            if (text === TARGET_TEXT) {
                log(`发现目标: ${text}`, "success");

                try {
                    el.click();
                    log("已触发点击事件", "success");
                } catch (e) {
                    log("点击报错: " + e.message, "error");
                    // 补救措施
                    try {
                        const evt = document.createEvent("MouseEvents");
                        evt.initEvent("click", true, true);
                        el.dispatchEvent(evt);
                        log("已触发模拟点击", "success");
                    } catch(e2) {}
                }

                break; // 点击一次后跳出
            }
        }
    }

    // === 启动 ===
    // 延迟1秒启动，等待页面基本元素
    setTimeout(() => {
        createPanel();
        log("脚本已加载", "info");
        // 每3秒扫描一次
        setInterval(checkAndClick, 3000);
    }, 1000);

})();
