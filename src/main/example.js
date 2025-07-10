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
