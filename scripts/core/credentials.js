// ==UserScript==
// @name         Global Secure Credential Manager
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Global secure credential storage API with AES-256 encryption
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @run-at       document-start
// @require      https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js
// ==/UserScript==

(function() {
    'use strict';

    // 配置设置
    const CONFIG = {
        prefix: 'global_cred_manager_'
    };

    function getPath(domain) {
        return `${CONFIG.prefix}creds_${domain}`;
    }

    // 凭证管理API
    const CredentialManager = {
        /**
         * 保存加密后的凭证
         * @param {string} domain - 域名
         * @param {Object} credentials - 凭证对象 {username, password}
         * @param {string} key - 加密密钥
         * @returns {boolean} 是否保存成功
         */
        saveCredentials: (domain, credentials, key) => {
            if (!domain || !credentials || !key) return false;
            const credentialsJSON = JSON.stringify(credentials);
            const encrypted = CryptoJS.AES.encrypt(credentialsJSON, key).toString();
            GM_setValue(getPath(domain), encrypted);
            return true;
        },

        /**
         * 获取并解密凭证
         * @param {string} domain - 域名
         * @param {string} key - 加密密钥
         * @returns {Object|null} 解密后的凭证对象
         */
        getCredentials: (domain, key) => {
            const credential = GM_getValue(getPath(domain));
            if (!credential) return null;

            try {
                const bytes = CryptoJS.AES.decrypt(credential, key);
                const decrypted = bytes.toString(CryptoJS.enc.Utf8);
                return JSON.parse(decrypted);
            } catch (e) {
                console.error('解密失败:', e);
                return null;
            }
        },

        /**
         * 删除指定域名的凭证
         * @param {string} domain - 域名
         * @returns {boolean} 是否重置成功
         */
        resetCredentials: (domain) => {
            GM_setValue(getPath((domain)), '');
            return true;
        },

        /**
         * 保存密钥选项状态
         * @param {string} domain - 域名
         * @param {boolean} saveKey - 是否保存密钥
         * @param {string} key - 密钥（如果需要保存）
         */
        saveKeyOption: (domain, saveKey, key = '') => {
            GM_setValue(`${CONFIG.prefix}save_key_checked_${domain}`, saveKey);
            if (saveKey && key) {
                GM_setValue(`${CONFIG.prefix}saved_key_${domain}`, key);
            } else {
                GM_setValue(`${CONFIG.prefix}saved_key_${domain}`, '');
            }
        },

        /**
         * 获取保存的密钥选项
         * @param {string} domain - 域名
         * @returns {Object} {savedKey, saveKeyChecked}
         */
        getKeyOption: (domain) => {
            return {
                savedKey: GM_getValue(`${CONFIG.prefix}saved_key_${domain}`, ''),
                saveKeyChecked: GM_getValue(`${CONFIG.prefix}save_key_checked_${domain}`, false)
            };
        }
    };

    // 暴露API到全局对象
    unsafeWindow.GlobalCredentialManager = CredentialManager;
})();