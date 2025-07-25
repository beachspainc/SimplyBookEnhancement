class SBEntity {
    constructor(data) {
        this.data = data;
    }

    /** @returns {any[]} */
    raw() {
        return this.data;
    }
}

class SBEntityArray extends SBEntity {
    constructor(data = []) {
        super(Array.isArray(data) ? data : []);
    }

    /** @returns {number} Total number of entries */
    get size() {
        return this.data.length;
    }

    /**
     * Extract specific fields from each item and return as a new SBEntityArray.
     * @param  {...string} fields - Fields to extract.
     * @returns {SBEntityArray<Object<string, any>>}
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
        return new SBEntityArray(result);
    }

    /**
     * Converts to specified subclass type.
     * @template T
     * @param {new(data: any[]) => T} Type - Constructor of SBEntityArray subclass.
     * @returns {T}
     */
    as(Type) {
        return new Type(this.data);
    }
}

class SBBookingArray extends SBEntityArray {
    /**
     * @returns {{ morning: SBBookingArray, afternoon: SBBookingArray, evening: SBBookingArray }}
     */
    get groupedByTime() {
        const segments = { morning: [], afternoon: [], evening: [] };
        for (const b of this.data) {
            const time = b?.date_start?.split(' ')[1];
            if (!time) continue;
            const hour = +time.split(':')[0];
            if (hour < 12) segments.morning.push(b);
            else if (hour < 18) segments.afternoon.push(b);
            else segments.evening.push(b);
        }
        return {
            morning: new SBBookingArray(segments.morning),
            afternoon: new SBBookingArray(segments.afternoon),
            evening: new SBBookingArray(segments.evening),
        };
    }

    /** @returns {string[]} Unique therapist names */
    get therapists() {
        return [...new Set(this.data.map(b => b.unit_name).filter(Boolean))];
    }
}

class SBClientArray extends SBEntityArray {
    /** @returns {string[]} Valid 10-digit cleaned phones */
    get phones() {
        return this
            .pluck('name_or_phone')
            .raw()
            .map(item => item?.name_or_phone?.replace(/\D/g, ''))
            .filter(p => p?.length === 10);
    }

    /** @returns {{ name: string, phone: string }[]} Name & phone pairs */
    get namePhonePairs() {
        return this
            .pluck('name', 'name_or_phone')
            .raw()
            .map(({ name, name_or_phone }) => ({ name, phone: name_or_phone }))
            .filter(p => p.phone);
    }
}
/**
 * SimplyBook API utility wrapper.
 */
const SimplyBookAPI = {
    baseUrl: 'https://beachspa.secure.simplybook.me/v2/rest',
    token: window.Config?.options?.csrf_token,

    /**
     * Sends request to SimplyBook endpoint.
     * @param {string} endpoint
     * @param {Object} config
     * @param {'GET'|'POST'} [config.method]
     * @param {Object} [config.params]
     * @param {Object|null} [config.data]
     * @param {Object} [config.headers]
     * @returns {Promise<SBEntityArray|SBEntity>}
     */
    async request(endpoint, { method = 'GET', params = {}, data = null, headers = {} } = {}) {
        if (!this.token) {
            console.error('❌ CSRF token missing');
            return new SBEntityArray();
        }

        const query = method === 'GET' && params
            ? '?' + new URLSearchParams(params).toString()
            : '';

        const url = `${this.baseUrl}/${endpoint}${query}`;

        const finalHeaders = {
            'x-csrf-token': this.token,
            'x-requested-with': 'XMLHttpRequest',
            'accept': 'application/json, text/plain, */*',
            ...headers
        };

        try {
            const response = await $.ajax({
                url,
                method,
                headers: finalHeaders,
                contentType: data ? 'application/json' : undefined,
                data: data ? JSON.stringify(data) : undefined
            });

            const resData = response.data || [];
            return Array.isArray(resData) ? new SBEntityArray(resData) : new SBEntity(resData);
        } catch (err) {
            console.error(`❌ Request failed (${endpoint}):`, err);
            return new SBEntityArray();
        }
    },

    /**
     * Fetches paginated clients.
     * @param {Object} params
     * @param {number} [page=1]
     * @returns {Promise<SBClientArray>}
     */
    async getClients(params = {}, page = 1) {
        const res = await this.request('client/paginated', {
            method: 'GET',
            params: { page, on_page: 100, ...params }
        });
        return res.as(SBClientArray);
    },

    /**
     * Fetches paginated bookings.
     * @param {Object} params
     * @param {number} [page=1]
     * @returns {Promise<SBBookingArray>}
     */
    async getBookings(params = {}, page = 1) {
        const res = await this.request('booking/paginated', {
            method: 'GET',
            params: { page, on_page: 100, ...params }
        });
        return res.as(SBBookingArray);
    },

    /**
     * Recursively fetches all paginated results.
     * @template T
     * @param {function(Object, number): Promise<SBEntityArray>} fetchFn - Fetch function.
     * @param {Object} params
     * @param {number} [page=1]
     * @param {Array<any>} [accumulated=[]]
     * @returns {Promise<SBEntityArray<T>>}
     */
    async fetchAll(fetchFn, params = {}, page = 1, accumulated = []) {
        const pageData = await fetchFn.call(this, params, page);
        const raw = pageData.raw?.() || [];
        const all = [...accumulated, ...raw];

        return raw.length === 100
            ? await this.fetchAll(fetchFn, params, page + 1, all)
            : pageData.constructor ? new pageData.constructor(all) : new SBEntityArray(all);
    }
};

// ✅ Testing fetchAll and extensions:
(async () => {
    const clients = await SimplyBookAPI.fetchAll(SimplyBookAPI.getClients, {
        'filter[date_from]': '2025-07-01',
        'filter[date_to]': '2025-07-09'
    });
    const phones = clients.getPhones();
    const namePhone = clients.getNamePhonePairs();

    console.log('📞 Total Valid Phones:', phones.length);
    console.table(namePhone.slice(0, 5));

    const bookings = await SimplyBookAPI.fetchAll(SimplyBookAPI.getBookings, {
        'filter[date_from]': '2025-07-01',
        'filter[date_to]': '2025-07-09'
    });
    const grouped = bookings.groupByTimeSegment();
    console.table(grouped.morning.raw().slice(0, 5));
    console.table(grouped.afternoon.raw().slice(0, 5));
    console.table(grouped.evening.raw().slice(0, 5));
})();