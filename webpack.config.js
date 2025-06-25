const dns = require('dns');
const { UserscriptPlugin } = require('webpack-userscript');
const path = require('path');
const fs = require('fs');
const { ProgressPlugin } = require('webpack');
const metadata = require('./src/metadata');
const os = require('os');
const getPort = require('get-port');

// 设置 DNS 解析顺序
dns.setDefaultResultOrder('verbatim');

// 配置常量定义
class Constants {
    static FILE_NAMES = {
        PROXY_SCRIPT: 'tampermonkey.proxy.user.js'
    };

    static PLUGIN_NAMES = {
        CONFLICT_DETECTOR: 'ConflictDetectorPlugin'
    };

    static DEFAULT_LOG_LEVEL = 'verbose';
    static PORT_RANGE = [8080, 8081, 8082];
    static DEFAULT_PORT = 8080;
}

// 环境配置类
class Config {
    // 主机配置
    static get Host() {
        return process.env.WEBPACK_HOST || 'localhost';
    }

    // 端口配置
    static get Port() {
        return process.env.WEBPACK_PORT ? parseInt(process.env.WEBPACK_PORT) : Config.Constants.DEFAULT_PORT;
    }

    // 日志级别配置
    static get LogLevel() {
        return process.env.LOG_LEVEL || 'verbose';
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
        PORT_RANGE: [8080, 8081, 8082],
        DEFAULT_PORT: 8080,
        FILE_NAMES: {
            PROXY_SCRIPT: 'tampermonkey.proxy.user.js'
        },
        PLUGIN_NAMES: {
            CONFLICT_DETECTOR: 'ConflictDetectorPlugin'
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

    constructor(logLevel = Constants.DEFAULT_LOG_LEVEL) {
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
    static CreateLogger(logLevel = Constants.DEFAULT_LOG_LEVEL) {
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
        if (this.#logLevel === Constants.DEFAULT_LOG_LEVEL) {
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
        if (this.#logLevel === Constants.DEFAULT_LOG_LEVEL) {
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
const logger = Logger.CreateLogger(Constants.DEFAULT_LOG_LEVEL);

// ConflictDetectorPlugin类
class ConflictDetectorPlugin {
    static PLUGIN_NAME = Constants.PLUGIN_NAMES.CONFLICT_DETECTOR;

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
                logger.debug(`Asset found: ${filename} from ${pathname}`);
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
            new UserscriptPlugin({
                headers: metadata,
                proxyScript: {
                    baseURL: `http://${Config.Host}:${Config.Port}`,
                    filename: Constants.FILE_NAMES.PROXY_SCRIPT
                },
                metajs: false,
                renameExt: true
            }),
            new ProgressPlugin({
                activeModules: true,
                entries: true,
                modules: true,
                modulesCount: 100,
                profile: true,
                handler: (percentage, message, ...args) => {
                    logger.debug(`Progress: ${Math.floor(percentage * 100)}% - ${message} ${args.join(' ')}`);
                }
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
            // 使用Config类获取端口和主机
            port: Config.Port,
            host: Config.Host,
            static: [
                {
                    directory: path.join(__dirname, 'dist'),
                    publicPath: '/',
                    serveIndex: true
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
            headers: { 'Access-Control-Allow-Origin': '*' },
            client: {
                logging: 'verbose',
                overlay: { errors: true, warnings: true },
                webSocketURL: {
                    // 使用Config类获取主机和端口
                    hostname: Config.Host,
                    port: Config.Port,
                    pathname: '/ws'
                }
            },
            devMiddleware: { stats: 'verbose', writeToDisk: true },
            onListening(devServer) {
                if (!devServer) return;
                const actualPort = devServer.server.address().port;
                // 使用UtilityService获取IP地址
                const ip = UtilityService.LocalIpAddress;
                logger.info(`Development server running at: http://${Config.Host}:${actualPort}`);
                logger.info(`Network accessible URL: http://${ip}:${actualPort}`);
                logger.info(`Proxy script URL: http://${Config.Host}:${actualPort}/${Constants.FILE_NAMES.PROXY_SCRIPT}`);
            },
            setupMiddlewares(middlewares, devServer) {
                devServer.app.use((req, res, next) => {
                    logger.debug(`Request: ${req.method} ${req.url}`);
                    next();
                });

                devServer.app.get('/api/server-info', (req, res) => {
                    const server = devServer.server;
                    if (!server) {
                        res.status(503).json({ success: false, error: "Server not ready" });
                        return;
                    }

                    const port = server.address().port;
                    const ip = UtilityService.LocalIpAddress;

                    res.json({
                        success: true,
                        data: {
                            port,
                            ip,
                            // 使用Config.Host代替硬编码的localhost
                            localUrl: `http://${Config.Host}:${port}`,
                            networkUrl: `http://${ip}:${port}`,
                            proxyScriptUrl: `http://${Config.Host}:${port}/${Constants.FILE_NAMES.PROXY_SCRIPT}`,
                            timestamp: new Date().toISOString(),
                            projectName: "SimplyBook Enhancement Tool",
                            version: metadata.version
                        }
                    });
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
                if (typeof config.devServer.port !== 'number' || 
                    config.devServer.port < 1 || 
                    config.devServer.port > 65535) {
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
            if (Config.LogLevel && !['verbose', 'silent'].includes(Config.LogLevel)) {
                throw new Error(`Invalid LOG_LEVEL value: ${Config.LogLevel}. Must be 'verbose' or 'silent'.`);
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
        //return await Object.assign({}, WebpackConfig);
        return {
            entry: WebpackConfig.entry,
            output: WebpackConfig.output,
            plugins: WebpackConfig.plugins,
            stats: WebpackConfig.stats,
            devServer: WebpackConfig.devServer
        };
    } catch (error) {
        logger.error(`Configuration error: ${error.message}`);
        throw error;
    }
};

// 在进程退出时关闭日志
process.on('exit', () => logger.end());
process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());