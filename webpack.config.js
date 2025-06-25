const dns = require('dns');
const { UserscriptPlugin } = require('webpack-userscript');
const path = require('path');
const fs = require('fs');
const { ProgressPlugin } = require('webpack');
const metadata = require('./src/metadata');
const os = require('os');
const getPort = require('get-port');
const webpack = require('webpack');
const { Compilation, sources } = require('webpack');

// 设置 DNS 解析顺序
dns.setDefaultResultOrder('verbatim');

const LogLevel = {
    VERBOSE: 'verbose',
    TRACE: 'trace',
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error',
    FATAL: 'fatal',
    SILENCE: 'silence'
};

// 环境配置类
class Config {
    // 主机配置
    static get Host() {
        return process.env.WEBPACK_HOST || Config.Constants.HOST;
    }

    // 端口配置
    static get Port() {
        return process.env.WEBPACK_PORT ? Number.parseInt(process.env.WEBPACK_PORT) : Config.Constants.DEFAULT_PORT;
    }

    // 日志级别配置
    static get LogLevel() {
        return process.env.LOG_LEVEL || Config.Constants.DEFAULT_LOG_LEVEL;
    }

    // 端口范围配置
    static get PortRange() {
        return Config.Constants.PORT_RANGE;
    }

    static get IsProduction() {
        return process.env.NODE_ENV === 'production';
    }

    // 常量定义作为内部类
    static Constants = {
        // 常量使用UPPER_SNAKE_CASE命名
        HOST: 'localhost',
        PORT_RANGE: [8080, 8081, 8082],
        DEFAULT_PORT: 8080,
        FILE_NAMES: {
            PROXY_SCRIPT: '[basename].proxy.user.js'
        },
        DEFAULT_LOG_LEVEL: LogLevel.VERBOSE,
        PLUGIN_NAMES: {
            CONFLICT_DETECTOR: 'ConflictDetectorPlugin',
            PROXY_FIX: 'ProxyScriptHotFixPlugin'
        }
    };
}

// 工具服务类
class UtilityService {
    static get LocalIpAddress() {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const net of interfaces[name]) {
                if (net.family === 'IPv4' && !net.internal) {
                    return net.address;
                }
            }
        }
        // 修改为通过Config类获取默认host
        return Config.Host;
    }
}

// 日志记录器类
class Logger {
    // 颜色常量
    static COLORS = {
        INFO: '\x1b[36m',
        WARN: '\x1b[33m',
        ERROR: '\x1b[31m',
        DEBUG: '\x1b[35m',
        RESET: '\x1b[0m'
    };

    // 私有字段
    #logStream;
    #logLevel;

    constructor(logLevel = Config.Constants.DEFAULT_LOG_LEVEL) {
        this.#logLevel = logLevel;
        this.#initializeLogger();
    }

    // 初始化日志系统
    #initializeLogger() {
        if (!fs.existsSync('logs')) {
            fs.mkdirSync('logs');
        }
        this.#logStream = fs.createWriteStream('logs/webpack.log', { flags: 'a' });
    }

    // 创建日志记录器实例
    static CreateLogger(logLevel = Config.Constants.DEFAULT_LOG_LEVEL) {
        return new Logger(logLevel);
    }

    // 日志方法
    #log(level, message) {
        const timestamp = new Date().toISOString();
        const coloredMessage = `${Logger.COLORS[level]}[${timestamp}] [${level.toUpperCase()}]${Logger.COLORS.RESET} ${message}`;

        console.log(coloredMessage);
        this.#logStream.write(`[${timestamp}] [${level.toUpperCase()}] ${message}\n`);

        if (level === 'error' && message instanceof Error) {
            console.error(message.stack);
            this.#logStream.write(`${message.stack}\n`);
        }
    }

    // 日志方法封装
    info(msg) {
        if (this.#logLevel === Config.Constants.DEFAULT_LOG_LEVEL) {
            this.#log('info', msg);
        }
    }

    warn(msg) {
        if (this.#logLevel !== 'silent') {
            this.#log('warn', msg);
        }
    }

    error(msg) {
        this.#log('error', msg);
    }

    debug(msg) {
        if (this.#logLevel === Config.Constants.DEFAULT_LOG_LEVEL) {
            this.#log('debug', msg);
        }
    }

    end() {
        this.#logStream.end(() => {
            this.debug('Log stream closed');
        });
    }
}

// 初始化日志系统
const logger = Logger.CreateLogger(Config.Constants.DEFAULT_LOG_LEVEL);

// 新增: ProxyScriptHotFixPlugin - 解决代理脚本与热更新的冲突
class ProxyScriptHotFixPlugin {
    static PLUGIN_NAME = Config.Constants.PLUGIN_NAMES.PROXY_FIX;
    #proxyFilename = '';
    #isInitialBuild = true;

    apply(compiler) {
        compiler.hooks.thisCompilation.tap(ProxyScriptHotFixPlugin.PLUGIN_NAME, (compilation) => {
            compilation.hooks.processAssets.tap(
                {
                    name: ProxyScriptHotFixPlugin.PLUGIN_NAME,
                    stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
                },
                (assets) => {
                    // 只在后续构建中处理代理脚本
                    if (!this.#isInitialBuild) {
                        const proxyAssets = Object.keys(assets).filter(name =>
                            name.includes('.proxy.user.js')
                        );

                        if (proxyAssets.length > 0) {
                            logger.info(`Removing proxy scripts from assets: ${proxyAssets.join(', ')}`);
                            proxyAssets.forEach(name => {
                                delete assets[name];
                            });
                        }
                    }
                }
            );
        });

        compiler.hooks.done.tap(ProxyScriptHotFixPlugin.PLUGIN_NAME, () => {
            if (this.#isInitialBuild) {
                logger.info('Initial build complete, enabling proxy script fix');
                this.#isInitialBuild = false;
            }
        });
    }
}

// ConflictDetectorPlugin类
class ConflictDetectorPlugin {
    static PLUGIN_NAME = Config.Constants.PLUGIN_NAMES.CONFLICT_DETECTOR;

    apply(compiler) {
        compiler.hooks.emit.tap(ConflictDetectorPlugin.PLUGIN_NAME, (compilation) => {
            const assetsByFilename = new Map();

            logger.info('Starting asset conflict detection...');

            // 收集所有资源
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

                // 调试日志
                logger.debug(`Asset found: ${filename} from ${pathname} ${asset}`);
            }

            // 检测并报告冲突
            for (const [filename, assets] of assetsByFilename.entries()) {
                if (assets.length > 1) {
                    logger.warn(`Conflict detected for filename: ${filename}`);
                    logger.warn(`Found in paths: ${assets.map(a => a.pathname).join(', ')}`);

                    // 添加冲突检测结果到编译信息
                    compilation.errors.push(
                        new Error(`Asset conflict: ${filename} exists in multiple paths: ${assets.map(a => a.pathname).join(', ')}`)
                    );
                }
            }
        });
    }
}

// EnsureDistDirPlugin类
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

// Webpack配置类
class WebpackConfig {
    static get mode() {
        return Config.IsProduction ?  'production' : 'development';
    }

    static get entry() {
        return {
            main: './src/loader.js'
        };
    }

    static get output() {
        return {
            path: path.resolve(__dirname, 'dist'),
            filename: 'simplybook.[name].user.js',
            publicPath: '/'
        };
    }

    static get plugins() {
        return [
            new EnsureDistDirPlugin(),
            new webpack.DefinePlugin({
                'process.env.DEV_SERVER_URL': JSON.stringify(
                    `http://${Config.Host}:${Config.Port}`
                ),
                'process.env.DEV_WS_URL': JSON.stringify(
                    `ws://${Config.Host}:${Config.Port}/ws`
                ),
                'process.env.NODE_ENV': JSON.stringify(Config.IsProduction ? 'production' : 'development')
            }),
            // 关键修改：添加ProxyScriptHotFixPlugin插件
            new ProxyScriptHotFixPlugin(),
            new UserscriptPlugin({
                headers: (original) => {
                    // 开发模式：添加构建编号
                    if (!Config.IsProduction) {
                        return {
                            ...original,
                            version: `${original.version}-build.[buildNo]`,
                        }
                    }
                    // 生产模式：保持原样
                    return original;
                },
                proxyScript: {
                    baseURL: `http://${Config.Host}:${Config.Port}`,
                    filename: Config.Constants.FILE_NAMES.PROXY_SCRIPT
                },
                metajs: false,
                renameExt: true
            }),
            new ConflictDetectorPlugin()
        ];
    }

    static get stats() {
        return {
            all: true,
            colors: true,
            errorDetails: true,
            moduleTrace: true,
            warningsFilter: (warning) => {
                logger.warn(`Warning: ${warning}`);
                return false;
            }
        };
    }

    // 修改devServer配置
    static get devServer() {
        return {
            port: Config.Port,
            host: Config.Host,
            allowedHosts: 'all',

            static: {
                directory: path.join(__dirname, 'dist'),
                publicPath: '/',
                watch: true
            },

            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Security-Policy': "default-src 'self' 'unsafe-inline' data: blob:; connect-src * ws: wss:;"
            },

            client: {
                logging: Config.LogLevel,
                overlay: { errors: true, warnings: true },

                // 关键修复：强制指定 WebSocket URL
                webSocketURL: {
                    hostname: Config.Host,
                    port: Config.Port,
                    pathname: '/ws',
                    protocol: 'ws'
                }
            },

            // 添加 WebSocket 服务器
            webSocketServer: {
                type: 'ws',
                options: {
                    path: '/ws',
                    // 允许所有来源连接
                    clientTracking: true,
                    verifyClient: (info) => {
                        console.log(`WebSocket client connecting from: ${info.origin}`);
                        return true; // 允许所有客户端
                    }
                }
            },

            onListening(devServer) {
                if (!devServer) return;
                const server = devServer.server;
                if (!server) return;

                const actualPort = server.address().port;
                console.log(`Development server running at: http://${Config.Host}:${actualPort}`);
                console.log(`Proxy script URL: http://${Config.Host}:${actualPort}/${Config.Constants.FILE_NAMES.PROXY_SCRIPT.replace('[basename]', 'simplybook.main')}`);
                console.log(`Main script URL: http://${Config.Host}:${actualPort}/simplybook.main.user.js`);

                // 修复后的 WebSocket 日志
                const wss = devServer.webSocketServer;
                if (wss && wss.implementation) {
                    const wsServer = wss.implementation;

                    wsServer.on('connection', (client, request) => {
                        const clientIp = request.socket.remoteAddress;
                        console.log(`WebSocket client connected from: ${clientIp}`);

                        client.on('close', () => {
                            console.log(`WebSocket client disconnected: ${clientIp}`);
                        });

                        // 可选：添加错误处理
                        client.on('error', (error) => {
                            console.error(`WebSocket error from ${clientIp}:`, error);
                        });
                    });
                } else {
                    console.warn('WebSocket server implementation not found');
                }
            },
            devMiddleware: { writeToDisk: true },
            hot: true, // 保持热更新开启
            setupMiddlewares(middlewares, devServer) {
                // 添加 WebSocket 处理中间件
                devServer.app.get('/ws', (req, res) => {
                    res.status(400).send('Use WebSocket protocol');
                });

                return middlewares;
            }
        };
    }
}

// 修改module.exports前添加配置验证
class ConfigValidator {
    static validate(config) {
        try {
            // 获取实际端口值（同步方式）
            const actualPort = (() => {
                try {
                    return parseInt(Config.Port);
                } catch (e) {
                    return Config.Constants.DEFAULT_PORT;
                }
            })();

            // 验证devServer配置
            if (config.devServer) {
                // 验证端口
                console.log(config.devServer.port !== 'number');
                if (typeof config.devServer.port !== 'number' ||
                    Number.parseInt(config.devServer.port) < 1 ||
                    Number.parseInt(config.devServer.port) > 65535) {
                    throw new Error(`Invalid devServer.port value: ${config.devServer.port}. Current resolved value: ${actualPort}. Must be a number between 1 and 65535.`);
                }

                // 验证webSocketURL配置
                if (config.devServer.client?.webSocketURL) {
                    if (typeof config.devServer.client.webSocketURL.port !== 'number' ||
                        config.devServer.client.webSocketURL.port < 1 ||
                        config.devServer.client.webSocketURL.port > 65535) {
                        throw new Error(`Invalid webSocketURL.port value: ${config.devServer.client.webSocketURL.port}. Must be a number between 1 and 65535.`);
                    }
                }
            }

            // 验证log level
            if (Config.LogLevel && ![LogLevel.VERBOSE, LogLevel.SILENCE].includes(Config.LogLevel)) {
                throw new Error(`Invalid LOG_LEVEL value: ${Config.LogLevel}. Must be ${LogLevel.VERBOSE} or ${LogLevel.SILENCE}.`);
            }

            logger.info('Configuration validation passed');
        } catch (error) {
            logger.error(`Configuration validation failed: ${error.message}`);
            throw error;
        }
    }
}

// 主模块导出
module.exports = async () => {
    try {
        const config = {
            entry: WebpackConfig.entry,
            output: WebpackConfig.output,
            module: WebpackConfig.module,
            plugins: WebpackConfig.plugins,
            stats: WebpackConfig.stats,
            devServer: WebpackConfig.devServer
        };

        // 验证配置
        ConfigValidator.validate(config);

        return config;
    } catch (error) {
        logger.error(`Configuration error: ${error.message}`);
        throw error;
    }
};

// 在进程退出时关闭日志
process.on('exit', () => logger.end());
process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());