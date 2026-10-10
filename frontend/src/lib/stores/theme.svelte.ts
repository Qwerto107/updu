// 默认使用浅色主题；用户主动选择后，优先恢复浏览器保存的偏好。
type Theme = "dark" | "light";

function createThemeStore() {
    let theme = $state<Theme>("light");

    function init() {
        try {
            const stored = localStorage.getItem("updu_theme");
            theme = stored === "dark" ? "dark" : "light";
        } catch {
            // 浏览器限制存储时，仍能使用默认主题和页面内切换。
            theme = "light";
        }
        apply();
    }

    function apply() {
        if (typeof document !== "undefined") {
            document.documentElement.classList.toggle("light", theme === "light");
        }
    }

    function toggle() {
        theme = theme === "dark" ? "light" : "dark";
        try {
            localStorage.setItem("updu_theme", theme);
        } catch {
            // 存储失败不应阻止本次主题切换。
        }
        apply();
    }

    return {
        get current() {
            return theme;
        },
        init,
        toggle,
    };
}

export const themeStore = createThemeStore();
