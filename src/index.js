console.log("[DEBUG] 主脚本已加载");
window.simplyBookScriptLoaded = true;

// 添加导出语句
export function init() {
    console.log('脚本初始化开始l2');

    // 创建调试按钮的代码...
    const debugBtn = document.createElement('button');
    debugBtn.textContent = '测试调试12';
    debugBtn.style.position = 'fixed';
    debugBtn.style.bottom = '40px';
    debugBtn.style.right = '20px';
    debugBtn.style.zIndex = '9999';
    debugBtn.addEventListener('click', () => {
        console.log('调试按钮被点击');
        debugTest();
    });

    document.body.appendChild(debugBtn);
    console.log('脚本初始化完成');
}

// 调试函数
export function debugTest() {
    const debugValue = Math.random();
    console.debug('[DEBUG] 当前值:', debugValue);
    return debugValue;
}

// 自动初始化
init();