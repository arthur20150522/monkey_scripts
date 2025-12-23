// ==UserScript==
// @name         360视觉云 - 显式控制面板 (V15.0 旗舰优化版)
// @namespace    http://tampermonkey.net/
// @version      15.0
// @description  [修复] 悬浮球点击不灵敏问题；[修复] 右侧展开时面板溢出屏幕问题；[新增] 智能边缘吸附检测。
// @author       Assistant
// @match        *://*.360.cn/*
// @match        *://*.360.com/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // === 配置常量 ===
    const BUTTON_KEYWORDS = ["继续播放", "继续观看", "恢复播放"];
    const PANEL_ID = "my-360-control-panel";
    const HIDE_CLASS = "tm-force-hide-element";
    const AUTO_HIDE_DELAY = 10000; // 10秒
    const PANEL_WIDTH = 230; // 面板展开宽度
    const ICON_SIZE = 48;    // 图标大小

    // === 全局状态 ===
    let isUserHiddenMode = false;
    let isWebFullscreen = false;
    let autoHideTimer = null;
    let isPanelHovered = false;
    let hasMoved = false; // 用于区分点击和拖拽

    // === CSS 样式 ===
    const css = `
        /* 强制隐藏类 */
        .${HIDE_CLASS} { display: none !important; }

        /* 面板容器 */
        #${PANEL_ID} {
            position: fixed;
            top: 160px;
            left: calc(100% - 250px); /* 默认初始位置 */
            width: ${PANEL_WIDTH}px;
            background: #2c3e50;
            color: #ecf0f1;
            z-index: 2147483647 !important;
            border-radius: 6px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.7);
            font-family: "Microsoft YaHei", sans-serif;
            font-size: 12px;
            /* 移除 transition 中的 width/left，避免拖拽时的延迟感，仅保留 opacity/radius */
            transition: opacity 0.2s, border-radius 0.2s;
            overflow: hidden;
            border: 1px solid #34495e;
            user-select: none;
            box-sizing: border-box;
        }

        /* 最小化状态 */
        #${PANEL_ID}.minimized {
            width: ${ICON_SIZE}px;
            height: ${ICON_SIZE}px;
            border-radius: 50%;
            cursor: pointer;
            border: 3px solid #27ae60;
            background: #2c3e50;
            opacity: 0.9;
        }
        #${PANEL_ID}.minimized:hover {
            opacity: 1;
            transform: scale(1.05); /* 悬停微放大 */
        }

        /* 头部区域 */
        #${PANEL_ID} .panel-header {
            padding: 10px;
            background: #34495e;
            cursor: move;
            font-weight: bold;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #465f76;
            height: 40px;
            box-sizing: border-box;
        }

        /* 最小化后的头部（隐形覆盖层）*/
        #${PANEL_ID}.minimized .panel-header {
            padding: 0;
            height: 100%;
            width: 100%;
            justify-content: center;
            border: none;
            background: transparent;
        }

        /* 最小化图标 */
        #${PANEL_ID}.minimized::after {
            content: "🛡️";
            font-size: 24px;
            line-height: ${ICON_SIZE-6}px; /* 减去边框 */
            text-align: center;
            width: 100%;
            display: block;
            pointer-events: none; /* 让点击穿透到 header */
        }

        /* 隐藏内容 */
        #${PANEL_ID}.minimized .header-text, 
        #${PANEL_ID}.minimized .toggle-btn,
        #${PANEL_ID}.minimized .panel-content { display: none !important; }

        /* 内容区域 */
        #${PANEL_ID} .panel-content {
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        /* 按钮样式 */
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
        .fullscreen-btn { background-color: #3498db; }
        .fullscreen-btn:hover { background-color: #2980b9; }
        .fullscreen-btn.active { background-color: #e74c3c; }

        .setting-row {
            display: flex; align-items: center; gap: 5px;
            color: #bdc3c7; font-size: 11px; padding-bottom: 5px;
            border-bottom: 1px dashed #444; margin-bottom: 5px;
        }
        .setting-row input { cursor: pointer; }

        .log-box {
            height: 100px; background: #1a252f; border: 1px solid #34495e;
            overflow-y: auto; padding: 6px; color: #bdc3c7;
            font-family: monospace; font-size: 11px; line-height: 1.5;
        }
        .log-box::-webkit-scrollbar { width: 4px; }
        .log-box::-webkit-scrollbar-thumb { background: #555; border-radius: 2px; }
        .status-running { color: #2ecc71; font-weight: bold; }

        /* 沉浸式全屏 */
        body.tm-web-fullscreen { overflow: hidden !important; background-color: #000 !important; }
        body.tm-web-fullscreen .navbar, 
        body.tm-web-fullscreen .sidebar-logo-container,
        body.tm-web-fullscreen .device-list-container,
        body.tm-web-fullscreen .monitor-top,
        body.tm-web-fullscreen .g-sdk { display: none !important; }
        body.tm-web-fullscreen .app-wrapper,
        body.tm-web-fullscreen .main-container,
        body.tm-web-fullscreen .app-main,
        body.tm-web-fullscreen .play,
        body.tm-web-fullscreen .monitor,
        body.tm-web-fullscreen .device-main-container,
        body.tm-web-fullscreen .device-inner-container,
        body.tm-web-fullscreen .monitor-container,
        body.tm-web-fullscreen .monitor-content {
            position: fixed !important; top: 0 !important; left: 0 !important;
            width: 100vw !important; height: 100vh !important;
            margin: 0 !important; padding: 0 !important;
            z-index: 9999 !important; background: #000 !important;
        }
        body.tm-web-fullscreen .monitor-grid { width: 100% !important; height: 100% !important; }
        body.tm-web-fullscreen .monitor-grid-item { height: auto !important; flex: 1 1 auto !important; }
    `;

    if (typeof GM_addStyle !== "undefined") {
        GM_addStyle(css);
    } else {
        const style = document.createElement('style');
        style.innerHTML = css;
        document.head.appendChild(style);
    }

    // === 主程序 ===
    function init() {
        createPanel();
        setInterval(checkAndClick, 2000);
        log("脚本 V15.0 已加载 (旗舰优化版)");
    }

    // === UI 构建 ===
    function createPanel() {
        if (document.getElementById(PANEL_ID)) return;

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.innerHTML = `
            <div class="panel-header">
                <span class="header-text">360监控 V15</span>
                <span class="toggle-btn" title="点击收起">➖</span>
            </div>
            <div class="panel-content">
                <div class="setting-row">
                    <input type="checkbox" id="${PANEL_ID}-autohide" checked>
                    <label for="${PANEL_ID}-autohide" style="cursor:pointer">空闲10秒自动收起</label>
                </div>
                <div>状态: <span id="${PANEL_ID}-status" class="status-running">监控中...</span></div>
                
                <button id="${PANEL_ID}-toggle-fullscreen" class="action-btn fullscreen-btn">
                    <span>📺</span> 沉浸式网页全屏
                </button>

                <button id="${PANEL_ID}-toggle-all" class="action-btn">
                    <span>👁️</span> 显示/隐藏控制栏
                </button>

                <div class="log-box" id="${PANEL_ID}-log"></div>
            </div>
        `;
        document.body.appendChild(panel);

        // --- 逻辑绑定 ---
        const header = panel.querySelector('.panel-header');
        const toggleBtn = panel.querySelector('.toggle-btn');
        const autoHideCb = document.getElementById(`${PANEL_ID}-autohide`);

        // 1. 拖拽优化 (解决点击不灵敏的核心)
        setupDraggable(panel, header);

        // 2. 展开/收起逻辑
        const toggleMinimize = (e) => {
            // 如果发生了拖拽位移，则视为拖拽，不触发点击
            if (hasMoved) return;

            if (e) e.stopPropagation();
            const isMinimizing = !panel.classList.contains('minimized');
            
            if (isMinimizing) {
                // 收起
                panel.classList.add('minimized');
            } else {
                // 展开：执行智能边缘检测
                ensureVisibleOnScreen(panel);
                panel.classList.remove('minimized');
                resetAutoHideTimer(); // 展开时重置计时
            }
        };

        // 绑定点击事件
        // 注意：这里把点击事件绑在 header 上，因为最小化时 header 占满全圆
        header.addEventListener('click', toggleMinimize);
        toggleBtn.addEventListener('click', (e) => {
            // 强制收起，不需要判断移动
            e.stopPropagation();
            panel.classList.add('minimized');
        });

        // 3. 自动收起逻辑
        panel.addEventListener('mouseenter', () => {
            isPanelHovered = true;
            if (autoHideTimer) clearTimeout(autoHideTimer);
        });
        panel.addEventListener('mouseleave', () => {
            isPanelHovered = false;
            resetAutoHideTimer();
        });
        autoHideCb.onchange = resetAutoHideTimer;
        resetAutoHideTimer(); // 初始启动

        // 4. 功能按钮
        document.getElementById(`${PANEL_ID}-toggle-all`).onclick = () => toggleUserHiddenMode();
        document.getElementById(`${PANEL_ID}-toggle-fullscreen`).onclick = toggleWebFullscreen;
    }

    // === 核心优化：智能边缘检测 (确保展开时不跑出屏幕) ===
    function ensureVisibleOnScreen(panel) {
        const rect = panel.getBoundingClientRect();
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;

        // 计算当前位置
        let newLeft = rect.left;
        let newTop = rect.top;

        // 1. 检查右边缘：如果 (当前左边距 + 展开宽度) > 屏幕宽度
        if (newLeft + PANEL_WIDTH > winWidth) {
            // 向左移动，紧贴右边缘（留10px间隙）
            newLeft = winWidth - PANEL_WIDTH - 10;
        }

        // 2. 检查下边缘
        // 假设展开后高度大概 200px，防止底部被遮挡
        if (newTop + 200 > winHeight) {
            newTop = winHeight - 220; 
        }

        // 3. 检查左/上边缘（防止负数）
        if (newLeft < 0) newLeft = 10;
        if (newTop < 0) newTop = 10;

        // 应用修正后的坐标
        panel.style.left = newLeft + 'px';
        panel.style.top = newTop + 'px';
        panel.style.right = 'auto'; // 清除可能存在的 right 属性
    }

    // === 核心优化：拖拽系统 (加入防抖动) ===
    function setupDraggable(element, handle) {
        let startX, startY, initialLeft, initialTop;
        
        handle.onmousedown = function(e) {
            // 忽略功能按钮的点击
            if (e.target.classList.contains('toggle-btn')) return;

            e.preventDefault();
            
            startX = e.clientX;
            startY = e.clientY;
            
            // 获取当前计算后的位置
            const rect = element.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            // 重置移动标记 (核心：只有移动超过阈值才算拖拽)
            hasMoved = false;

            // 暂停自动隐藏
            if(autoHideTimer) clearTimeout(autoHideTimer);

            document.onmousemove = function(e) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;

                // 防抖阈值：移动超过 5px 才视为拖拽
                if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                    hasMoved = true;
                }

                if (hasMoved) {
                    // 只有确认是拖拽了，才移动元素
                    element.style.left = `${initialLeft + dx}px`;
                    element.style.top = `${initialTop + dy}px`;
                    element.style.right = 'auto'; // 清除right，完全由left控制
                }
            };

            document.onmouseup = function() {
                document.onmousemove = null;
                document.onmouseup = null;
                
                // 拖拽结束，如果不是悬停状态，重启计时
                if (!isPanelHovered) resetAutoHideTimer();
            };
        };
    }

    // === 显隐控制 (使用 CSS Class) ===
    function applyVisibility(shouldHide) {
        const targets = [];
        document.querySelectorAll('.rotatebox').forEach(box => {
            if (box.querySelector('.rotate')) targets.push(box);
        });
        document.querySelectorAll('div[class*="controlsBot"]').forEach(bar => {
            targets.push(bar);
        });

        targets.forEach(el => {
            if (shouldHide) el.classList.add(HIDE_CLASS);
            else el.classList.remove(HIDE_CLASS);
        });
    }

    function toggleUserHiddenMode(forceHide) {
        const btn = document.getElementById(`${PANEL_ID}-toggle-all`);
        
        if (typeof forceHide === 'boolean') {
            isUserHiddenMode = forceHide;
        } else {
            isUserHiddenMode = !isUserHiddenMode;
        }
        
        applyVisibility(isUserHiddenMode);

        if (isUserHiddenMode) {
            btn.classList.add('hidden-mode');
            btn.querySelector('span').innerText = "🙈";
            if (!isWebFullscreen) log(`已隐藏干扰控件`, "#9b59b6");
        } else {
            btn.classList.remove('hidden-mode');
            btn.querySelector('span').innerText = "👁️";
            log("已恢复显示", "#3498db");
        }
    }

    // === 自动点击逻辑 ===
    function checkAndClick() {
        if (!document.getElementById(PANEL_ID)) createPanel();

        const visiblePopups = Array.from(document.querySelectorAll('.offlinebox.playcountdown'))
            .filter(el => el.style.display !== 'none' && el.offsetParent !== null);
        
        if (visiblePopups.length === 0) return;

        visiblePopups.forEach(popup => {
            const buttons = popup.querySelectorAll('button, span');
            for (let btn of buttons) {
                const text = btn.innerText ? btn.innerText.trim() : "";
                if (BUTTON_KEYWORDS.includes(text)) {
                    let target = btn;
                    if (target.tagName === 'SPAN' && target.parentElement.tagName === 'BUTTON') {
                        target = target.parentElement;
                    }

                    log(`检测到中断，正在恢复...`, "#e74c3c");
                    applyVisibility(true);
                    try {
                        target.onclick = function(e) { if(e) { e.stopPropagation(); e.stopImmediatePropagation(); } };
                        target.click();
                        log("✅ 点击成功", "#2ecc71");
                        startSuppression();
                    } catch (e) { console.error(e); }
                    break;
                }
            }
        });
    }

    // 压制器
    let suppressionTimer = null;
    function startSuppression() {
        if (suppressionTimer) return;
        let count = 0;
        suppressionTimer = setInterval(() => {
            applyVisibility(true);
            count++;
            if (count > 40) {
                clearInterval(suppressionTimer);
                suppressionTimer = null;
                applyVisibility(isUserHiddenMode);
            }
        }, 50);
    }

    // === 自动隐藏计时 ===
    function resetAutoHideTimer() {
        const panel = document.getElementById(PANEL_ID);
        const cb = document.getElementById(`${PANEL_ID}-autohide`);
        if (autoHideTimer) clearTimeout(autoHideTimer);

        if (cb && cb.checked && !isPanelHovered && panel && !panel.classList.contains('minimized')) {
            autoHideTimer = setTimeout(() => {
                panel.classList.add('minimized');
            }, AUTO_HIDE_DELAY);
        }
    }

    // === 网页全屏 ===
    function toggleWebFullscreen() {
        const btn = document.getElementById(`${PANEL_ID}-toggle-fullscreen`);
        isWebFullscreen = !isWebFullscreen;

        if (isWebFullscreen) {
            document.body.classList.add('tm-web-fullscreen');
            btn.classList.add('active');
            btn.querySelector('span').innerText = "❌";
            btn.childNodes[2].textContent = " 退出全屏";
            if (!isUserHiddenMode) toggleUserHiddenMode(true); 
            setTimeout(() => window.dispatchEvent(new Event('resize')), 200);
            log("进入沉浸模式", "#3498db");
        } else {
            document.body.classList.remove('tm-web-fullscreen');
            btn.classList.remove('active');
            btn.querySelector('span').innerText = "📺";
            btn.childNodes[2].textContent = " 沉浸式网页全屏";
            setTimeout(() => window.dispatchEvent(new Event('resize')), 200);
            log("已退出全屏", "#7f8c8d");
        }
    }

    function log(msg, color="#bdc3c7") {
        const logBox = document.getElementById(`${PANEL_ID}-log`);
        if (!logBox) return;
        const time = new Date().toLocaleTimeString('zh-CN', {hour12: false});
        const div = document.createElement('div');
        div.innerHTML = `<span style="color:#7f8c8d">[${time}]</span> <span style="color:${color}">${msg}</span>`;
        logBox.insertBefore(div, logBox.firstChild);
        if (logBox.children.length > 50) logBox.lastChild.remove();
    }

    setTimeout(init, 1500);
})();
