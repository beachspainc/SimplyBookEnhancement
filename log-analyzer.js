const fs = require('fs');
const path = require('path');
const readline = require('readline');
const chalk = require('chalk');

// 安装所需依赖
try {
    require.resolve('chalk');
} catch {
    console.log('Installing chalk for colored logs...');
    require('child_process').execSync('npm install chalk', { stdio: 'inherit' });
}

// 日志文件路径
const logFile = path.join(__dirname, '/logs/webpack.log');

if (!fs.existsSync(logFile)) {
    console.error(chalk.red('Error: No webpack.log file found. Run the dev server first.'));
    process.exit(1);
}

console.log(chalk.blue('Starting log analysis...'));
console.log(chalk.gray('----------------------------------------'));

// 创建读取接口
const rl = readline.createInterface({
    input: fs.createReadStream(logFile),
    crlfDelay: Infinity
});

// 日志统计
const stats = {
    total: 0,
    info: 0,
    warn: 0,
    error: 0,
    debug: 0,
    requests: 0
};

// 错误收集
const errors = [];
const warnings = [];
const slowRequests = [];

// 处理每一行日志
rl.on('line', (line) => {
    stats.total++;

    const match = line.match(/\[(.*?)\] \[(INFO|WARN|ERROR|DEBUG)\](.*)/);
    if (!match) return;

    const [, timestamp, level, message] = match;

    // 更新统计
    stats[level.toLowerCase()]++;

    // 高亮显示重要信息
    if (level === 'ERROR') {
        errors.push(line);
        console.log(chalk.red(line));
    } else if (level === 'WARN') {
        warnings.push(line);
        console.log(chalk.yellow(line));
    } else if (message.includes('slow')) {
        slowRequests.push(line);
        console.log(chalk.magenta(line));
    } else if (level === 'DEBUG' && message.includes('Request:')) {
        stats.requests++;
        // 不显示所有请求，只统计
    } else {
        console.log(level === 'INFO' ? chalk.cyan(line) : chalk.gray(line));
    }
});

// 分析完成
rl.on('close', () => {
    console.log(chalk.gray('----------------------------------------'));
    console.log(chalk.green('Log analysis completed!'));
    console.log(chalk.blue(`Total entries: ${stats.total}`));
    console.log(chalk.cyan(`Info: ${stats.info}`));
    console.log(chalk.yellow(`Warnings: ${stats.warn}`));
    console.log(chalk.red(`Errors: ${stats.error}`));
    console.log(chalk.magenta(`Debug: ${stats.debug}`));
    console.log(chalk.blue(`Requests: ${stats.requests}`));

    if (errors.length > 0) {
        console.log(chalk.red('\n===== ERROR SUMMARY ====='));
        errors.forEach(err => console.log(chalk.red(err)));
    }

    if (warnings.length > 0) {
        console.log(chalk.yellow('\n===== WARNING SUMMARY ====='));
        warnings.forEach(warn => console.log(chalk.yellow(warn)));
    }

    if (slowRequests.length > 0) {
        console.log(chalk.magenta('\n===== SLOW REQUESTS ====='));
        slowRequests.forEach(req => console.log(chalk.magenta(req)));
    }

    if (stats.error === 0 && stats.warn === 0) {
        console.log(chalk.green('\nNo critical issues found!'));
    } else {
        console.log(chalk.yellow('\nReview the summaries above for potential issues.'));
    }
});