// ==UserScript==
// @name         SimplyBook.me Enhancement Tool
// @namespace    http://tampermonkey.net/
// @version      1.21
// @description  Add payment features and debug info to SimplyBook.me
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
// @require      https://simplybook.me/api_example/json-rpc-client.js
// ==/UserScript==

(function () {
    'use strict';
    const CONFIG = {
        COMPANY_LOGIN: "beachspa",
        CRYPTO_TOKEN: "M7dzUz7zCb4g6R5",
        API_KEY: "2fefa78171e0c3cd0d7a81e95ef58fd14f474566faabda4abb56bbbd15200c0f",
        API_BASE_URL: 'https://user-api.simplybook.me'
    };

    class SimplyBookClient {
        static DEFAULT;

        constructor(base_url, company_name, username, password) {
            const client = new JSONRpcClient({
                url: `${base_url}/login`,
                onerror: (err) => console.error(`RPC Error: ${JSON.stringify(err)}`)
            });

            this.baseUrl = base_url;
            this.companyName = company_name;
            this.token = client.getUserToken(company_name, username, password);
        }

        getClient() {
            return new JSONRpcClient({
                url: `${this.baseUrl}/admin/`,
                headers: {
                    'X-Company-Login': this.companyName,
                    'X-User-Token': this.token
                },
                onerror: (err) => console.error("RPC Error:", err)
            });
        }

        static default() {
            if (SimplyBookClient.DEFAULT) return SimplyBookClient.DEFAULT;
            const credentials = unsafeWindow.SimplyBookCredentialManager.getCredentials(CONFIG.CRYPTO_TOKEN);
            if (!credentials || !credentials.username || !credentials.password) reject('Credentials not set or invalid');
            SimplyBookClient.DEFAULT = new SimplyBookClient(CONFIG.API_BASE_URL, CONFIG.COMPANY_LOGIN, credentials.username, credentials.password);
            return SimplyBookClient.DEFAULT;
        }
    }

    // 创建付款按钮
    function createPayButton() {
        const payBtn = document.createElement('button');
        payBtn.className = 'btn btn-success';
        payBtn.id = 'custom-payment-btn';
        payBtn.innerHTML = '<span class="btn__txt">Pay</span>';

        Object.assign(payBtn.style, {
            display: 'flex',
            margin: '0 5px',
            backgroundColor: '#28a745',
            borderColor: '#28a745',
            transition: 'all 0.3s ease'
        });

        payBtn.onmouseover = () => {
            payBtn.style.backgroundColor = '#218838';
            payBtn.style.borderColor = '#1e7e34';
        };

        payBtn.onmouseout = () => {
            payBtn.style.backgroundColor = '#28a745';
            payBtn.style.borderColor = '#28a745';
        };

        return payBtn;
    }

    // 获取当前预约ID
    function getCurrentBookingId() {
        try {
            const bookingCodeElement = document.querySelector('.booking-code');
            if (bookingCodeElement) {
                return bookingCodeElement.textContent.trim();
            }

            // 备用方法：尝试从URL参数中获取
            const urlParams = new URLSearchParams(window.location.search);
            const bookingId = urlParams.get('booking_id');
            if (bookingId) return bookingId;

            return 'N/A';
        } catch (e) {
            console.error('Failed to get booking ID:', e);
            return 'N/A';
        }
    }

    function isPureNumeric(value) {
        return /^\d+\.?\d*$|^\.\d+$/.test(value);
    }

    async function getBookingDetails(id) {
        try {
            const client = SimplyBookClient.default();
            if (!client) {
                throw new Error('Client not initialized');
            }

            if (isPureNumeric(id)) {
                return await client.getClient().getBookingDetails(id.toString());
            }

            const matched = await client.getClient().getBookings({ code: id });
            if (matched && Array.isArray(matched) && matched.length > 0) {
                return matched[0];
            }

            throw new Error('Booking not found');
        } catch (error) {
            console.error('Error in getBookingDetails:', error);
            throw error;
        }
    }

    // 创建/更新支付弹窗
    function createPaymentModal(bookingDetails) {
        // 移除旧的模态框
        const oldModal = document.getElementById('custom-payment-modal');
        const oldBackdrop = document.getElementById('custom-modal-backdrop');
        if (oldModal) oldModal.remove();
        if (oldBackdrop) oldBackdrop.remove();

        // 格式化日期和时间
        const startDate = new Date(bookingDetails.start_date);
        const dateStr = startDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
        const timeStr = startDate.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });

        // 创建新的支付弹窗
        const paymentModal = `
            <div id="custom-payment-modal" style="
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                padding: 20px;
                border-radius: 10px;
                box-shadow: 0 5px 30px rgba(0,0,0,0.3);
                z-index: 99999;
                width: 420px;
                max-width: 90%;
                font-family: Arial, sans-serif;
            ">
                <h3 style="margin-top:0; color:#333; border-bottom:1px solid #eee; padding-bottom:10px; font-size:18px; text-align:center;">
                    Payment for Booking #${bookingDetails.code || bookingDetails.id}
                </h3>

                <div style="margin-bottom:10px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:14px;">
                        <span style="color:#777; width:100px;">Service:</span>
                        <strong id="payment-modal-service" style="flex:1;">${bookingDetails.event}</strong>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:14px;">
                        <span style="color:#777; width:100px;">Provider:</span>
                        <strong id="payment-modal-provider" style="flex:1;">${bookingDetails.unit}</strong>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:14px;">
                        <span style="color:#777; width:100px;">Client:</span>
                        <strong id="payment-modal-client" style="flex:1;">${bookingDetails.client}</strong>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:14px;">
                        <span style="color:#777; width:100px;">Time:</span>
                        <strong id="payment-modal-time">${dateStr} ${timeStr}</strong>
                    </div>
                </div>

                <!-- Payment summary section -->
                <div id="payment-summary" style="margin:15px 0; padding:15px; background:#f8f9fa; border-radius:8px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:10px; font-size:16px;">
                        <span>Service Price:</span>
                        <strong>$${parseFloat(bookingDetails.event_price).toFixed(2)}</strong>
                    </div>
                    ${bookingDetails.invoice_amount ? `
                        <div style="display:flex; justify-content:space-between; margin-bottom:10px; font-size:16px;">
                            <span>Invoice Total:</span>
                            <strong>$${parseFloat(bookingDetails.invoice_amount).toFixed(2)}</strong>
                        </div>
                    ` : ''}
                    ${bookingDetails.payed_amount ? `
                        <div style="display:flex; justify-content:space-between; margin-bottom:10px; font-size:16px;">
                            <span>Amount Paid:</span>
                            <strong style="color:#28a745;">$${parseFloat(bookingDetails.payed_amount).toFixed(2)}</strong>
                        </div>
                    ` : ''}
                    <div style="display:flex; justify-content:space-between; margin-top:15px; padding-top:10px; border-top:1px dashed #ddd; font-size:16px; font-weight:bold;">
                        <span>Balance:</span>
                        <strong style="color:#e74c3c;">
                            $${bookingDetails.invoice_amount && bookingDetails.payed_amount ?
            (parseFloat(bookingDetails.invoice_amount) - parseFloat(bookingDetails.payed_amount)).toFixed(2) :
            parseFloat(bookingDetails.event_price).toFixed(2)}
                        </strong>
                    </div>
                </div>

                <!-- Payment status section -->
                <div id="payment-status" style="margin-bottom:15px; padding:15px; background:#f8f9fa; border-radius:8px; text-align:center;">
                    <div style="display:inline-flex; align-items:center; padding:8px 15px; border-radius:20px; background:${getStatusColor(bookingDetails.payment_status)}20; border:1px solid ${getStatusColor(bookingDetails.payment_status)};">
                        <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${getStatusColor(bookingDetails.payment_status)}; margin-right:8px;"></span>
                        <strong style="color:${getStatusColor(bookingDetails.payment_status)}; font-size:14px;">
                            ${capitalizeFirstLetter(bookingDetails.payment_status || 'unknown')}
                        </strong>
                    </div>
                    ${bookingDetails.invoice_number ? `
                        <div style="margin-top:10px; font-size:13px; color:#6c757d;">
                            Invoice #${bookingDetails.invoice_number}
                        </div>
                    ` : ''}
                    ${bookingDetails.payment_system ? `
                        <div style="margin-top:5px; font-size:13px; color:#6c757d;">
                            ${capitalizeFirstLetter(bookingDetails.payment_system.replace(/_/g, ' '))}
                        </div>
                    ` : ''}
                </div>

                <div style="display:flex; gap:10px;">
                    <button id="custom-pay-now" style="
                        flex:1;
                        padding:10px;
                        background:#27ae60;
                        color:white;
                        border:none;
                        border-radius:6px;
                        cursor:pointer;
                        font-size:14px;
                        font-weight:bold;
                        transition:background 0.3s;
                    ">New Invoice</button>

                    <button id="custom-pay-cancel" style="
                        flex:1;
                        padding:10px;
                        background:transparent;
                        color:#7f8c8d;
                        border:1px solid #ddd;
                        border-radius:6px;
                        cursor:pointer;
                        font-size:14px;
                    ">Close</button>
                </div>
            </div>

            <div id="custom-modal-backdrop" style="
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.6);
                z-index: 99998;
            "></div>
        `;

        document.body.insertAdjacentHTML('beforeend', paymentModal);

        // Add event listeners
        document.getElementById('custom-pay-now').addEventListener('click', () => {
            GM_notification({
                title: "Invoice Created",
                text: `New invoice created for booking #${bookingDetails.code}`,
                timeout: 3000
            });
        });

        document.getElementById('custom-pay-cancel').addEventListener('click', closePaymentModal);
        document.getElementById('custom-modal-backdrop').addEventListener('click', closePaymentModal);
    }

    // 获取状态颜色
    function getStatusColor(status) {
        if (!status) return '#6c757d';
        status = status.toLowerCase();

        if (status.includes('paid')) return '#28a745';
        if (status.includes('partial')) return '#ffc107';
        if (status.includes('unpaid') || status.includes('due')) return '#dc3545';
        if (status.includes('refund')) return '#6c757d';
        if (status.includes('cancel')) return '#6c757d';

        return '#6c757d';
    }

    // 首字母大写
    function capitalizeFirstLetter(string) {
        if (!string) return '';
        return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
    }

    // 关闭支付弹窗
    function closePaymentModal() {
        const modal = document.getElementById('custom-payment-modal');
        const backdrop = document.getElementById('custom-modal-backdrop');
        if (modal) modal.remove();
        if (backdrop) backdrop.remove();
    }

    // 处理支付流程
    async function handlePayment() {
        // 获取预约ID
        const bookingId = getCurrentBookingId();

        // 显示加载状态
        const originalButton = document.getElementById('custom-payment-btn');
        if (originalButton) {
            const spinner = document.createElement('span');
            spinner.className = 'spinner-border spinner-border-sm';
            spinner.setAttribute('role', 'status');
            spinner.setAttribute('aria-hidden', 'true');

            originalButton.innerHTML = '';
            originalButton.appendChild(spinner);
            originalButton.appendChild(document.createTextNode(' Loading...'));
            originalButton.disabled = true;
        }

        try {
            // 获取预约详细信息
            const bookingDetails = await getBookingDetails(bookingId);

            // 直接使用API返回的数据创建模态框
            createPaymentModal(bookingDetails);
        } catch (error) {
            console.error('Failed to get booking details:', error);

            // 使用DOM数据作为回退
            const bookingCode = getCurrentBookingId();
            const service = document.querySelector('.service-name')?.textContent || 'Unknown Service';
            const provider = document.querySelector('.perfomer-name span')?.textContent || 'Unknown Provider';
            const client = document.querySelector('.client-data .main span')?.textContent || 'Unknown Client';
            const date = document.querySelector('.date-from')?.textContent || 'Unknown Date';
            const time = document.querySelector('.time-from')?.textContent || 'Unknown Time';
            const amount = document.querySelector('.amount')?.textContent?.replace('$', '') || '0';

            // 创建回退模态框
            createPaymentModal({
                code: bookingCode,
                event: service,
                unit: provider,
                client: client,
                start_date: new Date().toISOString(),
                event_price: amount,
                payment_status: 'unknown'
            });

            // 显示错误通知
            GM_notification({
                title: "API Error",
                text: `Failed to get booking details: ${error.message || error}`,
                timeout: 5000,
                highlight: true
            });
        } finally {
            // 恢复按钮状态
            if (originalButton) {
                originalButton.innerHTML = '<span class="btn__txt">Pay</span>';
                originalButton.disabled = false;
            }
        }
    }

    // 在模态框底部添加付款按钮和调试信息
    function addPaymentButtonToModal() {
        // 检查是否已存在付款按钮
        if (document.getElementById('custom-payment-btn')) {
            return;
        }

        const footer = document.querySelector('.modal-footer');
        if (!footer) return;

        const buttons = footer.querySelectorAll('button');
        if (buttons.length < 2) return;

        // 找到"Cancel booking"按钮
        let cancelButton = null;
        for (let i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent.includes('Cancel booking')) {
                cancelButton = buttons[i];
                break;
            }
        }

        if (cancelButton) {
            const payBtn = createPayButton();
            payBtn.addEventListener('click', handlePayment);
            cancelButton.insertAdjacentElement('afterend', payBtn);
        } else if (buttons.length > 0) {
            // 如果没有取消按钮，添加到最后一个按钮后面
            const payBtn = createPayButton();
            payBtn.addEventListener('click', handlePayment);
            buttons[buttons.length - 1].insertAdjacentElement('afterend', payBtn);
        }
    }

    // 监听模态框变化
    function setupModalObserver() {
        // 初始尝试添加按钮
        addPaymentButtonToModal();

        // 设置MutationObserver监听模态框变化
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    const modalAdded = Array.from(mutation.addedNodes).some(node => {
                        return node.classList?.contains('modal-content') ||
                            node.querySelector?.('.modal-footer');
                    });

                    if (modalAdded) {
                        setTimeout(addPaymentButtonToModal, 300);
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // 监听预约单元格点击事件
        document.addEventListener('click', (event) => {
            if (event.target.closest('.booking-cell, .fc-event')) {
                setTimeout(addPaymentButtonToModal, 500);
            }
        });
    }

    // 页面加载完成后初始化
    if (document.readyState === 'complete') {
        setupModalObserver();
    } else {
        window.addEventListener('load', setupModalObserver);
    }

})();