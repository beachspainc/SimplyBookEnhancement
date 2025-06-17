// ==UserScript==
// @name         SimplyBook.me Payment Enhancement
// @namespace    http://tampermonkey.net/
// @version      8.6
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
        #element;
        #config;
        #event_listeners;
        #data;
        #parent_element;
        #custom_event_handlers = {};

        constructor(options) {
            this.#config = {
                parent: 'body',
                enable_css_scoping: true,
                initial_data: {},
                ...options
            };

            this.#element = null;
            this.#parent_element = null;
            this.#event_listeners = {};
            this.#data = { ...this.#config.initial_data };
        }

        get element() { return this.#element; }
        get is_loaded() { return !!this.#element; }
        get config() { return this.#config; }
        get data() { return {...this.#data}; }
        get is_mounted() { return this.#element?.parentNode && document.body.contains(this.#element); }

        async load() {
            if (this.is_loaded) return true;

            try {
                if (this.#config.element) this.#element = this.#config.element;
                else if (this.#config.html) this.#create_from_html(this.#config.html);
                else if (this.#config.url) {
                    const html = await this.#fetch_component(this.#config.url);
                    this.#create_from_html(html);
                }
                else throw new Error('Component requires element, html, or url');

                if (this.#config.enable_css_scoping) this.#scope_css();
                return true;
            } catch (error) {
                console.error('Component load error:', error);
                return false;
            }
        }

        #create_from_html(html) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            this.#element = this.#config.root_selector
                ? doc.querySelector(this.#config.root_selector)
                : doc.body.firstElementChild;

            if (!this.#element) throw new Error('Component element not found');
            this.#process_style_tags(doc);
        }

        #process_style_tags(doc) {
            const fragment = document.createDocumentFragment();
            doc.querySelectorAll('style').forEach(style => {
                const newStyle = document.createElement('style');
                newStyle.textContent = style.textContent;
                fragment.appendChild(newStyle);
            });
            this.#element?.appendChild(fragment);
        }

        async mount() {
            if (this.is_mounted) {
                console.warn('Component is already mounted');
                return true;
            }

            if (!this.is_loaded) throw new Error('Component must be loaded before mounting');

            this.#parent_element = typeof this.#config.parent === 'string'
                ? document.querySelector(this.#config.parent)
                : this.#config.parent;

            if (!this.#parent_element) {
                console.error('Parent element not found');
                return false;
            }

            this.#init_event_listeners();
            this.render();
            this.#parent_element.appendChild(this.#element);
            return true;
        }

        async unmount() {
            if (!this.is_mounted) {
                console.warn('Component not mounted');
                return false;
            }

            this.#remove_event_listeners();
            this.#element.parentNode?.removeChild(this.#element);
            return true;
        }

        #init_event_listeners() {
            if (!this.#element) return;

            const bindEvent = (event, handler) => this.#element.addEventListener(event, handler);

            Object.entries(this.#event_listeners).forEach(([event, listeners]) => {
                listeners.forEach(({ selector, handler }) => {
                    if (selector === 'root') bindEvent(event, handler);
                    else if (selector) bindEvent(event, e => e.target.matches(selector) && handler.call(e.target, e));
                });
            });

            Object.entries(this.#custom_event_handlers).forEach(([event, handler]) => bindEvent(event, handler));
        }

        #remove_event_listeners() {
            if (!this.#element) return;

            const unbindEvent = (event, handler) => this.#element.removeEventListener(event, handler);

            Object.entries(this.#event_listeners).forEach(([event, listeners]) => {
                listeners.forEach(({ selector, handler }) => selector && unbindEvent(event, handler));
            });

            Object.entries(this.#custom_event_handlers).forEach(([event, handler]) => unbindEvent(event, handler));
        }

        addEventHandler(event, handler) {
            this.#custom_event_handlers[event] = handler;
            if (this.is_mounted) this.#element.addEventListener(event, handler);
        }

        #scope_css() {
            if (!this.#element) return;

            const scope_id = `component_${Math.random().toString(36).slice(2, 11)}`;
            this.#element.id = scope_id;

            this.#element.querySelectorAll('style').forEach(style => {
                style.textContent = style.textContent.replace(/(^|\})([^{]+?\{)/g, `$1#${scope_id} $2`);
            });
        }

        #fetch_component(url) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    onload: r => r.status >= 200 && r.status < 300 ? resolve(r.responseText) : reject(r.status),
                    onerror: reject
                });
            });
        }

        update_data(new_data) {
            this.#data = { ...this.#data, ...new_data };
            if (this.is_mounted) this.render();
            return this;
        }

        destroy() {
            this.unmount();
            this.#event_listeners = {};
            this.#custom_event_handlers = {};
            this.#element = null;
        }

        render() {}
    }

    class AsyncStateComponent extends Component {
        #state;
        #loading_overlay;

        constructor(options) {
            super({
                initial_state: { is_loading: false, has_error: false, error_message: '' },
                ...options
            });
            this.#state = { ...this.config.initial_state };
            this.#loading_overlay = null;
            this.#init_loading_styles();
        }

        get state() { return {...this.#state}; }

        #init_loading_styles() {
            if (document.getElementById('stateful-loading-styles')) return;

            const style = document.createElement('style');
            style.id = 'stateful-loading-styles';
            style.textContent = `
                .stateful-loading-overlay {
                    position: absolute; top: 0; left: 0;
                    width: 100%; height: 100%;
                    background: rgba(255, 255, 255, 0.7);
                    display: flex; justify-content: center; align-items: center;
                    z-index: 1000; border-radius: inherit;
                    opacity: 0; transition: opacity 0.3s ease; pointer-events: none;
                }
                .stateful-loading-overlay.active { opacity: 1; pointer-events: auto; }
                .stateful-loading-spinner {
                    width: 20px; height: 20px; position: relative;
                }
                .stateful-loading-spinner::before, .stateful-loading-spinner::after {
                    content: ''; position: absolute; top: 0; left: 0;
                    width: 100%; height: 100%; border-radius: 50%;
                    border: 2px solid transparent;
                    animation: stateful-spin 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
                }
                .stateful-loading-spinner::before {
                    border-top-color: #3498db; animation-delay: -0.45s;
                }
                .stateful-loading-spinner::after {
                    border-top-color: #e74c3c; animation-delay: -0.15s;
                }
                @keyframes stateful-spin {
                    0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); }
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
            if (!this.element) return;

            const bind = {
                'data-bind': (el, key) => el.textContent = this.#state[key],
                'data-class': (el, attr) => {
                    const mapping = JSON.parse(attr);
                    Object.entries(mapping).forEach(([cls, key]) => el.classList.toggle(cls, !!this.#state[key]));
                },
                'data-bind-data': (el, key) => {
                    if (!(key in this.data)) return;
                    if (['INPUT','TEXTAREA','SELECT'].includes(el.tagName)) el.value = this.data[key];
                    else el.textContent = this.data[key];
                }
            };

            Object.entries(bind).forEach(([attr, handler]) => {
                this.element.querySelectorAll(`[${attr}]`).forEach(el => handler(el, el.getAttribute(attr)));
            });
        }

        #create_loading_overlay() {
            if (this.#loading_overlay) return;
            if (getComputedStyle(this.element).position === 'static') this.element.style.position = 'relative';

            this.#loading_overlay = document.createElement('div');
            this.#loading_overlay.className = 'stateful-loading-overlay';
            this.#loading_overlay.innerHTML = '<div class="stateful-loading-spinner"></div>';
            this.#loading_overlay.addEventListener('click', e => e.stopPropagation());
            this.element.appendChild(this.#loading_overlay);
        }

        set_loading(state) {
            if (!this.element) return;

            this.element.classList.toggle('stateful-loading', state);
            this.set_state({
                is_loading: state,
                has_error: state ? false : this.#state.has_error,
                error_message: state ? '' : this.#state.error_message
            });

            if (this.config.loading_animation) {
                if (state) {
                    this.#create_loading_overlay();
                    this.#loading_overlay?.classList.add('active');
                } else {
                    this.#loading_overlay?.classList.remove('active');
                }
            }
        }

        set_error(error) {
            this.set_loading(false);
            this.set_state({ has_error: true, error_message: error.message });
            GM_notification({ title: "Error", text: error.message, timeout: 5000 });
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
        constructor() {
            super({
                url: COMPONENT_URLS.BUTTON,
                root_selector: '#sb-payment-button',
                enable_css_scoping: false,
                initial_data: { selected_event: null }
            });
            this.addEventHandler('click', this.onClick.bind(this));
        }

        async mount() {
            if (!unsafeWindow.view?.infoForm?.footer?.[0] || !unsafeWindow.scheduler) {
                console.log('Waiting for unsafeWindow to load...');
                return false;
            }

            const { view, scheduler } = unsafeWindow;
            if (view.infoForm.footer[0].querySelector(this.config.root_selector)) return false;

            this.config.parent = view.infoForm.footer[0];
            if (!(await super.mount())) return false;

            scheduler.attachEvent("onClick", id => {
                this.update_data({ selected_event: scheduler.getEvent(id) });
                return true;
            });

            return true;
        }

        async unmount() {
            unsafeWindow.scheduler?.detachEvent("onClick");
            return super.unmount();
        }

        onClick(e) {
            if (!e.target.closest('#sb-payment-button') || !this.data.selected_event) return;

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

    class TipTag extends Component {
        #tip_amount;

        constructor() {
            super({
                html: `<span class="tip-tag" style="
                    display: inline-block; margin-left: 8px; color: #007bff;
                    cursor: pointer; text-decoration: none; transition: all 0.3s ease;
                    padding: 2px 6px; border-radius: 4px;">Add Tip</span>`,
                enable_css_scoping: true
            });

            this.#tip_amount = null;
            this.addEventHandler('mouseover', this.onMouseover.bind(this));
            this.addEventHandler('mouseout', this.onMouseout.bind(this));
            this.addEventHandler('click', this.onClick.bind(this));
        }

        onMouseover() {
            if (!this.element) return;
            this.element.style.background = '#f0f7ff';
            this.element.style.textDecoration = 'underline';
            this.element.style.transform = 'translateY(-1px)';
        }

        onMouseout() {
            if (!this.element) return;
            this.element.style.background = 'transparent';
            this.element.style.textDecoration = 'none';
            this.element.style.transform = 'none';
        }

        onClick() {
            const tipAmount = prompt('Enter tip amount (e.g. 5.00):', '5.00');
            if (!tipAmount) return;

            this.#tip_amount = parseFloat(tipAmount);
            if (isNaN(this.#tip_amount)) {
                GM_notification({ title: "Invalid Amount", text: "Please enter a valid number", timeout: 3000 });
                return;
            }

            if (this.element) {
                this.element.textContent = `Tip: $${this.#tip_amount.toFixed(2)}`;
                this.element.style.color = '#28a745';
                this.element.style.fontWeight = 'bold';
            }

            GM_notification({
                title: "Tip Added",
                text: `$${this.#tip_amount.toFixed(2)} tip added to order`,
                timeout: 3000
            });
        }

        async mount() {
            const body = unsafeWindow.view?.infoForm?.body?.[0];
            if (!body) {
                console.log('Waiting for unsafeWindow to load...');
                return false;
            }

            // 检查是否已存在tip标签
            if (body.querySelector('.tip-tag')) {
                return false;
            }

            // 查找目标父元素
            const targetParent = this.#findTargetParent(body);
            if (!targetParent) {
                // 使用MutationObserver等待目标元素出现
                const observer = new MutationObserver(() => {
                    const parent = this.#findTargetParent(body);
                    if (parent) {
                        observer.disconnect();
                        this.config.parent = parent;
                        super.mount();
                    }
                });

                observer.observe(body, {
                    childList: true,
                    subtree: true
                });

                return true;
            }

            // 直接挂载到找到的父元素
            this.config.parent = targetParent;
            return super.mount();
        }

        #findTargetParent(infoFormBody) {
            try {
                // 更精确地定位目标位置
                const priceContainer = infoFormBody.querySelector(
                    '#booking-info .top-block.row .col-md-8.col-sm-7 ul li:nth-child(3) span'
                );

                return priceContainer || null;
            } catch (error) {
                console.error('Error finding target parent:', error);
                return null;
            }
        }
    }

    async function initializeComponents() {
        try {
            const payment_button = new PaymentButton();
            if (await payment_button.load()) await payment_button.mount();

            const tips_label = new TipTag();
            if (await tips_label.load()) await tips_label.mount();
        } catch (error) {
            console.error('Initialization error:', error);
        }
    }

    class HierarchicalComponent extends Component {}
    window.addEventListener('load', initializeComponents);
})();