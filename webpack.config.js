const dns = require('dns');
const { UserscriptPlugin } = require('webpack-userscript');
const path = require('path');
const fs = require('fs');
const metadata = require('./src/metadata');
const os = require('os');

// 使用 CommonJS 兼容的 get-port 版本
const getPort = require('get-port');

class Config {

    static GetHost() {
        return process.env.WEBPACK_HOST || 'localhost';
    }

    static GetPort() {
        return process.env.WEBPACK_PORT || 8080;
    }

    static GetEnvironment() {
        return process.env.NODE_ENV || 'development';
    }

    static Constants = {
        IS_PRODUCTION: process.env.NODE_ENV === 'production',
        IS_DEVELOPMENT: process.env.NODE_ENV === 'development'
    }
}

class UtilityService {
    static GetLocalIpAddress() {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const net of interfaces[name]) {
                if (net.family === 'IPv4' && !net.internal) {
                    return net.address;
                }
            }
        }
        return 'localhost';
    }
}

// 设置 DNS 解析顺序
dns.setDefaultResultOrder('verbatim');

// 创建详细的日志记录器
class Logger {
    static ColorScheme = {
        Info: '\x1b[36m', // 青色
        Warn: '\x1b[33m', // 黄色
        Error: '\x1b[31m', // 红色
        Debug: '\x1b[35m', // 紫色
        Reset: '\x1b[0m'  // 重置
    };

    static ensureLogDirectory() {
        if (!fs.existsSync('logs')) {
            fs.mkdirSync('logs');
        }
    }

    static createLogger(logLevel = 'verbose') {
        const logStream = fs.createWriteStream('logs/webpack.log', { flags: 'a' });

        const log = (level, message) => {
            const timestamp = new Date().toISOString();
            const coloredMessage = `${Logger.ColorScheme[level.toUpperCase()]}[${timestamp}] [${level.toUpperCase()}]${Logger.ColorScheme.Reset} ${message}`;

            console.log(coloredMessage);

            logStream.write(`[${timestamp}] [${level.toUpperCase()}] ${message}\n`);

            if (level === 'error' && message instanceof Error) {
                console.error(message.stack);
                logStream.write(`${message.stack}\n`);
            }
        };

        return {
            info: (msg) => logLevel === 'verbose' && log('info', msg),
            warn: (msg) => logLevel !== 'silent' && log('warn', msg),
            error: (msg) => log('error', msg),
            debug: (msg) => logLevel === 'verbose' && log('debug', msg),
            end: () => logStream.end()
        };
    }
}

// 使用新的 Logger 类
Logger.ensureLogDirectory();
const logger = Logger.createLogger('verbose');

module.exports = async () => {
    try {
        logger.info('Starting Webpack configuration...');

        // 优先使用环境变量中的端口
        const port = process.env.WEBPACK_PORT
            ? parseInt(process.env.WEBPACK_PORT)
            : await getPort({ host: 'localhost', port: 8080 });

        logger.info(`Using port: ${port}`);

        return {
            // 添加命名入口点
            entry: {
                main: './src/loader.js' // 使用loader作为入口
            },
            output: {
                path: path.resolve(__dirname, 'dist'),
                // 使用 .user.js 后缀
                filename: 'simplybook.[name].user.js',
                publicPath: '/'
            },
            plugins: [
                new EnsureDistDirPlugin(),
                // Userscript 插件（修复版本）
                new UserscriptPlugin({
                    headers: metadata,
                    proxyScript: {
                        baseURL: `http://localhost:${port}`,
                        filename: 'tampermonkey.proxy.user.js',
                        enable: Config.Constants.IS_PRODUCTION
                    },
                    metajs: false,
                    renameExt: false, // 禁用自动重命名
                    noMetafile: true // 禁用元文件生成
                }),
                // 冲突检测插件（放到最后）
                new ConflictDetectorPlugin()
            ],
            // 启用详细统计信息
            stats: {
                all: true,
                colors: true,
                errorDetails: true,
                moduleTrace: true,
            },
            devServer: {
                port: port,
                static: [
                    {
                        directory: path.join(__dirname, 'dist'),
                        publicPath: '/',
                        serveIndex: true,
                        watch: {
                            usePolling: true
                        }
                    },
                    {
                        directory: path.join(__dirname, 'public'),
                        publicPath: '/',
                        staticOptions: {
                            setHeaders: (res, filePath) => {
                                if (filePath && filePath.endsWith('.html')) {
                                    res.setHeader('Content-Type', 'text/html');
                                    logger.debug(`Set Content-Type: text/html for ${filePath}`);
                                }
                            }
                        }
                    }
                ],
                headers: {
                    'Access-Control-Allow-Origin': '*' // 只保留跨域设置
                },
                client: {
                    logging: 'verbose', // 客户端详细日志
                    overlay: {
                        errors: true,
                        warnings: true
                    },
                    // 显式设置WebSocket URL
                    webSocketURL: {
                        hostname: '0.0.0.0',
                        port: port,
                        pathname: '/ws'
                    }
                },
                devMiddleware: {
                    stats: 'verbose', // 中间件详细日志
                    writeToDisk: true // 将文件写入磁盘以便检查
                },
                onListening: function(devServer) {
                    if (!devServer) return;
                    const actualPort = devServer.server.address().port;
                    const ip = UtilityService.GetLocalIpAddress();
                    logger.info(`Development server running at: http://localhost:${actualPort}`);
                    logger.info(`Network accessible URL: http://${ip}:${actualPort}`);
                    logger.info(`Proxy script URL: http://localhost:${actualPort}/tampermonkey.proxy.user.js`);
                },
                setupMiddlewares: (middlewares, devServer) => {
                    // 1. 保留请求日志中间件
                    devServer.app.use((req, res, next) => {
                        logger.debug(`Request: ${req.method} ${req.url}`);
                        next();
                    });

                    // 2. 添加内容类型处理中间件
                    devServer.app.use((req, res, next) => {
                        if (req.url === '/') {
                            res.setHeader('Content-Type', 'text/html');
                            logger.debug(`Set Content-Type: text/html for root path`);
                        }
                        else if (req.url.endsWith('.html')) {
                            res.setHeader('Content-Type', 'text/html');
                            logger.debug(`Set Content-Type: text/html for ${req.url}`);
                        }
                        next();
                    });

                    // 3. 添加服务器信息 API 端点
                    devServer.app.get('/api/server-info', (req, res) => {
                        const server = devServer.server;
                        if (!server) {
                            res.status(503).json({
                                success: false,
                                error: "Server not ready"
                            });
                            return;
                        }

                        const port = server.address().port;
                        const ip = UtilityService.getLocalIpAddress();

                        res.json({
                            success: true,
                            data: {
                                port,
                                ip,
                                localUrl: `http://localhost:${port}`,
                                networkUrl: `http://${ip}:${port}`,
                                proxyScriptUrl: `http://localhost:${port}/tampermonkey.proxy.user.js`,
                                timestamp: new Date().toISOString(),
                                projectName: "SimplyBook Enhancement Tool",
                                version: metadata.version
                            }
                        });
                    });

                    return middlewares;
                }
            }
        };
    } catch (error) {
        logger.error(`Configuration error: ${error.message}`);
        throw error;
    }
};
// 增强的冲突检测插件
class ConflictDetectorPlugin {
    apply(compiler) {
        // 使用 emit 钩子捕获所有最终资源
        compiler.hooks.emit.tap('ConflictDetectorPlugin', (compilation) => {
            const assetsByFilename = new Map();
            const logger = Logger.createLogger('verbose');

            logger.info('Starting asset conflict detection...');

            // 收集所有资源（包含热更新资源）
            for (const [pathname, asset] of Object.entries(compilation.assets)) {
                const filename = path.basename(pathname);

                if (!assetsByFilename.has(filename)) {
                    assetsByFilename.set(filename, []);
                }

                assetsByFilename.get(filename).push({
                    pathname,
                    size: asset.size(),
                    source: asset.source().slice(0, 100) + '...'
                });

                // 调试日志：记录每个资源
                logger.debug(`Asset found: ${filename} from ${pathname}`);
            }

            // 特别关注冲突文件
            if (assetsByFilename.has('tampermonkey.proxy.user.js')) {
                const assets = assetsByFilename.get('tampermonkey.proxy.user.js');
                logger.info(`Found ${assets.length} assets for tampermonkey.proxy.user.js`);
                assets.forEach(asset => {
                    logger.info(`- ${asset.pathname} (${asset.size} bytes): ${asset.source}`);
                });
            }

            // 检测并报告冲突
            let conflictDetected = false;
            for (const [filename, assets] of assetsByFilename) {
                if (assets.length > 1) {
                    conflictDetected = true;
                    logger.error(`\n[CONFLICT DETECTED] Multiple assets for filename: ${filename}`);
                    logger.error('Conflicting assets:');

                    assets.forEach((asset, index) => {
                        logger.error(`  ${index + 1}. Path: ${asset.pathname}`);
                        logger.error(`     Size: ${asset.size} bytes`);
                        logger.error(`     Content: ${asset.source}`);
                    });

                    // 抛出错误以停止构建
                    throw new Error(`Conflict: Multiple assets emit to the same filename ${filename}`);
                }
            }

            if (!conflictDetected) {
                logger.info('No filename conflicts detected in assets');
            }
        });
    }
}

class EnsureDistDirPlugin {
    apply(compiler) {
        compiler.hooks.beforeRun.tap('EnsureDistDir', () => {
            if (!fs.existsSync('dist')) {
                fs.mkdirSync('dist');
                logger.info('Created dist directory');
            }
        });
    }
}

// 在进程退出时关闭日志
process.on('exit', () => logger.end());
process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());