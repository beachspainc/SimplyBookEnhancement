module.exports = {
    name: 'SimplyBook增强工具webpack版',
    namespace: 'http://your-domain.com/',
    version: '0.1.1', // 动态版本号
    description: '增强SimplyBook功能',
    author: 'YourName',
    match: [
        'https://*.simplybook.me/*',
        'https://*.simplybook.asia/*'
    ],
    grant: [
        'GM_xmlhttpRequest',
        'GM_setValue',
        'GM_getValue'
    ],
    require: [
        //'https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js'
    ],
    connect: [
        'localhost',
        '127.0.0.1',
        '192.168.0.145', // 你的本地IP
        'simplybook.me',
        '*' // 开发环境下允许所有域名（仅限开发）
    ],
    'run-at': 'document-end'
};