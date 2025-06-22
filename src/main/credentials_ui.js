// ==UserScript==
// @name         SimplyBook Secure Credential Manager UI
// @namespace    http://tampermonkey.net/
// @version      5.4
// @description  SimplyBook credential manager UI using global credential storage
// @match        https://*.secure.simplybook.me/*
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        unsafeWindow
// @run-at       document-end
// @require      libs/credentials.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js
// ==/UserScript==

(function() {
    'use strict';

    // 配置设置
    const CONFIG = {
        debugMode: false,
        autoSubmit: true
    };

    // 临时凭证存储
    let tempCredentials = {
        username: '',
        password: ''
    };

    // 菜单命令ID
    let restoreMenuId = null;

    // 等待DOM加载
    function waitForDOM() {
        return new Promise((resolve) => {
            if (document.readyState === 'complete' || document.readyState === 'interactive') {
                resolve();
            } else {
                document.addEventListener('DOMContentLoaded', resolve, {once: true});
                window.addEventListener('load', resolve, {once: true});
            }
        });
    }

    // 主函数
    async function main() {
        // 检查全局API是否可用
        if (typeof unsafeWindow.GlobalCredentialManager === 'undefined') {
            console.error('全局凭证管理器未加载!');
            return;
        }

        await waitForDOM();

        // 检查是否是登录页面
        const isLoginPage = window.location.pathname.includes('/login') ||
            document.querySelector('input[type="password"]') !== null;

        if (isLoginPage) {
            handleLoginPage();
        }
    }

    // 处理登录页面
    function handleLoginPage() {
        // 创建主容器
        const container = document.createElement('div');
        container.id = 'loginCredentialManager';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            font-family: 'Segoe UI', system-ui, sans-serif;
            font-size: 14px;
            width: 380px;
            max-width: 90%;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
            cursor: move;
            transition: all 0.3s ease;
        `;
        document.body.appendChild(container);

        // 添加样式
        addStyles();

        // 创建UI
        createLoginUI();
    }

    // SVG图标
    const EYE_ICON = '../resources/icons/EYE_ICON.svg';
    const EYE_SLASH_ICON = '../resources/icons/EYE_SLASH_ICON.svg';
    const MINIMIZE_ICON = '../resources/icons/MINIMIZE_ICON.svg';

    // 添加样式
    function addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #loginCredentialManager .manager-container {
                background: linear-gradient(135deg, #1a365d, #2a4365);
                color: #e2e8f0;
                padding: 0;
            }
            
            #loginCredentialManager .content {
                padding: 25px;
                transition: max-height 0.3s ease, padding 0.3s ease;
                max-height: 500px;
                overflow: hidden;
            }
            
            #loginCredentialManager .input-group {
                margin-bottom: 20px;
            }
            
            #loginCredentialManager label {
                display: block;
                color: #a0c8ff;
                margin-bottom: 8px;
                font-weight: 500;
                font-size: 14px;
            }
            
            #loginCredentialManager .input-icon {
                margin-right: 10px;
                width: 20px;
                text-align: center;
                display: inline-block;
            }
            
            #loginCredentialManager input {
                width: 100%;
                padding: 14px 15px;
                border: 1px solid #3a506b;
                background: rgba(10, 25, 47, 0.7);
                border-radius: 8px;
                color: #f8fafc;
                font-size: 15px;
                transition: all 0.2s ease;
                display: block;
                box-sizing: border-box;
            }
            
            #loginCredentialManager input:focus {
                border-color: #4299e1;
                outline: none;
                box-shadow: 0 0 0 3px rgba(66, 153, 225, 0.3);
            }
            
            #loginCredentialManager .btn {
                padding: 14px;
                border: none;
                border-radius: 8px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                width: 100%;
                margin-top: 15px;
            }
            
            #loginCredentialManager .btn-primary {
                background: linear-gradient(135deg, #4299e1, #3182ce);
                color: white;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            
            #loginCredentialManager .btn-primary:hover {
                background: linear-gradient(135deg, #3182ce, #2b6cb0);
                transform: translateY(-2px);
                box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
            }
            
            #loginCredentialManager .btn-secondary {
                background: transparent;
                color: #63b3ed;
                border: 1px solid #63b3ed;
            }
            
            #loginCredentialManager .btn-secondary:hover {
                background: rgba(99, 179, 237, 0.1);
            }
            
            #loginCredentialManager .message {
                padding: 14px;
                border-radius: 8px;
                margin: 20px 0;
                font-size: 14px;
                text-align: center;
            }
            
            #loginCredentialManager .message.info {
                background: rgba(66, 153, 225, 0.15);
                border: 1px solid #4299e1;
                color: #4299e1;
            }
            
            #loginCredentialManager .message.success {
                background: rgba(56, 178, 172, 0.15);
                border: 1px solid #38b2ac;
                color: #38b2ac;
            }
            
            #loginCredentialManager .message.error {
                background: rgba(245, 101, 101, 0.15);
                border: 1px solid #f56565;
                color: #f56565;
            }
            
            #loginCredentialManager .password-container {
                position: relative;
            }
            
            #loginCredentialManager .input-actions {
                position: absolute;
                right: 15px;
                top: 50%;
                transform: translateY(-50%);
                display: flex;
                gap: 5px;
            }
            
            #loginCredentialManager .toggle-password {
                background: none;
                border: none;
                color: #a0aec0;
                cursor: pointer;
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
                padding: 0;
            }
            
            #loginCredentialManager .toggle-password svg {
                width: 18px;
                height: 18px;
                fill: currentColor;
            }
            
            #loginCredentialManager .option-group {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-top: 15px;
                flex-wrap: wrap;
                gap: 10px;
            }
            
            #loginCredentialManager .checkbox-container {
                display: flex;
                align-items: center;
                gap: 8px;
                cursor: pointer;
                margin-right: auto;
            }
            
            #loginCredentialManager .checkbox-container input {
                width: 18px;
                height: 18px;
                margin: 0;
                cursor: pointer;
                position: relative;
                appearance: none;
                -webkit-appearance: none;
                border: 2px solid #4299e1;
                border-radius: 4px;
                background: rgba(10, 25, 47, 0.7);
                transition: all 0.2s ease;
            }
            
            #loginCredentialManager .checkbox-container input[type="checkbox"]:checked {
                background-color: #4299e1;
                border-color: #4299e1;
            }
            
            #loginCredentialManager .checkbox-container input[type="checkbox"]:checked::after {
                content: "";
                position: absolute;
                left: 14px;
                top: 5px;
                width: 5px;
                height: 14px;
                border: solid white;
                border-width: 0 3px 3px 0;
                transform: rotate(45deg);
            }
            
            #loginCredentialManager .checkbox-container label {
                margin: 0;
                cursor: pointer;
                display: inline;
                color: #a0c8ff;
            }
            
            #loginCredentialManager .reset-link {
                color: #63b3ed;
                text-decoration: none;
                font-size: 14px;
                cursor: pointer;
                white-space: nowrap;
            }
            
            #loginCredentialManager .reset-link:hover {
                text-decoration: underline;
            }
            
            #loginCredentialManager .footer {
                text-align: center;
                padding: 15px;
                background: rgba(0, 0, 0, 0.2);
                color: #a0aec0;
                font-size: 13px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                cursor: default;
            }
            
            #loginCredentialManager .drag-handle {
                position: absolute;
                top: 0;
                left: 0;
                width: calc(100% - 40px);
                height: 20px;
                cursor: move;
                z-index: 10;
            }
            
            #loginCredentialManager .input-with-actions {
                display: flex;
                gap: 10px;
                align-items: center;
                width: 100%;
            }
            
            #loginCredentialManager .input-with-actions .password-container {
                flex: 1;
                position: relative;
            }
            
            #loginCredentialManager .input-group label {
                display: block;
                margin-bottom: 8px;
            }
            
            #loginCredentialManager .minimize-btn {
                position: absolute;
                top: 5px;
                right: 5px;
                background: none;
                border: none;
                color: #a0aec0;
                cursor: pointer;
                width: 30px;
                height: 30px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 11;
                transition: all 0.2s ease;
            }
            
            #loginCredentialManager .minimize-btn:hover {
                background: rgba(255, 255, 255, 0.1);
                color: #fff;
            }
        `;
        document.head.appendChild(style);
    }

    // 创建登录页面UI
    function createLoginUI() {
        const container = document.getElementById('loginCredentialManager');
        const domain = window.location.hostname;
        const GlobalCM = unsafeWindow.GlobalCredentialManager;

        // 获取保存的密钥选项
        const keyOption = GlobalCM.getKeyOption(domain);
        const savedKey = keyOption.savedKey;
        const saveKeyChecked = keyOption.saveKeyChecked;

        // 检查是否有保存的凭证
        const hasCredentials = GlobalCM.getCredentials(domain, savedKey) !== null;

        // 创建UI
        container.innerHTML = `
            <div class="manager-container">
                <!-- 拖拽手柄 -->
                <div class="drag-handle"></div>
                
                <!-- 最小化按钮 -->
                <button class="minimize-btn" id="minimizeBtn">${MINIMIZE_ICON}</button>
                
                <div class="content">
                    <!-- 凭证输入模式 -->
                    <div id="credentialsMode" ${hasCredentials ? 'style="display:none;"' : ''}>
                        <div class="input-group">
                            <label for="managerUsername">
                                <span class="input-icon">👤</span>
                                Username
                            </label>
                            <div class="input-with-actions">
                                <div class="password-container">
                                    <input type="text" id="managerUsername" placeholder="Enter your username" autocomplete="username">
                                </div>
                            </div>
                        </div>
                        
                        <div class="input-group">
                            <label for="managerPassword">
                                <span class="input-icon">🔒</span>
                                Password
                            </label>
                            <div class="input-with-actions">
                                <div class="password-container">
                                    <input type="password" id="managerPassword" placeholder="Enter your password" autocomplete="current-password">
                                    <div class="input-actions">
                                        <button class="toggle-password" id="toggleManagerPassword">${EYE_ICON}</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <button class="btn btn-primary" id="saveCredsBtn">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                                <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
                            </svg>
                            Save Credentials
                        </button>
                    </div>
                    
                    <!-- 密钥输入模式 -->
                    <div id="keyMode" ${hasCredentials ? '' : 'style="display:none;"'}>
                        <div class="input-group">
                            <label for="loginKey">
                                <span class="input-icon">🔑</span>
                                Encryption Key
                            </label>
                            <div class="input-with-actions">
                                <div class="password-container">
                                    <input type="password" id="loginKey" placeholder="Enter your encryption key" value="${savedKey}" autocomplete="off">
                                    <div class="input-actions">
                                        <button class="toggle-password" id="toggleLoginKey">${EYE_ICON}</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="option-group">
                            <div class="checkbox-container">
                                <input type="checkbox" id="saveKeyCheckboxKeyMode" ${saveKeyChecked ? 'checked' : ''}>
                                <label for="saveKeyCheckboxKeyMode">Save Key</label>
                            </div>
                            
                            <a class="reset-link" id="resetCredentials">Reset Credentials</a>
                        </div>
                        
                        <button class="btn btn-primary" id="decryptFillBtn">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                                <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/>
                            </svg>
                            Decrypt & Login
                        </button>
                    </div>
                </div>
                
                <div class="footer">
                    <span id="footerText">All credentials are protected with AES-256 encryption</span>
                </div>
            </div>
        `;

        // 添加事件监听器
        document.getElementById('saveCredsBtn')?.addEventListener('click', saveCredentials);
        document.getElementById('decryptFillBtn')?.addEventListener('click', decryptAndFill);
        document.getElementById('toggleManagerPassword')?.addEventListener('click', () => togglePasswordVisibility('managerPassword'));
        document.getElementById('toggleLoginKey')?.addEventListener('click', () => togglePasswordVisibility('loginKey'));
        document.getElementById('resetCredentials')?.addEventListener('click', resetCredentials);
        document.getElementById('minimizeBtn')?.addEventListener('click', toggleMinimize);

        // 添加拖拽功能
        makeDraggable(container);

        // 注册菜单命令
        registerMenuCommands();

        // 如果有保存的凭证，默认隐藏窗体
        if (hasCredentials) {
            container.style.display = 'none';
        }
    }

    // 注册菜单命令
    function registerMenuCommands() {
        if (!restoreMenuId) {
            restoreMenuId = GM_registerMenuCommand('Show SimplyBook Credential Manager', restoreFromMinimized);
        }
    }

    // 使元素可拖拽
    function makeDraggable(element) {
        if (!element) return;

        const dragHandle = element.querySelector('.drag-handle');
        if (!dragHandle) return;

        let initialX = 0, initialY = 0;
        let currentX = 0, currentY = 0;
        let offsetX = 0, offsetY = 0;
        let isDragging = false;

        dragHandle.addEventListener('mousedown', dragMouseDown);

        function dragMouseDown(e) {
            e.preventDefault();
            isDragging = true;

            // 获取初始鼠标位置
            initialX = e.pageX;
            initialY = e.pageY;

            // 获取当前元素位置
            currentX = element.offsetLeft;
            currentY = element.offsetTop;

            // 计算当前鼠标偏移
            offsetX = initialX - currentX;
            offsetY = initialY - currentY;

            document.addEventListener('mousemove', elementDrag);
            document.addEventListener('mouseup', closeDragElement);
        }

        function elementDrag(e) {
            if (!isDragging) return;
            e.preventDefault();

            // 计算新位置
            const x = e.pageX - offsetX;
            const y = e.pageY - offsetY;

            // 设置新位置
            element.style.left = x + "px";
            element.style.top = y + "px";
        }

        function closeDragElement() {
            isDragging = false;
            document.removeEventListener('mousemove', elementDrag);
            document.removeEventListener('mouseup', closeDragElement);
        }
    }

    // 切换密码可见性
    function togglePasswordVisibility(inputId) {
        const input = document.getElementById(inputId);
        if (!input) return;

        const type = input.getAttribute('type') === 'password' ? 'text' : 'password';
        input.setAttribute('type', type);

        // 更新按钮图标
        const button = document.querySelector(`#toggle${inputId.charAt(0).toUpperCase() + inputId.slice(1)}`);
        if (button) {
            button.innerHTML = type === 'password' ? EYE_ICON : EYE_SLASH_ICON;
        }
    }

    // 从最小化状态恢复
    function restoreFromMinimized() {
        const container = document.getElementById('loginCredentialManager');
        if (container) {
            container.style.display = 'block';
            // 将窗体置于最前面
            container.style.zIndex = '10000';
        }
    }

    // 最小化窗体
    function toggleMinimize() {
        const container = document.getElementById('loginCredentialManager');
        if (container) {
            container.style.display = 'none';
        }
    }

    // 显示消息
    function showMessage(msg, type) {
        // 创建或更新消息元素
        let msgEl = document.getElementById('infoMessage');

        if (!msgEl) {
            msgEl = document.createElement('div');
            msgEl.id = 'infoMessage';
            const content = document.querySelector('.content');
            content.insertBefore(msgEl, content.firstChild);
        }

        msgEl.textContent = msg;
        msgEl.className = `message ${type}`;

        // 5秒后自动消失
        if (type === 'success' || type === 'error') {
            setTimeout(() => {
                msgEl.style.opacity = '0';
                setTimeout(() => {
                    if (msgEl.parentNode) {
                        msgEl.parentNode.removeChild(msgEl);
                    }
                }, 500);
            }, 5000);
        }
    }

    // 保存凭证
    function saveCredentials() {
        const username = document.getElementById('managerUsername')?.value.trim();
        const password = document.getElementById('managerPassword')?.value;

        if (!username) {
            showMessage('Please enter a username', 'error');
            return;
        }

        if (!password) {
            showMessage('Please enter a password', 'error');
            return;
        }

        // 临时存储凭证
        tempCredentials = {
            username: username,
            password: password
        };

        // 显示密钥输入页面
        document.getElementById('credentialsMode').style.display = 'none';
        document.getElementById('keyMode').style.display = 'block';
    }

    // 解密并填充表单
    function decryptAndFill() {
        const keyInput = document.getElementById('loginKey');
        const key = keyInput?.value;
        const saveKeyCheckbox = document.getElementById('saveKeyCheckboxKeyMode');
        const saveKey = saveKeyCheckbox?.checked || false;
        const domain = window.location.hostname;
        const GlobalCM = unsafeWindow.GlobalCredentialManager;

        if (!key) {
            showMessage('Please enter an encryption key', 'error');
            return;
        }

        // 保存密钥选项
        GlobalCM.saveKeyOption(domain, saveKey, key);

        // 获取凭证
        let creds = GlobalCM.getCredentials(domain, key);

        if (!creds) {
            // 如果没有保存的凭证但用户输入了凭证
            if (tempCredentials.username && tempCredentials.password) {
                // 尝试保存新凭证
                if (GlobalCM.saveCredentials(domain, tempCredentials, key)) {
                    creds = tempCredentials;
                    tempCredentials = { username: '', password: '' };
                    showMessage('Credentials saved and filled successfully', 'success');
                } else {
                    showMessage('Failed to save credentials', 'error');
                    return;
                }
            } else {
                showMessage('No credentials found for this site', 'error');
                return;
            }
        }

        // 填充表单字段
        const usernameFields = document.querySelectorAll('input[type="text"], input[type="email"], input[autocomplete="username"]');
        const passwordFields = document.querySelectorAll('input[type="password"], input[autocomplete="current-password"]');

        if (usernameFields.length > 0) {
            usernameFields[0].value = creds.username;
        }

        if (passwordFields.length > 0) {
            passwordFields[0].value = creds.password;
        }

        showMessage('Credentials filled successfully', 'success');

        // 自动提交表单
        if (CONFIG.autoSubmit) {
            const submitButton = document.querySelector('button[type="submit"], input[type="submit"]');
            if (submitButton) {
                setTimeout(() => {
                    submitButton.click();
                }, 1000);
            }
        }
    }

    // 重置凭证
    function resetCredentials() {
        const domain = window.location.hostname;
        const GlobalCM = unsafeWindow.GlobalCredentialManager;

        // 清除所有存储的数据
        GlobalCM.resetCredentials(domain);
        GlobalCM.saveKeyOption(domain, false);

        // 刷新UI
        document.getElementById('credentialsMode').style.display = 'block';
        document.getElementById('keyMode').style.display = 'none';
        document.getElementById('managerUsername').value = '';
        document.getElementById('managerPassword').value = '';
        document.getElementById('loginKey').value = '';
        document.getElementById('saveKeyCheckboxKeyMode').checked = false;

        // 重置后显示窗体
        const container = document.getElementById('loginCredentialManager');
        if (container) {
            container.style.display = 'block';
        }

        showMessage('All credentials reset, please re-enter', 'info');
    }

    // 启动主程序
    main().catch(console.error);
})();