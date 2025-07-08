// site-status.js
(function initSiteStatus() {
    if (!document.querySelector('#site-status-styles')) {
        const link = document.createElement('link');
        link.id = 'site-status-styles';
        link.rel = 'stylesheet';

        const scripts = document.querySelectorAll('script');
        let basePath = '';
        for (let i = 0; i < scripts.length; i++) {
            if (scripts[i].src && scripts[i].src.includes('site-status')) {
                const src = scripts[i].src;
                basePath = src.substring(0, src.lastIndexOf('/') + 1);
                break;
            }
        }

        link.href = basePath + 'site-status.css';
        document.head.appendChild(link);
    }

    const statusMap = {
        editing: {
            label: 'Editing',
            message: `We're currently editing the site. If you have suggestions, please let us know!😊`,
            icon: '✏️',
            color: '#8f8c8c',
            features: ["Service Details", "Booking(Home Page)"]
        },
        maintenance: {
            label: 'Maintenance',
            message: `We're performing maintenance. Some features may be temporarily unavailable.`,
            icon: '🛠️',
            color: '#f59e0b',
            features: ["User profile updates", "Payment processing", "Notification system"]
        },
        error: {
            label: 'Temporary Issue',
            message: `We're experiencing technical difficulties. Service will be restored shortly.`,
            icon: '⚠️',
            color: '#ef4444',
            features: ["File uploads", "Search functionality", "Real-time updates"]
        },
        info: {
            label: 'Notice',
            message: `Important update: We've made improvements to enhance your experience!`,
            icon: 'ℹ️',
            color: '#3b82f6',
            features: ["New dashboard layout", "Enhanced search filters", "Performance improvements"]
        }
    };

    (function registerFormSubmitter() {
        let submitting = false;
        const FORM_ID = "67d3566edced410d83e33d1f";
        const COLLECTION_ID = "67d3566ddced410d83e33cce";
        const OBJECT_NAME = "6c55ceb84973ea7f489a";

        const getBaseURL = () => {
            const { protocol, host } = window.location;
            return `${protocol}//${host}`;
        };

        const CSRFToken = {
            COOKIE_NAME: "crumb",
            get() {
                const match = document.cookie.match(new RegExp(`${this.COOKIE_NAME}=([^;]+)`));
                return match ? decodeURIComponent(match[1]) : null;
            }
        };

        const RECAPTCHA = {
            ACTION: "FORM_BLOCK_SUBMISSION",
            getSiteKey() {
                const iframe = document.querySelector('iframe[src*="/recaptcha/"]');
                const src = iframe?.src || "";
                const siteKeyMatch = src.match(/[?&]k=([^&]+)/);
                if (!siteKeyMatch) throw new Error("reCAPTCHA sitekey not found");
                return siteKeyMatch[1];
            },
            async getToken(siteKey) {
                if (!window.grecaptcha && !window.grecaptcha?.enterprise) {
                    await new Promise(resolve => {
                        const interval = setInterval(() => {
                            if (window.grecaptcha || window.grecaptcha?.enterprise) {
                                clearInterval(interval);
                                resolve();
                            }
                        }, 100);
                    });
                }

                const grecaptcha = window.grecaptcha?.enterprise || window.grecaptcha;
                if (!grecaptcha) throw new Error("reCAPTCHA library not loaded");

                return new Promise((resolve, reject) => {
                    const timeoutId = setTimeout(() => reject(new Error("reCAPTCHA execution timed out")), 10000);
                    grecaptcha.ready(() => {
                        clearTimeout(timeoutId);
                        grecaptcha.execute(siteKey, { action: this.ACTION }).then(resolve).catch(reject);
                    });
                });
            }
        };

        const API = {
            get ENDPOINTS() {
                const base = getBaseURL();
                return {
                    KEY: `${base}/api/form/FormSubmissionKey`,
                    SUBMIT: `${base}/api/form/SaveFormSubmission`
                };
            },
            COMMON_HEADERS: {
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/json"
            },
            async fetchKey(csrfToken) {
                const response = await fetch(this.ENDPOINTS.KEY, {
                    method: "POST",
                    headers: { ...this.COMMON_HEADERS, "X-CSRF-Token": csrfToken },
                    credentials: "include"
                });
                if (!response.ok) throw new Error(`Key request failed: ${response.status}`);
                return (await response.json()).key;
            },
            async submitForm(csrfToken, payload) {
                const response = await fetch(this.ENDPOINTS.SUBMIT, {
                    method: "POST",
                    headers: { ...this.COMMON_HEADERS, "X-CSRF-Token": csrfToken },
                    body: JSON.stringify(payload),
                    credentials: "include"
                });
                return response;
            }
        };

        window.submitForm = async function(data = {}) {
            if (submitting) return { success: false, error: "Do not submit repeatedly" };
            submitting = true;

            try {
                const csrfToken = CSRFToken.get();
                if (!csrfToken) throw new Error("Missing CSRF token");

                const siteKey = RECAPTCHA.getSiteKey();
                const recaptchaToken = await RECAPTCHA.getToken(siteKey);

                const formKey = await API.fetchKey(csrfToken);

                const formData = {
                    "name-yui_3_17_2_1_1679346524828_51496": [data.fname || "Console", data.lname || "User"],
                    "email-yui_3_17_2_1_1679348080814_63349": { emailAddress: data.email || "console@example.com" },
                    "textarea-yui_3_17_2_1_1679348080814_63351": data.message || "Feedback from console"
                };

                const payload = {
                    formId: FORM_ID,
                    collectionId: COLLECTION_ID,
                    form: JSON.stringify(formData),
                    key: formKey,
                    objectName: OBJECT_NAME,
                    isReactFormSubmission: true,
                    recaptchaEnterpriseV3Token: recaptchaToken,
                    pagePermissionTypeValue: 1,
                    pageTitle: "Home",
                    pageId: COLLECTION_ID,
                    contentSource: "c",
                    pagePath: "/"
                };

                const response = await API.submitForm(csrfToken, payload);

                if (response.status === 204) {
                    return { success: true, message: "Form submitted successfully" };
                }
                const errorText = await response.text();
                throw new Error(`Submission failed (${response.status}): ${errorText}`);
            } catch (error) {
                return { success: false, error: error.message || "Unknown error", details: error };
            } finally {
                submitting = false;
            }
        };
    })();

    window.showSiteStatus = function(statusKey = 'editing') {
        const existing = document.querySelector('.site-status-icon');
        if (existing) existing.remove();

        const status = statusMap[statusKey] || statusMap.editing;
        const container = document.createElement('div');
        container.className = 'site-status-icon';
        container.style.setProperty('--status-color', status.color);

        const compact = document.createElement('div');
        compact.className = 'status-compact';

        const label = document.createElement('span');
        label.className = 'status-label';
        label.textContent = status.label;

        const emoji = document.createElement('span');
        emoji.className = 'status-emoji';
        emoji.innerHTML = `${status.icon}<span class="status-dots"><span class="dot dot1"></span><span class="dot dot2"></span><span class="dot dot3"></span></span>`;

        const closeFull = document.createElement('button');
        closeFull.className = 'status-close-full';
        closeFull.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>';
        closeFull.ariaLabel = 'Close status panel';

        const panel = document.createElement('div');
        panel.className = 'site-status-panel collapsed';

        const panelContent = document.createElement('div');
        panelContent.className = 'panel-content';

        const panelMessage = document.createElement('div');
        panelMessage.className = 'panel-message';
        panelMessage.textContent = status.message;

        let featuresList = '';
        if (status.features && status.features.length > 0) {
            featuresList = `<div class="affected-features"><div style="font-weight: 600; margin-bottom: 8px; color: var(--status-color);">Affected Features:</div><ul>${status.features.map(feature => `<li>${feature}</li>`).join('')}</ul></div>`;
        }

        const inputGroup = document.createElement('div');
        inputGroup.className = 'site-status-input-group';
        inputGroup.innerHTML = `
          <input type="email" placeholder="Email" aria-label="Your email" required style="max-width: 100%; width: 280px;">
          <textarea placeholder="Your suggestion..." aria-label="Your suggestion" required style="max-width: 100%; width: 280px;"></textarea>
        `;
        const statusActions = document.createElement('div');
        statusActions.className = 'status-actions';
        statusActions.innerHTML = `<button class="feedback-btn"><span class="btn-text">Send Feedback</span></button>`;

        panelContent.appendChild(panelMessage);
        if (featuresList) panelContent.insertAdjacentHTML('beforeend', featuresList);
        panelContent.appendChild(inputGroup);
        panelContent.appendChild(statusActions);
        panel.appendChild(panelContent);

        compact.appendChild(label);
        compact.appendChild(emoji);
        compact.appendChild(closeFull);
        container.appendChild(compact);
        container.appendChild(panel);
        document.body.appendChild(container);

        let expanded = false;

        function expandStatus() {
            container.classList.add('expanded');
            panel.classList.remove('collapsed');
            expanded = true;
        }

        function collapseStatus() {
            container.classList.remove('expanded');
            panel.classList.add('collapsed');
            expanded = false;
        }

        compact.addEventListener('click', () => { if (!expanded) expandStatus(); });
        closeFull.addEventListener('click', (e) => { e.stopPropagation(); collapseStatus(); });
        document.addEventListener('click', (e) => { if (expanded && !container.contains(e.target)) collapseStatus(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') expanded ? collapseStatus() : container.remove(); });

        const submitBtn = panel.querySelector('.feedback-btn');
        const emailInput = panel.querySelector('input[type="email"]');
        const suggestionInput = panel.querySelector('textarea');

        submitBtn.addEventListener('click', async () => {
            const email = emailInput?.value?.trim?.();
            const suggestion = suggestionInput?.value?.trim?.();
            if (!email) return alert('Please enter your email address');
            if (!suggestion) return alert('Please enter your suggestion');

            submitBtn.classList.add('sending');
            submitBtn.disabled = true;

            try {
                const result = await window.submitForm({ email, message: suggestion });
                if (result.success) {
                    emailInput.value = '';
                    suggestionInput.value = '';
                    collapseStatus();
                } else {
                    throw new Error(result.error || 'Submission failed');
                }
            } catch (error) {
                console.error('Feedback submission error:', error);
            } finally {
                submitBtn.classList.remove('sending');
                submitBtn.disabled = false;
            }
        });
    };

    document.addEventListener('DOMContentLoaded', () => {
        window.showSiteStatus('editing');
    });
})();
