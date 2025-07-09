

/**
 * FileLoaderUtils: A utility toolkit for dynamically fetching and injecting file resources.
 */
export const FileUtils = {

    /**
     * Resolves a URL into its directory, base filename (without extension), and extension name.
     * @param {string} url - The absolute URL to process.
     * @returns {{ origin: string, dirname: string, filename: string, extname: string }} An object containing the origin, directory path, base filename, and extension.
     */
    resolve_url(url) {
        const u = new URL(url, location.href);
        const origin = u.origin;
        const segments = u.pathname.split('/');
        const fullName = segments.pop() || '';
        const dirname = segments.join('/') + '/';

        const match = fullName.match(/^(.*?)(\.[^.]*)?$/);
        const filename = match?.[1] || '';
        const extname = match?.[2] || '';

        return { origin, dirname, filename, extname };
    },
    /**
     * Fetches the content of a specified file asynchronously.
     * @param {string} path - The absolute base path where the file is located.
     * @param {string} name - The file name without extension.
     * @param {string} file_ext - The file extension, including the leading dot (e.g., '.html', '.css').
     * @returns {Promise<string|null>} Promise resolving to the file content as a string, or null if fetching fails.
     */
    async fetch_file(path, name, file_ext) {
        const fileUrl = `${path}${name}${file_ext}`;

        try {
            const response = await fetch(fileUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch ${fileUrl}: ${response.status}`);
            }
            return await response.text();
        } catch (error) {
            console.error(error);
            return null;
        }
    },

    /**
     * Retrieves the content of an HTML file asynchronously.
     * @param {string} path - The absolute base path to the HTML file.
     * @param {string} name - The file name without extension.
     * @returns {Promise<string|null>} Promise resolving to the HTML content as a string, or null if fetching fails.
     */
    async fetch_html(path, name) {
        return await this.fetch_file(path, name, '.html');
    },

    /**
     * Retrieves the content of a CSS file asynchronously.
     * @param {string} path - The absolute base path to the CSS file.
     * @param {string} name - The file name without extension.
     * @returns {Promise<string|null>} Promise resolving to the CSS content as a string, or null if fetching fails.
     */
    async fetch_css(path, name) {
        return await this.fetch_file(path, name, '.css');
    },

    /**
     * Dynamically injects CSS content into the document head.
     * @param {string} url - The absolute URL of the JavaScript file (including the file name).
     * @returns {Promise<void>} Appends a <style> element with fetched CSS content to the document head if not already injected.
     */
    async inject_css(url) {
        const { origin, dirname, filename } = this.resolve_url(url);
        console.log(origin, dirname, filename);

        const content = await this.fetch_css(origin+dirname, filename);

        if (content !== null) {
            const id = `${filename}-styles`;

            // Ensure the CSS content is not already injected
            if (!document.getElementById(id)) {
                const styleElement = document.createElement('style');
                styleElement.id = id;
                styleElement.textContent = content;
                document.head.appendChild(styleElement);
                return true;
            }
        }
        console.error('Failed to inject CSS:', url);
        return false;
    }
};


/**
 * Sends a fetch request to a specified URL with Squarespace-compatible headers.
 * Allows additional headers to be merged into the default ones.
 * @param {string} url - The URL to send the request to.
 * @param {string} method - HTTP method (GET, POST, etc).
 * @param {string} token - CSRF token string.
 * @param {Object} [body] - Optional body payload.
 * @param {Object} [extra_headers] - Optional headers to merge with default headers.
 * @returns {Promise<Response>} The fetch response.
 */
export async function call_api(url, method, token, body = undefined, extra_headers = {}) {
    const headers = {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
        ...extra_headers
    };

    const options = {
        method,
        headers,
        credentials: 'include'
    };
    if (body) options.body = JSON.stringify(body);
    return fetch(url, options);
}

/**
 * Utility class to handle Google reCAPTCHA site key extraction and token retrieval.
 */
export const ReCaptcha = {
    action: 'FORM_BLOCK_SUBMISSION',

    /**
     * Extracts the site key from an embedded reCAPTCHA iframe.
     * @returns {Promise<string>} The site key string.
     */
    async get_site_key() {
        const iframe = document.querySelector('iframe[src*="/recaptcha/"]');
        const src = iframe?.src || '';
        const match = src.match(/[?&]k=([^&]+)/);
        if (!match) throw new Error('reCAPTCHA sitekey not found');
        return match[1];
    },

    /**
     * Retrieves the reCAPTCHA token using the provided site key.
     * @param {string} site_key - The site key to use for executing reCAPTCHA.
     * @returns {Promise<string>} The token string.
     */
    async get_token(site_key) {
        await new Promise((resolve) => {
            if (window.grecaptcha || window.grecaptcha?.enterprise) return resolve();
            const observer = new MutationObserver(() => {
                if (window.grecaptcha || window.grecaptcha?.enterprise) {
                    observer.disconnect();
                    resolve();
                }
            });
            observer.observe(document, { childList: true, subtree: true });
        });

        const grecaptcha = window.grecaptcha?.enterprise || window.grecaptcha;
        if (!grecaptcha) throw new Error('reCAPTCHA library not loaded');

        return new Promise((resolve, reject) => {
            const timeout_id = setTimeout(() => reject(new Error('reCAPTCHA execution timed out')), 10000);
            grecaptcha.ready(() => {
                clearTimeout(timeout_id);
                grecaptcha.execute(site_key, { action: ReCaptcha.action }).then(resolve).catch(reject);
            });
        });
    }
};

/**
 * Utilities for handling Squarespace form submission.
 */
export const SquareSpace = {
    /**
     * Extracts CSRF token from cookies.
     * @returns {string|null} The CSRF token string.
     */
    get_csrf_token() {
        const match = document.cookie.match(/crumb=([^;]+)/);
        return match ? decodeURIComponent(match[1]) : null;
    },

    /**
     * Requests a submission key from Squarespace.
     * @param {string} token - CSRF token.
     * @returns {Promise<string>} The submission key.
     */
    async get_submission_key(token) {
        const response = await call_api(
            '/api/form/FormSubmissionKey',
            'POST',
            token
        );
        if (!response.ok) throw new Error(`Key request failed: ${response.status}`);
        const json = await response.json();
        return json.key;
    },

    /**
     * Submits a form defined by schema and filled values.
     * @param {Object} form - The form structure including formId, collectionId, objectName, and fields.
     * @param {Object} values - The data values corresponding to field mappings.
     * @param {string} recaptcha_token - reCAPTCHA token.
     * @returns {Promise<Object>} The result of the submission.
     */
    async submit_form(form, values, recaptcha_token = '') {
        const token = SquareSpace.get_csrf_token();
        if (!token) return { success: false, error: 'Missing CSRF token' };

        const submission_key = await SquareSpace.get_submission_key(token);

        const formatted = {};
        for (const [actual_key, logical_key] of Object.entries(form.fields)) {
            if (logical_key === 'name' && typeof values.name === 'string') {
                formatted[actual_key] = values.name.split(' ', 2);
            } else if (logical_key === 'email') {
                formatted[actual_key] = { emailAddress: values.email };
            } else {
                formatted[actual_key] = values[logical_key];
            }
        }

        const payload = {
            formId: form.formId,
            collectionId: form.collectionId,
            objectName: form.objectName,
            form: JSON.stringify(formatted),
            key: submission_key,
            isReactFormSubmission: true,
            recaptchaEnterpriseV3Token: recaptcha_token,
            pagePermissionTypeValue: 1,
            pageTitle: 'Home',
            pageId: form.collectionId,
            contentSource: 'c',
            pagePath: '/'
        };

        return await call_api(
            '/api/form/SaveFormSubmission',
            'POST',
            token,
            payload
        ).then(async (response) => {
            if (response.status === 204) {
                return { success: true, message: 'Form submitted successfully' };
            }
            const error_text = await response.text();
            return { success: false, error: `Submission failed (${response.status}): ${error_text}` };
        });
    }
};
