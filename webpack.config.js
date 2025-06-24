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
    static get Host() {
        return process.env.WEBPACK_HOST || 'localhost';
    }

    static get Port() {
        return process.env.WEBPACK_PORT ? parseInt(process.env.WEBPACK_PORT) : Constants.DEFAULT_PORT;
    }

    static get IsProduction() {
        return process.env.NODE_ENV === 'production';
    }
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
        return 'localhost';
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

    static get devServer() {
        return {
            port: Config.Port,
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
                overlay: { 
                    errors: true, 
                    warnings: true 
                },
                webSocketURL: {
                    hostname: Config.Host,
                    port: Config.Port,
                    pathname: '/ws'
                }
            },
            devMiddleware: { 
                stats: 'verbose', 
                writeToDisk: true 
            },
            onListening(devServer) {
                if (!devServer) return;
                const actualPort = devServer.server.address().port;
                const ip = UtilityService.LocalIpAddress;
                logger.info(`Development server running at: http://localhost:${actualPort}`);
                logger.info(`Network accessible URL: http://${ip}:${actualPort}`);
                logger.info(`Proxy script URL: http://localhost:${actualPort}/${Constants.FILE_NAMES.PROXY_SCRIPT}`);
            },
            setupMiddlewares(middlewares, devServer) {
                // 请求日志中间件
                devServer.app.use((req, res, next) => {
                    logger.debug(`Request: ${req.method} ${req.url}`);
                    next();
                });

                // 内容类型处理中间件
                devServer.app.use((req, res, next) => {
                    if (req.url === '/') {
                        res.setHeader('Content-Type', 'text/html');
                        logger.debug(`Set Content-Type: text/html for root path`);
                    } else if (req.url.endsWith('.html')) {
                        res.setHeader('Content-Type', 'text/html');
                        logger.debug(`Set Content-Type: text/html for ${req.url}`);
                    }
                    next();
                });

                // 服务器信息API
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
                    const ip = UtilityService.LocalIpAddress;

                    res.json({
                        success: true,
                        data: {
                            port,
                            ip,
                            localUrl: `http://localhost:${port}`,
                            networkUrl: `http://${ip}:${port}`,
                            proxyScriptUrl: `http://localhost:${port}/${Constants.FILE_NAMES.PROXY_SCRIPT}`,
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

// 主模块导出
module.exports = async () => {
    try {
        logger.info('Starting Webpack configuration...');

        // 获取实际端口
        const actualPort = await getPort({ port: Constants.PORT_RANGE });
        logger.info(`Using port: ${actualPort}`);

        // 返回Webpack配置
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