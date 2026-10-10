package api

// 新增语言时同时更新前端注册表；默认语言只允许已提供翻译的语言。
func isSupportedLanguage(value string) bool {
	return value == "en" || value == "zh-CN"
}
