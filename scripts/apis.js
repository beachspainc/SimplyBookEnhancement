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

        async request(endpoint, method, body, headers = {}, params) {
            return new Promise((resolve, reject) => {
                let url = `${this.baseUrl}${endpoint}`;

                // Add query parameters for GET requests
                if (params && method === "GET") {
                    const query = new URLSearchParams(params).toString();
                    url += `?${query}`;
                }
                GM_xmlhttpRequest({
                    method: method,
                    url: url,
                    headers: {
                        "Content-Type": "application/json",
                        ...headers
                    },
                    data: body ? JSON.stringify(body) : undefined,
                    onload: (response) => {
                        if (response.status >= 200 && response.status < 300) {
                            try {
                                const data = response.responseText ? JSON.parse(response.responseText) : null;
                                resolve(data);
                            } catch (e) {
                                resolve(null);
                            }
                        } else {
                            let errorDetails = {};
                            try {
                                const errorData = JSON.parse(response.responseText);
                                errorDetails = errorData.errors || {};
                            } catch (e) {
                                // Unable to parse error details
                            }

                            if (response.status === 400) {
                                reject(new APIError("Invalid request data", "BadRequest", errorDetails));
                            } else if (response.status === 403) {
                                reject(new APIError("Access denied", "AccessDenied"));
                            } else {
                                reject(new APIError(`HTTP error! status: ${response.status}`, "HTTPError"));
                            }
                        }
                    },
                    onerror: (error) => {
                        reject(new APIError(`Request failed: ${error.error}`, "NetworkError"));
                    }
                });
            });
        }
    }
    class AdminClient extends RestClient {
        static DEFAULT;

        constructor(base_url, company, username, password) {
            super(base_url);
            this.client = new AuthenticationClient(base_url);
            this.company = company;
            this.#authenticated = this.#authenticate(username, password);
        }

        #authenticated
        async #authenticate(username, password) {
            this.token = await this.client.authenticate(this.company, username, password);
        }

        async request(endpoint, method, body, headers = {}, params) {
            await this.#authenticated;
            if (!this.token) throw new APIError("Authentication failed", "AuthenticationFailed");
            //TODO: status 409 refresh token
            return super.request(endpoint, method, body, {
                ...headers,
                "X-Company-Login": this.company,
                "X-Token": this.token.token
            }, params);
        }

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
            console.log(data);
            return new AdminBookingDetailsEntity(...valuesOf(data, AdminBookingDetailsEntity));
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
         * @param {Object} location - LocationEntity
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

    class InvoiceEntity {
        /**
         * @param {number} id - Invoice id
         * @param {string} number - Invoice number
         * @param {string} status - Invoice status
         * @param {number} amount - Invoice amount
         * @param {number} paid_amount - Paid amount
         * @param {string} payment_processor - Payment processor
         * @param {string} created_datetime - Creation datetime
         * @param {string} payment_datetime - Payment datetime
         * @param {number} booking_id - Related booking id
         */
        constructor(id, number, status, amount, paid_amount, payment_processor, created_datetime, payment_datetime, booking_id) {
            this.id = id;
            this.number = number;
            this.status = status;
            this.amount = amount;
            this.paid_amount = paid_amount;
            this.payment_processor = payment_processor;
            this.created_datetime = created_datetime;
            this.payment_datetime = payment_datetime;
            this.booking_id = booking_id;
        }
    }
    class CompanyEntity {
        /**
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

    class PaymentProcessorEntity {
        /**
         * @param {string} id - Processor identifier
         * @param {string} name - Processor name
         * @param {boolean} is_active - Active status
         * @param {Object} settings - Processor settings
         * @param {string[]} supported_currencies - Supported currencies
         */
        constructor(id, name, is_active, settings, supported_currencies) {
            this.id = id;
            this.name = name;
            this.is_active = is_active;
            this.settings = settings;
            this.supported_currencies = supported_currencies;
        }
    }

    class MembershipEntity {
        /**
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

    class ClientMembershipEntity {
        /**
         * @param {number} id - Client membership id
         * @param {number} client_id - Client id
         * @param {number} membership_id - Membership id
         * @param {string} start_date - Start date
         * @param {string} end_date - End date
         * @param {boolean} is_active - Active status
         * @param {Object} usage - Usage statistics
         */
        constructor(id, client_id, membership_id, start_date, end_date, is_active, usage) {
            this.id = id;
            this.client_id = client_id;
            this.membership_id = membership_id;
            this.start_date = start_date;
            this.end_date = end_date;
            this.is_active = is_active;
            this.usage = usage;
        }
    }

    class EventEntity {
        /**
         * @param {number} id - Event id
         * @param {string} title - Event title
         * @param {string} start_datetime - Start datetime
         * @param {string} end_datetime - End datetime
         * @param {string} description - Event description
         * @param {number} provider_id - Provider id
         * @param {number} location_id - Location id
         * @param {boolean} is_public - Public visibility
         */
        constructor(id, title, start_datetime, end_datetime, description, provider_id, location_id, is_public) {
            this.id = id;
            this.title = title;
            this.start_datetime = start_datetime;
            this.end_datetime = end_datetime;
            this.description = description;
            this.provider_id = provider_id;
            this.location_id = location_id;
            this.is_public = is_public;
        }
    }

    class WorkScheduleEntity {
        /**
         * @param {number} provider_id - Provider id
         * @param {Object} schedule - Weekly schedule
         * @param {Object[]} exceptions - Schedule exceptions
         * @param {string[]} holidays - Holiday dates
         */
        constructor(provider_id, schedule, exceptions, holidays) {
            this.provider_id = provider_id;
            this.schedule = schedule;
            this.exceptions = exceptions;
            this.holidays = holidays;
        }
    }

    class NotificationTemplateEntity {
        /**
         * @param {number} id - Template id
         * @param {string} name - Template name
         * @param {string} type - Template type (email/sms)
         * @param {string} subject - Email subject
         * @param {string} body - Template body
         * @param {Object} variables - Available variables
         * @param {boolean} is_active - Active status
         */
        constructor(id, name, type, subject, body, variables, is_active) {
            this.id = id;
            this.name = name;
            this.type = type;
            this.subject = subject;
            this.body = body;
            this.variables = variables;
            this.is_active = is_active;
        }
    }

    class CustomFieldEntity {
        /**
         * @param {number} id - Field id
         * @param {string} name - Field name
         * @param {string} type - Field type
         * @param {boolean} required - Required status
         * @param {Object} settings - Field settings
         * @param {string[]} options - Field options for select types
         */
        constructor(id, name, type, required, settings, options) {
            this.id = id;
            this.name = name;
            this.type = type;
            this.required = required;
            this.settings = settings;
            this.options = options;
        }
    }

    class ProductEntity {
        /**
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

    class ServiceCategoryEntity {
        /**
         * @param {number} id - Category id
         * @param {string} name - Category name
         * @param {string} description - Category description
         * @param {number} parent_id - Parent category id
         * @param {boolean} is_active - Active status
         * @param {number} sort_order - Sort order
         */
        constructor(id, name, description, parent_id, is_active, sort_order) {
            this.id = id;
            this.name = name;
            this.description = description;
            this.parent_id = parent_id;
            this.is_active = is_active;
            this.sort_order = sort_order;
        }
    }

    class TimeSlotEntity {
        /**
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

    class PaymentEntity {
        /**
         * @param {number} id - Payment id
         * @param {number} invoice_id - Invoice id
         * @param {number} amount - Payment amount
         * @param {string} processor - Payment processor
         * @param {string} status - Payment status
         * @param {string} transaction_id - Transaction id
         * @param {string} created_datetime - Creation datetime
         */
        constructor(id, invoice_id, amount, processor, status, transaction_id, created_datetime) {
            this.id = id;
            this.invoice_id = invoice_id;
            this.amount = amount;
            this.processor = processor;
            this.status = status;
            this.transaction_id = transaction_id;
            this.created_datetime = created_datetime;
        }
    }

    class ErrorEntity {
        /**
         * @param {string} code - Error code
         * @param {string} message - Error message
         * @param {Object} details - Error details
         * @param {string} type - Error type
         */
        constructor(code, message, details, type) {
            this.code = code;
            this.message = message;
            this.details = details;
            this.type = type;
        }
    }

    class ConfigEntity {
        /**
         * @param {string} key - Config key
         * @param {*} value - Config value
         * @param {string} type - Value type
         * @param {Object} metadata - Additional metadata
         */
        constructor(key, value, type, metadata) {
            this.key = key;
            this.value = value;
            this.type = type;
            this.metadata = metadata;
        }
    }

    class StatisticsEntity {
        /**
         * @param {string} period - Statistics period
         * @param {Object} data - Statistics data
         * @param {Object} metrics - Statistics metrics
         * @param {Object} filters - Applied filters
         */
        constructor(period, data, metrics, filters) {
            this.period = period;
            this.data = data;
            this.metrics = metrics;
            this.filters = filters;
        }
    }

    class LogEntity {
        /**
         * @param {number} id - Log entry id
         * @param {string} type - Log type
         * @param {string} message - Log message
         * @param {Object} context - Log context
         * @param {string} created_datetime - Creation datetime
         * @param {string} level - Log level
         */
        constructor(id, type, message, context, created_datetime, level) {
            this.id = id;
            this.type = type;
            this.message = message;
            this.context = context;
            this.created_datetime = created_datetime;
            this.level = level;
        }
    }

    class UserEntity {
        /**
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

    class NotificationEntity {
        /**
         * @param {number} id - Notification id
         * @param {string} type - Notification type
         * @param {string} title - Notification title
         * @param {string} message - Notification message
         * @param {boolean} is_read - Read status
         * @param {number} user_id - Target user id
         * @param {string} created_datetime - Creation datetime
         */
        constructor(id, type, title, message, is_read, user_id, created_datetime) {
            this.id = id;
            this.type = type;
            this.title = title;
            this.message = message;
            this.is_read = is_read;
            this.user_id = user_id;
            this.created_datetime = created_datetime;
        }
    }

    class FileEntity {
        /**
         * @param {number} id - File id
         * @param {string} name - File name
         * @param {string} path - File path
         * @param {string} mime_type - MIME type
         * @param {number} size - File size in bytes
         * @param {string} hash - File hash
         * @param {string} upload_datetime - Upload datetime
         */
        constructor(id, name, path, mime_type, size, hash, upload_datetime) {
            this.id = id;
            this.name = name;
            this.path = path;
            this.mime_type = mime_type;
            this.size = size;
            this.hash = hash;
            this.upload_datetime = upload_datetime;
        }
    }

    class ReviewEntity {
        /**
         * @param {number} id - Review id
         * @param {number} booking_id - Related booking id
         * @param {number} client_id - Client id
         * @param {number} rating - Rating value
         * @param {string} comment - Review comment
         * @param {boolean} is_published - Published status
         * @param {string} created_datetime - Creation datetime
         */
        constructor(id, booking_id, client_id, rating, comment, is_published, created_datetime) {
            this.id = id;
            this.booking_id = booking_id;
            this.client_id = client_id;
            this.rating = rating;
            this.comment = comment;
            this.is_published = is_published;
            this.created_datetime = created_datetime;
        }
    }

    class CouponEntity {
        /**
         * @param {number} id - Coupon id
         * @param {string} code - Coupon code
         * @param {string} type - Coupon type
         * @param {number} value - Discount value
         * @param {number} usage_limit - Usage limit
         * @param {number} used_count - Times used
         * @param {string} expiry_date - Expiry date
         * @param {boolean} is_active - Active status
         */
        constructor(id, code, type, value, usage_limit, used_count, expiry_date, is_active) {
            this.id = id;
            this.code = code;
            this.type = type;
            this.value = value;
            this.usage_limit = usage_limit;
            this.used_count = used_count;
            this.expiry_date = expiry_date;
            this.is_active = is_active;
        }
    }

    class ReportEntity {
        /**
         * @param {number} id - Report id
         * @param {string} type - Report type
         * @param {Object} parameters - Report parameters
         * @param {Object} data - Report data
         * @param {string} format - Report format
         * @param {string} generated_datetime - Generation datetime
         */
        constructor(id, type, parameters, data, format, generated_datetime) {
            this.id = id;
            this.type = type;
            this.parameters = parameters;
            this.data = data;
            this.format = format;
            this.generated_datetime = generated_datetime;
        }
    }

    class ResourceEntity {
        /**
         * @param {number} id - Resource id
         * @param {string} name - Resource name
         * @param {string} type - Resource type
         * @param {boolean} is_shared - Shared status
         * @param {number} quantity - Available quantity
         * @param {Object} settings - Resource settings
         * @param {boolean} is_active - Active status
         */
        constructor(id, name, type, is_shared, quantity, settings, is_active) {
            this.id = id;
            this.name = name;
            this.type = type;
            this.is_shared = is_shared;
            this.quantity = quantity;
            this.settings = settings;
            this.is_active = is_active;
        }
    }

    class SubscriptionEntity {
        /**
         * @param {number} id - Subscription id
         * @param {string} plan - Subscription plan
         * @param {string} status - Subscription status
         * @param {string} start_date - Start date
         * @param {string} end_date - End date
         * @param {number} price - Subscription price
         * @param {string} billing_cycle - Billing cycle
         * @param {Object} features - Included features
         */
        constructor(id, plan, status, start_date, end_date, price, billing_cycle, features) {
            this.id = id;
            this.plan = plan;
            this.status = status;
            this.start_date = start_date;
            this.end_date = end_date;
            this.price = price;
            this.billing_cycle = billing_cycle;
            this.features = features;
        }
    }

    class IntegrationEntity {
        /**
         * @param {number} id - Integration id
         * @param {string} name - Integration name
         * @param {string} type - Integration type
         * @param {Object} config - Integration configuration
         * @param {boolean} is_active - Active status
         * @param {string} last_sync - Last sync datetime
         * @param {Object} sync_status - Sync status details
         */
        constructor(id, name, type, config, is_active, last_sync, sync_status) {
            this.id = id;
            this.name = name;
            this.type = type;
            this.config = config;
            this.is_active = is_active;
            this.last_sync = last_sync;
            this.sync_status = sync_status;
        }
    }

    class WebhookEntity {
        /**
         * @param {number} id - Webhook id
         * @param {string} url - Webhook URL
         * @param {string[]} events - Subscribed events
         * @param {boolean} is_active - Active status
         * @param {Object} headers - Custom headers
         * @param {string} secret - Webhook secret
         * @param {Object} last_delivery - Last delivery details
         */
        constructor(id, url, events, is_active, headers, secret, last_delivery) {
            this.id = id;
            this.url = url;
            this.events = events;
            this.is_active = is_active;
            this.headers = headers;
            this.secret = secret;
            this.last_delivery = last_delivery;
        }
    }

    class PackageEntity {
        /**
         * @param {number} id - Package id
         * @param {string} name - Package name
         * @param {string} description - Package description
         * @param {number} price - Package price
         * @param {number[]} service_ids - Included service ids
         * @param {number} validity_days - Validity period in days
         * @param {boolean} is_active - Active status
         * @param {Object} settings - Package settings
         */
        constructor(id, name, description, price, service_ids, validity_days, is_active, settings) {
            this.id = id;
            this.name = name;
            this.description = description;
            this.price = price;
            this.service_ids = service_ids;
            this.validity_days = validity_days;
            this.is_active = is_active;
            this.settings = settings;
        }
    }

    class ClientGroupEntity {
        /**
         * @param {number} id - Group id
         * @param {string} name - Group name
         * @param {string} description - Group description
         * @param {number[]} client_ids - Member client ids
         * @param {Object} settings - Group settings
         * @param {boolean} is_active - Active status
         */
        constructor(id, name, description, client_ids, settings, is_active) {
            this.id = id;
            this.name = name;
            this.description = description;
            this.client_ids = client_ids;
            this.settings = settings;
            this.is_active = is_active;
        }
    }

    class ServiceOptionEntity {
        /**
         * @param {number} id - Option id
         * @param {number} service_id - Service id
         * @param {string} name - Option name
         * @param {string} type - Option type
         * @param {number} price_modifier - Price modification
         * @param {number} duration_modifier - Duration modification
         * @param {boolean} is_required - Required status
         * @param {Object} settings - Option settings
         */
        constructor(id, service_id, name, type, price_modifier, duration_modifier, is_required, settings) {
            this.id = id;
            this.service_id = service_id;
            this.name = name;
            this.type = type;
            this.price_modifier = price_modifier;
            this.duration_modifier = duration_modifier;
            this.is_required = is_required;
            this.settings = settings;
        }
    }

    class WaitingListEntity {
        /**
         * @param {number} id - Entry id
         * @param {number} client_id - Client id
         * @param {number} service_id - Service id
         * @param {string} preferred_date - Preferred date
         * @param {string} status - Status
         * @param {string} notes - Additional notes
         * @param {string} created_datetime - Creation datetime
         */
        constructor(id, client_id, service_id, preferred_date, status, notes, created_datetime) {
            this.id = id;
            this.client_id = client_id;
            this.service_id = service_id;
            this.preferred_date = preferred_date;
            this.status = status;
            this.notes = notes;
            this.created_datetime = created_datetime;
        }
    }

    class GiftCardEntity {
        /**
         * @param {number} id - Gift card id
         * @param {string} code - Gift card code
         * @param {number} initial_value - Initial value
         * @param {number} current_balance - Current balance
         * @param {string} expiry_date - Expiry date
         * @param {boolean} is_active - Active status
         * @param {number} recipient_id - Recipient client id
         * @param {Object} usage_history - Usage history
         */
        constructor(id, code, initial_value, current_balance, expiry_date, is_active, recipient_id, usage_history) {
            this.id = id;
            this.code = code;
            this.initial_value = initial_value;
            this.current_balance = current_balance;
            this.expiry_date = expiry_date;
            this.is_active = is_active;
            this.recipient_id = recipient_id;
            this.usage_history = usage_history;
        }
    }

    class EmailTemplateEntity {
        /**
         * @param {number} id - Template id
         * @param {string} name - Template name
         * @param {string} subject - Email subject
         * @param {string} body - Email body
         * @param {string} trigger - Trigger event
         * @param {Object} variables - Available variables
         * @param {boolean} is_active - Active status
         * @param {Object} settings - Template settings
         */
        constructor(id, name, subject, body, trigger, variables, is_active, settings) {
            this.id = id;
            this.name = name;
            this.subject = subject;
            this.body = body;
            this.trigger = trigger;
            this.variables = variables;
            this.is_active = is_active;
            this.settings = settings;
        }
    }

    class BlockedTimeEntity {
        /**
         * @param {number} id - Blocked time id
         * @param {string} start_datetime - Start datetime
         * @param {string} end_datetime - End datetime
         * @param {number} provider_id - Provider id
         * @param {string} reason - Blocking reason
         * @param {boolean} is_recurring - Recurring status
         * @param {Object} recurrence_rule - Recurrence settings
         * @param {Object} settings - Block settings
         */
        constructor(id, start_datetime, end_datetime, provider_id, reason, is_recurring, recurrence_rule, settings) {
            this.id = id;
            this.start_datetime = start_datetime;
            this.end_datetime = end_datetime;
            this.provider_id = provider_id;
            this.reason = reason;
            this.is_recurring = is_recurring;
            this.recurrence_rule = recurrence_rule;
            this.settings = settings;
        }
    }

    class CommunicationLogEntity {
        /**
         * @param {number} id - Log id
         * @param {string} type - Communication type (email/sms)
         * @param {number} client_id - Client id
         * @param {string} subject - Message subject
         * @param {string} content - Message content
         * @param {string} status - Delivery status
         * @param {string} sent_datetime - Sent datetime
         * @param {Object} metadata - Additional metadata
         */
        constructor(id, type, client_id, subject, content, status, sent_datetime, metadata) {
            this.id = id;
            this.type = type;
            this.client_id = client_id;
            this.subject = subject;
            this.content = content;
            this.status = status;
            this.sent_datetime = sent_datetime;
            this.metadata = metadata;
        }
    }

    class ReminderEntity {
        /**
         * @param {number} id - Reminder id
         * @param {string} type - Reminder type
         * @param {number} booking_id - Related booking id
         * @param {string} send_datetime - Scheduled send time
         * @param {string} status - Reminder status
         * @param {Object} template - Message template
         * @param {Object} settings - Reminder settings
         */
        constructor(id, type, booking_id, send_datetime, status, template, settings) {
            this.id = id;
            this.type = type;
            this.booking_id = booking_id;
            this.send_datetime = send_datetime;
            this.status = status;
            this.template = template;
            this.settings = settings;
        }
    }

    class PromotionEntity {
        /**
         * @param {number} id - Promotion id
         * @param {string} name - Promotion name
         * @param {string} description - Promotion description
         * @param {string} start_date - Start date
         * @param {string} end_date - End date
         * @param {Object} conditions - Promotion conditions
         * @param {Object} rewards - Promotion rewards
         * @param {boolean} is_active - Active status
         */
        constructor(id, name, description, start_date, end_date, conditions, rewards, is_active) {
            this.id = id;
            this.name = name;
            this.description = description;
            this.start_date = start_date;
            this.end_date = end_date;
            this.conditions = conditions;
            this.rewards = rewards;
            this.is_active = is_active;
        }
    }

    class TaxRateEntity {
        /**
         * @param {number} id - Tax rate id
         * @param {string} name - Tax rate name
         * @param {number} rate - Tax rate percentage
         * @param {string} country - Country code
         * @param {string} region - Region/state code
         * @param {boolean} is_default - Default status
         * @param {Object} settings - Tax settings
         */
        constructor(id, name, rate, country, region, is_default, settings) {
            this.id = id;
            this.name = name;
            this.rate = rate;
            this.country = country;
            this.region = region;
            this.is_default = is_default;
            this.settings = settings;
        }
    }

    class FormEntity {
        /**
         * @param {number} id - Form id
         * @param {string} name - Form name
         * @param {string} type - Form type
         * @param {Object[]} fields - Form fields
         * @param {Object} validation_rules - Validation rules
         * @param {boolean} is_active - Active status
         * @param {Object} settings - Form settings
         */
        constructor(id, name, type, fields, validation_rules, is_active, settings) {
            this.id = id;
            this.name = name;
            this.type = type;
            this.fields = fields;
            this.validation_rules = validation_rules;
            this.is_active = is_active;
            this.settings = settings;
        }
    }

    class WorkflowEntity {
        /**
         * @param {number} id - Workflow id
         * @param {string} name - Workflow name
         * @param {string} trigger_event - Trigger event
         * @param {Object[]} conditions - Workflow conditions
         * @param {Object[]} actions - Workflow actions
         * @param {boolean} is_active - Active status
         * @param {Object} settings - Workflow settings
         */
        constructor(id, name, trigger_event, conditions, actions, is_active, settings) {
            this.id = id;
            this.name = name;
            this.trigger_event = trigger_event;
            this.conditions = conditions;
            this.actions = actions;
            this.is_active = is_active;
            this.settings = settings;
        }
    }

    class ServiceProviderEntity {
        /**
         * @param {number} id - Provider id
         * @param {string} name - Provider name
         * @param {string} email - Provider email
         * @param {string} phone - Provider phone
         * @param {number[]} service_ids - Assigned service ids
         * @param {number[]} location_ids - Assigned location ids
         * @param {Object} schedule - Work schedule
         * @param {boolean} is_active - Active status
         * @param {Object} settings - Provider settings
         */
        constructor(id, name, email, phone, service_ids, location_ids, schedule, is_active, settings) {
            this.id = id;
            this.name = name;
            this.email = email;
            this.phone = phone;
            this.service_ids = service_ids;
            this.location_ids = location_ids;
            this.schedule = schedule;
            this.is_active = is_active;
            this.settings = settings;
        }
    }

    class InventoryEntity {
        /**
         * @param {number} id - Inventory record id
         * @param {number} product_id - Product id
         * @param {string} action - Action type (in/out)
         * @param {number} quantity - Quantity changed
         * @param {string} reason - Reason for change
         * @param {number} booking_id - Related booking id
         * @param {string} created_datetime - Creation datetime
         */
        constructor(id, product_id, action, quantity, reason, booking_id, created_datetime) {
            this.id = id;
            this.product_id = product_id;
            this.action = action;
            this.quantity = quantity;
            this.reason = reason;
            this.booking_id = booking_id;
            this.created_datetime = created_datetime;
        }
    }

    class MembershipPlanEntity {
        /**
         * @param {number} id - Plan id
         * @param {string} name - Plan name
         * @param {string} description - Plan description
         * @param {number} price - Plan price
         * @param {number} duration_days - Duration in days
         * @param {Object} benefits - Plan benefits
         * @param {Object} restrictions - Plan restrictions
         * @param {boolean} is_active - Active status
         */
        constructor(id, name, description, price, duration_days, benefits, restrictions, is_active) {
            this.id = id;
            this.name = name;
            this.description = description;
            this.price = price;
            this.duration_days = duration_days;
            this.benefits = benefits;
            this.restrictions = restrictions;
            this.is_active = is_active;
        }
    }

    class WaiverEntity {
        /**
         * @param {number} id - Waiver id
         * @param {string} title - Waiver title
         * @param {string} content - Waiver content
         * @param {number[]} service_ids - Required for services
         * @param {boolean} require_signature - Signature requirement
         * @param {Object} settings - Waiver settings
         * @param {boolean} is_active - Active status
         */
        constructor(id, title, content, service_ids, require_signature, settings, is_active) {
            this.id = id;
            this.title = title;
            this.content = content;
            this.service_ids = service_ids;
            this.require_signature = require_signature;
            this.settings = settings;
            this.is_active = is_active;
        }
    }

    class MarketingCampaignEntity {
        /**
         * @param {number} id - Campaign id
         * @param {string} name - Campaign name
         * @param {string} type - Campaign type
         * @param {string} status - Campaign status
         * @param {Object} settings - Campaign settings
         * @param {Object} statistics - Campaign statistics
         * @param {string} start_date - Start date
         * @param {string} end_date - End date
         */
        constructor(id, name, type, status, settings, statistics, start_date, end_date) {
            this.id = id;
            this.name = name;
            this.type = type;
            this.status = status;
            this.settings = settings;
            this.statistics = statistics;
            this.start_date = start_date;
            this.end_date = end_date;
        }
    }

    class FeedbackFormEntity {
        /**
         * @param {number} id - Form id
         * @param {string} name - Form name
         * @param {Object[]} questions - Form questions
         * @param {number[]} service_ids - Associated services
         * @param {boolean} auto_send - Auto send status
         * @param {Object} settings - Form settings
         * @param {boolean} is_active - Active status
         */
        constructor(id, name, questions, service_ids, auto_send, settings, is_active) {
            this.id = id;
            this.name = name;
            this.questions = questions;
            this.service_ids = service_ids;
            this.auto_send = auto_send;
            this.settings = settings;
            this.is_active = is_active;
        }
    }

    class ReferralEntity {
        /**
         * @param {number} id - Referral id
         * @param {number} referrer_id - Referrer client id
         * @param {number} referred_id - Referred client id
         * @param {string} status - Referral status
         * @param {Object} rewards - Reward details
         * @param {string} created_datetime - Creation datetime
         */
        constructor(id, referrer_id, referred_id, status, rewards, created_datetime) {
            this.id = id;
            this.referrer_id = referrer_id;
            this.referred_id = referred_id;
            this.status = status;
            this.rewards = rewards;
            this.created_datetime = created_datetime;
        }
    }
    console.log(AdminClient.default().getBookingDetails('3mbs3ej9k'));
})();
