// src/loader.js
import { init } from './index.js'; // 将 initScript 改为 init

// 确保DOM加载后执
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}