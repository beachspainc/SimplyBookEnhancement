// ==UserScript==
// @name         SimplyBook.me Payment Enhancement
// @namespace    http://tampermonkey.net/
// @version      7.3
// @description  Enhanced with event data capture, display, and tip tag feature
// @author       Your Name
// @match        https://*.simplybook.me/*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        REPO_BASE_URL: 'https://raw.githubusercontent.com/beachspainc/SimplyBookEnhancement/main',
        COMPANY_LOGIN: "beachspa",
        API_BASE_URL: 'https://user-api.simplybook.me',
        API_KEY: '2fefa78171e0c3cd0d7a81e95ef58fd14f474566faabda4abb56bbbd15200c0f'
    };

    const COMPONENT_URLS = {
        BUTTON: `${CONFIG.REPO_BASE_URL}/resources/components/payment_button.html`,
        MODAL: `${CONFIG.REPO_BASE_URL}/resources/components/payment_modal.html`
    };

    class Component {
        #root_element;
        #config;
        #event_listeners;
        #is_mounted;
        #data;
        #container_element;

        constructor(options) {
            this.#config = {
                container: 'body',
                enable_css_scoping: true,
                initial_data: {},
                ...options
            };

            this.#root_element = null;
            this.#container_element = null;
            this.#event_listeners = {};
            this.#is_mounted = false;
            this.#data = { ...this.#config.initial_data };
        }

        get root_element() {
            return this.#root_element;
        }

        get is_mounted() {
            return this.#is_mounted;
        }

        get config() {
            return this.#config;
        }

        get data() {
            return {...this.#data};
        }

        async load() {
            try {
                // 处理不同的初始化方式
                if (this.#config.root_element) {
                    this.#root_element = this.#config.root_element;
                }
                else if (this.#config.html) {
                    this.#create_from_html(this.#config.html);
                }
                else if (this.#config.url) {
                    const html = await this.#fetch_component(this.#config.url);
                    this.#create_from_html(html);
                }
                else {
                    console.error('Component requires either root_element, html, or url');
                    return false;
                }

                // 处理样式
                if (this.#config.enable_css_scoping) {
                    this.#scope_css();
                }

                return true;
            } catch (error) {
                console.error('Component load error:', error);
                return false;
            }
        }

        #create_from_html(html) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            this.#root_element = this.#config.root_selector
                ? doc.querySelector(this.#config.root_selector)
                : doc.body.firstElementChild;

            if (!this.#root_element) {
                throw new Error('Root element not found');
            }

            this.#process_style_tags(doc);
        }

        #process_style_tags(doc) {
            const fragment = document.createDocumentFragment();
            doc.querySelectorAll('style').forEach(style => {
                const newStyle = document.createElement('style');
                newStyle.textContent = style.textContent;
                fragment.appendChild(newStyle);
            });

            if (this.#root_element) {
                this.#root_element.appendChild(fragment);
            }
        }

        async mount() {
            if (this.#is_mounted) {
                console.warn('Component is already mounted');
                return true;
            }

            // 确保已加载
            if (!this.#root_element) {
                console.error('Cannot mount: Component not loaded');
                return false;
            }

            // 查找容器元素
            this.#container_element = document.querySelector(this.#config.container);
            if (!this.#container_element) {
                console.error('Container element not found');
                return false;
            }

            // 初始化事件监听器
            this.#init_event_listeners();

            // 渲染组件
            this.render();

            this.#is_mounted = true;
            console.log('Component mounted successfully');
            return true;
        }

        async unmount() {
            if (!this.#is_mounted) {
                console.warn('Component is not mounted');
                return false;
            }

            // 移除事件监听器
            this.#remove_event_listeners();

            // 从DOM中移除
            if (this.#root_element.parentNode) {
                this.#root_element.parentNode.removeChild(this.#root_element);
            }

            this.#is_mounted = false;
            console.log('Component unmounted successfully');
            return true;
        }

        #init_event_listeners() {
            if (!this.#root_element) return;

            // 绑定基础事件
            const eventsToBind = ['click', 'change', 'input', 'submit'];
            eventsToBind.forEach(event => {
                if (typeof this[`_on_${event}`] === 'function') {
                    this.#root_element.addEventListener(event, e => this[`_on_${event}`](e));
                }
            });

            // 绑定自定义事件监听器
            Object.entries(this.#event_listeners).forEach(([event, listeners]) => {
                listeners.forEach(({selector, handler}) => {
                    if (selector === 'root') {
                        this.#root_element.addEventListener(event, handler);
                    } else if (selector) {
                        this.#root_element.addEventListener(event, e => {
                            if (e.target.matches(selector)) handler.call(e.target, e);
                        });
                    }
                });
            });
        }

        #remove_event_listeners() {
            if (!this.#root_element) return;

            // 解绑基础事件
            const eventsToUnbind = ['click', 'change', 'input', 'submit'];
            eventsToUnbind.forEach(event => {
                if (typeof this[`_on_${event}`] === 'function') {
                    this.#root_element.removeEventListener(event, e => this[`_on_${event}`](e));
                }
            });

            // 解绑自定义事件监听器
            Object.entries(this.#event_listeners).forEach(([event, listeners]) => {
                listeners.forEach(({selector, handler}) => {
                    if (selector === 'root') {
                        this.#root_element.removeEventListener(event, handler);
                    } else if (selector) {
                        this.#root_element.removeEventListener(event, handler);
                    }
                });
            });
        }

        on(event, selector, handler) {
            this.#event_listeners[event] ||= [];
            this.#event_listeners[event].push({selector, handler});
        }

        #scope_css() {
            if (!this.#root_element) return;

            const scope_id = `component_${Math.random().toString(36).slice(2, 11)}`;
            this.#root_element.id = scope_id;

            this.#root_element.querySelectorAll('style').forEach(style => {
                style.textContent = style.textContent.replace(
                    /(^|\})([^{]+?\{)/g,
                    `$1#${scope_id} $2`
                );
            });
        }

        #fetch_component(url) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    onload: r => r.status >= 200 && r.status < 300
                        ? resolve(r.responseText)
                        : reject(r.status),
                    onerror: reject
                });
            });
        }

        update_data(new_data) {
            this.#data = { ...this.#data, ...new_data };
            if (this.#is_mounted) this.render();
            return this;
        }

        destroy() {
            this.unmount();
            this.#event_listeners = {};
            this.#root_element = null;
        }

        render() {}
    }

    class AsyncStateComponent extends Component {
        #state;
        #loading_overlay;

        constructor(options) {
            // 确保传递 initial_state
            const completeOptions = {
                initial_state: { is_loading: false, has_error: false, error_message: '' },
                ...options
            };

            super({
                loading_animation: true,
                ...completeOptions
            });

            this.#state = { ...completeOptions.initial_state };
            this.#loading_overlay = null;
            this.#init_loading_styles();
        }

        get state() {
            return {...this.#state};
        }

        #init_loading_styles() {
            if (document.getElementById('stateful-loading-styles')) return;

            const style = document.createElement('style');
            style.id = 'stateful-loading-styles';
            style.textContent = `
                .stateful-loading-overlay {
                    position: absolute;
                    top: 0; left: 0;
                    width: 100%; height: 100%;
                    background: rgba(255, 255, 255, 0.7);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 1000;
                    border-radius: inherit;
                    opacity: 0;
                    transition: opacity 0.3s ease;
                    pointer-events: none;
                }
                .stateful-loading-overlay.active {
                    opacity: 1;
                    pointer-events: auto;
                }
                .stateful-loading-spinner {
                    width: 20px; height: 20px;
                    position: relative;
                }
                .stateful-loading-spinner::before,
                .stateful-loading-spinner::after {
                    content: '';
                    position: absolute;
                    top: 0; left: 0;
                    width: 100%; height: 100%;
                    border-radius: 50%;
                    border: 2px solid transparent;
                    animation: stateful-spin 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
                }
                .stateful-loading-spinner::before {
                    border-top-color: #3498db;
                    animation-delay: -0.45s;
                }
                .stateful-loading-spinner::after {
                    border-top-color: #e74c3c;
                    animation-delay: -0.15s;
                }
                @keyframes stateful-spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                .stateful-loading, .stateful-loading * {
                    pointer-events: none !important;
                    cursor: not-allowed !important;
                    user-select: none !important;
                }
            `;
            document.head.appendChild(style);
        }

        set_state(new_state) {
            this.#state = { ...this.#state, ...new_state };
            this.render();
        }

        render() {
            if (!this.root_element) return;

            // 统一处理所有数据绑定
            const bindHandlers = {
                'data-bind': (el, key) => el.textContent = this.#state[key],
                'data-class': (el, attr) => {
                    const mapping = JSON.parse(attr);
                    Object.entries(mapping).forEach(([cls, key]) => {
                        el.classList.toggle(cls, !!this.#state[key]);
                    });
                },
                'data-bind-data': (el, key) => {
                    if (key in this.data) {
                        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
                            el.value = this.data[key];
                        } else {
                            el.textContent = this.data[key];
                        }
                    }
                }
            };

            Object.entries(bindHandlers).forEach(([attr, handler]) => {
                this.root_element.querySelectorAll(`[${attr}]`).forEach(el => {
                    handler(el, el.getAttribute(attr));
                });
            });
        }

        #create_loading_overlay() {
            if (this.#loading_overlay) return;

            if (getComputedStyle(this.root_element).position === 'static') {
                this.root_element.style.position = 'relative';
            }

            this.#loading_overlay = document.createElement('div');
            this.#loading_overlay.className = 'stateful-loading-overlay';

            const spinner = document.createElement('div');
            spinner.className = 'stateful-loading-spinner';
            this.#loading_overlay.appendChild(spinner);

            this.root_element.appendChild(this.#loading_overlay);
            this.#loading_overlay.addEventListener('click', e => e.stopPropagation());
        }

        set_loading(state) {
            if (!this.root_element) return;

            if (state) {
                this.root_element.classList.add('stateful-loading');
                this.set_state({ is_loading: true, has_error: false, error_message: '' });

                if (this.config.loading_animation) {
                    this.#create_loading_overlay();
                    this.#loading_overlay?.classList.add('active');
                }
            } else {
                this.root_element.classList.remove('stateful-loading');
                this.set_state({ is_loading: false });
                this.#loading_overlay?.classList.remove('active');
            }
        }

        set_error(error) {
            this.set_loading(false);
            this.set_state({ has_error: true, error_message: error.message });
            GM_notification({
                title: "Error",
                text: error.message,
                timeout: 5000
            });
        }

        async execute_async_operation(operation) {
            this.set_loading(true);
            try {
                const result = await operation();
                this.set_loading(false);
                return result;
            } catch (error) {
                this.set_error(error);
                throw error;
            }
        }
    }

    class PaymentButton extends AsyncStateComponent {
        #scheduler_attached = false;

        constructor() {
            super({
                url: COMPONENT_URLS.BUTTON,
                root_selector: '#sb-payment-button',
                enable_css_scoping: false,
                initial_data: { selected_event: null }
            });
        }

        async mount() {
            // 确保 unsafeWindow 已加载
            if (!unsafeWindow.view || !unsafeWindow.scheduler) {
                console.log('Waiting for unsafeWindow to load...');
                return false;
            }

            const { view, scheduler } = unsafeWindow;
            const infoForm = view.infoForm;

            // 防止重复插入
            if (infoForm.footer?.[0]?.querySelector(this.config.root_selector)) {
                return false;
            }

            // 尝试在现有按钮后插入
            const insertAfterButton = infoForm.deleteButton?.[0] || infoForm.cancelButton?.[0];
            if (insertAfterButton) {
                insertAfterButton.insertAdjacentElement('afterend', this.root_element);
            }
            // 备用插入位置
            else if (infoForm.footer?.[0]) {
                infoForm.footer[0].prepend(this.root_element);
            }

            // 注册事件选择监听（只注册一次）
            if (!this.#scheduler_attached) {
                scheduler.attachEvent("onClick", (id) => {
                    this.update_data({
                        selected_event: scheduler.getEvent(id)
                    });
                    return true;
                });
                this.#scheduler_attached = true;
            }

            // 调用基类mount完成实际挂载
            return super.mount();
        }

        async unmount() {
            // 解绑事件
            if (this.#scheduler_attached) {
                const { scheduler } = unsafeWindow;
                scheduler.detachEvent("onClick");
                this.#scheduler_attached = false;
            }

            // 调用基类unmount完成实际卸载
            return super.unmount();
        }

        _on_click(e) {
            if (e.target.closest('#sb-payment-button') && this.data.selected_event) {
                this.execute_async_operation(async () => {
                    await new Promise(r => setTimeout(r, 1500));
                    GM_notification({
                        title: "Event Info",
                        text: JSON.stringify(this.data.selected_event, null, 2),
                        timeout: 3000
                    });
                }).catch(console.error);
            }
        }
    }

    // 小费标签组件
    class TipTag extends Component {
        #tip_amount;
        #mounted = false;

        constructor() {
            // 创建小费元素
            const tipElement = TipTag.create_tip_element();

            super({
                root_element: tipElement,
                container: '.price.with-icon',
                enable_css_scoping: true
            });

            this.#tip_amount = null;

            // 使用箭头函数绑定事件处理函数
            this.onMouseover = () => {
                this.root_element.style.background = '#f0f7ff';
                this.root_element.style.textDecoration = 'underline';
                this.root_element.style.transform = 'translateY(-1px)';
            };

            this.onMouseout = () => {
                this.root_element.style.background = 'transparent';
                this.root_element.style.textDecoration = 'none';
                this.root_element.style.transform = 'none';
            };

            this.onClick = () => {
                const tipAmount = prompt('Enter tip amount (e.g. 5.00):', '5.00');
                if (tipAmount) {
                    this.#tip_amount = parseFloat(tipAmount);
                    if (isNaN(this.#tip_amount)) {
                        GM_notification({
                            title: "Invalid Amount",
                            text: "Please enter a valid number",
                            timeout: 3000
                        });
                        return;
                    }

                    this.root_element.textContent = `Tip: $${this.#tip_amount.toFixed(2)}`;
                    this.root_element.style.color = '#28a745';
                    this.root_element.style.fontWeight = 'bold';

                    GM_notification({
                        title: "Tip Added",
                        text: `$${this.#tip_amount.toFixed(2)} tip added to order`,
                        timeout: 3000
                    });
                }
            };
        }

        static create_tip_element() {
            const tipElement = document.createElement('span');
            tipElement.className = 'tip-tag';
            tipElement.textContent = 'Add Tip';

            // 添加基本样式
            tipElement.style.cssText = `
                margin-left: 8px;
                color: #007bff;
                cursor: pointer;
                text-decoration: none;
                transition: all 0.3s ease;
                padding: 2px 6px;
                border-radius: 4px;
            `;

            return tipElement;
        }

        async mount() {
            // 添加事件监听器
            this.root_element.addEventListener('mouseover', this.onMouseover);
            this.root_element.addEventListener('mouseout', this.onMouseout);
            this.root_element.addEventListener('click', this.onClick);

            // 尝试挂载
            const result = await super.mount();
            this.#mounted = result;
            return result;
        }

        async unmount() {
            // 移除事件监听器
            this.root_element.removeEventListener('mouseover', this.onMouseover);
            this.root_element.removeEventListener('mouseout', this.onMouseout);
            this.root_element.removeEventListener('click', this.onClick);

            // 调用基类unmount完成实际卸载
            const result = await super.unmount();
            this.#mounted = !result;
            return result;
        }
    }



    const payment_button = new PaymentButton();
    if (document.readyState === 'complete') {
        payment_button.mount();
    } else {
        window.addEventListener('load', () => payment_button.mount());
    }
})();