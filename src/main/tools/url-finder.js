// ==UserScript==
// @name         /v2/ 路径提取器（优化版）
// @namespace    http://tampermonkey.net/
// @version      1.9
// @description  提取源码中所有包含 /v2/ 的路径，精确位置输出
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 配置：行号偏移量
    const LINE_OFFSET = 2;

    // 获取页面源码
    const pageSource = document.documentElement.outerHTML;

    // 存储所有找到的路径、方法和位置
    const results = [];

    // 创建行号索引
    const lineStarts = [0];
    for (let i = 0; i < pageSource.length; i++) {
        if (pageSource[i] === '\n') {
            lineStarts.push(i + 1);
        }
    }

    // 获取行号和列号（应用偏移）
    function getPosition(index) {
        let low = 0;
        let high = lineStarts.length - 1;
        let line = 0;

        // 二分查找行号
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (lineStarts[mid] <= index) {
                line = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        const column = index - lineStarts[line] + 1;
        return {
            line: line + 1 + LINE_OFFSET,  // 应用行号偏移
            column
        };
    }

    // 预编译正则表达式
    const regexPatterns = [
        // HTML 标签
        {
            pattern: /<(a|link|img|script|iframe|form)\s+[^>]*?(href|src|action)\s*=\s*["']([^"']*\/v2\/[^"']*)["'][^>]*>/gi,
            processor: (match, index) => {
                const element = match[1].toLowerCase();
                let url = match[3].replace(/&amp;/g, '&');

                // 确定请求方法
                let method = 'GET';
                if (element === 'form') {
                    const methodAttr = match[0].match(/method\s*=\s*["']([^"']+)["']/i);
                    method = methodAttr ? methodAttr[1].toUpperCase() : 'GET';
                }

                // 提取/v2/后面的路径
                const v2Index = url.toLowerCase().indexOf('/v2/');
                const shortPath = v2Index !== -1 ? url.substring(v2Index) : url;

                return { method, shortPath, index };
            }
        },

        // fetch API
        {
            pattern: /fetch\s*\(\s*["']([^"']*\/v2\/[^"']*)["']\s*(?:,\s*{([^}]*)})?\s*\)/gi,
            processor: (match, index) => {
                const url = match[1].replace(/&amp;/g, '&');
                let method = 'GET';

                if (match[2]) {
                    const methodMatch = match[2].match(/method\s*:\s*["']([^"']+)["']/i);
                    method = methodMatch ? methodMatch[1].toUpperCase() : 'GET';
                }

                // 提取/v2/后面的路径
                const v2Index = url.toLowerCase().indexOf('/v2/');
                const shortPath = v2Index !== -1 ? url.substring(v2Index) : url;

                return { method, shortPath, index };
            }
        },

        // XMLHttpRequest
        {
            pattern: /\.open\s*\(\s*["']([A-Z]+)["']\s*,\s*["']([^"']*\/v2\/[^"']*)["']/gi,
            processor: (match, index) => {
                const method = match[1].toUpperCase();
                const url = match[2].replace(/&amp;/g, '&');

                // 提取/v2/后面的路径
                const v2Index = url.toLowerCase().indexOf('/v2/');
                const shortPath = v2Index !== -1 ? url.substring(v2Index) : url;

                return { method, shortPath, index };
            }
        },

        // Axios
        {
            pattern: /axios\.(get|post|put|delete|patch|head)\s*\(\s*["']([^"']*\/v2\/[^"']*)["']/gi,
            processor: (match, index) => {
                const method = match[1].toUpperCase();
                const url = match[2].replace(/&amp;/g, '&');

                // 提取/v2/后面的路径
                const v2Index = url.toLowerCase().indexOf('/v2/');
                const shortPath = v2Index !== -1 ? url.substring(v2Index) : url;

                return { method, shortPath, index };
            }
        },

        // jQuery AJAX
        {
            pattern: /\$\.(?:ajax|get|post)\s*\(\s*({[^}]*url\s*:\s*["']([^"']*\/v2\/[^"']*)["'][^}]*}|["']([^"']*\/v2\/[^"']*)["'])/gi,
            processor: (match, index) => {
                let method = 'GET';
                let url = '';

                if (match[1].startsWith('{')) {
                    const methodMatch = match[1].match(/method\s*:\s*["']([^"']+)["']/i) ||
                        match[1].match(/type\s*:\s*["']([^"']+)["']/i);
                    method = methodMatch ? methodMatch[1].toUpperCase() : 'GET';
                    url = match[2].replace(/&amp;/g, '&');
                } else {
                    method = match[0].includes('$.post') ? 'POST' : 'GET';
                    url = match[3].replace(/&amp;/g, '&');
                }

                // 提取/v2/后面的路径
                const v2Index = url.toLowerCase().indexOf('/v2/');
                const shortPath = v2Index !== -1 ? url.substring(v2Index) : url;

                return { method, shortPath, index };
            }
        },

        // 通用 HTTP 方法
        {
            pattern: /(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+["']([^"']*\/v2\/[^"']*)["']/gi,
            processor: (match, index) => {
                const method = match[0].split(/\s+/)[0].toUpperCase();
                const url = match[1].replace(/&amp;/g, '&');

                // 提取/v2/后面的路径
                const v2Index = url.toLowerCase().indexOf('/v2/');
                const shortPath = v2Index !== -1 ? url.substring(v2Index) : url;

                return { method, shortPath, index };
            }
        }
    ];

    // 处理所有正则表达式
    regexPatterns.forEach(patternObj => {
        const regex = new RegExp(patternObj.pattern.source, 'gi');
        let match;

        while ((match = regex.exec(pageSource)) !== null) {
            try {
                const result = patternObj.processor(match, match.index);

                // 添加位置信息（已应用偏移）
                const position = getPosition(result.index);
                result.position = `${position.line}:${position.column}`;

                results.push(result);
            } catch (e) {
                // 忽略解析错误
            }
        }
    });

    // 使用Map进行严格去重
    const uniqueResults = [];
    const seenKeys = new Map();

    results.forEach(item => {
        // 创建唯一键：方法+路径
        const key = `${item.method}${item.shortPath}`;

        // 只保留每个路径的第一个出现位置
        if (!seenKeys.has(key)) {
            seenKeys.set(key, true);
            uniqueResults.push(item);
        }
    });

    // 按位置排序
    const sortedResults = uniqueResults.sort((a, b) => {
        const [aLine, aCol] = a.position.split(':').map(Number);
        const [bLine, bCol] = b.position.split(':').map(Number);

        return aLine - bLine || aCol - bCol;
    });

    // 输出结果（不显示用户脚本位置）
    if (sortedResults.length > 0) {
        // 创建结果字符串
        const outputLines = [
            `找到 ${sortedResults.length} 个包含 /v2/ 的路径`,
            ...sortedResults.map((item, index) => {
                // 使用方法确定颜色
                const methodColor =
                    item.method === 'GET' ? 'green' :
                        item.method === 'POST' ? 'orange' : 'blue';

                return `${index + 1}. [${item.method}] ${item.shortPath} (at ${item.position})`;
            })
        ];

        // 一次性输出所有结果
        console.log(outputLines.join('\n'));
    } else {
        console.log('未找到包含 /v2/ 的路径');
    }
})();