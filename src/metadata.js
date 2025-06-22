module.exports = {
    name: 'SimplyBook增强工具webpack版',
    namespace: 'http://your-domain.com/',
    version: '0.1.' + Date.now(), // 动态版本号
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
    'run-at': 'document-end'
};