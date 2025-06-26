// ==UserScript==
// @name         全面敏感信息检查器
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  检查网页中各种存储、缓存和变量中的敏感信息，如 token、密码、密钥、JWT 等
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @grant        GM_addStyle
// @require      https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js
// ==/UserScript==

(function() {
    'use strict';

    // 配置: 要搜索的目标键
    const TARGET_KEY = "token"; // 可以修改为其他要搜索的键名

    function checkValueCondition(key, value) {
        const sensitiveKeyPattern = /(token|auth|access|secret|key|password|credential|session)/i;
        const jwtPattern = /^eyJ[a-z0-9]+\.[a-z0-9]+\.[a-z0-9_-]+$/i;
        const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
        const digit64Pattern = /^[0-9]{64}$/;

        if (!key || value === undefined || value === null) return false;
        if (sensitiveKeyPattern.test(key)) return true;
        if (typeof value === 'string') {
            if (jwtPattern.test(value)) return true;
            if (uuidPattern.test(value)) return true;
            if (digit64Pattern.test(value)) return true;
        }
        return false;
    }

    function checkStandardStorages() {
        const results = [];
        const types = [localStorage, sessionStorage];
        types.forEach((storage, idx) => {
            const type = idx === 0 ? 'LocalStorage' : 'SessionStorage';
            for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                const value = storage.getItem(key);
                if (checkValueCondition(key, value)) {
                    results.push({ type, key, value, domain: location.origin });
                }
            }
        });
        return results;
    }

    async function checkIndexedDB() {
        const results = [];
        if (!window.indexedDB || !indexedDB.databases) return results;

        try {
            const dbs = await indexedDB.databases();
            for (const dbInfo of dbs) {
                try {
                    const db = await new Promise((resolve, reject) => {
                        const req = indexedDB.open(dbInfo.name, dbInfo.version);
                        req.onsuccess = () => resolve(req.result);
                        req.onerror = reject;
                    });
                    for (const storeName of Array.from(db.objectStoreNames)) {
                        const tx = db.transaction(storeName, 'readonly');
                        const store = tx.objectStore(storeName);
                        const cursorReq = store.openCursor();

                        await new Promise(resolve => {
                            cursorReq.onsuccess = event => {
                                const cursor = event.target.result;
                                if (cursor) {
                                    const key = cursor.key;
                                    const value = cursor.value;
                                    if (checkValueCondition(key, value)) {
                                        results.push({
                                            type: 'IndexedDB',
                                            database: dbInfo.name,
                                            store: storeName,
                                            key,
                                            value,
                                            domain: location.origin
                                        });
                                    }
                                    cursor.continue();
                                } else {
                                    resolve();
                                }
                            };
                            cursorReq.onerror = () => resolve();
                        });
                    }
                    db.close();
                } catch (e) {
                    console.error('IndexedDB 检查失败:', dbInfo.name, e);
                }
            }
        } catch (e) {
            console.error('获取 IndexedDB 列表失败', e);
        }
        return results;
    }

    async function checkServiceWorkerCaches() {
        const results = [];
        if (!navigator.serviceWorker || !caches) return results;

        try {
            const cacheNames = await caches.keys();
            for (const name of cacheNames) {
                const cache = await caches.open(name);
                const requests = await cache.keys();
                for (const req of requests) {
                    const res = await cache.match(req);
                    if (!res) continue;

                    for (const [key, val] of res.headers.entries()) {
                        if (checkValueCondition(key, val)) {
                            results.push({
                                type: 'ServiceWorkerCache',
                                cache: name,
                                source: req.url,
                                key: `header:${key}`,
                                value: val,
                                domain: location.origin
                            });
                        }
                    }

                    const text = await res.text();
                    if (checkValueCondition('body', text)) {
                        results.push({
                            type: 'ServiceWorkerCache',
                            cache: name,
                            source: req.url,
                            key: 'body',
                            value: text,
                            domain: location.origin
                        });
                    }
                }
            }
        } catch (e) {
            console.error('缓存检查失败', e);
        }
        return results;
    }

    // 修改后的全局变量检查函数
    function findTargetKeyPaths() {
        const results = [];
        const global = unsafeWindow || window;
        const seen = new WeakSet();

        function scan(obj, path = 'window') {
            if (!obj || typeof obj !== 'object' || seen.has(obj)) return;
            seen.add(obj);

            try {
                for (const key of Object.keys(obj)) {
                    const fullPath = `${path}.${key}`;
                    const value = obj[key];

                    // 检查路径中是否包含目标键 (不区分大小写)
                    if (key.toLowerCase().includes(TARGET_KEY.toLowerCase())) {
                        results.push({
                            type: 'GlobalVariable',
                            key: fullPath,
                            value,
                            domain: location.origin
                        });
                    }

                    // 继续递归扫描
                    if (typeof value === 'object' && value !== null) {
                        scan(value, fullPath);
                    }
                }
            } catch (e) {
                // 忽略无法访问的属性
            }
        }

        scan(global);
        return results;
    }

    function checkDOMStorage() {
        const results = [];
        document.querySelectorAll('meta').forEach(meta => {
            const name = meta.getAttribute('name') || meta.getAttribute('property') || '';
            const content = meta.getAttribute('content') || '';
            if (checkValueCondition(name, content)) {
                results.push({ type: 'DOMElement', element: 'meta', key: name, value: content, domain: location.origin });
            }
        });

        document.querySelectorAll('input[type="hidden"]').forEach(input => {
            const name = input.name || '';
            const value = input.value || '';
            if (checkValueCondition(name, value)) {
                results.push({ type: 'DOMElement', element: 'input', key: name, value, domain: location.origin });
            }
        });

        return results;
    }

    async function checkHttpOnlyCookies() {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: location.href,
                anonymous: true,
                onload: function(res) {
                    const results = [];
                    const headers = res.responseHeaders;
                    const matchAll = headers.match(/set-cookie: ([^=]+)=([^;]+)/gi) || [];
                    matchAll.forEach(str => {
                        const [, key, val] = str.match(/set-cookie: ([^=]+)=([^;]+)/i);
                        if (checkValueCondition(key, val)) {
                            results.push({
                                type: 'HTTPOnlyCookie',
                                key,
                                value: val,
                                source: 'ResponseHeader',
                                domain: location.hostname
                            });
                        }
                    });
                    resolve(results);
                },
                onerror: () => resolve([])
            });
        });
    }

    async function performFullCheck() {
        const results = [];
        const seen = new Set();

        const addUnique = item => {
            const val = JSON.stringify(item.value);
            if (!seen.has(val)) {
                seen.add(val);
                results.push(item);
            }
        };

        [
            ...checkStandardStorages(),
            ...findTargetKeyPaths(), // 使用修改后的函数
            ...checkDOMStorage(),
            ...await checkIndexedDB(),
            ...await checkServiceWorkerCaches(),
            ...await checkHttpOnlyCookies()
        ].forEach(addUnique);

        if (results.length === 0) {
            console.log('%c[敏感信息检查器] 未发现敏感信息。', 'color: orange');
        } else {
            console.log(`%c[敏感信息检查器] 发现 ${results.length} 项敏感信息:`, 'color: red');
            console.table(results.map(r => ({
                Type: r.type,
                Key: r.key,
                Value: Array.isArray(r.value) ? r.value.join(', ') : r.value,
                Domain: r.domain
            })));
        }
    }

    setTimeout(() => performFullCheck().catch(console.error), 3000);
})();