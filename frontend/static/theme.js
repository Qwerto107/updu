// 在首次绘制前恢复主题；使用同源文件，兼容禁止内联脚本的安全策略。
try {
    document.documentElement.classList.toggle('light', localStorage.getItem('updu_theme') !== 'dark');
} catch {
    // 浏览器禁用存储时，保留 HTML 中的默认浅色主题。
}
