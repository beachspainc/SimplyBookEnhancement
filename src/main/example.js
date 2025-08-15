// =======================
// Entity Classes
// =======================

/**
 * Base entity class that represents a single record returned by the API.
 *
 * Responsibilities:
 * - Encapsulates raw data for a single record or object.
 * - Provides a method to retrieve the raw underlying data structure.
 */
class SBEntity {
    /**
     * @param {any} data - The raw data object associated with this entity.
     */
    constructor(data) {
        this.data = data;
    }

    /**
     * Returns the raw underlying data stored in this entity.
     * This method is useful when you need to access the original API payload.
     *
     * @returns {any} The raw data object.
     */
    raw() {
        return this.data;
    }
}

/**
 * Represents an array (collection) of SBEntity instances or plain objects.
 * Optionally includes pagination metadata returned from the API.
 *
 * Responsibilities:
 * - Provides collection-level operations (pluck, size, type casting).
 * - Stores and exposes pagination metadata (if provided).
 */
class SBEntityArray extends SBEntity {
    /**
     * @param {any[]} data - An array of records or objects.
     * @param {Object|null} meta - Optional pagination metadata (e.g., page, total pages).
     */
    constructor(data = [], meta = null) {
        super(Array.isArray(data) ? data : []);
        this.meta = meta && typeof meta === 'object' ? meta : null;
    }

    /**
     * The total number of items in the collection.
     *
     * @type {number}
     */
    get size() {
        return this.data.length;
    }

    /**
     * Extracts one or more fields from each record in the collection.
     * This is useful when you need only specific fields without additional processing.
     *
     * @param {...string} fields - The field names to extract from each record.
     * @returns {SBEntityArray} A new SBEntityArray containing only the extracted fields.
     */
    pluck(...fields) {
        const result = this.data.map(item => {
            const extracted = {};
            for (const field of fields) {
                if (item?.[field] !== undefined) {
                    extracted[field] = item[field];
                }
            }
            return extracted;
        });
        return new SBEntityArray(result, this.meta);
    }

    /**
     * Casts the current SBEntityArray into a specific subclass (e.g., SBClientArray).
     *
     * @template T
     * @param {new(data: any[], meta?: any) => T} Type - The constructor of the target subclass.
     * @returns {T} A new instance of the target subclass containing the same data and metadata.
     */
    as(Type) {
        return new Type(this.data, this.meta);
    }
}

/**
 * Specialized entity array for booking records.
 *
 * Responsibilities:
 * - Adds time-based grouping capabilities (morning, afternoon, evening).
 * - Exposes a list of unique therapist names for the bookings.
 */
class SBBookingArray extends SBEntityArray {
    /**
     * Groups bookings into three categories based on start time:
     * - Morning: start time before 12:00
     * - Afternoon: start time from 12:00 to before 18:00
     * - Evening: start time from 18:00 onwards
     *
     * Time can be provided as:
     * - String format "YYYY-MM-DD HH:mm:ss"
     * - Separate time string "HH:mm:ss"
     * - Timestamp in milliseconds
     *
     * @returns {{ morning: SBBookingArray, afternoon: SBBookingArray, evening: SBBookingArray }}
     *          An object containing three SBBookingArray instances for each time segment.
     */
    get groupedByTime() {
        const segments = { morning: [], afternoon: [], evening: [] };

        const pickHour = (b) => {
            // Attempt to parse hour from known date/time string fields
            let s = b?.date_start || b?.start_dt || b?.start_date || b?.start_time;
            if (typeof s === 'string') {
                const time = s.includes(' ') ? s.split(' ')[1] : s;
                const hh = time?.split(':')?.[0];
                const hour = Number(hh);
                if (Number.isFinite(hour)) return hour;
            }
            // Attempt to parse from timestamp fields
            const ts = b?.timestamp || b?.start_ts;
            if (ts) {
                const d = new Date(ts);
                const hour = d.getHours?.();
                if (Number.isFinite(hour)) return hour;
            }
            return null;
        };

        for (const b of this.data) {
            const hour = pickHour(b);
            if (!Number.isFinite(hour)) continue;
            if (hour < 12) segments.morning.push(b);
            else if (hour < 18) segments.afternoon.push(b);
            else segments.evening.push(b);
        }

        return {
            morning: new SBBookingArray(segments.morning, this.meta),
            afternoon: new SBBookingArray(segments.afternoon, this.meta),
            evening: new SBBookingArray(segments.evening, this.meta),
        };
    }

    /**
     * Returns a list of unique therapist names associated with the bookings.
     *
     * @type {string[]}
     */
    get therapists() {
        return [...new Set(this.data.map(b => b.unit_name).filter(Boolean))];
    }
}

/**
 * Specialized entity array for client records.
 *
 * Responsibilities:
 * - Extracts valid phone numbers in standardized format.
 * - Provides name-phone pair mappings.
 */
class SBClientArray extends SBEntityArray {
    /**
     * Returns an array of valid phone numbers from client records.
     * Numbers are cleaned to remove non-digit characters and must be exactly 10 digits long.
     *
     * @type {string[]}
     */
    get phones() {
        return this
            .pluck('name_or_phone')
            .raw()
            .map(item => item?.name_or_phone?.replace(/\D/g, ''))
            .filter(p => p?.length === 10);
    }

    /**
     * Returns an array of objects mapping client names to phone numbers.
     *
     * @type {{ name: string, phone: string }[]}
     */
    get namePhonePairs() {
        return this
            .pluck('name', 'name_or_phone')
            .raw()
            .map(({ name, name_or_phone }) => ({ name, phone: name_or_phone }))
            .filter(p => p.phone);
    }
}

/**
 * API client wrapper for interacting with the SimplyBook REST API.
 *
 * Responsibilities:
 * - Handles CSRF token management.
 * - Wraps HTTP requests with consistent configuration (headers, JSON handling).
 * - Exposes higher-level methods for retrieving specific resources.
 * - Supports pagination and recursive fetch for complete data retrieval.
 */
const SimplyBookAPI = {
    baseUrl: 'https://beachspa.secure.simplybook.me/v2/rest',

    /**
     * Retrieves the CSRF token from either the global config object or the HTML meta tag.
     * This token is required for all API requests to pass authentication.
     *
     * @type {string|undefined}
     */
    get token() {
        return (
            window.Config?.options?.csrf_token ||
            document.querySelector('meta[name="csrf-token"]')?.content ||
            undefined
        );
    },

    /**
     * Sends an HTTP request to the SimplyBook API with built-in handling for:
     * - CSRF token header injection.
     * - JSON request/response.
     * - Optional jQuery AJAX or fetch fallback.
     *
     * @param {string} endpoint - API endpoint relative to baseUrl.
     * @param {Object} config - Configuration object for the request.
     * @param {string} [config.method='GET'] - HTTP method.
     * @param {Object} [config.params={}] - URL query parameters.
     * @param {Object|null} [config.data=null] - Request payload for methods like POST/PUT.
     * @param {Object} [config.headers={}] - Additional HTTP headers.
     *
     * @returns {Promise<SBEntityArray|SBEntity>} Parsed API response wrapped in entity class.
     */
    async request(endpoint, { method = 'GET', params = {}, data = null, headers = {} } = {}) {
        if (!this.token) {
            console.error('CSRF token missing');
            return new SBEntityArray();
        }

        const hasParams = params && Object.keys(params).length > 0;
        const query = hasParams ? '?' + new URLSearchParams(params).toString() : '';
        const url = `${this.baseUrl}/${endpoint}${query}`;
        const hasJsonBody = data !== null && data !== undefined;

        const finalHeaders = {
            'x-csrf-token': this.token,
            'x-requested-with': 'XMLHttpRequest',
            'accept': 'application/json, text/plain, */*',
            ...headers
        };

        try {
            if (typeof $ !== 'undefined' && $.ajax) {
                const response = await $.ajax({
                    url,
                    method,
                    headers: finalHeaders,
                    data: hasJsonBody ? JSON.stringify(data) : undefined,
                    contentType: hasJsonBody ? 'application/json' : undefined,
                    processData: hasJsonBody ? false : undefined,
                    dataType: 'json',
                    timeout: 15000
                });

                const resData = response?.data ?? (Array.isArray(response) ? response : []);
                const meta = response?.metadata ?? null;
                return Array.isArray(resData) ? new SBEntityArray(resData, meta) : new SBEntity(resData);
            } else {
                const resp = await fetch(url, {
                    method,
                    headers: {
                        ...finalHeaders,
                        ...(hasJsonBody ? { 'Content-Type': 'application/json' } : {})
                    },
                    body: hasJsonBody ? JSON.stringify(data) : undefined
                });
                const json = await resp.json().catch(() => ({}));
                const resData = json?.data ?? (Array.isArray(json) ? json : []);
                const meta = json?.metadata ?? null;
                return Array.isArray(resData) ? new SBEntityArray(resData, meta) : new SBEntity(resData);
            }
        } catch (err) {
            console.error(`Request failed (${endpoint}):`, err);
            return new SBEntityArray();
        }
    },

    /**
     * Retrieves a paginated list of clients.
     *
     * @param {Object} params - Filter and query parameters.
     * @param {number} [page=1] - The page number to retrieve.
     * @returns {Promise<SBClientArray>} A collection of client records.
     */
    async getClients(params = {}, page = 1) {
        const res = await this.request('client/paginated', {
            method: 'GET',
            params: { page, on_page: 100, ...params }
        });
        return res.as(SBClientArray);
    },

    /**
     * Retrieves a paginated list of bookings.
     *
     * @param {Object} params - Filter and query parameters.
     * @param {number} [page=1] - The page number to retrieve.
     * @returns {Promise<SBBookingArray>} A collection of booking records.
     */
    async getBookings(params = {}, page = 1) {
        const res = await this.request('booking/paginated', {
            method: 'GET',
            params: { page, on_page: 100, ...params }
        });
        return res.as(SBBookingArray);
    },

    /**
     * Recursively fetches all pages of a paginated resource until all data is retrieved.
     *
     * @template T
     * @param {function(Object, number): Promise<SBEntityArray>} fetchFn - The method used to fetch one page.
     * @param {Object} params - Query parameters passed to fetchFn.
     * @param {number} [page=1] - Current page number (used internally for recursion).
     * @param {Array<any>} [accumulated=[]] - Previously retrieved records.
     * @returns {Promise<SBEntityArray<T>>} A collection containing all retrieved records.
     */
    async fetchAll(fetchFn, params = {}, page = 1, accumulated = []) {
        const pageData = await fetchFn.call(this, params, page);
        const raw = pageData.raw?.() || [];
        const meta = pageData.meta || {};
        const all = [...accumulated, ...raw];

        const pages = Number(meta.pages_count);
        const current = Number(meta.page);
        if (Number.isFinite(pages) && Number.isFinite(current)) {
            return current < pages
                ? await this.fetchAll(fetchFn, params, page + 1, all)
                : new pageData.constructor(all, { ...meta, page: pages, items_count: all.length });
        }

        const onPage = (params && Number(params.on_page)) || 100;
        return raw.length === onPage
            ? await this.fetchAll(fetchFn, params, page + 1, all)
            : new pageData.constructor(all, { page, on_page: onPage, items_count: all.length });
    }
};


// === Example usage with corrected getter calls ===
(async () => {
    const clients = await SimplyBookAPI.fetchAll(SimplyBookAPI.getClients, {
        'filter[date_from]': '2025-07-01',
        'filter[date_to]': '2025-07-09'
    });
    const phones = clients.phones;              // Use getter instead of missing method
    const namePhone = clients.namePhonePairs;   // Use getter instead of missing method

    console.log('📞 Total Valid Phones:', phones.length);
    console.table(namePhone.slice(0, 5));

    const bookings = await SimplyBookAPI.fetchAll(SimplyBookAPI.getBookings, {
        'filter[date_from]': '2025-07-01',
        'filter[date_to]': '2025-07-09'
    });
    const grouped = bookings.groupedByTime;     // Use getter instead of missing method
    console.table(grouped.morning.raw().slice(0, 5));
    console.table(grouped.afternoon.raw().slice(0, 5));
    console.table(grouped.evening.raw().slice(0, 5));
})();