// ==UserScript==
// @name         SimplyBook.me Payment Enhancement
// @namespace    http://tampermonkey.net/
// @version      5.4
// @description  Optimized component architecture with unified event system
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
        // 私有属性声明
        #root_element;
        #config;
        #event_listeners;
        #is_mounted;

        constructor(options) {
            this.#config = { container: 'body', enable_css_scoping: true, ...options };
            this.#root_element = this._container_element = null;
            this.#event_listeners = {};
            this.#is_mounted = false;
            this.load();
        }

        // Getter for config
        get config() {
            return this.#config;
        }

        // Getter for root_element
        get root_element() {
            return this.#root_element;
        }

        // Getter for event_listeners
        get event_listeners() {
            return this.#event_listeners;
        }

        async load() {
            const html = await this.#fetch_component(this.#config.url).catch(error => {
                console.error('Component load error:', error);
                return null;
            });
            if (!html) return;

            const doc = new DOMParser().parseFromString(html, 'text/html');
            this.#root_element = this.#config.root_selector ?
                doc.querySelector(this.#config.root_selector) : doc.body.firstElementChild;
            if (!this.#root_element) throw new Error('Root element not found');

            this.#process_style_tags(doc);
            if (this.#config.enable_css_scoping) this.#scope_css();

            this.mount();
        }

        #process_style_tags(doc) {
            const fragment = document.createDocumentFragment();
            doc.querySelectorAll('style').forEach(style => {
                const newStyle = document.createElement('style');
                newStyle.textContent = style.textContent;
                fragment.appendChild(newStyle);
            });
            this.#root_element.appendChild(fragment);
        }

        mount() {
            if (this.#is_mounted) return;
            this._container_element = document.querySelector(this.#config.container);
            if (!this._container_element) throw new Error(`Container not found: ${this.#config.container}`);

            this._on_mount();
            this.#init_event_listeners();
            this.render();
            this.#is_mounted = true;
        }

        #init_event_listeners() {
            if (!this.#root_element) return;
            const event_map = {
                'click': '_on_click',
                'dblclick': '_on_double_click',
                'mouseenter': '_on_mouse_enter',
                'mouseleave': '_on_mouse_leave',
                'focus': '_on_focus',
                'blur': '_on_blur',
                'keydown': '_on_key_down',
                'keyup': '_on_key_up',
                'change': '_on_change',
                'input': '_on_input',
                'submit': '_on_submit',
                'load': '_on_load',
                'error': '_on_error'
            };

            Object.entries(event_map)
                .filter(([, method]) => typeof this[method] === 'function')
                .forEach(([event, method]) =>
                    this.on(event, 'root', e => this[method](e))
                );

            Object.entries(this.#event_listeners).forEach(([event, listeners]) => {
                listeners.forEach(({selector, handler}) => {
                    if (selector === 'root') this.#root_element.addEventListener(event, handler);
                    else if (selector) this.#root_element.addEventListener(event, e => {
                        if (e.target.matches(selector)) handler.call(e.target, e);
                    });
                    else this.#root_element.addEventListener(event, handler);
                });
            });
        }

        on(event, selector, handler) {
            this.#event_listeners[event] ||= [];
            this.#event_listeners[event].push({selector, handler});
            if (this.#is_mounted) this.#attach_event_handler(event, selector, handler);
        }

        #attach_event_handler(event, selector, handler) {
            if (!this.#root_element) return;
            if (selector === 'root') this.#root_element.addEventListener(event, handler);
            else if (selector) this.#root_element.addEventListener(event, e => {
                if (e.target.matches(selector)) handler.call(e.target, e);
            });
            else this.#root_element.addEventListener(event, handler);
        }

        #scope_css() {
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
            return new Promise((resolve, reject) => GM_xmlhttpRequest({
                method: 'GET', url,
                onload: r => r.status >= 200 && r.status < 300 ? resolve(r.responseText) : reject(r.status),
                onerror: reject
            }));
        }

        destroy() {
            this.#root_element?.parentNode?.removeChild(this.#root_element);
            this.#event_listeners = {};
            this.#is_mounted = false;
        }
        render() {}
        _on_mount() { throw new Error('_mount_control() must be implemented'); }
        _on_click() {} _on_double_click() {} _on_mouse_enter() {} _on_mouse_leave() {}
        _on_focus() {} _on_blur() {} _on_key_down() {} _on_key_up() {} _on_change() {}
        _on_input() {} _on_submit() {} _on_load() {} _on_error() {}
    }

    class AsyncStateComponent extends Component {
        // 私有属性声明
        #state;
        #loading_overlay;

        constructor(options) {
            super({
                loading_animation: true,
                initial_state: { is_loading: false, has_error: false, error_message: '', ...options?.initial_state },
                ...options
            });
            this.#state = { ...this.config.initial_state };
            this.#loading_overlay = null;
            this.#init_loading_styles();
        }

        // Getter for state
        get state() {
            return this.#state;
        }

        // Getter for loading_overlay
        get loading_overlay() {
            return this.#loading_overlay;
        }

        #init_loading_styles() {
            if (document.getElementById('stateful-loading-styles')) return;
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

        set_state(new_state) {
            this.#state = { ...this.#state, ...new_state };
            this.render();
        }

        render() {
            this.root_element.querySelectorAll('[data-bind]').forEach(el => {
                const key = el.getAttribute('data-bind');
                if (key in this.#state) el.textContent = this.#state[key];
            });
            this.root_element.querySelectorAll('[data-class]').forEach(el => {
                const mapping = JSON.parse(el.getAttribute('data-class'));
                Object.entries(mapping).forEach(([cls, key]) => {
                    if (key in this.#state) el.classList.toggle(cls, !!this.#state[key]);
                });
            });
        }

        #create_loading_overlay() {
            if (this.#loading_overlay) return;
            if (getComputedStyle(this.root_element).position === 'static')
                this.root_element.style.position = 'relative';
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
                const rect = this.root_element.getBoundingClientRect();
                this.root_element.style.width = `${rect.width}px`;
                this.root_element.style.height = `${rect.height}px`;
                this.root_element.style.pointerEvents = 'none';
                this.root_element.style.cursor = 'not-allowed';

                if (this.config.loading_animation && !this.#loading_overlay) {
                    this.#create_loading_overlay();
                }

                this.set_state({ is_loading: true, has_error: false, error_message: '' });
                if (this.#loading_overlay) this.#loading_overlay.classList.add('active');
            } else {
                this.root_element.style.width = '';
                this.root_element.style.height = '';
                this.root_element.style.pointerEvents = '';
                this.root_element.style.cursor = '';

                this.set_state({ is_loading: false });
                if (this.#loading_overlay) this.#loading_overlay.classList.remove('active');
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
                enable_css_scoping: false
            });
        }

        _on_mount() {
            if (!this.#position_button()) {
                const observer = new MutationObserver(() => this.#position_button() && observer.disconnect());
                observer.observe(document.body, { childList: true, subtree: true });
                setTimeout(() => observer.disconnect(), 5000);
            }
        }

        #position_button() {
            const footer = document.querySelector('.modal-footer');
            const cancelBtn = footer?.querySelector('.btn-danger');
            if (!footer || !cancelBtn) return false;
            if (footer.querySelector('#sb-payment-button')) return true;
            cancelBtn.insertAdjacentElement('afterend', this.root_element);
            return true;
        }

        _on_click(e) {
            if (e.target.closest('#sb-payment-button')) {
                this.execute_async_operation(async () => {
                    await new Promise(r => setTimeout(r, 1500));
                    GM_notification({
                        title: "Payment Success",
                        text: "Payment processed!",
                        timeout: 3000
                    });
                    return true;
                }).catch(console.error);
            }
        }
    }
    const view = unsafeWindow.view;
    console.log(view);
    const scheduler = unsafeWindow.scheduler
    console.log(scheduler);
    scheduler.attachEvent("onClick", function(id, e) {
        const event = scheduler.getEvent(id);
        //new PaymentButton().mount();
        return true;
    });
    if (document.readyState === 'complete') new PaymentButton();
    else window.addEventListener('load', () => new PaymentButton());
})();