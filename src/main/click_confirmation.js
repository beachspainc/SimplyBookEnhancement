// ==UserScript==
// @name         SimplyBook.me Booking Helper
// @namespace    http://tampermonkey.net/
// @version      16.0
// @description  The definitive, professionally architected script. Solves race conditions by using a single event source.
// @author       Gemini & User
// @match        https://*.simplybook.me/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const parser = (function() {

        class BookingInfo {
            constructor(client_name, service_name, date, time, duration, provider_name) {
                this.data = {
                    client_name,
                    service_name,
                    date,
                    time,
                    duration,
                    provider_name
                };
                Object.freeze(this.data);
            }

            get client_name() {
                return this.data.client_name;
            }
            /**
             * 方式一：传入“函数”
             * @template TParams, TReturn
             * @overload
             * @param {(params: TParams) => TReturn} fnOrRef 目标函数
             * @param {string | string[] | Record<string, unknown>} fields 需要传递的字段；'key' | ['key'] | { key: 1 }
             * @param {any} [thisArg] 可选：若目标函数内部需要 this，则传入绑定对象
             * @returns {TReturn}
             */

            /**
             * 方式二：传入“[对象, 方法名]”
             * 对象上该方法需满足 (params: TParams) => TReturn
             * @template TParams, TReturn
             * @overload
             * @param {[Record<string, (p: TParams) => TReturn>, string]} fnOrRef [对象, 方法名]
             * @param {string | string[] | Record<string, unknown>} fields 需要传递的字段；'key' | ['key'] | { key: 1 }
             * @returns {TReturn}
             */

            /**
             * 实际实现签名（联合）
             * @template TParams, TReturn
             * @param {((params: TParams) => TReturn) | [Record<string, (p: TParams) => TReturn>, string]} fnOrRef
             * @param {string | string[] | Record<string, unknown>} fields
             * @param {any} [thisArg]
             * @returns {TReturn}
             */
            delegate(fnOrRef, fields, thisArg) {
                /** @type {string[]} */
                const keys =
                    typeof fields === 'string'
                        ? [fields]
                        : Array.isArray(fields)
                            ? fields
                            : (fields && typeof fields === 'object')
                                ? Object.keys(fields)
                                : [];
                /** @type {Record<string, any>} */
                const params = {};
                for (const k of keys) {
                    if (k in this) {
                        params[k] = this[k];
                    } else if (this.data && k in this.data) {
                        params[k] = this.data[k];
                    }
                }

                if (Array.isArray(fnOrRef) && fnOrRef.length === 2) {
                    const [obj, methodName] = fnOrRef;
                    const method = obj?.[methodName];
                    if (typeof method !== 'function') {
                        throw new TypeError('delegate: 无效的方法引用 [obj, methodName]');
                    }
                    // @ts-ignore
                    return method.call(obj, /** @type {any} */ (params));
                }

                if (typeof fnOrRef === 'function') {
                    // @ts-ignore
                    return fnOrRef.call(thisArg ?? undefined, /** @type {any} */ (params));
                }

                throw new TypeError('delegate: fnOrRef 必须是函数或 [对象, 方法名] 形式');
            }


        }

        const BookingAPI = {
            getCustomer({ client_name }) {
                console.log("getCustomer ->", client_name);
                return { ok: true, client_name };
            },
            getService({ service_name }) {
                console.log("getService ->", service_name);
                return { ok: true, service_name };
            },
            // 需要 this 的例子
            _prefix: "[API]",
            withThis({ client_name }) {
                console.log(this._prefix, client_name); // 依赖 this
                return { ok: true, tag: this._prefix, client_name };
            }
        };
        const info = new BookingInfo("Alice", "Massage", "2025-08-20", "14:00", 60, "Bob");

        // 方式 A：对象 + 方法名（自动保持 this）
        info.delegate(BookingAPI.getCustomer, { client_name });

// 方式 B：传裸函数 + 字段数组（若函数不需要 this）
        info.delegate(BookingAPI.getService, ["service_name"]);
// 等价于：BookingAPI.getService({ service_name: "Massage" })

// 方式 C：传裸函数但需要 this -> 给个 thisArg
        info.delegate(BookingAPI.withThis, { client_name }, BookingAPI);
        class BookingResult {
            constructor(parsed_data) {
                this.data = parsed_data;
                Object.freeze(this);
            }
            confirmation() {
                const { client_name, service_line, date, time, provider } = this.data;
                return `
Beach Spa & Massage
Hi ${client_name}, Thank you for booking with us.
📅 Your appointment is confirmed for: ${service_line} at ${date} ${time}
🧑‍🔧 Your massage therapist: ${provider}
📍 Address: 2720 N Mall Dr Ste 124 Virginia Beach, VA 23452
If you have any questions or requests, feel free to contact us anytime.
`;
            }
        }

        function minutes(text) {
            if (typeof text !== 'string' || text.trim() === '') return "0 Minutes";
            const multipliers = { h: 60, hr: 60, m: 1, min: 1 };
            const regex = /(\d+)\s*([a-z]+)/gi;
            const minutes = [...text.matchAll(regex)].reduce((total, match) => {
                const value = parseInt(match[1], 10);
                const unit = match[2].toLowerCase();
                const multiplier = multipliers[unit];
                return total + (multiplier ? (value * multiplier) : 0);
            }, 0);
            return `${minutes} Minutes`;
        }

        return {
            code() {

            },
            generate() {
                const client_name = document.querySelector('#view-client-info .data.main span').innerText.trim();
                const service_name = document.querySelector('.service-name').innerText.trim();
                const date = document.querySelector('.date-from').innerText.trim();
                const time_text = document.querySelector('.time-from').innerText.trim();
                const duration_text = document.querySelector('.duration span').innerText.trim();
                let provider = document.querySelector('.perfomer-name span').innerText.trim();

                if (provider.includes('(')) { provider = provider.split('(')[0].trim(); }

                const duration = minutes(duration_text);
                const service_line = `${duration} - ${service_name}`;
                const time = time_text.substring(0, 7);

                return new BookingResult({ client_name, service_line, date, time, provider });
            }
        };
    })();


    function attach_hook(hook, callback) {
        if (typeof hook !== 'function') throw new Error("Hook Error: Invalid hook function provided.")
        if (typeof callback != 'function') throw new Error("Hook Error: Invalid callback function provided.")
        return hook(callback);
    }


    function hook_info_shown() {

    }
    function hook_form(callback) {
        if (typeof callback !== 'function') throw new Error("Hook Error: Invalid callback function provided.")
        if (!window.jQuery || !window.view?.infoForm) throw new Error("Hook Error: Page components are not available.");
        const observer = new MutationObserver((mutations, obs) => {
            const node = document.querySelector('#booking-info');
            if (node && node.children.length > 0) {
                callback();
                obs.disconnect();
            }
        });
    }


    // function attach_hook(on_ready) {
    //
    //     if (typeof on_ready !== 'function') throw new Error("Hook Error: Invalid callback function provided.")
    //     if (!window.jQuery || !window.view?.infoForm) throw new Error("Hook Error: Page components are not available.");
    //     const observer = new MutationObserver((mutations, obs) => {
    //         const node = document.querySelector('#booking-info');
    //         if (node && node.children.length > 0) {
    //             on_ready();
    //             obs.disconnect();
    //         }
    //     });
    //
    //     jQuery(window.view.infoForm).off('formShown.bookingHook').on('formShown.bookingHook', function(event) {
    //         const id = event?.delegateTarget?.id;
    //         if (!id) return;
    //         console.log(`[Hook] formShown event for booking ID: ${id}. Waiting for content...`);
    //         const form = window.view.infoForm.body?.[0];
    //         if (form) observer.observe(form, { childList: true, subtree: true });
    //     });
    // }

    function process_info() {
        const confirmation = parser.generate().confirmation();
        if (confirmation) console.log(confirmation);
    }

    function run() {
        attach_hook(process_info);
        console.debug("Booking hook has been initialized.");
    }

    run();

})();