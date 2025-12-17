// ==UserScript==
// @name         360视觉云 - 显式控制面板 (V5.0稳定版)
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  在屏幕右侧显示可伸缩面板，直接锁定并点击"继续播放"按钮，修复长时间运行后失效的问题。
// @author       Assistant
// @match        *://*.360.cn/*
// @match        *://*.360.com/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // === 配置 ===
    // 核心关键词（按钮上只要包含这些字就点）
    const BUTTON_KEYWORDS = ["继续播放", "继续观看", "恢复播放"];
    const PANEL_ID = "my-360-control-panel";
    
    // 防抖动设置：点击后多少毫秒内不再重复点击
    const CLICK_COOLDOWN = 10000; 
    let lastClickTime = 0;

    // === UI 样式 (保持不变，确保层级最高) ===
    const css = `
        #${PANEL_ID} {
            position: fixed;
            top: 150px;
            right: 10px;
            width: 220px; /* 稍微宽一点 */
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
        }
        #${PANEL_ID}.minimized .panel-content {
            display: none;
        }
        .log-box {
            height: 120px;
            background: #1a252f;
            border: 1px solid #34495e;
            overflow-y: auto;
            margin-top: 8px;
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
                <span class="header-text">360监控助手 V5</span>
                <span class="toggle-btn">➖</span>
            </div>
            <div class="panel-content">
                <div>状态: <span id="${PANEL_ID}-status" class="status-running">扫描中...</span></div>
                <div style="margin-top:4px">扫描次数: <span id="${PANEL_ID}-count">0</span></div>
                <div class="log-box" id="${PANEL_ID}-log"></div>
            </div>
        `;
        document.body.appendChild(panel);

        panel.querySelector('.panel-header').onclick = () => {
            panel.classList.toggle('minimized');
        };
    }

    // === 日志系统 ===
    function log(msg, color="#bdc3c7") {
        const logBox = document.getElementById(`${PANEL_ID}-log`);
        if (!logBox) return;

        const time = new Date().toLocaleTimeString('zh-CN', {hour12: false});
        const div = document.createElement('div');
        div.innerHTML = `<span style="color:#7f8c8d">[${time}]</span> <span style="color:${color}">${msg}</span>`;
        
        // 始终插入到最上面
        logBox.insertBefore(div, logBox.firstChild);
        
        // 保持日志只有50行，防止内存溢出
        if (logBox.children.length > 50) logBox.lastChild.remove();
    }

    // === 核心逻辑 (修复版) ===
    let checkCount = 0;

    function checkAndClick() {
        // 1. 维护面板
        if (!document.getElementById(PANEL_ID)) createPanel();
        
        checkCount++;
        // 降低更新UI频率，每5次扫描才更新一次数字，提升性能
        if (checkCount % 5 === 0) {
            const countSpan = document.getElementById(`${PANEL_ID}-count`);
            if (countSpan) countSpan.innerText = checkCount;
        }

        // 2. 检查冷却时间 (防止同一个按钮被疯狂连点)
        const now = Date.now();
        if (now - lastClickTime < CLICK_COOLDOWN) {
            return;
        }
        
        // 恢复状态显示
        const statusSpan = document.getElementById(`${PANEL_ID}-status`);
        if (statusSpan && statusSpan.innerText !== "扫描中...") {
            statusSpan.innerText = "扫描中...";
            statusSpan.className = "status-running";
        }

        // 3. 直接寻找按钮 (不再检测上下文，这最稳)
        // 使用更广泛的选择器，防止漏网之鱼
        const candidates = document.querySelectorAll('button, div, span, a');
        
        for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i];
            
            // 性能优化：先判断是否可见，不可见直接跳过
            if (el.offsetParent === null) continue;
            
            // 获取文本
            const text = el.innerText ? el.innerText.trim() : "";
            if (!text) continue;

            // 匹配关键词
            if (BUTTON_KEYWORDS.includes(text)) {
                
                log(`发现目标: "${text}"`, "#e74c3c"); // 红色高亮日志
                
                try {
                    // 尝试点击
                    el.click();
                    
                    // 记录时间和状态
                    lastClickTime = Date.now();
                    log("✅ 已触发点击指令", "#2ecc71"); // 绿色成功日志
                    
                    // 更新面板状态
                    if(statusSpan) {
                        statusSpan.innerText = "等待冷却...";
                        statusSpan.className = "status-cooldown";
                    }

                    // 既然点到了，就不用继续循环了
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
        log("脚本 V5 已加载 (强力模式)");
        // 每 2 秒扫描一次，频率加快一点点
        setInterval(checkAndClick, 2000);
    }, 1500);

})();
