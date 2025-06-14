// ==UserScript==
// @name         SimplyBook.me Payment Enhancement
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Enhanced component architecture with state management
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

    // 配置 - 外部组件URL
    const COMPONENT_URLS = {
        BUTTON: `${CONFIG.REPO_BASE_URL}/resources/components/payment_button.html`,
        MODAL: `${CONFIG.REPO_BASE_URL}/resources/components/payment_modal.html`
    };

    // 基础组件类 - 只负责组件加载和基础功能
    class Component {
        constructor(options) {
            // 基础配置
            this.config = {
                url: '',
                container: 'body',
                root_selector: null,
                enable_css_scoping: true,
                observe_changes: false,
                mutation_observer_options: {
                    childList: true,
                    subtree: true
                },
                ...options
            };

            // 组件状态
            this.root_element = null;
            this.container_element = null;
            this.event_listeners = {};
            this.is_mounted = false;
            this.load_promise = null;
            this.observer = null;

            // 初始化
            if (this.config.observe_changes) {
                this.init_mutation_observer();
            }

            this.load();
        }

        // 加载组件HTML
        async load() {
            this.load_promise = new Promise(async (resolve, reject) => {
                try {
                    const html = await this.fetch_component(this.config.url);
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(html, 'text/html');

                    // 获取根元素
                    this.root_element = this.config.root_selector ?
                        doc.querySelector(this.config.root_selector) :
                        doc.body.firstElementChild;

                    if (!this.root_element) throw new Error('Root element not found');

                    // 处理样式标签
                    this.process_style_tags(doc);

                    // 应用CSS作用域
                    if (this.config.enable_css_scoping) {
                        this.scope_css();
                    }

                    this.mount();
                    resolve(this);
                } catch (error) {
                    console.error('Component load error:', error);
                    reject(error);
                }
            });

            return this.load_promise;
        }

        // 处理样式标签
        process_style_tags(doc) {
            const style_elements = doc.querySelectorAll('style');
            const fragment = document.createDocumentFragment();

            style_elements.forEach(style => {
                const newStyle = document.createElement('style');
                newStyle.textContent = style.textContent;
                fragment.appendChild(newStyle);
            });

            this.root_element.appendChild(fragment);
        }

        // 挂载组件
        mount() {
            if (this.is_mounted) return;

            this.container_element = document.querySelector(this.config.container);
            if (!this.container_element) {
                throw new Error(`Container not found: ${this.config.container}`);
            }

            this.container_element.appendChild(this.root_element);
            this.is_mounted = true;

            this.init_event_listeners();
            this.render();
        }

        // 渲染组件
        render() {
            // 基础组件不实现具体渲染逻辑
            // 由子类根据状态覆盖此方法
        }

        // 初始化事件监听器
        init_event_listeners() {
            if (!this.root_element) return;

            // 自动绑定受保护方法
            this.auto_bind_protected_events();

            // 处理通过 on() 方法注册的事件
            Object.entries(this.event_listeners).forEach(([event_name, listeners]) => {
                listeners.forEach(({selector, handler}) => {
                    this.attach_event_handler(event_name, selector, handler);
                });
            });
        }

        // 自动绑定受保护的事件处理方法
        auto_bind_protected_events() {
            const event_map = {
                'click': 'on_click',
                'dblclick': 'on_double_click',
                'mouseenter': 'on_mouse_enter',
                'mouseleave': 'on_mouse_leave',
                'focus': 'on_focus',
                'blur': 'on_blur',
                'keydown': 'on_key_down',
                'keyup': 'on_key_up',
                'change': 'on_change',
                'input': 'on_input',
                'submit': 'on_submit',
                'load': 'on_load',
                'error': 'on_error'
            };

            Object.entries(event_map).forEach(([event_name, method_name]) => {
                if (typeof this[method_name] === 'function') {
                    this.root_element.addEventListener(event_name, (e) => {
                        this[method_name](e);
                    });
                }
            });
        }

        // 注册事件监听器
        on(event_name, selector, handler) {
            if (!this.event_listeners[event_name]) {
                this.event_listeners[event_name] = [];
            }

            this.event_listeners[event_name].push({selector, handler});

            if (this.is_mounted) {
                this.attach_event_handler(event_name, selector, handler);
            }
        }

        // 附加事件处理器
        attach_event_handler(event_name, selector, handler) {
            if (!this.root_element) return;

            if (selector === 'root') {
                this.root_element.addEventListener(event_name, handler);
            } else if (selector) {
                // 事件委托
                this.root_element.addEventListener(event_name, e => {
                    if (e.target.matches(selector)) {
                        handler.call(e.target, e);
                    }
                });
            } else {
                // 全局事件
                this.root_element.addEventListener(event_name, handler);
            }
        }

        // 作用域处理
        scope_css() {
            const scope_id = `component_${Math.random().toString(36).substr(2, 9)}`;
            this.root_element.id = scope_id;

            const style_elements = this.root_element.querySelectorAll('style');
            style_elements.forEach(style => {
                let css_text = style.textContent;

                // 简化作用域处理
                css_text = css_text.replace(/([^{}@]+)(?={)/g, (match) => {
                    return match.split(',').map(selector => {
                        if (selector.trim().startsWith('@')) return selector;
                        return `#${scope_id} ${selector.trim()}`;
                    }).join(',');
                });

                style.textContent = css_text;
            });
        }

        // 获取组件内容
        fetch_component(url) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    onload: response => {
                        if (response.status >= 200 && response.status < 300) {
                            resolve(response.responseText);
                        } else {
                            reject(new Error(`HTTP error! status: ${response.status}`));
                        }
                    },
                    onerror: error => reject(error)
                });
            });
        }

        // 初始化MutationObserver
        init_mutation_observer() {
            this.observer = new MutationObserver(mutations => {
                this.handle_mutations(mutations);
            });
        }

        // 处理DOM变化
        handle_mutations(mutations) {
            mutations.forEach(mutation => {
                if (mutation.type === 'childList') {
                    this.init_event_listeners();
                    this.render();
                }
            });
        }

        // 开始观察目标元素
        observe_target(target) {
            if (!this.observer || !target) return;
            this.observer.observe(target, this.config.mutation_observer_options);
        }

        // 停止观察
        disconnect_observer() {
            if (this.observer) {
                this.observer.disconnect();
            }
        }

        // 销毁组件
        destroy() {
            if (this.root_element?.parentNode) {
                this.root_element.parentNode.removeChild(this.root_element);
            }

            this.event_listeners = {};
            this.is_mounted = false;
            this.disconnect_observer();
        }

        // 默认事件处理方法（空实现，由子类覆盖）
        on_click(e) {}
        on_double_click(e) {}
        on_mouse_enter(e) {}
        on_mouse_leave(e) {}
        on_focus(e) {}
        on_blur(e) {}
        on_key_down(e) {}
        on_key_up(e) {}
        on_change(e) {}
        on_input(e) {}
        on_submit(e) {}
        on_load(e) {}
        on_error(e) {}
    }

    // 状态组件 - 负责视觉状态和操作反馈
    class StatefulComponent extends Component {
        constructor(options) {
            super({
                initial_state: {},
                ...options
            });

            // 状态管理
            this.state = {
                ...this.config.initial_state
            };

            // 初始尺寸记录
            this.initial_width = null;
            this.initial_height = null;
        }

        // 设置状态并重新渲染
        set_state(new_state) {
            this.state = {...this.state, ...new_state};
            this.render();
        }

        // 渲染组件（子类应覆盖此方法）
        render() {
            // 数据绑定
            const bindable_elements = this.root_element.querySelectorAll('[data-bind]');
            bindable_elements.forEach(el => {
                const state_key = el.getAttribute('data-bind');
                if (state_key in this.state) {
                    el.textContent = this.state[state_key];
                }
            });

            // 类绑定
            const class_elements = this.root_element.querySelectorAll('[data-class]');
            class_elements.forEach(el => {
                const class_mapping = JSON.parse(el.getAttribute('data-class'));
                Object.entries(class_mapping).forEach(([class_name, state_key]) => {
                    if (state_key in this.state) {
                        el.classList.toggle(class_name, !!this.state[state_key]);
                    }
                });
            });
        }

        // 记录初始尺寸
        record_initial_dimensions() {
            if (!this.root_element) return;
            const rect = this.root_element.getBoundingClientRect();
            this.initial_width = rect.width;
            this.initial_height = rect.height;
        }
    }

    // 异步状态组件 - 处理加载和错误状态
    class AsyncStateComponent extends StatefulComponent {
        constructor(options) {
            super({
                loading_animation: true,
                initial_state: {
                    is_loading: false,
                    has_error: false,
                    error_message: ''
                },
                ...options
            });

            // 交互状态保存
            this.original_pointer_events = null;
            this.original_cursor = null;

            // 加载动画元素
            this.loading_overlay = null;

            // 添加全局样式
            this.add_loading_animation_styles();
        }

        // 添加加载动画的全局样式
        add_loading_animation_styles() {
            if (!document.getElementById('stateful-loading-styles')) {
                const style = document.createElement('style');
                style.id = 'stateful-loading-styles';
                style.textContent = `
                    .stateful-loading-overlay {
                        position: absolute;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
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
                        width: 20px;
                        height: 20px;
                        position: relative;
                    }

                    .stateful-loading-spinner::before,
                    .stateful-loading-spinner::after {
                        content: '';
                        position: absolute;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
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
                `;
                document.head.appendChild(style);
            }
        }

        // 创建加载覆盖层
        create_loading_overlay() {
            if (this.loading_overlay) return;

            const rootPosition = window.getComputedStyle(this.root_element).position;
            if (rootPosition === 'static') {
                this.root_element.style.position = 'relative';
            }

            this.loading_overlay = document.createElement('div');
            this.loading_overlay.className = 'stateful-loading-overlay';

            const spinner = document.createElement('div');
            spinner.className = 'stateful-loading-spinner';

            this.loading_overlay.appendChild(spinner);
            this.root_element.appendChild(this.loading_overlay);

            // 阻止加载层上的交互
            this.loading_overlay.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
            });
        }

        // 显示加载状态
        show_loading() {
            if (!this.root_element) return;

            // 记录初始尺寸
            this.record_initial_dimensions();

            // 固定组件尺寸
            if (this.initial_width && this.initial_height) {
                this.root_element.style.width = `${this.initial_width}px`;
                this.root_element.style.height = `${this.initial_height}px`;
            }

            // 保存原始交互状态
            this.original_pointer_events = this.root_element.style.pointerEvents;
            this.original_cursor = this.root_element.style.cursor;

            // 冻结组件 - 禁止交互
            this.root_element.style.pointerEvents = 'none';
            this.root_element.style.cursor = 'not-allowed';

            // 创建加载覆盖层
            if (this.config.loading_animation && !this.loading_overlay) {
                this.create_loading_overlay();
            }

            // 更新状态
            this.set_state({
                is_loading: true,
                has_error: false,
                error_message: ''
            });

            // 显示加载动画
            if (this.loading_overlay) {
                this.loading_overlay.classList.add('active');
            }
        }

        // 隐藏加载状态
        hide_loading() {
            if (!this.root_element) return;

            // 恢复组件尺寸
            this.root_element.style.width = '';
            this.root_element.style.height = '';

            // 恢复原始交互状态
            if (this.original_pointer_events !== null) {
                this.root_element.style.pointerEvents = this.original_pointer_events;
            } else {
                this.root_element.style.removeProperty('pointer-events');
            }

            if (this.original_cursor !== null) {
                this.root_element.style.cursor = this.original_cursor;
            } else {
                this.root_element.style.removeProperty('cursor');
            }

            // 更新状态
            this.set_state({is_loading: false});

            // 隐藏加载动画
            if (this.loading_overlay) {
                this.loading_overlay.classList.remove('active');
            }
        }

        // 设置错误状态
        set_error(error) {
            this.hide_loading();

            // 更新状态
            this.set_state({
                has_error: true,
                error_message: error.message
            });

            // 显示错误通知
            GM_notification({
                title: "Component Error",
                text: error.message,
                timeout: 5000
            });
        }

        // 执行异步操作（带状态管理）
        async execute_async_operation(operation) {
            this.show_loading();

            try {
                const result = await operation();
                this.hide_loading();
                return result;
            } catch (error) {
                this.set_error(error);
                throw error;
            }
        }
    }

    // 支付按钮组件
    class PaymentButton extends AsyncStateComponent {
        constructor(options) {
            super({
                url: COMPONENT_URLS.BUTTON,
                root_selector: '#sb-payment-button',
                observe_changes: true,
                enable_css_scoping: false,
                loading_animation: true,
                ...options
            });

            // 跟踪定位状态
            this.is_positioned = false;
            this.original_button_content = null;
        }

        // 覆盖基类的点击处理方法
        on_click(e) {
            if (e.target === this.root_element ||
                e.target.closest('#sb-payment-button')) {
                this.handle_click();
            }
        }

        // 处理点击事件
        handle_click() {
            // 保存原始按钮内容
            if (!this.original_button_content) {
                this.original_button_content = this.root_element.innerHTML;
            }

            // 使用状态管理执行异步操作
            this.execute_async_operation(async () => {
                // 模拟支付处理
                await new Promise(resolve => setTimeout(resolve, 1500));
                return {success: true};
            }).then(result => {
                if (result.success) {
                    GM_notification({
                        title: "Payment Success",
                        text: "Payment processed successfully!",
                        timeout: 3000
                    });
                }
            }).catch(error => {
                console.error('Payment error:', error);
            });
        }

        // 定位按钮在Cancel和Edit之间
        position_between_cancel_and_edit() {
            const modal = document.querySelector('.booking-info-popup');
            if (!modal) return false;

            const footer = modal.querySelector('.modal-footer');
            if (!footer) return false;

            const cancel_btn = footer.querySelector('.btn-danger');
            const edit_btn = Array.from(footer.querySelectorAll('.btn-info'))
                .find(btn => btn.textContent.includes('Edit'));

            if (!cancel_btn || !edit_btn) return false;

            if (footer.querySelector('#sb-payment-button')) {
                return true;
            }

            cancel_btn.insertAdjacentElement('afterend', this.root_element);
            this.observe_target(footer);

            return true;
        }

        // 重写mount方法
        mount() {
            super.mount();
            this.is_positioned = this.position_between_cancel_and_edit();

            if (!this.is_positioned) {
                this.setup_backup_positioning();
            }
        }

        // 设置备用定位机制
        setup_backup_positioning() {
            const observer = new MutationObserver(() => {
                if (this.position_between_cancel_and_edit()) {
                    observer.disconnect();
                    this.is_positioned = true;
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            setTimeout(() => {
                observer.disconnect();
            }, 5000);
        }
    }

    // 主初始化函数
    function init_payment_button() {
        const payment_button = new PaymentButton();

        payment_button.load_promise.then(() => {
            if (!payment_button.is_positioned) {
                payment_button.setup_backup_positioning();
            }
        }).catch(error => {
            console.error('Payment button load error:', error);
        });
    }

    // 页面加载完成后执行
    if (document.readyState === 'complete') {
        init_payment_button();
    } else {
        window.addEventListener('load', init_payment_button);
    }
})();