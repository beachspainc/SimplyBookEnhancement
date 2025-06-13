// ==UserScript==
// @name         SimplyBook.me Payment Enhancement
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Add payment features to SimplyBook.me with parameterized HTML components
// @author       Your Name
// @match        https://*.simplybook.me/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // 配置 - SimplyBook API
    const CONFIG = {
        REPO_BASE_URL: 'https://raw.githubusercontent.com/beachspainc/SimplyBookEnhancement/main',
        COMPANY_LOGIN: "beachspa",
        API_BASE_URL: 'https://user-api.simplybook.me',
        API_KEY: '2fefa78171e0c3cd0d7a81e95ef58fd14f474566faabda4abb56bbbd15200c0f'
    };

    // 配置 - 外部组件URL
    const COMPONENT_URLS = {
        BUTTON: `${CONFIG.REPO_BASE_URL}/resources/components/button.html`,
        MODAL: `${CONFIG.REPO_BASE_URL}/resources/components/modal.html`
    };


    /**
     * 通用组件加载器
     *
     * @param {Object} options 加载选项
     * @param {string} options.url 组件HTML文件的URL
     * @param {string} [options.containerId='component-container'] 容器元素ID
     * @param {string} [options.rootSelector] 根元素选择器
     * @param {Function} initCallback 组件初始化回调函数
     * @returns {Promise<HTMLElement>} 返回组件根元素的Promise
     */
    function loadComponent(options, initCallback) {
        const config = {
            containerId: 'component-container',
            ...options
        };

        // 确保容器存在
        let container = document.getElementById(config.containerId);
        if (!container) {
            container = document.createElement('div');
            container.id = config.containerId;
            container.style.display = 'none';
            document.body.appendChild(container);
        }

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: config.url,
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        // 解析HTML字符串
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(response.responseText, 'text/html');

                        // 获取所有元素
                        const elements = Array.from(doc.body.children);

                        // 添加到容器
                        elements.forEach(el => {
                            container.appendChild(el.cloneNode(true));
                        });

                        // 获取根元素
                        let rootElement;
                        if (config.rootSelector) {
                            rootElement = container.querySelector(config.rootSelector);
                        } else {
                            // 尝试自动检测根元素
                            rootElement = elements.find(el =>
                                el.id || el.classList.value || el.tagName === 'CUSTOM-ELEMENT'
                            ) || elements[0];
                        }

                        if (!rootElement) {
                            reject(new Error('Component root element not found'));
                            return;
                        }

                        // 执行初始化回调
                        if (typeof initCallback === 'function') {
                            initCallback(rootElement);
                        }

                        resolve(rootElement);
                    } else {
                        reject(new Error(`HTTP error! status: ${response.status}`));
                    }
                },
                onerror: function(error) {
                    reject(error);
                }
            });
        });
    }
})();