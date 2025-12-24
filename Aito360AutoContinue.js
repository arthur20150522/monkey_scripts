// ==UserScript==
// @name         360视觉云 - 显式控制面板 (V16.0 网页全屏旋转版)
// @namespace    http://tampermonkey.net/
// @version      16.0
// @description  [新增] 网页全屏下的视频旋转功能；[优化] 支持点击锁定单一视频窗口进行旋转；[修复] 之前的拖拽稳定性。
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
    const AUTO_HIDE_DELAY = 10000;
    const PANEL_WIDTH = 230;
    const ICON_SIZE = 48;

    // === 全局状态 ===
    let isUserHiddenMode = false;
    let isWebFullscreen = false;
    let autoHideTimer = null;
    let isPanelHovered = false;
    let hasMoved = false;
    let selectedVideoItem = null; // 当前选中的视频窗口

    // === CSS 样式 ===
    const css = `
        /* 强制隐藏类 */
        .${HIDE_CLASS} { display: none !important; }

        /* 面板容器 */
        #${PANEL_ID} {
            position: fixed;
            top: 160px;
            left: calc(100% - 250px);
            width: ${PANEL_WIDTH}px;
            background: #2c3e50;
            color: #ecf0f1;
            z-index: 2147483647 !important;
            border-radius: 6px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.7);
            font-family: "Microsoft YaHei", sans-serif;
            font-size: 12px;
            transition: opacity 0.2s, border-radius 0.2s;
            overflow: hidden;
            border: 1px solid #34495e;
            user-select: none;
            box-sizing: border-box;
        }

        #${PANEL_ID}.minimized {
            width: ${ICON_SIZE}px;
            height: ${ICON_SIZE}px;
            border-radius: 50%;
            cursor: pointer;
            border: 3px solid #27ae60;
            background: #2c3e50;
            opacity: 0.9;
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
            height: 40px;
            box-sizing: border-box;
        }

        #${PANEL_ID}.minimized .panel-header { padding: 0; height: 100%; width: 100%; justify-content: center; border: none; background: transparent; }
        #${PANEL_ID}.minimized::after { content: "🛡️"; font-size: 24px; line-height: ${ICON_SIZE-6}px; text-align: center; width: 100%; display: block; pointer-events: none; }
        #${PANEL_ID}.minimized .header-text, #${PANEL_ID}.minimized .toggle-btn, #${PANEL_ID}.minimized .panel-content { display: none !important; }

        /* 内容区域 */
        #${PANEL_ID} .panel-content { padding: 10px; display: flex; flex-direction: column; gap: 8px; }

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
        .action-btn:disabled { background-color: #444 !important; cursor: not-allowed; opacity: 0.6; }
        .fullscreen-btn { background-color: #3498db; }
        .rotate-btn { background-color: #9b59b6; }
        .rotate-btn:hover { background-color: #8e44ad; }

        .setting-row { display: flex; align-items: center; gap: 5px; color: #bdc3c7; font-size: 11px; border-bottom: 1px dashed #444; padding-bottom: 5px; }

        .log-box {
            height: 90px; background: #1a252f; border: 1px solid #34495e;
            overflow-y: auto; padding: 6px; color: #bdc3c7;
            font-family: monospace; font-size: 11px;
        }

        /* 视频旋转相关 */
        .tm-video-selected { outline: 3px solid #3498db !important; z-index: 10001 !important; }
        .video-rotate-container { transition: transform 0.3s ease; transform-origin: center center; }

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
    `;

    if (typeof GM_addStyle !== "undefined") { GM_addStyle(css); } else {
        const style = document.createElement('style');
        style.innerHTML = css;
        document.head.appendChild(style);
    }

    // === 主程序 ===
    function init() {
        createPanel();
        setInterval(checkAndClick, 2000);
        setupVideoSelector(); // 视频选择监听
        log("脚本 V16.0 加载成功");
    }

    // === UI 构建 ===
    function createPanel() {
        if (document.getElementById(PANEL_ID)) return;

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.innerHTML = `
            <div class="panel-header">
                <span class="header-text">360控制台 V16</span>
                <span class="toggle-btn">➖</span>
            </div>
            <div class="panel-content">
                <div class="setting-row">
                    <input type="checkbox" id="${PANEL_ID}-autohide" checked>
                    <label for="${PANEL_ID}-autohide" style="cursor:pointer">10秒自动收起</label>
                </div>
                
                <button id="${PANEL_ID}-toggle-fullscreen" class="action-btn fullscreen-btn">
                    <span>📺</span> 开启沉浸全屏
                </button>

                <button id="${PANEL_ID}-rotate" class="action-btn rotate-btn" disabled>
                    <span>🔄</span> 旋转选中视频 (仅全屏)
                </button>

                <button id="${PANEL_ID}-toggle-all" class="action-btn">
                    <span>👁️</span> 显示/隐藏控制栏
                </button>

                <div class="log-box" id="${PANEL_ID}-log"></div>
            </div>
        `;
        document.body.appendChild(panel);

        // 逻辑绑定
        const header = panel.querySelector('.panel-header');
        setupDraggable(panel, header);

        header.addEventListener('click', (e) => {
            if (hasMoved) return;
            if (panel.classList.contains('minimized')) {
                ensureVisibleOnScreen(panel);
                panel.classList.remove('minimized');
                resetAutoHideTimer();
            }
        });

        panel.querySelector('.toggle-btn').onclick = (e) => {
            e.stopPropagation();
            panel.classList.add('minimized');
        };

        // 自动隐藏逻辑
        panel.onmouseenter = () => { isPanelHovered = true; if(autoHideTimer) clearTimeout(autoHideTimer); };
        panel.onmouseleave = () => { isPanelHovered = false; resetAutoHideTimer(); };
        document.getElementById(`${PANEL_ID}-autohide`).onchange = resetAutoHideTimer;

        // 功能按键
        document.getElementById(`${PANEL_ID}-toggle-fullscreen`).onclick = toggleWebFullscreen;
        document.getElementById(`${PANEL_ID}-rotate`).onclick = rotateSelectedVideo;
        document.getElementById(`${PANEL_ID}-toggle-all`).onclick = () => toggleUserHiddenMode();

        resetAutoHideTimer();
    }

    // === 视频选择功能 ===
    function setupVideoSelector() {
        document.addEventListener('click', (e) => {
            // 查找点击的是否是视频窗口
            const item = e.target.closest('.monitor-grid-item, .play, .monitor-content');
            if (item && isWebFullscreen) {
                // 清除之前的选择
                if (selectedVideoItem) selectedVideoItem.classList.remove('tm-video-selected');
                
                selectedVideoItem = item;
                selectedVideoItem.classList.add('tm-video-selected');
                log("已锁定当前窗口", "#3498db");
            }
        }, true);
    }

    // === 旋转逻辑 ===
    function rotateSelectedVideo() {
        if (!isWebFullscreen) return;
        if (!selectedVideoItem) {
            log("请先点击选中一个视频窗格", "#e74c3c");
            return;
        }

        // 找到实际承载画面的 video 或其容器
        let target = selectedVideoItem.querySelector('video') || selectedVideoItem;
        
        // 获取当前旋转角度
        let currentRotate = parseInt(selectedVideoItem.getAttribute('data-tm-rotate') || "0");
        currentRotate = (currentRotate + 90) % 360;
        selectedVideoItem.setAttribute('data-tm-rotate', currentRotate);

        // 应用变换
        // 90度和270度时，需要缩小比例防止画面溢出（surveillance视频通常是16:9）
        let scale = "1";
        if (currentRotate === 90 || currentRotate === 270) {
            scale = "0.56"; // 9/16 的近似值，确保长边不超出短边容器
        }

        target.style.transition = "transform 0.3s ease";
        target.style.transform = `rotate(${currentRotate}deg) scale(${scale})`;
        
        log(`旋转至: ${currentRotate}°`, "#9b59b6");
    }

    // === 全屏逻辑 ===
    function toggleWebFullscreen() {
        const btn = document.getElementById(`${PANEL_ID}-toggle-fullscreen`);
        const rotateBtn = document.getElementById(`${PANEL_ID}-rotate`);
        isWebFullscreen = !isWebFullscreen;

        if (isWebFullscreen) {
            document.body.classList.add('tm-web-fullscreen');
            btn.classList.add('active');
            btn.innerHTML = "<span>❌</span> 退出全屏";
            rotateBtn.disabled = false;
            if (!isUserHiddenMode) toggleUserHiddenMode(true);
            log("沉浸全屏已开启，点击视频后可旋转", "#2ecc71");
        } else {
            document.body.classList.remove('tm-web-fullscreen');
            btn.classList.remove('active');
            btn.innerHTML = "<span>📺</span> 开启沉浸全屏";
            rotateBtn.disabled = true;
            if (selectedVideoItem) {
                selectedVideoItem.classList.remove('tm-video-selected');
                // 还原旋转
                let target = selectedVideoItem.querySelector('video') || selectedVideoItem;
                target.style.transform = "none";
                selectedVideoItem.setAttribute('data-tm-rotate', "0");
            }
            log("已退出全屏并重置旋转", "#7f8c8d");
        }
        setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
    }

    // === 基础工具函数 (保留自 V15) ===
    function setupDraggable(element, handle) {
        let startX, startY, initialLeft, initialTop;
        handle.onmousedown = function(e) {
            if (e.target.classList.contains('toggle-btn')) return;
            e.preventDefault();
            startX = e.clientX; startY = e.clientY;
            const rect = element.getBoundingClientRect();
            initialLeft = rect.left; initialTop = rect.top;
            hasMoved = false;
            document.onmousemove = function(e) {
                const dx = e.clientX - startX; const dy = e.clientY - startY;
                if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasMoved = true;
                if (hasMoved) {
                    element.style.left = `${initialLeft + dx}px`;
                    element.style.top = `${initialTop + dy}px`;
                    element.style.right = 'auto';
                }
            };
            document.onmouseup = function() {
                document.onmousemove = null;
                document.onmouseup = null;
                if (!isPanelHovered) resetAutoHideTimer();
            };
        };
    }

    function ensureVisibleOnScreen(panel) {
        const winWidth = window.innerWidth;
        const rect = panel.getBoundingClientRect();
        if (rect.left + PANEL_WIDTH > winWidth) panel.style.left = (winWidth - PANEL_WIDTH - 20) + 'px';
        if (rect.top < 0) panel.style.top = '10px';
    }

    function resetAutoHideTimer() {
        const panel = document.getElementById(PANEL_ID);
        const cb = document.getElementById(`${PANEL_ID}-autohide`);
        if (autoHideTimer) clearTimeout(autoHideTimer);
        if (cb && cb.checked && !isPanelHovered && panel && !panel.classList.contains('minimized')) {
            autoHideTimer = setTimeout(() => panel.classList.add('minimized'), AUTO_HIDE_DELAY);
        }
    }

    function toggleUserHiddenMode(forceHide) {
        isUserHiddenMode = (typeof forceHide === 'boolean') ? forceHide : !isUserHiddenMode;
        const btn = document.getElementById(`${PANEL_ID}-toggle-all`);
        const targets = [...document.querySelectorAll('.rotatebox, div[class*="controlsBot"]')];
        targets.forEach(el => isUserHiddenMode ? el.classList.add(HIDE_CLASS) : el.classList.remove(HIDE_CLASS));
        btn.querySelector('span').innerText = isUserHiddenMode ? "🙈" : "👁️";
        btn.style.backgroundColor = isUserHiddenMode ? "#7f8c8d" : "#e67e22";
    }

    function checkAndClick() {
        const popup = document.querySelector('.offlinebox.playcountdown');
        if (popup && popup.style.display !== 'none') {
            const btns = popup.querySelectorAll('button, span');
            for (let b of btns) {
                if (BUTTON_KEYWORDS.includes(b.innerText.trim())) {
                    log("检测到中断，正在恢复...");
                    b.click();
                    break;
                }
            }
        }
    }

    function log(msg, color="#bdc3c7") {
        const logBox = document.getElementById(`${PANEL_ID}-log`);
        if (!logBox) return;
        const div = document.createElement('div');
        div.innerHTML = `<span style="color:#7f8c8d">[${new Date().toLocaleTimeString()}]</span> <span style="color:${color}">${msg}</span>`;
        logBox.insertBefore(div, logBox.firstChild);
        if (logBox.children.length > 30) logBox.lastChild.remove();
    }

    setTimeout(init, 1500);
})();
