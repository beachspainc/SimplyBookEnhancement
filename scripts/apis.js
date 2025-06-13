// ==UserScript==
// @name         SimplyBook.me APIs
// @namespace    http://tampermonkey.net/
// @version      1.21
// @description  Add more features to SimplyBook.me
// @author       LilPoppy
// @match        https://*.secure.simplybook.me/v2/index/index
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @icon         https://simplybook.me/favicon.ico
// @connect      user-api-v2.simplybook.me
// @run-at       document-end
// ==/UserScript==
(function() {
    'use strict';

    const CONFIG = {
        COMPANY: window.location.hostname.split('.')[0],
        CRYPTO_TOKEN: "M7dzUz7zCb4g6R5",
        API_KEY: "2fefa78171e0c3cd0d7a81e95ef58fd14f474566faabda4abb56bbbd15200c0f",
        API_BASE_URL: 'https://user-api-v2.simplybook.me'
    };

    /**
     *
     * @param cacheKey
     * @param ttl
     * @returns {function(*, *, *): *}
     */
    function cacheResult(cacheKey, ttl = 60 * 60 * 1000) {
        return function (target, propertyKey, descriptor) {
            const originalMethod = descriptor.value;

            descriptor.value = async function (...args) {
                const key = `${cacheKey}:${propertyKey}:${JSON.stringify(args)}`;

                try {
                    const cached = localStorage.getItem(key);
                    if (cached) {
                        const { value, expires } = JSON.parse(cached);
                        if (!expires || Date.now() < expires) {
                            console.debug(`[Cache] Hit for ${key}`);
                            return value;
                        }
                    }
                } catch (e) {
                    console.warn(`Cache load failed for ${key}`, e);
                }

                console.debug(`[Cache] Miss for ${key}`);
                const result = await originalMethod.apply(this, args);
                try {
                    localStorage.setItem(key, JSON.stringify({
                        value: result,
                        expires: ttl ? Date.now() + ttl : null
                    }));
                } catch (e) {
                    console.warn(`Cache save failed for ${key}`, e);
                }
                return result;
            };

            return descriptor;
        };
    }
    /**
     * 获取构造函数参数信息
     * @param {Function} targetClass - 目标类
     * @returns {Object} { paramNames: Array<string>, paramTypes: { [name]: string } }
     */
    function getConstructorParamsInfo(targetClass) {
        const constructorStr = targetClass.toString();
        const paramNames = constructorStr
            .match(/constructor\s*\(([^)]*)\)/)[1]
            .split(',')
            .map(param => param.trim().replace(/\/\*[^*]*\*\//g, '').split('=')[0].trim())
            .filter(name => name);
        const paramTypes = {};
        const jsdocMatch = constructorStr.match(/\/\*\*([\s\S]*?)\*\/\s*constructor\(/);
        if (jsdocMatch) {
            const lines = jsdocMatch[1].split('\n');
            lines.forEach(line => {
                const paramMatch = line.match(/@param\s+{([^}]+)}\s+(\w+)/);
                if (paramMatch) {
                    const [, type, name] = paramMatch;
                    paramTypes[name] = type;
                }
            });
        }
        return { paramNames, paramTypes };
    }

    /**
     * 解析 JSDoc 类型字符串
     * @param {string} typeStr - JSDoc 类型字符串
     * @returns {Array} [基本类型, 是否为数组]
     */
    function parseJsdocType(typeStr) {
        const isArray = typeStr.includes('[]') || /^array\|/i.test(typeStr);
        const baseType = typeStr
            .replace(/\[\]$/g, '')
            .replace(/^array\|/i, '')
            .split('|')[0]
            .trim();

        return [baseType, isArray];
    }
    /**
     * 根据类型注解转换值
     * @param {*} value - 输入值
     * @param {string} typeStr - JSDoc 类型字符串
     * @returns {*} 转换后的值
     */
    function convertByJsdocType(value, typeStr) {
        if (value === null || value === undefined) return value;
        const [baseType, isArray] = parseJsdocType(typeStr);
        if (isArray && Array.isArray(value))  return value.map(item => convertByJsdocType(item, baseType));
        switch (baseType.toLowerCase()) {
            case 'number':
            case 'int':
            case 'integer':
            case 'float':
            case 'double':
                return Number(value);
            case 'boolean':
            case 'bool':
                return Boolean(value);
            case 'string':
            case 'str':
                return String(value);
            case 'null':
            case 'undefined':
            case 'any':
            case 'Array':
                return value;
            default:
                try {
                    const type = eval(baseType);
                    if (typeof type === 'function') {
                        return new type(...valuesOf(value, type));
                    }
                } catch (e) {
                    return value;
                }

        }
    }

    /**
     * 从数据中提取并转换目标类需要的值
     * @param {Object|Array} entries - 输入数据
     * @param {Function} targetClass - 目标类构造函数
     * @returns {Array} 构造函数参数数组
     */
    function valuesOf(entries, targetClass) {
        const { paramNames, paramTypes } = getConstructorParamsInfo(targetClass);
        const result = new Array(paramNames.length);
        const entriesIter = Array.isArray(entries) ? entries : Object.entries(entries);

        for (const entry of entriesIter) {
            let key, value;
            if (Array.isArray(entry)) [key, value] = entry;
            else if (entry && typeof entry === 'object')  ({key, value} = entry);
            else continue;
            if (paramNames.includes(key)) {
                const index = paramNames.indexOf(key);
                const type = paramTypes[key];
                result[index] = type ? convertByJsdocType(value, type) : value;
            }
        }
        return result;
    }

    // Error class for API exceptions
    class APIError extends Error {
        constructor(message, type, errors) {
            super(message);
            this.name = "APIError";
            this.type = type;
            this.errors = errors || {};
        }
    }

    class RestClient {
        constructor(base_url) {
            this.baseUrl = base_url;
        }

        /**
         * 发送 HTTP 请求（精简版）
         * @param {string} endpoint - API 端点
         * @param {string} method - HTTP 方法
         * @param {object} [body] - 请求体数据
         * @param {object} [headers={}] - 额外的请求头
         * @param {object} [params] - 查询参数
         * @returns {Promise<object>} 响应数据
         * @throws {APIError} 各种 API 错误
         */
        async request(endpoint, method, body, headers = {}, params) {
            return new Promise((resolve, reject) => {
                // 构建 URL 和请求详情
                let url = `${this.baseUrl}${endpoint}`;
                const requestDetails = {
                    url,
                    method,
                    headers: { "Content-Type": "application/json", ...headers },
                    body: body ? JSON.stringify(body) : undefined,
                    params
                };

                // 添加 GET 查询参数
                if (params && method === "GET") {
                    url += `?${new URLSearchParams(params)}`;
                }

                GM_xmlhttpRequest({
                    method,
                    url,
                    headers: requestDetails.headers,
                    data: requestDetails.body,

                    onload: (response) => {
                        if (response.status >= 200 && response.status < 300) {
                            resolve(response.responseText ? JSON.parse(response.responseText) : null);
                            return;
                        }

                        const errorData = this.#parseErrorResponse(response);
                        const error = this.#createApiError(response.status, errorData);

                        error.request = requestDetails;
                        error.response = {
                            status: response.status,
                            headers: response.headers,
                            body: response.responseText
                        };
                        reject(error);
                    },

                    onerror: (error) => {
                        const apiError = new APIError(`Network error: ${error.error}`, "NetworkError");
                        apiError.request = requestDetails;
                        console.error("Network Error:", apiError.message, { request: requestDetails, error });
                        reject(apiError);
                    }
                });
            });
        }

        /**
         * 解析错误响应
         * @private
         */
        #parseErrorResponse(response) {
            try {
                const data = JSON.parse(response.responseText);
                return data.errors || {};
            } catch (e) {
                return {};
            }
        }

        /**
         * 创建 API 错误对象
         * @private
         */
        #createApiError(status, errorDetails) {
            const messages = {
                400: "Invalid request data",
                403: "Access denied",
                404: "Resource not found",
                500: "Internal server error"
            };

            const defaultMessage = `HTTP error: ${status}`;
            const message = messages[status] || defaultMessage;

            return new APIError(message, `HTTP_${status}`, errorDetails);
        }
    }

    class AdminClient extends RestClient {
        static DEFAULT;
        static #TOKEN_CACHE_KEY = "AdminClient_token_cache";
        /** @type {TokenEntity} */
        token;
        constructor(base_url, company, username, password) {
            super(base_url);
            this.client = new AuthenticationClient(base_url);
            this.company = company;
            const cachedToken = AdminClient.#loadTokenFromCache(company, username);
            if (cachedToken) {
                this.token = cachedToken;
                this.#authenticated = Promise.resolve();
            } else {
                this.#authenticated = this.#authenticate(username, password);
            }
        }

        #authenticated;
        async #authenticate(username, password) {
            this.token = await this.client.authenticate(this.company, username, password);
            AdminClient.#saveTokenToCache(this.company, username, this.token);
        }

        async #refreshToken() {
            if(!this.token) throw new APIError('Token not found');
            const username = this.token.login;
            this.token = await this.client.refreshToken(this.company, this.token.refresh_token);
            AdminClient.#saveTokenToCache(this.company, username, this.token);
        }

        static #loadTokenFromCache(company, username) {
            try {
                const cache = JSON.parse(localStorage.getItem(AdminClient.#TOKEN_CACHE_KEY)) || {};
                return cache[`${company}:${username}`] || null;
            } catch (e) {
                console.error("Failed to load token from cache", e);
                return null;
            }
        }

        static #saveTokenToCache(company, username, token) {
            try {
                const cache = JSON.parse(localStorage.getItem(AdminClient.#TOKEN_CACHE_KEY)) || {};
                cache[`${company}:${username}`] = token;
                localStorage.setItem(AdminClient.#TOKEN_CACHE_KEY, JSON.stringify(cache));
            } catch (e) {
                console.error("Failed to save token to cache", e);
            }
        }

        async request(endpoint, method, body, headers = {}, params) {
            await this.#authenticated;
            if (!this.token) throw new APIError("Authentication failed", "AuthenticationFailed");
            try {
                return await super.request(endpoint, method, body, {
                    ...headers,
                    "X-Company-Login": this.company,
                    "X-Token": this.token.token
                }, params);
            } catch (error) {
                if(error.response.status === 401 && JSON.parse(error.response.body).code === 419) {
                    await this.#refreshToken();
                    return this.request(endpoint, method, body, params);
                }
                throw error;
            }

        }


        /**
         * Get API Client as Singleton
         * @returns {AdminClient} API Client
         */
        static default() {
            if (AdminClient.DEFAULT) return AdminClient.DEFAULT;
            const credentials = unsafeWindow.SimplyBookCredentialManager.getCredentials(CONFIG.CRYPTO_TOKEN);
            if (!credentials || !credentials.username || !credentials.password) reject('Credentials not set or invalid');
            AdminClient.DEFAULT = new AdminClient(CONFIG.API_BASE_URL, CONFIG.COMPANY, credentials.username, credentials.password);
            return AdminClient.DEFAULT;
        }

        /**
         * Get order/invoice item by id
         * @param {number} id - Invoice/order id
         * @returns {Promise<AdminInvoiceEntity>} Invoice details
         * @throws {APIError} AccessDenied, NotFound
         */
        async getInvoice(id) {
            const data = await this.request(`/admin/invoices/${id}`, "GET");
            return new AdminInvoiceEntity(...valuesOf(data, AdminInvoiceEntity));
        }

        /**
         * Get booking details by id
         * @param {number} id - book id
         * @returns {Promise<AdminBookingDetailsEntity>} Booking details
         * @throws {APIError} AccessDenied, NotFound
         */
        async getBookingDetails(id) {
            const data = await this.request(`/admin/bookings/${id}`, "GET");
            return new AdminBookingDetailsEntity(...valuesOf(data, AdminBookingDetailsEntity));
        }

        /**
         * 获取预订列表（使用 request 的 params 参数）
         * @param {number} [page=1] - 页码
         * @param {number} [on_page=10] - 每页数量
         * @param {Object} [filter] - 过滤条件
         * @returns {Promise<{entities: AdminReportBookingEntity[], pagination: object}>} 预订列表和分页信息
         */
        async getBookings(page = 1, on_page = 10, filter = null) {
            const params = { page, on_page };
            if (filter) {
                for (const [key, value] of Object.entries(filter)) {
                    if (value == null) continue;
                    if (key === 'additional_fields') {
                        for (const [field, val] of Object.entries(value)) params[`filter[additional_fields][${field}]`] = val;
                    }
                    else if (Array.isArray(value)) {
                        value.forEach((item, index) => {
                            params[`filter[${key}][${index}]`] = item;
                        });
                    }
                    else params[`filter[${key}]`] = value;
                }
            }
            const response = await this.request('/admin/bookings', 'GET', null, {}, params);
            if (!response?.data) throw new APIError('InvalidResponse', 'Missing data in API response');
            const entities = response.data.map(item =>
                new AdminReportBookingEntity(...valuesOf(item, AdminReportBookingEntity))
            );
            return {
                entities,
                pagination: response.meta?.pagination || {
                    total: entities.length,
                    per_page: on_page,
                    current_page: page,
                    total_pages: Math.ceil(entities.length / on_page) || 1
                }
            };
        }

        /**
         * 通过预订代码获取预订
         * @param {string} code - 预订代码
         * @returns {Promise<AdminReportBookingEntity>} 预订实体
         */
        async getBookingByCode(code) {
            const { entities } = await this.getBookings(1, 1, { search: code });
            if (!entities?.length) return null;
            for(const entity of entities) {
                if(entity.code === code) return entity;
            }
            return null;
        }

    }


    class AuthenticationClient extends RestClient {

        constructor(base_url) {
            super(base_url);
        }

        async authenticate(company, login, password) {
            const data = await this.request(
                "/admin/auth",
                "POST",
                {company, login, password}
            );
            return new TokenEntity(...Object.values(data).slice(0, 8));
        }

        async authenticate2FA(company, sessionId, code, type) {
            const data = await this.request(
                "/admin/auth/2fa",
                "POST",
                {company, session_id: sessionId, code, type}
            );
            return new TokenEntity(...Object.values(data).slice(0, 8));
        }

        async sendSMSCode(company, sessionId) {
            await this.request(
                "/admin/auth/sms",
                "GET",
                null,
                {},
                {company, session_id: sessionId}
            );
        }

        async refreshToken(company, refreshToken) {
            const data = await this.request(
                "/admin/auth/refresh-token",
                "POST",
                {company, refresh_token: refreshToken}
            );
            return new TokenEntity(...Object.values(data).slice(0, 8));
        }

        async logout(company, token, authToken) {
            await this.request(
                "/admin/auth/logout",
                "POST",
                {auth_token: authToken},
                {
                    "X-Company-Login": company,
                    "X-Token": token
                }
            );
        }
    }
    class AdminLoginEntity {
        /**
         * @param {string} company - Company name
         * @param {string} login - User login
         * @param {string} password - User password
         */
        constructor(company, login, password) {
            this.company = company;
            this.login = login;
            this.password = password;
        }
    }

    class AdminLogin2FAEntity {
        /**
         * @param {string} company - Company name
         */
        constructor(company) {
            this.company = company;
        }
    }

    class AdminLogoutEntity {
        /**
         * @param {string} auth_token - Auth token
         */
        constructor(auth_token) {
            this.auth_token = auth_token;
        }
    }

    class TokenEntity {
        /**
         * @param {string} token - Auth token
         * @param {string} company - Company login
         * @param {string} login - User login
         * @param {string|null} refresh_token - Refresh token
         * @param {string|null} domain - Company domain
         * @param {boolean} require2fa - Required two factor auth
         * @param {string[]} allowed2fa_providers - Allowed providers (sms/ga)
         * @param {string} auth_session_id - Authentication session id
         */
        constructor(token, company, login, refresh_token, domain, require2fa, allowed2fa_providers, auth_session_id) {
            this.token = token;
            this.company = company;
            this.login = login;
            this.refresh_token = refresh_token;
            this.domain = domain;
            this.require2fa = require2fa;
            this.allowed2fa_providers = allowed2fa_providers;
            this.auth_session_id = auth_session_id;
        }
    }

    class AdminClientEntity {
        /**
         * @param {number} id - User ID. Auto-generated value.
         * @param {string} name - Full name of the user
         * @param {string} email - User's email address
         * @param {string|null} phone - User's phone number (E.164 format)
         * @param {string|null} address1 - Primary address line
         * @param {string|null} address2 - Secondary address line
         * @param {string|null} city - City name
         * @param {string|null} state_id - State/Province identifier
         * @param {string|null} zip - Postal/ZIP code
         * @param {number|null} country_id - Country identifier
         * @param {string} full_address - Precomputed full address string
         * @param {boolean} can_be_edited - Flag indicating if user can be modified
         * @param {boolean} is_deleted - Soft deletion status
         * @param {boolean} email_promo_subscribed - Email marketing consent
         * @param {boolean} sms_promo_subscribed - SMS marketing consent
         */
        constructor(
            id,
            name,
            email,
            phone,
            address1,
            address2,
            city,
            state_id,
            zip,
            country_id,
            full_address,
            can_be_edited,
            is_deleted,
            email_promo_subscribed,
            sms_promo_subscribed
        ) {
            this.id = id;
            this.name = name;
            this.email = email;
            this.phone = phone;
            this.address1 = address1;
            this.address2 = address2;
            this.city = city;
            this.state_id = state_id;
            this.zip = zip;
            this.country_id = country_id;
            this.full_address = full_address;
            this.can_be_edited = can_be_edited;
            this.is_deleted = is_deleted;
            this.email_promo_subscribed = email_promo_subscribed;
            this.sms_promo_subscribed = sms_promo_subscribed;
        }

        /**
         * Check if the user is active (not deleted)
         * @returns {boolean}
         */
        isActive() {
            return !this.is_deleted;
        }

        /**
         * Check if user has complete address information
         * @returns {boolean}
         */
        hasCompleteAddress() {
            return !!(
                this.address1 &&
                this.city &&
                this.state_id &&
                this.zip &&
                this.country_id
            );
        }

        /**
         * Get formatted address (combines available address components)
         * @returns {string}
         */
        getFormattedAddress() {
            if (this.full_address) return this.full_address;

            const parts = [
                this.address1,
                this.address2,
                this.city,
                this.state_id,
                this.zip
            ].filter(Boolean); // Remove empty parts

            return parts.join(', ') || 'No address available';
        }

        /**
         * Check if user is subscribed to any marketing
         * @returns {boolean}
         */
        isSubscribedToMarketing() {
            return this.email_promo_subscribed || this.sms_promo_subscribed;
        }

        /**
         * Check if user can be edited
         * @returns {boolean}
         */
        isEditable() {
            return this.can_be_edited && !this.is_deleted;
        }

        /**
         * Get masked email for display
         * @returns {string}
         */
        getMaskedEmail() {
            if (!this.email) return '';
            const [name, domain] = this.email.split('@');
            return `${name[0]}****@${domain}`;
        }
    }

    class AdminInvoiceEntity {
        /**
         * @param {number} id - Invoice id. Auto-generated value.
         * @param {string} number - Invoice number. Auto-generated value.
         * @param {string} datetime - Invoice datetime. Readonly
         * @param {string} due_datetime - Invoice due date.
         * @param {string|null} payment_datetime - Payment date
         * @param {string|null} refund_datetime - Refund date
         * @param {number} amount - Invoice amount.
         * @param {number} recurring_amount - Recurring amount.
         * @param {number} deposit - Deposit amount.
         * @param {number} rest_amount - Rest amount.
         * @param {TaxEntity[]} taxes - Array of invoice taxes
         * @param {number} tip - Tips
         * @param {number} discount - Discount amount.
         * @param {string} currency - Currency code (ISO 4217)
         * @param {number} client_id - Client id
         * @param {string} description - Invoice description
         * @param {boolean} payment_received - Payment received status
         * @param {string} payment_processor - Payment processor key
         * @param {Array} lines - Array of line items
         * @param {PromotionInstanceEntity[]} promotion_instances - Promotion instances
         * @param {PackageInstanceEntity[]} package_instances - Package instances
         * @param {string} status - Invoice status
         * @param {boolean} support_recurring_payment - Supports recurring payment
         * @param {boolean} require_recurring_payment - Requires recurring payment
         * @param {number} recurring_profile_id - Recurring profile id
         * @param {AdminClientEntity} client - Client entity
         * @param {number} created_by_user_id - Creator user ID
         * @param {UserEntity} created_by_user - Creator user
         * @param {number} approved_by_user_id - Approver user ID
         * @param {UserEntity} approved_by_user - Approver user
         * @param {number} refunded_by_user_id - Refunder user ID
         * @param {UserEntity} refunded_by_user - Refunder user
         */
        constructor(
            id,
            number,
            datetime,
            due_datetime,
            payment_datetime,
            refund_datetime,
            amount,
            recurring_amount,
            deposit,
            rest_amount,
            taxes,
            tip,
            discount,
            currency,
            client_id,
            description,
            payment_received,
            payment_processor,
            lines,
            promotion_instances,
            package_instances,
            status,
            support_recurring_payment,
            require_recurring_payment,
            recurring_profile_id,
            client,
            created_by_user_id,
            created_by_user,
            approved_by_user_id,
            approved_by_user,
            refunded_by_user_id,
            refunded_by_user
        ) {
            this.id = id;
            this.number = number;
            this.datetime = datetime;
            this.due_datetime = due_datetime;
            this.payment_datetime = payment_datetime;
            this.refund_datetime = refund_datetime;
            this.amount = amount;
            this.recurring_amount = recurring_amount;
            this.deposit = deposit;
            this.rest_amount = rest_amount;
            this.taxes = taxes;
            this.tip = tip;
            this.discount = discount;
            this.currency = currency;
            this.client_id = client_id;
            this.description = description;
            this.payment_received = payment_received;
            this.payment_processor = payment_processor;
            this.lines = lines;
            this.promotion_instances = promotion_instances;
            this.package_instances = package_instances;
            this.status = status;
            this.support_recurring_payment = support_recurring_payment;
            this.require_recurring_payment = require_recurring_payment;
            this.recurring_profile_id = recurring_profile_id;
            this.client = client;
            this.created_by_user_id = created_by_user_id;
            this.created_by_user = created_by_user;
            this.approved_by_user_id = approved_by_user_id;
            this.approved_by_user = approved_by_user;
            this.refunded_by_user_id = refunded_by_user_id;
            this.refunded_by_user = refunded_by_user;
        }

        /**
         * Check if the invoice is paid
         * @returns {boolean}
         */
        isPaid() {
            return this.payment_received && this.payment_datetime !== null;
        }

        /**
         * Check if the invoice is overdue
         * @returns {boolean}
         */
        isOverdue() {
            if (this.isPaid()) return false;
            return new Date() > new Date(this.due_datetime);
        }

        /**
         * Get the remaining amount to be paid
         * @returns {number}
         */
        getRemainingAmount() {
            return this.rest_amount || 0;
        }

        /**
         * Check if the invoice is refunded
         * @returns {boolean}
         */
        isRefunded() {
            return this.refund_datetime !== null;
        }

        /**
         * Get a formatted amount with currency
         * @returns {string}
         */
        getFormattedAmount() {
            return `${this.amount.toFixed(2)} ${this.currency}`;
        }
    }


    class AdminBookingBuildEntity {
        /**
         * @param {string} start_datetime - Booking start datetime
         * @param {string} end_datetime - Booking end datetime
         * @param {number} location_id - Location id
         * @param {number} category_id - Category id
         * @param {number} service_id - Service id
         * @param {number} provider_id - Provider id
         * @param {number} client_id - Client id
         * @param {Object} service - ServiceEntity
         * @param {Object} provider - ProviderEntity
         * @param {LocationEntity} location - LocationEntity
         * @param {Object} category - CategoryEntity
         * @param {number} count - Group booking count
         * @param {Object} recurring_settings - Booking_RecurringSettingsEntity
         * @param {Array} additional_fields - Array of Booking_AdditionalFieldValueEntity
         * @param {Array} products - Array of ProductQtyEntity
         * @param {number} client_membership_id - Client membership instance id
         * @param {Object} client - ClientEntity
         * @param {number} batch_id - Multiple/group booking batch
         * @param {boolean} skip_membership - Do not use membership
         * @param {number} user_status_id - Users status id
         * @param {boolean} accept_payment - Set true to make payment order
         * @param {string|null} payment_processor - Payment processor
         */
        constructor(start_datetime, end_datetime, location_id, category_id, service_id, provider_id, client_id, service, provider, location, category, count, recurring_settings, additional_fields, products, client_membership_id, client, batch_id, skip_membership, user_status_id, accept_payment, payment_processor) {
            this.start_datetime = start_datetime;
            this.end_datetime = end_datetime;
            this.location_id = location_id;
            this.category_id = category_id;
            this.service_id = service_id;
            this.provider_id = provider_id;
            this.client_id = client_id;
            this.service = service;
            this.provider = provider;
            this.location = location;
            this.category = category;
            this.count = count;
            this.recurring_settings = recurring_settings;
            this.additional_fields = additional_fields;
            this.products = products;
            this.client_membership_id = client_membership_id;
            this.client = client;
            this.batch_id = batch_id;
            this.skip_membership = skip_membership;
            this.user_status_id = user_status_id;
            this.accept_payment = accept_payment;
            this.payment_processor = payment_processor;
        }
    }
    class BookingResultEntity {
        /**
         * @param {Array} bookings - Array of BookingEntity
         * @param {Object|null} batch - BookingBatchEntity
         */
        constructor(bookings, batch) {
            this.bookings = bookings;
            this.batch = batch;
        }
    }

    class BookingEntity {
        /**
         * @param {number} id - Booking id
         * @param {string} code - Booking code
         * @param {boolean} is_confirmed - Booking is confirmed
         * @param {string} start_datetime - Booking start datetime
         * @param {string} end_datetime - Booking end datetime
         * @param {number} location_id - Location id
         * @param {number} category_id - Category id
         * @param {number} service_id - Service id
         * @param {number} provider_id - Provider id
         * @param {number} client_id - Client id
         * @param {number} duration - Duration in minutes
         * @param {ServiceEntity} service - ServiceEntity
         * @param {ProviderEntity} provider - ProviderEntity
         * @param {LocationEntity} location - LocationEntity
         * @param {CategoryEntity} category - CategoryEntity
         */
        constructor(id, code, is_confirmed, start_datetime, end_datetime, location_id, category_id,
                    service_id, provider_id, client_id, duration, service, provider, location, category) {
            this.id = id;
            this.code = code;
            this.is_confirmed = is_confirmed;
            this.start_datetime = start_datetime;
            this.end_datetime = end_datetime;
            this.location_id = location_id;
            this.category_id = category_id;
            this.service_id = service_id;
            this.provider_id = provider_id;
            this.client_id = client_id;
            this.duration = duration;
            this.service = service;
            this.provider = provider;
            this.location = location;
            this.category = category;
        }
    }
    class AdminReportBookingEntity {
        /**
         * Admin booking list information entity
         *
         * @param {number} id - Booking id. Auto-generated value.
         * @param {string} code - Booking code. Auto-generated value.
         * @param {boolean} is_confirmed - Booking is confirmed
         * @param {string} start_datetime - Booking start datetime (ISO 8601)
         * @param {string} end_datetime - Booking end datetime (ISO 8601)
         * @param {number|null} location_id - Provider location id
         * @param {number|null} category_id - Service category id
         * @param {number} service_id - Service id
         * @param {number} provider_id - Provider id
         * @param {number} client_id - Client id
         * @param {number} duration - Duration in minutes
         * @param {ServiceEntity} service - Booking service details entity
         * @param {ProviderEntity} provider - Booking provider details entity
         * @param {LocationEntity|null} location - Provider location entity
         * @param {CategoryEntity|null} category - Service category entity
         * @param {ClientEntity} client - Client details entity
         * @param {string} status - Booking status (confirmed/pending/canceled)
         * @param {number|null} membership_id - Client membership id
         * @param {number|null} invoice_id - Invoice id
         * @param {string|null} invoice_status - Payment status ('deleted','new','pending','cancelled','cancelled_by_timeout','error','paid')
         * @param {boolean|null} invoice_payment_received - Payment was received
         * @param {string|null} invoice_number - Invoice number
         * @param {string|null} invoice_datetime - Invoice datetime
         * @param {string|null} invoice_payment_processor - Payment processor key
         * @param {string|null} ticket_code - Booking ticket code
         * @param {string|null} ticket_validation_datetime - Ticket validation datetime
         * @param {boolean|null} ticket_is_used - Ticket was already validated
         * @param {string|null} testing_status - Medical testing status (positive/negative/inconclusive/pending)
         * @param {number|null} user_status_id - Status custom feature id
         * @param {boolean} can_be_edited - Can this booking be edited by user
         * @param {boolean} can_be_canceled - Can this booking be canceled by user
         */
        constructor(
            id,
            code,
            is_confirmed,
            start_datetime,
            end_datetime,
            location_id,
            category_id,
            service_id,
            provider_id,
            client_id,
            duration,
            service,
            provider,
            location,
            category,
            client,
            status,
            membership_id,
            invoice_id,
            invoice_status,
            invoice_payment_received,
            invoice_number,
            invoice_datetime,
            invoice_payment_processor,
            ticket_code,
            ticket_validation_datetime,
            ticket_is_used,
            testing_status,
            user_status_id,
            can_be_edited,
            can_be_canceled
        ) {
            // Core booking information
            this.id = id;
            this.code = code;
            this.is_confirmed = is_confirmed;
            this.start_datetime = start_datetime;
            this.end_datetime = end_datetime;

            // Service and provider references
            this.location_id = location_id;
            this.category_id = category_id;
            this.service_id = service_id;
            this.provider_id = provider_id;
            this.client_id = client_id;
            this.duration = duration;

            // Entity references
            this.service = service;
            this.provider = provider;
            this.location = location;
            this.category = category;
            this.client = client;

            // Status information
            this.status = status;
            this.membership_id = membership_id;
            this.invoice_id = invoice_id;
            this.invoice_status = invoice_status;
            this.invoice_payment_received = invoice_payment_received;
            this.invoice_number = invoice_number;
            this.invoice_datetime = invoice_datetime;
            this.invoice_payment_processor = invoice_payment_processor;

            // Ticket information
            this.ticket_code = ticket_code;
            this.ticket_validation_datetime = ticket_validation_datetime;
            this.ticket_is_used = ticket_is_used;

            // Testing and custom status
            this.testing_status = testing_status;
            this.user_status_id = user_status_id;

            // Permissions
            this.can_be_edited = can_be_edited;
            this.can_be_canceled = can_be_canceled;
        }

        /**
         * Check if booking is currently active
         * @returns {boolean}
         */
        isActive() {
            const now = new Date();
            const start = new Date(this.start_datetime);
            const end = new Date(this.end_datetime);
            return now >= start && now <= end;
        }

        /**
         * Check if booking is in the past
         * @returns {boolean}
         */
        isPast() {
            return new Date() > new Date(this.end_datetime);
        }

        /**
         * Check if booking is upcoming (future)
         * @returns {boolean}
         */
        isUpcoming() {
            return new Date() < new Date(this.start_datetime);
        }

        /**
         * Check if booking requires payment
         * @returns {boolean}
         */
        requiresPayment() {
            return this.invoice_id !== null &&
                this.invoice_status !== 'paid' &&
                this.invoice_status !== 'cancelled';
        }

        /**
         * Check if payment was successfully received
         * @returns {boolean}
         */
        isPaymentReceived() {
            return this.invoice_payment_received === true ||
                this.invoice_status === 'paid';
        }

        /**
         * Check if booking is confirmed and not cancelled
         * @returns {boolean}
         */
        isConfirmed() {
            return this.is_confirmed && this.status === 'confirmed';
        }

        /**
         * Check if medical testing is required
         * @returns {boolean}
         */
        requiresMedicalTesting() {
            return this.testing_status !== null;
        }

        /**
         * Check if booking can be modified
         * @returns {boolean}
         */
        isModifiable() {
            return this.can_be_edited &&
                !this.ticket_is_used &&
                this.status === 'confirmed' &&
                new Date() < new Date(this.start_datetime);
        }

        /**
         * Check if booking can be cancelled
         * @returns {boolean}
         */
        isCancellable() {
            return this.can_be_canceled &&
                !this.ticket_is_used &&
                this.status === 'confirmed' &&
                new Date() < new Date(this.start_datetime);
        }

        /**
         * Get formatted duration (HH:MM format)
         * @returns {string}
         */
        getFormattedDuration() {
            const hours = Math.floor(this.duration / 60);
            const minutes = this.duration % 60;
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        }

        /**
         * Get booking date (without time)
         * @returns {string}
         */
        getBookingDate() {
            return this.start_datetime.split('T')[0];
        }

        /**
         * Get start time (HH:MM format)
         * @returns {string}
         */
        getStartTime() {
            return this.start_datetime.split('T')[1].substring(0, 5);
        }

        /**
         * Get end time (HH:MM format)
         * @returns {string}
         */
        getEndTime() {
            return this.end_datetime.split('T')[1].substring(0, 5);
        }

        /**
         * Get time range (HH:MM - HH:MM format)
         * @returns {string}
         */
        getTimeRange() {
            return `${this.getStartTime()} - ${this.getEndTime()}`;
        }

        /**
         * Get the service price (if available)
         * @returns {number}
         */
        getServicePrice() {
            return this.service?.price || 0;
        }

        /**
         * Get simplified status for reporting
         * @returns {string}
         */
        getReportStatus() {
            if (this.status === 'cancelled') return 'Cancelled';
            if (this.isPaymentReceived()) return 'Paid';
            if (this.requiresPayment()) return 'Payment Pending';
            if (this.ticket_is_used) return 'Completed';
            if (this.isPast()) return 'Completed';
            return this.status.charAt(0).toUpperCase() + this.status.slice(1);
        }
    }
    class BookingBatchEntity {
        /**
         * @param {number} id - Batch id
         * @param {string} type - Batch type ('recurring', 'multiple', 'group')
         * @param {boolean} is_closed - Flag that indicates that user has finished booking
         */
        constructor(id, type, is_closed) {
            this.id = id;
            this.type = type;
            this.is_closed = is_closed;
        }
    }

    class Booking_RecurringSettingsEntity {
        /**
         * @param {number} days - Repeat days
         * @param {number} repeat_count - Repeat count
         * @param {string} type - Type of repeat ('fixed', 'weekly')
         * @param {string} mode - Mode ('skip', 'book_available', 'book_and_move')
         */
        constructor(days, repeat_count, type, mode) {
            this.days = days;
            this.repeat_count = repeat_count;
            this.type = type;
            this.mode = mode;
        }
    }

    class Booking_AdditionalFieldValueEntity {
        /**
         * @param {number} id - Additional field id
         * @param {string} field - Additional field name
         * @param {*} value - Additional field value
         * @param {string} file_hash - Cloud field file hash
         */
        constructor(id, field, value, file_hash) {
            this.id = id;
            this.field = field;
            this.value = value;
            this.file_hash = file_hash;
        }
    }

    class ProductQtyEntity {
        /**
         * @param {number} product_id - Product id
         * @param {number} qty - Product qty
         */
        constructor(product_id, qty) {
            this.product_id = product_id;
            this.qty = qty;
        }
    }

    class AdminBookingDetailsEntity {
        /**
         * Detailed booking information (admin only)
         *
         * @param {number} id - Booking id. Auto-generated value.
         * @param {string} code - Booking code. Auto-generated value.
         * @param {boolean} is_confirmed - Booking is confirmed
         * @param {string} start_datetime - Booking start datetime (ISO 8601)
         * @param {string} end_datetime - Booking end datetime (ISO 8601)
         * @param {number|null} location_id - Provider location id
         * @param {number|null} category_id - Service category id
         * @param {number} service_id - Service id
         * @param {number} provider_id - Provider id
         * @param {number} client_id - Client id
         * @param {number} duration - Duration in minutes
         * @param {ServiceEntity} service - Booking service details entity
         * @param {ProviderEntity} provider - Booking provider details entity
         * @param {LocationEntity|null} location - Provider location entity
         * @param {CategoryEntity|null} category - Service category entity
         * @param {ClientEntity} client - Client details entity
         * @param {string} status - Booking status (confirmed/pending/canceled)
         * @param {number|null} membership_id - Client membership id
         * @param {number|null} invoice_id - Invoice id
         * @param {string|null} invoice_status - Payment status ('deleted','new','pending','cancelled','cancelled_by_timeout','error','paid')
         * @param {boolean|null} invoice_payment_received - Payment was received
         * @param {string|null} invoice_number - Invoice number
         * @param {string|null} invoice_datetime - Invoice datetime
         * @param {string|null} invoice_payment_processor - Payment processor key
         * @param {string|null} ticket_code - Booking ticket code
         * @param {string|null} ticket_validation_datetime - Ticket validation datetime
         * @param {boolean|null} ticket_is_used - Ticket was already validated
         * @param {string|null} testing_status - Medical testing status (positive/negative/inconclusive/pending)
         * @param {number|null} user_status_id - Status custom feature id
         * @param {boolean} can_be_edited - Can this booking be edited by user
         * @param {boolean} can_be_canceled - Can this booking be canceled by user
         * @param {Array|Booking_LogEntity[]} log - Booking edit log
         * @param {Array|Booking_AdditionalFieldValueEntity[]} additional_fields - Booking intake form details
         * @param {Array|Booking_DetailedProductQtyEntity[]} products - Booking detailed products list
         * @param {Array|Booking_DetailedProductQtyEntity[]} attributes - Booking detailed attributes list
         * @param {AdminInvoiceEntity|null} invoice - Invoice entity
         * @param {ClientMembershipPaymentEntity|null} membership - Client membership object
         * @param {StatusEntity|null} user_status - User status entity
         * @param {string} comment - Booking comment
         * @param {Array|ResourceEntity[]} resources - Booking resources list
         */
        constructor(
            id,
            code,
            is_confirmed,
            start_datetime,
            end_datetime,
            location_id,
            category_id,
            service_id,
            provider_id,
            client_id,
            duration,
            service,
            provider,
            location,
            category,
            client,
            status,
            membership_id,
            invoice_id,
            invoice_status,
            invoice_payment_received,
            invoice_number,
            invoice_datetime,
            invoice_payment_processor,
            ticket_code,
            ticket_validation_datetime,
            ticket_is_used,
            testing_status,
            user_status_id,
            can_be_edited,
            can_be_canceled,
            log,
            additional_fields,
            products,
            attributes,
            invoice,
            membership,
            user_status,
            comment,
            resources
        ) {
            // Core booking information
            this.id = id;
            this.code = code;
            this.is_confirmed = is_confirmed;
            this.start_datetime = start_datetime;
            this.end_datetime = end_datetime;

            // Service and provider references
            this.location_id = location_id;
            this.category_id = category_id;
            this.service_id = service_id;
            this.provider_id = provider_id;
            this.client_id = client_id;
            this.duration = duration;

            // Entity references
            this.service = service;
            this.provider = provider;
            this.location = location;
            this.category = category;
            this.client = client;

            // Status information
            this.status = status;
            this.membership_id = membership_id;
            this.invoice_id = invoice_id;
            this.invoice_status = invoice_status;
            this.invoice_payment_received = invoice_payment_received;
            this.invoice_number = invoice_number;
            this.invoice_datetime = invoice_datetime;
            this.invoice_payment_processor = invoice_payment_processor;

            // Ticket information
            this.ticket_code = ticket_code;
            this.ticket_validation_datetime = ticket_validation_datetime;
            this.ticket_is_used = ticket_is_used;

            // Testing and custom status
            this.testing_status = testing_status;
            this.user_status_id = user_status_id;

            // Permissions
            this.can_be_edited = can_be_edited;
            this.can_be_canceled = can_be_canceled;

            // Logs and additional data
            this.log = log;
            this.additional_fields = additional_fields;
            this.products = products;
            this.attributes = attributes;

            // Related entities
            this.invoice = invoice;
            this.membership = membership;
            this.user_status = user_status;

            // Additional information
            this.comment = comment;
            this.resources = resources;
        }

        /**
         * Check if booking is currently active
         * @returns {boolean}
         */
        isActive() {
            const now = new Date();
            const start = new Date(this.start_datetime);
            const end = new Date(this.end_datetime);
            return now >= start && now <= end;
        }

        /**
         * Check if booking requires payment
         * @returns {boolean}
         */
        requiresPayment() {
            return this.invoice_id !== null && this.invoice_status !== 'paid';
        }

        /**
         * Check if booking can be modified
         * @returns {boolean}
         */
        isModifiable() {
            return this.can_be_edited &&
                !this.ticket_is_used &&
                this.status === 'confirmed' &&
                new Date() < new Date(this.start_datetime);
        }

        /**
         * Get formatted duration (HH:MM format)
         * @returns {string}
         */
        getFormattedDuration() {
            const hours = Math.floor(this.duration / 60);
            const minutes = this.duration % 60;
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        }

        /**
         * Check if medical testing is required
         * @returns {boolean}
         */
        requiresMedicalTesting() {
            return this.testing_status !== null;
        }

        /**
         * Check if payment was successfully received
         * @returns {boolean}
         */
        isPaymentReceived() {
            return this.invoice_payment_received === true ||
                this.invoice_status === 'paid';
        }

        /**
         * Get the primary resource (if available)
         * @returns {ResourceEntity|null}
         */
        getPrimaryResource() {
            return this.resources.length > 0 ? this.resources[0] : null;
        }

        /**
         * Get all intake form fields as key-value pairs
         * @returns {Object}
         */
        getIntakeFormData() {
            return this.additional_fields.reduce((acc, field) => {
                acc[field.field_id] = field.value;
                return acc;
            }, {});
        }

        /**
         * Check if booking is upcoming (within next 24 hours)
         * @returns {boolean}
         */
        isUpcoming() {
            const now = new Date();
            const start = new Date(this.start_datetime);
            const twentyFourHours = 24 * 60 * 60 * 1000;
            return start > now && (start - now) < twentyFourHours;
        }

        /**
         * Get the total price including products and attributes
         * @returns {number}
         */
        getTotalPrice() {
            let total = this.service.price || 0;

            // Add products cost
            if (this.products && this.products.length) {
                total += this.products.reduce((sum, product) =>
                    sum + (product.price * product.quantity), 0);
            }

            // Add attributes cost
            if (this.attributes && this.attributes.length) {
                total += this.attributes.reduce((sum, attribute) =>
                    sum + (attribute.price * attribute.quantity), 0);
            }

            return total;
        }
    }
    class ServiceEntity {
        /**
         * TODO
         * @param {number} id - Service id
         * @param {string} name - Service name
         * @param {number} duration - Service duration in minutes
         * @param {number} price - Service price
         * @param {number} category_id - Category id
         * @param {string} description - Service description
         * @param {boolean} is_active - Service active status
         */
        constructor(id, name, duration, price, category_id, description, is_active) {
            this.id = id;
            this.name = name;
            this.duration = duration;
            this.price = price;
            this.category_id = category_id;
            this.description = description;
            this.is_active = is_active;
        }
    }

    class ProviderEntity {
        /**
         * @param {number} id - Provider id
         * @param {string} name - Provider name
         * @param {string} email - Provider email
         * @param {string} phone - Provider phone
         * @param {boolean} is_active - Provider active status
         * @param {number[]} service_ids - Array of service ids
         * @param {number[]} location_ids - Array of location ids
         */
        constructor(id, name, email, phone, is_active, service_ids, location_ids) {
            this.id = id;
            this.name = name;
            this.email = email;
            this.phone = phone;
            this.is_active = is_active;
            this.service_ids = service_ids;
            this.location_ids = location_ids;
        }
    }

    class LocationEntity {
        /**
         * @param {number} id - Location id
         * @param {string} name - Location name
         * @param {string} address - Location address
         * @param {string} city - Location city
         * @param {string} state - Location state
         * @param {string} country - Location country
         * @param {string} zip - Location zip code
         * @param {boolean} is_active - Location active status
         */
        constructor(id, name, address, city, state, country, zip, is_active) {
            this.id = id;
            this.name = name;
            this.address = address;
            this.city = city;
            this.state = state;
            this.country = country;
            this.zip = zip;
            this.is_active = is_active;
        }
    }

    class CategoryEntity {
        /**
         * @param {number} id - Category id
         * @param {string} name - Category name
         * @param {string} description - Category description
         * @param {boolean} is_active - Category active status
         */
        constructor(id, name, description, is_active) {
            this.id = id;
            this.name = name;
            this.description = description;
            this.is_active = is_active;
        }
    }

    class ClientEntity {
        /**
         * TODO
         * @param {number} id - Client id
         * @param {string} name - Client name
         * @param {string} email - Client email
         * @param {string} phone - Client phone
         * @param {string} address - Client address
         * @param {string} city - Client city
         * @param {string} state - Client state
         * @param {string} country - Client country
         * @param {string} zip - Client zip code
         * @param {Object} custom_fields - Client custom fields
         */
        constructor(id, name, email, phone, address, city, state, country, zip, custom_fields) {
            this.id = id;
            this.name = name;
            this.email = email;
            this.phone = phone;
            this.address = address;
            this.city = city;
            this.state = state;
            this.country = country;
            this.zip = zip;
            this.custom_fields = custom_fields;
        }
    }

    class CompanyEntity {
        /**
         * TODO
         * @param {string} login - Company login name
         * @param {string} name - Company name
         * @param {string} domain - Company domain
         * @param {string} timezone - Company timezone
         * @param {string} currency - Company currency
         * @param {string} country - Company country
         * @param {string} language - Company language
         * @param {Object} settings - Company settings
         */
        constructor(login, name, domain, timezone, currency, country, language, settings) {
            this.login = login;
            this.name = name;
            this.domain = domain;
            this.timezone = timezone;
            this.currency = currency;
            this.country = country;
            this.language = language;
            this.settings = settings;
        }
    }

    class MembershipEntity {
        /**
         * TODO
         * @param {number} id - Membership id
         * @param {string} name - Membership name
         * @param {number} price - Membership price
         * @param {number} duration - Duration in days
         * @param {number[]} service_ids - Included service ids
         * @param {boolean} is_active - Active status
         * @param {Object} settings - Membership settings
         */
        constructor(id, name, price, duration, service_ids, is_active, settings) {
            this.id = id;
            this.name = name;
            this.price = price;
            this.duration = duration;
            this.service_ids = service_ids;
            this.is_active = is_active;
            this.settings = settings;
        }
    }


    class ProductEntity {
        /**
         * TODO
         * @param {number} id - Product id
         * @param {string} name - Product name
         * @param {string} sku - Product SKU
         * @param {number} price - Product price
         * @param {number} stock - Product stock quantity
         * @param {string} description - Product description
         * @param {boolean} is_active - Active status
         * @param {Object} settings - Product settings
         */
        constructor(id, name, sku, price, stock, description, is_active, settings) {
            this.id = id;
            this.name = name;
            this.sku = sku;
            this.price = price;
            this.stock = stock;
            this.description = description;
            this.is_active = is_active;
            this.settings = settings;
        }
    }

    class TimeSlotEntity {
        /**
         * TODO
         * @param {string} start_time - Start time
         * @param {string} end_time - End time
         * @param {number} provider_id - Provider id
         * @param {number} service_id - Service id
         * @param {number} location_id - Location id
         * @param {boolean} is_available - Availability status
         */
        constructor(start_time, end_time, provider_id, service_id, location_id, is_available) {
            this.start_time = start_time;
            this.end_time = end_time;
            this.provider_id = provider_id;
            this.service_id = service_id;
            this.location_id = location_id;
            this.is_available = is_available;
        }
    }



    class UserEntity {
        /**
         * TODO
         * @param {number} id - User id
         * @param {string} username - Username
         * @param {string} email - User email
         * @param {string} role - User role
         * @param {boolean} is_active - Active status
         * @param {Object} permissions - User permissions
         * @param {string} last_login - Last login datetime
         * @param {Object} settings - User settings
         */
        constructor(id, username, email, role, is_active, permissions, last_login, settings) {
            this.id = id;
            this.username = username;
            this.email = email;
            this.role = role;
            this.is_active = is_active;
            this.permissions = permissions;
            this.last_login = last_login;
            this.settings = settings;
        }
    }


    class ResourceEntity {
        /**
         * Resource info
         * @param {number} id - Resource id
         * @param {string} name - Resource name
         */
        constructor(id, name) {
            this.id = id;
            this.name = name;
        }
    }


    class PromotionEntity {
        /**
         * Entity that contains promotion information
         *
         * @param {number} id - Promotion id. Auto-generated value.
         * @param {string} name - Promotion name
         * @param {string} description - Promotion description
         * @param {number} file_id - Image file id
         * @param {string} picture_preview - Path to preview picture
         * @param {string} picture_large - Path to large picture
         * @param {boolean} is_visible - Is promotion visible on public site
         * @param {boolean} is_active - Is promotion active
         * @param {number} position - Promotion position
         * @param {number} price - Promotion price to purchase (gift card)
         * @param {string} currency - Promotion price currency to purchase (gift card)
         * @param {TaxEntity} tax - Promotion tax
         * @param {string} promotion_type - Promotion type. Can be 'gift_card', 'discount'
         * @param {string} discount_type - Discount type. Can be 'fixed_amount', 'percentage'
         * @param {number} discount - Discount value (amount value or percentage value)
         * @param {string} duration_type - Duration type for gift cards ('year', 'month', 'week', 'day')
         * @param {number} duration - Duration length
         * @param {string} client_type - Client type can be 'new' or 'all'
         * @param {number} allow_usage_count - Limit of usage count
         * @param {boolean} is_unlimited - Is unlimited
         * @param {boolean} affect_services - Is it possible to apply this promotion to services?
         * @param {boolean} affect_products - Is it possible to apply this promotion to products?
         * @param {boolean} affect_paid_attributes - Is it possible to apply this promotion to paid attribute?
         * @param {boolean} affect_memberships - Is it possible to apply this promotion to memberships?
         * @param {boolean} affect_packages - Is it possible to apply this promotion to packages?
         * @param {Array|number[]} service_restrictions - Array of service ids
         * @param {Array|Promotion_BookingRestrictionEntity[]} booking_restrictions - Booking restrictions
         * @param {Array|number[]} product_restrictions - Array of product ids
         * @param {Array|number[]} paid_attribute_restrictions - Array of paid attributes ids
         * @param {Array|number[]} memberships_restrictions - Array of memberships ids
         * @param {Array|number[]} package_restrictions - Array of packages ids
         */
        constructor(
            id,
            name,
            description,
            file_id = null,
            picture_preview = null,
            picture_large = null,
            is_visible = true,
            is_active = true,
            position = 0,
            price = 0,
            currency = 'USD',
            tax = null,
            promotion_type,
            discount_type = null,
            discount = 0,
            duration_type = null,
            duration = 0,
            client_type = 'all',
            allow_usage_count = 1,
            is_unlimited = false,
            affect_services = false,
            affect_products = false,
            affect_paid_attributes = false,
            affect_memberships = false,
            affect_packages = false,
            service_restrictions = [],
            booking_restrictions = [],
            product_restrictions = [],
            paid_attribute_restrictions = [],
            memberships_restrictions = [],
            package_restrictions = []
        ) {
            this.id = id;
            this.name = name;
            this.description = description;
            this.file_id = file_id;
            this.picture_preview = picture_preview;
            this.picture_large = picture_large;
            this.is_visible = is_visible;
            this.is_active = is_active;
            this.position = position;
            this.price = price;
            this.currency = currency;
            this.tax = tax;
            this.promotion_type = promotion_type;
            this.discount_type = discount_type;
            this.discount = discount;
            this.duration_type = duration_type;
            this.duration = duration;
            this.client_type = client_type;
            this.allow_usage_count = allow_usage_count;
            this.is_unlimited = is_unlimited;
            this.affect_services = affect_services;
            this.affect_products = affect_products;
            this.affect_paid_attributes = affect_paid_attributes;
            this.affect_memberships = affect_memberships;
            this.affect_packages = affect_packages;
            this.service_restrictions = service_restrictions;
            this.booking_restrictions = booking_restrictions;
            this.product_restrictions = product_restrictions;
            this.paid_attribute_restrictions = paid_attribute_restrictions;
            this.memberships_restrictions = memberships_restrictions;
            this.package_restrictions = package_restrictions;
        }

        /* ================== 基本状态检查 ================== */

        /**
         * 检查促销是否可用
         * @returns {boolean}
         */
        isAvailable() {
            return this.is_active && this.is_visible;
        }

        /**
         * 检查是否为礼品卡类型
         * @returns {boolean}
         */
        isGiftCard() {
            return this.promotion_type === 'gift_card';
        }

        /**
         * 检查是否为折扣类型
         * @returns {boolean}
         */
        isDiscount() {
            return this.promotion_type === 'discount';
        }

        /**
         * 检查是否仅限新客户使用
         * @returns {boolean}
         */
        isForNewClientsOnly() {
            return this.client_type === 'new';
        }

        /* ================== 折扣计算逻辑 ================== */

        /**
         * 应用折扣到原始价格
         * @param {number} originalPrice - 原始价格
         * @returns {number} 折扣后的价格
         */
        applyDiscount(originalPrice) {
            if (!this.isDiscount()) return originalPrice;

            if (this.discount_type === 'fixed_amount') {
                return Math.max(0, originalPrice - this.discount);
            } else if (this.discount_type === 'percentage') {
                return originalPrice * (1 - this.discount / 100);
            }

            return originalPrice;
        }

        /**
         * 计算礼品卡价值（含税）
         * @returns {number}
         */
        getGiftCardValue() {
            if (!this.isGiftCard()) return 0;
            return this.tax ? this.tax.calculateTotal(this.price) : this.price;
        }

        /**
         * 获取促销类型标签
         * @returns {string}
         */
        getPromotionTypeLabel() {
            if (this.isGiftCard()) {
                return `${this.currency} ${this.getGiftCardValue().toFixed(2)} 礼品卡`;
            } else if (this.isDiscount()) {
                if (this.discount_type === 'fixed_amount') {
                    return `${this.currency} ${this.discount.toFixed(2)} 折扣`;
                } else {
                    return `${this.discount}% 折扣`;
                }
            }
            return "未知促销类型";
        }

        /* ================== 适用性检查 ================== */

        /**
         * 检查促销是否适用于特定服务
         * @param {number} serviceId - 服务ID
         * @returns {boolean}
         */
        appliesToService(serviceId) {
            if (!this.affect_services) return false;
            return this.service_restrictions.length === 0 ||
                this.service_restrictions.includes(serviceId);
        }

        /**
         * 检查促销是否适用于特定产品
         * @param {number} productId - 产品ID
         * @returns {boolean}
         */
        appliesToProduct(productId) {
            if (!this.affect_products) return false;
            return this.product_restrictions.length === 0 ||
                this.product_restrictions.includes(productId);
        }

        /**
         * 检查促销是否适用于特定套餐
         * @param {number} packageId - 套餐ID
         * @returns {boolean}
         */
        appliesToPackage(packageId) {
            if (!this.affect_packages) return false;
            return this.package_restrictions.length === 0 ||
                this.package_restrictions.includes(packageId);
        }

        /**
         * 检查促销是否适用于特定客户类型
         * @param {boolean} isNewClient - 是否为新客户
         * @returns {boolean}
         */
        appliesToClient(isNewClient) {
            if (this.isForNewClientsOnly()) {
                return isNewClient;
            }
            return true;
        }

        /**
         * 检查是否适用于特定日期时间
         * @param {Date} dateTime - 要检查的日期时间
         * @returns {boolean}
         */
        isValidForDateTime(dateTime) {
            if (this.booking_restrictions.length === 0) return true;

            return this.booking_restrictions.some(restriction =>
                restriction.isValidForDateTime(dateTime)
            );
        }

        /* ================== 礼品卡有效期管理 ================== */

        /**
         * 计算礼品卡过期日期
         * @param {Date} [startDate=new Date()] - 起始日期
         * @returns {Date|null}
         */
        calculateExpirationDate(startDate = new Date()) {
            if (!this.isGiftCard() || !this.duration_type || this.duration <= 0) {
                return null;
            }

            const result = new Date(startDate);

            switch (this.duration_type) {
                case 'day':
                    result.setDate(result.getDate() + this.duration);
                    break;
                case 'week':
                    result.setDate(result.getDate() + this.duration * 7);
                    break;
                case 'month':
                    result.setMonth(result.getMonth() + this.duration);
                    break;
                case 'year':
                    result.setFullYear(result.getFullYear() + this.duration);
                    break;
            }

            return result;
        }

        /**
         * 获取礼品卡有效期文本
         * @returns {string}
         */
        getValidityPeriod() {
            if (!this.isGiftCard()) return "不适用";

            const durationText =
                this.duration_type === 'day' ? '天' :
                    this.duration_type === 'week' ? '周' :
                        this.duration_type === 'month' ? '月' : '年';

            return `${this.duration} ${durationText}`;
        }

        /* ================== 使用限制管理 ================== */

        /**
         * 检查是否还有可用次数
         * @param {number} [currentUsage=0] - 当前已使用次数
         * @returns {boolean}
         */
        hasRemainingUses(currentUsage = 0) {
            return this.is_unlimited || currentUsage < this.allow_usage_count;
        }

        /**
         * 获取剩余可用次数
         * @param {number} [currentUsage=0] - 当前已使用次数
         * @returns {number|string}
         */
        getRemainingUses(currentUsage = 0) {
            return this.is_unlimited ? '无限' : Math.max(0, this.allow_usage_count - currentUsage);
        }

        /* ================== 图像处理方法 ================== */

        /**
         * 获取预览图片URL
         * @param {string} [baseUrl=''] - 基础URL路径
         * @returns {string}
         */
        getPreviewImageUrl(baseUrl = '') {
            return this.picture_preview ? `${baseUrl}${this.picture_preview}` : '';
        }

        /**
         * 获取大图URL
         * @param {string} [baseUrl=''] - 基础URL路径
         * @returns {string}
         */
        getLargeImageUrl(baseUrl = '') {
            return this.picture_large ? `${baseUrl}${this.picture_large}` : '';
        }

        /**
         * 检查是否有图片
         * @returns {boolean}
         */
        hasImages() {
            return !!this.picture_preview || !!this.picture_large;
        }


        /**
         * 获取促销描述摘要
         * @param {number} [maxLength=100] - 最大长度
         * @returns {string}
         */
        getShortDescription(maxLength = 100) {
            return this.description.length > maxLength
                ? `${this.description.substring(0, maxLength)}...`
                : this.description;
        }

        /**
         * 检查是否影响任何产品/服务
         * @returns {boolean}
         */
        affectsAnything() {
            return this.affect_services ||
                this.affect_products ||
                this.affect_paid_attributes ||
                this.affect_memberships ||
                this.affect_packages;
        }

    }

    class PromotionInstanceEntity {
        /**
         * Entity that contains promotion instance information
         *
         * @param {number} id - Promotion instance id. Auto-generated value.
         * @param {PromotionEntity} promotion - Promotion information
         * @param {string} start_date - Promotion instance start date (ISO 8601)
         * @param {string} expired_date - Promotion instance expire date (ISO 8601)
         * @param {boolean} is_used - Returns true if this promotion was used already
         * @param {boolean} can_be_used - Returns true if this promotion can be used now
         * @param {number} can_be_used_count - How many times left. -1 = unlimited uses
         * @param {string} code - Promotion instance code
         * @param {number} client_id - Client id
         */
        constructor(
            id,
            promotion,
            start_date,
            expired_date,
            is_used,
            can_be_used,
            can_be_used_count,
            code,
            client_id
        ) {
            this.id = id;
            this.promotion = promotion;
            this.start_date = start_date;
            this.expired_date = expired_date;
            this.is_used = is_used;
            this.can_be_used = can_be_used;
            this.can_be_used_count = can_be_used_count;
            this.code = code;
            this.client_id = client_id;
        }

        /**
         * Check if the promotion is currently active
         * @returns {boolean}
         */
        isActive() {
            const now = new Date();
            const start = new Date(this.start_date);
            const end = new Date(this.expired_date);
            return now >= start && now <= end;
        }

        /**
         * Check if the promotion has unlimited uses
         * @returns {boolean}
         */
        isUnlimited() {
            return this.can_be_used_count === -1;
        }

        /**
         * Check if the promotion is expired
         * @returns {boolean}
         */
        isExpired() {
            return new Date() > new Date(this.expired_date);
        }

        /**
         * Check if the promotion can be applied now
         * @returns {boolean}
         */
        isApplicable() {
            return this.can_be_used &&
                this.isActive() &&
                !this.is_used &&
                (this.isUnlimited() || this.can_be_used_count > 0);
        }

        /**
         * Get remaining usage count (returns Infinity for unlimited)
         * @returns {number|Infinity}
         */
        getRemainingUses() {
            return this.isUnlimited() ? Infinity : this.can_be_used_count;
        }

        /**
         * Get time remaining until expiration (in milliseconds)
         * @returns {number}
         */
        getTimeRemaining() {
            return new Date(this.expired_date) - new Date();
        }

        /**
         * Get formatted expiration time (e.g., "3 days left")
         * @returns {string}
         */
        getFormattedTimeRemaining() {
            const ms = this.getTimeRemaining();
            if (ms <= 0) return "Expired";

            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);

            if (days > 0) return `${days} day${days !== 1 ? 's' : ''} left`;
            if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''} left`;
            if (minutes > 0) return `${minutes} minute${minutes !== 1 ? 's' : ''} left`;
            return "Less than a minute left";
        }

        /**
         * Mark the promotion as used (decrement usage count)
         */
        markAsUsed() {
            if (this.is_used) return;

            if (!this.isUnlimited()) {
                this.can_be_used_count = Math.max(0, this.can_be_used_count - 1);
            }

            // Update usage status if count reaches zero
            if (this.can_be_used_count === 0) {
                this.is_used = true;
                this.can_be_used = false;
            }
        }

        /**
         * Validate promotion code format
         * @returns {boolean}
         */
        isValidCodeFormat() {
            // Basic validation: 6-20 alphanumeric characters
            return /^[a-zA-Z0-9]{6,20}$/.test(this.code);
        }

        /**
         * Check if promotion is associated with a specific client
         * @param {number} clientId - Client ID to check
         * @returns {boolean}
         */
        isForClient(clientId) {
            return this.client_id === clientId;
        }
    }

    class Promotion_BookingRestrictionEntity {
        /**
         * Booking promotion restrictions info
         *
         * @param {number} id - Restriction id. Auto-generated value.
         * @param {string} start_date - Start date when promotion affects booking (YYYY-MM-DD)
         * @param {string} end_date - End date when promotion affects booking (YYYY-MM-DD)
         * @param {string} start_time - Start time when promotion affects booking (HH:mm:ss)
         * @param {string} end_time - End time when promotion affects booking (HH:mm:ss)
         */
        constructor(
            id,
            start_date,
            end_date,
            start_time,
            end_time
        ) {
            this.id = id;
            this.start_date = start_date;
            this.end_date = end_date;
            this.start_time = start_time;
            this.end_time = end_time;
        }

        /**
         * 检查指定日期时间是否在限制范围内
         * @param {Date} dateTime - 要检查的日期时间对象
         * @returns {boolean}
         */
        isValidForDateTime(dateTime) {
            const dateStr = dateTime.toISOString().split('T')[0];
            const timeStr = dateTime.toTimeString().split(' ')[0];

            // 检查日期范围
            if (dateStr < this.start_date || dateStr > this.end_date) {
                return false;
            }

            // 检查时间范围
            return timeStr >= this.start_time && timeStr <= this.end_time;
        }

        /**
         * 获取开始日期时间对象
         * @returns {Date}
         */
        getStartDateTime() {
            return new Date(`${this.start_date}T${this.start_time}`);
        }

        /**
         * 获取结束日期时间对象
         * @returns {Date}
         */
        getEndDateTime() {
            return new Date(`${this.end_date}T${this.end_time}`);
        }

        /**
         * 检查限制是否在当前时间有效
         * @returns {boolean}
         */
        isCurrentlyActive() {
            const now = new Date();
            return this.isValidForDateTime(now);
        }

        /**
         * 获取持续时间（毫秒）
         * @returns {number}
         */
        getDurationMillis() {
            return this.getEndDateTime() - this.getStartDateTime();
        }

        /**
         * 获取格式化的日期范围
         * @returns {string}
         */
        getFormattedDateRange() {
            return `${this.start_date} 至 ${this.end_date}`;
        }

        /**
         * 获取格式化的时间范围
         * @returns {string}
         */
        getFormattedTimeRange() {
            return `${this.start_time.substring(0, 5)} - ${this.end_time.substring(0, 5)}`;
        }
    }

    class TaxEntity {
        /**
         * Entity that contains tax information
         *
         * @param {number} id - Tax id. Auto-generated value.
         * @param {string} name - Tax name
         * @param {number} ratio - Tax ratio (e.g., 0.15 for 15%)
         * @param {boolean} is_default - Is default tax
         */
        constructor(
            id,
            name,
            ratio,
            is_default = false
        ) {
            this.id = id;
            this.name = name;
            this.ratio = ratio;
            this.is_default = is_default;
        }

        /**
         * 计算税额
         * @param {number} amount - 税前金额
         * @returns {number}
         */
        calculateTax(amount) {
            return amount * this.ratio;
        }

        /**
         * 计算含税总额
         * @param {number} amount - 税前金额
         * @returns {number}
         */
        calculateTotal(amount) {
            return amount * (1 + this.ratio);
        }

        /**
         * 获取税率百分比
         * @returns {string}
         */
        getPercentage() {
            return `${(this.ratio * 100).toFixed(2)}%`;
        }

        /**
         * 检查是否为默认税
         * @returns {boolean}
         */
        isDefault() {
            return this.is_default;
        }
    }

    class PackageEntity {
        /**
         * Entity that contains package information
         *
         * @param {number} id - Package id. Auto-generated value.
         * @param {string} name - Package name
         * @param {string} description - Package description
         * @param {number} position - Package position
         * @param {number} file_id - Image file id
         * @param {string} picture - Picture file name
         * @param {string} picture_path - Picture path
         * @param {string} picture_preview - Path to preview picture
         * @param {string} picture_large - Path to large picture
         * @param {number} price - Package price
         * @param {string} currency - Package price currency
         * @param {number} tax_id - Tax id
         * @param {TaxEntity} tax - Tax information
         * @param {number} duration - Package duration
         * @param {string} duration_type - Package duration type
         * @param {number} sales_limit - Package sales limit
         * @param {number} sold - Sold packages count
         * @param {boolean} can_be_purchased - If client can purchase this package
         * @param {boolean} is_active - Is package active
         * @param {boolean} is_visible - Is package visible on public site
         * @param {Array|Package_PackageServiceEntity[]} services - Array of connected services
         * @param {Array|Package_PackageProductEntity[]} products - Array of connected products
         * @param {Array|Package_PackageProductEntity[]} paid_attributes - Array of connected paid attributes
         * @param {boolean} has_instances - If package has generated instances already
         * @param {boolean} is_use_package_limit - Is use package limit
         * @param {number} package_limit - Package limit
         */
        constructor(
            id,
            name,
            description,
            position,
            file_id,
            picture,
            picture_path,
            picture_preview,
            picture_large,
            price,
            currency,
            tax_id,
            tax,
            duration,
            duration_type,
            sales_limit,
            sold,
            can_be_purchased,
            is_active,
            is_visible,
            services,
            products,
            paid_attributes,
            has_instances,
            is_use_package_limit,
            package_limit
        ) {
            this.id = id;
            this.name = name;
            this.description = description;
            this.position = position;
            this.file_id = file_id;
            this.picture = picture;
            this.picture_path = picture_path;
            this.picture_preview = picture_preview;
            this.picture_large = picture_large;
            this.price = price;
            this.currency = currency;
            this.tax_id = tax_id;
            this.tax = tax;
            this.duration = duration;
            this.duration_type = duration_type;
            this.sales_limit = sales_limit;
            this.sold = sold;
            this.can_be_purchased = can_be_purchased;
            this.is_active = is_active;
            this.is_visible = is_visible;
            this.services = services;
            this.products = products;
            this.paid_attributes = paid_attributes;
            this.has_instances = has_instances;
            this.is_use_package_limit = is_use_package_limit;
            this.package_limit = package_limit;
        }

        /**
         * Check if the package is available for purchase
         * @returns {boolean}
         */
        isAvailable() {
            return this.can_be_purchased &&
                this.is_active &&
                this.is_visible &&
                (this.sales_limit === 0 || this.sold < this.sales_limit);
        }

        /**
         * Get the remaining available quantity
         * @returns {number}
         */
        getRemainingQuantity() {
            if (this.sales_limit === 0) return Infinity;
            return Math.max(0, this.sales_limit - this.sold);
        }

        /**
         * Get the total duration in minutes
         * @returns {number}
         */
        getTotalDurationMinutes() {
            switch (this.duration_type) {
                case 'minutes': return this.duration;
                case 'hours': return this.duration * 60;
                case 'days': return this.duration * 24 * 60;
                default: return this.duration;
            }
        }

        /**
         * Get the price including tax
         * @returns {number}
         */
        getPriceWithTax() {
            if (!this.tax) return this.price;
            return this.price * (1 + this.tax.rate / 100);
        }

        /**
         * Get the formatted price with currency
         * @param {boolean} includeTax - Include tax in the price
         * @returns {string}
         */
        getFormattedPrice(includeTax = true) {
            const price = includeTax ? this.getPriceWithTax() : this.price;
            return `${price.toFixed(2)} ${this.currency}`;
        }

        /**
         * Check if the package has any services
         * @returns {boolean}
         */
        hasServices() {
            return this.services && this.services.length > 0;
        }

        /**
         * Check if the package has any products
         * @returns {boolean}
         */
        hasProducts() {
            return this.products && this.products.length > 0;
        }

        /**
         * Check if the package has any paid attributes
         * @returns {boolean}
         */
        hasPaidAttributes() {
            return this.paid_attributes && this.paid_attributes.length > 0;
        }

        /**
         * Get the full URL for the preview picture
         * @returns {string}
         */
        getPreviewPictureUrl() {
            return this.picture_path && this.picture_preview
                ? `${this.picture_path}/${this.picture_preview}`
                : '';
        }

        /**
         * Get the full URL for the large picture
         * @returns {string}
         */
        getLargePictureUrl() {
            return this.picture_path && this.picture_large
                ? `${this.picture_path}/${this.picture_large}`
                : '';
        }

        /**
         * Check if the package has reached its limit
         * @returns {boolean}
         */
        hasReachedLimit() {
            return this.is_use_package_limit &&
                this.package_limit > 0 &&
                this.sold >= this.package_limit;
        }

        /**
         * Get the total value of all included services
         * @returns {number}
         */
        getServicesValue() {
            if (!this.hasServices()) return 0;
            return this.services.reduce((sum, service) => sum + (service.price || 0), 0);
        }

        /**
         * Get the total value of all included products
         * @returns {number}
         */
        getProductsValue() {
            if (!this.hasProducts()) return 0;
            return this.products.reduce((sum, product) => sum + (product.price * product.quantity || 0), 0);
        }

        /**
         * Get the total value of all included paid attributes
         * @returns {number}
         */
        getPaidAttributesValue() {
            if (!this.hasPaidAttributes()) return 0;
            return this.paid_attributes.reduce((sum, attr) => sum + (attr.price * attr.quantity || 0), 0);
        }

        /**
         * Calculate the total value of all package components
         * @returns {number}
         */
        getTotalValue() {
            return this.getServicesValue() + this.getProductsValue() + this.getPaidAttributesValue();
        }

        /**
         * Calculate the savings percentage compared to individual purchases
         * @returns {number}
         */
        getSavingsPercentage() {
            const totalValue = this.getTotalValue();
            if (totalValue <= this.price) return 0;
            return Math.round((1 - this.price / totalValue) * 100);
        }

        /**
         * Check if the package has any images
         * @returns {boolean}
         */
        hasImages() {
            return !!this.picture ||
                !!this.picture_preview ||
                !!this.picture_large;
        }

        /**
         * Get the main service in the package (if any)
         * @returns {Package_PackageServiceEntity|null}
         */
        getPrimaryService() {
            return this.services.length > 0 ? this.services[0] : null;
        }
    }











    // AdminClient.default().getBookingDetails('3mbs3ej9k').then(response => {
    //     console.log(response);
    // });
    // AdminClient.default().getInvoice('3mbs3ej9k').then(response => {
    //     console.log(response);
    // });
    AdminClient.default().getBookingByCode('3mbs3ej9k').then(async response => {
        let details = await AdminClient.default().getBookingDetails(response.id);
        console.log(response);
        console.log(details);
        console.log(await AdminClient.default().getInvoice(response.invoice_id));
    });
})();
