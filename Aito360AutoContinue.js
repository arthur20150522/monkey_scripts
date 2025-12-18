// ==UserScript==
// @name         360视觉云 - 显式控制面板 (V9.0 源码适配版)
// @namespace    http://tampermonkey.net/
// @version      9.0
// @description  自动点击"继续播放"弹窗，并提供一键隐藏/显示页面遮挡元素（云台、底部控制栏）的功能。基于HTML源码分析优化：精准锁定ElementUI按钮，强力阻止事件冒泡，彻底解决误触云台问题。
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
    const CLICK_COOLDOWN = 5000; // 冷却时间5秒
    let lastClickTime = 0;
    let isHiddenMode = false; // 记录遮挡物是否被隐藏

    // === UI 样式 (层级调至 HTML 中观测到的最高值之上) ===
    const css = `
        #${PANEL_ID} {
            position: fixed;
            top: 160px;
            right: 15px;
            width: 230px;
            background: #2c3e50;
            color: #ecf0f1;
            z-index: 2147483647 !important; /* 确保最高层级 */
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
        /* 滚动条美化 */
        .log-box::-webkit-scrollbar { width: 4px; }
        .log-box::-webkit-scrollbar-thumb { background: #555; border-radius: 2px; }
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
                <span class="header-text">360监控助手 V9</span>
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
        document.getElementById(`${PANEL_ID}-toggle-all`).onclick = togglePageControls;
    }

    // === 功能：一键显隐页面控件 (基于源码特征) ===
    function togglePageControls() {
        const btn = document.getElementById(`${PANEL_ID}-toggle-all`);
        const targets = [];

        // 1. 寻找云台 (.rotatebox)
        document.querySelectorAll('.rotatebox').forEach(box => {
            // 源码特征：包含 rotate 类
            if (box.querySelector('.rotate')) targets.push(box);
        });

        // 2. 寻找底部栏 (controlsBot)
        // 源码特征：class包含 controlsBot 且内部有音量或全屏按钮
        document.querySelectorAll('div[class*="controlsBot"]').forEach(bar => {
            targets.push(bar);
        });

        if (targets.length === 0) {
            log("未找到遮挡控件 (可能未加载)", "#f39c12");
            return;
        }

        isHiddenMode = !isHiddenMode;
        
        targets.forEach(el => {
            // 使用 visibility 而不是 display，防止页面排版错乱（可选）
            // 这里仍用 display: none 比较彻底
            el.style.display = isHiddenMode ? 'none' : '';
        });

        if (isHiddenMode) {
            btn.classList.add('hidden-mode');
            btn.querySelector('span').innerText = "🙈";
            log(`已隐藏 ${targets.length} 个控件`, "#9b59b6");
        } else {
            btn.classList.remove('hidden-mode');
            btn.querySelector('span').innerText = "👁️";
            log("已恢复页面控件", "#3498db");
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

    // === 核心逻辑：精准点击 & 阻止冒泡 ===
    function checkAndClick() {
        if (!document.getElementById(PANEL_ID)) createPanel();
        if (Date.now() - lastClickTime < CLICK_COOLDOWN) return;

        // 状态复位
        const statusSpan = document.getElementById(`${PANEL_ID}-status`);
        if (statusSpan && statusSpan.innerText !== "扫描中...") {
            statusSpan.innerText = "扫描中...";
            statusSpan.className = "status-running";
        }

        // 源码特征：el-button 包含 span 文本
        // 我们查找所有可能的文本载体
        const elements = document.querySelectorAll('span, button');
        
        for (let i = 0; i < elements.length; i++) {
            let el = elements[i];
            
            // 1. 可见性检查
            if (el.offsetParent === null) continue;
            
            // 2. 文本匹配
            const text = el.innerText ? el.innerText.trim() : "";
            if (!BUTTON_KEYWORDS.includes(text)) continue;

            // === 3. 智能提升目标 (V9核心) ===
            // 如果找到的是 <span>继续播放</span>，而它爸爸是 <button>，那就点爸爸
            // 这样更符合 ElementUI 的事件绑定机制
            if (el.tagName === 'SPAN' && el.parentElement && el.parentElement.tagName === 'BUTTON') {
                el = el.parentElement;
                console.log("360监控助手：已修正点击目标为父级 Button");
            }

            // === 4. 执行点击 & 强力阻止冒泡 ===
            log(`发现目标: "${text}"`, "#e74c3c");
            
            try {
                // 方式 A: 覆盖 onclick 阻止冒泡
                el.onclick = function(e) {
                    if (e) {
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        e.preventDefault(); // 防止可能的默认跳转
                    }
                    console.log("360监控助手：已拦截冒泡");
                };

                // 方式 B: 原生点击
                el.click();
                
                lastClickTime = Date.now();
                log("✅ 点击成功 (已阻断云台触发)", "#2ecc71");
                
                if(statusSpan) {
                    statusSpan.innerText = "冷却中...";
                    statusSpan.className = "status-cooldown";
                }
                
                // 任务完成，退出循环
                break; 

            } catch (e) {
                log("❌ 点击报错: " + e.message, "red");
            }
        }
    }

    // === 启动 ===
    setTimeout(() => {
        createPanel();
        log("脚本 V9 已加载 (源码适配版)");
        // 2秒轮询一次，性能损耗极低
        setInterval(checkAndClick, 2000);
    }, 1500);

})();
