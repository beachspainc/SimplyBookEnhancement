// site-status.js
console.log("LOADING")
import { FileUtils, ReCaptcha, SquareSpace } from '/s/utilities.js';

(function init_site_status() {
    FileUtils.inject_css(import.meta.url);

    const status_map = {
        editing: {
            label: 'Editing',
            message: `We're currently editing the site. If you have suggestions, please let us know! 😊`,
            icon: '✏️',
            color: '#8f8c8c',
            features: ['Service Details', 'Booking(Home Page)']
        }
    };

    window.show_site_status = function (status_key = 'editing') {
        const existing = document.querySelector('.site-status-icon');
        if (existing) existing.remove();

        const status = status_map[status_key] || status_map.editing;
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

        const close_full = document.createElement('button');
        close_full.className = 'status-close-full';
        close_full.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>';
        close_full.ariaLabel = 'Close status panel';

        const panel = document.createElement('div');
        panel.className = 'site-status-panel collapsed';

        const panel_content = document.createElement('div');
        panel_content.className = 'panel-content';

        const panel_message = document.createElement('div');
        panel_message.className = 'panel-message';
        panel_message.textContent = status.message;

        let features_list = '';
        if (status.features && status.features.length > 0) {
            features_list = `<div class="affected-features"><div style="font-weight: 600; margin-bottom: 8px; color: var(--status-color);">Affected Features:</div><ul>${status.features.map(f => `<li>${f}</li>`).join('')}</ul></div>`;
        }

        const input_group = document.createElement('div');
        input_group.className = 'site-status-input-group';
        input_group.innerHTML = `
      <input type="email" placeholder="Email" aria-label="Your email" required style="max-width: 100%; width: 280px;">
      <textarea placeholder="Your suggestion..." aria-label="Your suggestion" required style="max-width: 100%; width: 280px;"></textarea>
    `;

        const status_actions = document.createElement('div');
        status_actions.className = 'status-actions';
        status_actions.innerHTML = `<button class="feedback-btn"><span class="btn-text">Send Feedback</span></button>`;

        panel_content.appendChild(panel_message);
        if (features_list) panel_content.insertAdjacentHTML('beforeend', features_list);
        panel_content.appendChild(input_group);
        panel_content.appendChild(status_actions);
        panel.appendChild(panel_content);

        compact.appendChild(label);
        compact.appendChild(emoji);
        compact.appendChild(close_full);
        container.appendChild(compact);
        container.appendChild(panel);
        document.body.appendChild(container);

        let expanded = false;

        function expand_status() {
            container.classList.add('expanded');
            panel.classList.remove('collapsed');
            expanded = true;
        }

        function collapse_status() {
            container.classList.remove('expanded');
            panel.classList.add('collapsed');
            expanded = false;
        }

        compact.addEventListener('click', () => { if (!expanded) expand_status(); });
        close_full.addEventListener('click', (e) => { e.stopPropagation(); collapse_status(); });
        document.addEventListener('click', (e) => { if (expanded && !container.contains(e.target)) collapse_status(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') expanded ? collapse_status() : container.remove(); });

        const submit_btn = panel.querySelector('.feedback-btn');
        const email_input = panel.querySelector('input[type="email"]');
        const suggestion_input = panel.querySelector('textarea');

        submit_btn.addEventListener('click', async () => {
            const email = email_input?.value?.trim?.();
            const message = suggestion_input?.value?.trim?.();
            if (!email) return alert('Please enter your email address');
            if (!message) return alert('Please enter your suggestion');

            submit_btn.classList.add('sending');
            submit_btn.disabled = true;

            try {
                const site_key = await ReCaptcha.get_site_key();
                const token = await ReCaptcha.get_token(site_key);

                const result = await SquareSpace.submit_form({
                    formId: '67d3566edced410d83e33d1f',
                    collectionId: '67d3566ddced410d83e33cce',
                    objectName: '6c55ceb84973ea7f489a',
                    fields: {
                        'name-yui_3_17_2_1_1679346524828_51496': 'name',
                        'email-yui_3_17_2_1_1679348080814_63349': 'email',
                        'textarea-yui_3_17_2_1_1679348080814_63351': 'message'
                    }
                }, { name: 'Console User', email, message }, token);

                if (result.success) {
                    email_input.value = '';
                    suggestion_input.value = '';
                    collapse_status();
                } else {
                    throw new Error(result.error);
                }
            } catch (error) {
                console.error('Feedback submission error:', error);
            } finally {
                submit_btn.classList.remove('sending');
                submit_btn.disabled = false;
            }
        });
    };

    document.addEventListener('DOMContentLoaded', () => {
        window.show_site_status('editing');
    });
})();
