<!--Mobile Info Bar auto-hide when burger menu is open-->

(function(){
    console.debug('[MobileBar] Script loaded');

    const style = document.createElement('style');
    style.textContent = `
    .sqs-mobile-info-bar {
      position: fixed !important;
      bottom: 0; left: 0; width: 100%; z-index: 9999;
      transform: none !important;
      transition: transform 0.3s ease !important;
    }
    .sqs-mobile-info-bar-hide {
      transform: translateY(100%) !important;
    }
  `;
    document.head.appendChild(style);
     console.debug('[MobileBar] Style injected');

    let bar = null, scrollTimer = null, tries = 0;

    function simulateLongPress(element) {
        const rect = element.getBoundingClientRect();
        const longPressEvent = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 2,
            buttons: 2,
            clientX: rect.left + 10,
            clientY: rect.top + 10
        });
         console.debug('[MobileBar] Dispatching simulated long-press');
        element.dispatchEvent(longPressEvent);
    }

    function initBar() {
        bar = document.querySelector('.sqs-mobile-info-bar');
        if (!bar) {
            if (++tries < 20) {
                 console.debug(`[MobileBar] Retry init #${tries}`);
                return setTimeout(initBar, 200);
            }
            console.warn('[MobileBar] Mobile Info Bar not found');
            return;
        }
         console.debug('[MobileBar] Bar found:', bar);

        // Inject MESSAGE button & long-press
        new MutationObserver(() => {
            const triggers = bar.querySelector('.sqs-mobile-info-bar-triggers');
            const phoneTrigger = triggers?.querySelector('[data-type="contactPhoneNumber"] a[href^="tel:"]');
            if (triggers && phoneTrigger) {
                // 🔥 UNIFYING CHANGE IS HERE
                if (!triggers.querySelector('[data-type="contactSms"]')) {
                    const phone = phoneTrigger.href.replace('tel:', '').trim();
                    const btn = document.createElement('div');
                    btn.className = 'sqs-mobile-info-bar-trigger'; // Class is now consistent
                    btn.setAttribute('data-type', 'contactSms');  // Add the uniform identifier
                    btn.innerHTML = `
            <a href="sms:${phone}">
              <span class="sqs-mobile-info-bar-trigger-icon"></span>
              <span class="sqs-mobile-info-bar-trigger-label">MESSAGE</span>
            </a>`;
                    triggers.insertBefore(
                        btn,
                        phoneTrigger.closest('.sqs-mobile-info-bar-trigger').nextSibling
                    );
                     console.debug('[MobileBar] MESSAGE button with data-type injected');
                }

                if (!phoneTrigger.dataset._longPressBound) {
                    phoneTrigger.dataset._longPressBound = '1';
                    phoneTrigger.addEventListener('click', function(e) {
                        e.preventDefault();
                         console.debug('[MobileBar] CALL button clicked, simulating long press');
                        simulateLongPress(phoneTrigger);
                    }, { once: true });
                     console.debug('[MobileBar] Long-press simulation bound to CALL');
                }
            }
        }).observe(document.body, { childList: true, subtree: true });

        // Scroll hide & show
        window.addEventListener('scroll', () => {
            bar.classList.add('sqs-mobile-info-bar-hide');
            clearTimeout(scrollTimer);
            scrollTimer = setTimeout(() => {
                bar.classList.remove('sqs-mobile-info-bar-hide');
                 console.debug('[MobileBar] Bar re-shown after scroll stop');
            }, 300);
        });

        // Restore overwritten styles
        new MutationObserver(() => {
            bar.style.transform = '';
        }).observe(bar, { attributes: true, attributeFilter: ['class','style'] });

        // Show on load
        window.addEventListener('load', () => {
            bar.classList.remove('sqs-mobile-info-bar-hide');
             console.debug('[MobileBar] Bar shown on page load');
        });

        // 🔥 Watch for burger--active state
        const burger = document.querySelector('.header-burger-btn');
        if (burger) {
            new MutationObserver(() => {
                const isOpen = burger.classList.contains('burger--active');
                if (isOpen) {
                    bar.classList.add('sqs-mobile-info-bar-hide');
                     console.debug('[MobileBar] Hidden due to menu open');
                } else {
                    bar.classList.remove('sqs-mobile-info-bar-hide');
                     console.debug('[MobileBar] Shown (menu closed)');
                }
            }).observe(burger, { attributes: true, attributeFilter: ['class'] });
             console.debug('[MobileBar] Burger menu observer bound');
        } else {
            console.warn('[MobileBar] Burger menu not found');
        }
    }

    document.readyState === 'loading'
        ? document.addEventListener('DOMContentLoaded', initBar)
        : initBar();
})();