// ==UserScript==
// @name         360视觉云 - 显式控制面板 (V23.0 交互完善版)
// @namespace    http://tampermonkey.net/
// @version      23.0
// @description  [修复]悬浮球拖拽与点击；[新增]鼠标滚轮缩放；[优化]仅限中键平移；[保留]全屏黑屏修复、旋转、自动续播。
// @author       Assistant
// @match        *://*.360.cn/*
// @match        *://*.360.com/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const BUTTON_KEYWORDS = ["继续播放", "继续观看", "恢复播放"];
    const PANEL_ID = "my-360-control-panel";
    const HIDE_CLASS = "tm-force-hide-element";
    const ZOOM_STEP = 0.15;

    let isUserHiddenMode = false;
    let isWebFullscreen = false;
    let autoHideTimer = null;
    let isPanelHovered = false;
    let hasMoved = false; // 区分面板拖拽与点击

    // 变换状态
    let transformState = {
        el: null, 
        scale: 1,
        tx: 0,
        ty: 0,
        rotate: 0
    };

    let isPanning = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    const css = `
        .${HIDE_CLASS} { display: none !important; }

        /* 面板样式 */
        #${PANEL_ID} {
            position: fixed; top: 160px; left: calc(100% - 250px);
            width: 230px; background: #2c3e50; color: #ecf0f1;
            z-index: 2147483647 !important; border-radius: 6px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.8); font-family: "Microsoft YaHei", sans-serif;
            font-size: 12px; transition: opacity 0.2s, border-radius 0.2s; 
            border: 1px solid #34495e; overflow: visible;
        }
        
        /* 最小化状态（悬浮球） */
        #${PANEL_ID}.minimized { width: 48px; height: 48px; border-radius: 50%; cursor: pointer; border: 3px solid #27ae60; background: #2c3e50; overflow: hidden; }
        #${PANEL_ID}.minimized::after { content: "🛡️"; font-size: 24px; line-height: 42px; text-align: center; width: 100%; display: block; pointer-events: none; }
        
        #${PANEL_ID} .panel-header { padding: 10px; background: #34495e; cursor: move; display: flex; justify-content: space-between; align-items: center; height: 40px; box-sizing: border-box; }
        #${PANEL_ID}.minimized .header-text, 
        #${PANEL_ID}.minimized .toggle-btn, 
        #${PANEL_ID}.minimized .panel-content { display: none !important; }
        
        #${PANEL_ID} .panel-content { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
        .action-btn { background-color: #e67e22; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer; font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 5px; }
        .action-btn:hover { background-color: #d35400; }
        .fullscreen-btn { background-color: #3498db; }
        .rotate-btn { background-color: #9b59b6; }
        .log-box { height: 90px; background: #1a252f; border: 1px solid #34495e; overflow-y: auto; padding: 6px; color: #bdc3c7; font-size: 11px; }

        /* === 沉浸全屏修复 === */
        body.tm-web-fullscreen { overflow: hidden !important; background: #000 !important; }
        body.tm-web-fullscreen .navbar, body.tm-web-fullscreen .sidebar-logo-container, body.tm-web-fullscreen .device-list-container, body.tm-web-fullscreen .monitor-top, body.tm-web-fullscreen .g-sdk { display: none !important; }

        body.tm-web-fullscreen .monitor-grid-item.tm-video-selected {
            position: fixed !important; top: 0 !important; left: 0 !important;
            width: 100vw !important; height: 100vh !important;
            z-index: 2147483640 !important; background: #000 !important;
            display: flex !important; justify-content: center !important; align-items: center !important;
        }

        body.tm-web-fullscreen .tm-video-selected video {
            width: 100% !important; height: 100% !important;
            object-fit: contain !important; background: #000 !important;
            transform-origin: center center;
        }

        .tm-grabbing, .tm-grabbing * { cursor: grabbing !important; }
        .monitor-grid-item.tm-video-selected { outline: 3px solid #3498db; }
    `;

    if (typeof GM_addStyle !== "undefined") { GM_addStyle(css); } else {
        const style = document.createElement('style');
        style.innerHTML = css;
        document.head.appendChild(style);
    }

    function init() {
        createPanel();
        setupGlobalEvents();
        setInterval(checkAndClick, 2000);
        log("脚本 V23.0 已就绪", "#2ecc71");
    }

    // === 面板逻辑与拖拽修复 ===
    function createPanel() {
        if (document.getElementById(PANEL_ID)) return;
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.innerHTML = `
            <div class="panel-header"><span class="header-text">360交互控制 V23</span><span class="toggle-btn" title="点击收起">➖</span></div>
            <div class="panel-content">
                <button id="${PANEL_ID}-toggle-fullscreen" class="action-btn fullscreen-btn">📺 开启沉浸全屏</button>
                <button id="${PANEL_ID}-rotate" class="action-btn rotate-btn">🔄 画面旋转</button>
                <button id="${PANEL_ID}-toggle-all" class="action-btn">👁️ 隐藏干扰项</button>
                <div style="font-size:10px; color:#95a5a6; border-top:1px solid #444; padding-top:4px; line-height:1.4">
                    全屏操作(选中视频后):<br>
                    - <b>缩放</b>: 滚轮 或 Ctrl + [ / ] <br>
                    - <b>平移</b>: 按住<b>鼠标中键</b>拖拽<br>
                    - <b>重置</b>: Alt + R
                </div>
                <div class="log-box" id="${PANEL_ID}-log"></div>
            </div>
        `;
        document.body.appendChild(panel);

        const header = panel.querySelector('.panel-header');
        setupDraggable(panel, header);

        // 面板点击：如果不是在拖拽，则根据当前状态展开或收起
        panel.addEventListener('click', (e) => {
            if (hasMoved) return; // 如果发生了位移，不触发点击逻辑
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

        document.getElementById(`${PANEL_ID}-toggle-fullscreen`).onclick = toggleWebFullscreen;
        document.getElementById(`${PANEL_ID}-rotate`).onclick = rotateVideo;
        document.getElementById(`${PANEL_ID}-toggle-all`).onclick = () => toggleUserHiddenMode();

        panel.onmouseenter = () => { isPanelHovered = true; if(autoHideTimer) clearTimeout(autoHideTimer); };
        panel.onmouseleave = () => { isPanelHovered = false; resetAutoHideTimer(); };
        resetAutoHideTimer();
    }

    // === 核心逻辑：按键、中键平移与滚轮缩放 ===
    function setupGlobalEvents() {
        // 1. 键盘监听
        window.addEventListener('keydown', (e) => {
            if (e.altKey && e.key.toLowerCase() === 'r') { resetTransform(); log("重置成功", "#2ecc71"); }
            if (e.ctrlKey) {
                if (e.key === ']') { e.preventDefault(); changeZoom(ZOOM_STEP); }
                if (e.key === '[') { e.preventDefault(); changeZoom(-ZOOM_STEP); }
            }
        });

        // 2. 滚轮缩放
        window.addEventListener('wheel', (e) => {
            if (isWebFullscreen && transformState.el) {
                e.preventDefault(); // 阻止页面滚动
                const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
                changeZoom(delta);
            }
        }, { passive: false });

        // 3. 鼠标交互（平移与选中）
        document.addEventListener('mousedown', (e) => {
            if (e.target.closest(`#${PANEL_ID}`)) return;

            const item = e.target.closest('.monitor-grid-item');
            if (!item) return;

            // 选中视频格 (左键)
            if (e.button === 0) {
                if (transformState.el) transformState.el.classList.remove('tm-video-selected');
                transformState.el = item;
                transformState.el.classList.add('tm-video-selected');
                
                const v = item.querySelector('video');
                if (v) {
                    transformState.scale = parseFloat(v.getAttribute('data-scale') || "1");
                    transformState.tx = parseFloat(v.getAttribute('data-tx') || "0");
                    transformState.ty = parseFloat(v.getAttribute('data-ty') || "0");
                    transformState.rotate = parseInt(v.getAttribute('data-rotate') || "0");
                }
            }

            // 平移逻辑 (仅限鼠标中键 - button 1)
            if (e.button === 1) {
                if (isWebFullscreen && transformState.el) {
                    isPanning = true;
                    lastMouseX = e.clientX;
                    lastMouseY = e.clientY;
                    document.body.classList.add('tm-grabbing');
                    e.preventDefault();
                    e.stopImmediatePropagation();
                }
            }
        }, true);

        document.addEventListener('mousemove', (e) => {
            if (!isPanning || !transformState.el) return;
            const dx = e.clientX - lastMouseX;
            const dy = e.clientY - lastMouseY;
            transformState.tx += dx;
            transformState.ty += dy;
            applyTransform(true);
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            e.stopImmediatePropagation();
        }, true);

        document.addEventListener('mouseup', (e) => {
            if (isPanning) {
                isPanning = false;
                document.body.classList.remove('tm-grabbing');
                e.stopImmediatePropagation();
            }
        }, true);
    }

    function applyTransform(fast = false) {
        if (!transformState.el) return;
        const video = transformState.el.querySelector('video');
        if (!video) return;

        video.setAttribute('data-scale', transformState.scale);
        video.setAttribute('data-tx', transformState.tx);
        video.setAttribute('data-ty', transformState.ty);
        video.setAttribute('data-rotate', transformState.rotate);

        video.style.transition = fast ? "none" : "transform 0.2s ease-out";
        video.style.transform = `translate(${transformState.tx}px, ${transformState.ty}px) scale(${transformState.scale}) rotate(${transformState.rotate}deg)`;
    }

    function changeZoom(delta) {
        if (!transformState.el) return;
        transformState.scale = Math.max(0.1, transformState.scale + delta);
        applyTransform();
    }

    function rotateVideo() {
        if (!transformState.el) return log("未选中视频", "#e74c3c");
        transformState.rotate = (transformState.rotate + 90) % 360;
        applyTransform();
        log(`旋转: ${transformState.rotate}°`);
    }

    function resetTransform() {
        if (!transformState.el) return;
        transformState.scale = 1; transformState.tx = 0; transformState.ty = 0; transformState.rotate = 0;
        applyTransform();
    }

    function toggleWebFullscreen() {
        isWebFullscreen = !isWebFullscreen;
        const btn = document.getElementById(`${PANEL_ID}-toggle-fullscreen`);
        if (isWebFullscreen) {
            document.body.classList.add('tm-web-fullscreen');
            btn.innerText = "❌ 退出全屏模式";
            if (!isUserHiddenMode) toggleUserHiddenMode(true);
            log("沉浸全屏模式开启", "#3498db");
        } else {
            document.body.classList.remove('tm-web-fullscreen');
            btn.innerText = "📺 开启沉浸全屏";
            resetTransform();
            log("全屏已退出");
        }
        setTimeout(() => window.dispatchEvent(new Event('resize')), 500);
    }

    function toggleUserHiddenMode(force) {
        isUserHiddenMode = (typeof force === 'boolean') ? force : !isUserHiddenMode;
        document.querySelectorAll('.rotatebox, div[class*="controlsBot"]').forEach(el => {
            isUserHiddenMode ? el.classList.add(HIDE_CLASS) : el.classList.remove(HIDE_CLASS);
        });
    }

    function checkAndClick() {
        const popup = document.querySelector('.offlinebox.playcountdown');
        if (popup && popup.style.display !== 'none' && popup.offsetParent !== null) {
            const btn = popup.querySelector('button');
            if (btn && BUTTON_KEYWORDS.includes(btn.innerText.trim())) {
                btn.click();
                log("自动续播中", "#e74c3c");
                toggleUserHiddenMode(true);
                setTimeout(() => toggleUserHiddenMode(isUserHiddenMode), 1000);
            }
        }
    }

    // === 通用拖拽函数（支持最小化状态拖拽） ===
    function setupDraggable(element, handle) {
        let sx, sy, il, it;
        
        // 关键：将鼠标事件绑定到整个元素，但在展开状态下 handle 限制为 header
        const dragTarget = element;

        dragTarget.onmousedown = function(e) {
            // 如果面板是展开的，且点击的不是 header，则不触发拖拽
            if (!element.classList.contains('minimized') && !e.target.closest('.panel-header')) return;
            if (e.target.classList.contains('toggle-btn')) return;

            sx = e.clientX; sy = e.clientY;
            const r = element.getBoundingClientRect();
            il = r.left; it = r.top;
            hasMoved = false;

            document.onmousemove = function(e) {
                const dx = e.clientX - sx; const dy = e.clientY - sy;
                if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                    hasMoved = true;
                    element.style.left = (il + dx) + 'px';
                    element.style.top = (it + dy) + 'px';
                    element.style.right = 'auto';
                }
            };
            document.onmouseup = function() {
                document.onmousemove = null; 
                document.onmouseup = null;
                if (!isPanelHovered) resetAutoHideTimer();
                ensureVisibleOnScreen(element);
            };
        };
    }

    function ensureVisibleOnScreen(panel) {
        const winW = window.innerWidth;
        const rect = panel.getBoundingClientRect();
        if (rect.left + 230 > winW) panel.style.left = (winW - 240) + 'px';
        if (rect.top < 0) panel.style.top = '10px';
    }

    function resetAutoHideTimer() {
        const panel = document.getElementById(PANEL_ID);
        if (autoHideTimer) clearTimeout(autoHideTimer);
        if (!isPanelHovered && panel && !panel.classList.contains('minimized')) {
            autoHideTimer = setTimeout(() => panel.classList.add('minimized'), 10000);
        }
    }

    function log(msg, color="#bdc3c7") {
        const lb = document.getElementById(`${PANEL_ID}-log`);
        if (!lb) return;
        const div = document.createElement('div');
        div.innerHTML = `<span style="color:#7f8c8d">[${new Date().toLocaleTimeString('zh-CN',{hour12:false})}]</span> <span style="color:${color}">${msg}</span>`;
        lb.insertBefore(div, lb.firstChild);
        if (lb.children.length > 30) lb.lastChild.remove();
    }

    setTimeout(init, 1500);
})();
