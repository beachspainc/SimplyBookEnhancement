var csrfToken = window.react_config?.csrf_token;

async function getAllPhones(token, page = 1, accumulated = []) {
    const ON_PAGE = 100;

    if (!token) {
        console.error('CSRF token not found.');
        return [];
    }

    try {
        const response = await $.ajax({
            url: `https://beachspa.secure.simplybook.me/v2/rest/client/paginated?page=${page}&on_page=${ON_PAGE}`,
            method: 'GET',
            headers: {
                'x-csrf-token': token,
                'x-requested-with': 'XMLHttpRequest',
                'accept': 'application/json, text/plain, */*'
            }
        });

        const phoneNumbers = response.data
            .map(client => client.name_or_phone)
            .filter(Boolean);

        const allPhones = [...accumulated, ...phoneNumbers];

        // ✅ 如果当前页返回的数据等于 ON_PAGE，可能还有下一页，递归
        if (response.data.length === ON_PAGE) {
            return await getAllPhones(token, page + 1, allPhones);
        } else {
            // ✅ 否则已经是最后一页
            return allPhones;
        }

    } catch (error) {
        console.error('❌ Error on page', page, error);
        return accumulated;
    }
}

const normalizeNumber = (num) => {
    let digits = num.replace(/\D/g, ''); // 去除非数字
    if (digits.startsWith('1') && digits.length === 11) {
        digits = digits.slice(1); // 去掉国家码
    }
    return digits.length === 10 ? digits : null; // 只保留10位有效美国号码
};


// ✅ 使用示例：抓取全部手机号
(async () => {
    const rawNumbers = await getAllPhones(csrfToken);
    console.log(`✅ 共抓取 ${rawNumbers.length} 个手机号`);
    console.log(JSON.stringify(rawNumbers, null, 2));
    const uniqueNumbers = new Set();
    const cleanedNumbers = [];

    for (let num of rawNumbers) {
        const clean = normalizeNumber(num);
        if (clean && !uniqueNumbers.has(clean)) {
            uniqueNumbers.add(clean);
            cleanedNumbers.push(clean);
        }
    }

// 2. 统计757区号的数量
    const is757 = (num) => num.startsWith('757');
    const count757 = cleanedNumbers.filter(is757).length;
    const total = cleanedNumbers.length;
    const percent757 = ((count757 / total) * 100).toFixed(2);

// 3. 输出统计
    console.log(`📊 总去重后号码数: ${total}`);
    console.log(`📍 757区号数量: ${count757}`);
    console.log(`🌎 非757区号数量: ${total - count757}`);
    console.log(`📈 757区号比例: ${percent757}%`);
})();
// 辅助函数：在页面上显示格式化响应（可选）
function displayPrettyResponse(jsonString) {
    // 创建或获取显示容器
    let container = document.getElementById('api-response-container');
    if (!container) {
        container = document.createElement('pre');
        container.id = 'api-response-container';
        container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      width: 40%;
      height: 80vh;
      background: #f5f5f5;
      border: 1px solid #ccc;
      padding: 15px;
      overflow: auto;
      z-index: 9999;
      font-family: monospace;
      white-space: pre-wrap;
      box-shadow: 0 4px 8px rgba(0,0,0,0.1);
    `;
        document.body.appendChild(container);
    }

    // 显示响应
    container.textContent = jsonString;
}