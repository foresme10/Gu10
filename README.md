# Surge AI 解锁检测模块

用于检测当前 Surge 实际出口是否可以访问：

- ChatGPT Web
- Google Gemini Web

模块提供 iOS 信息面板，点击刷新即可重新检测；面板打开时每 10 分钟自动刷新一次。检测不需要 MITM，不读取账号、Cookie 或 Token，也不会修改策略组。

## 安装

1. 将 `AI-Unlock-Check.sgmodule` 和 `AI-Unlock-Check.js` 放到当前 Surge 配置文件所在目录，两个文件必须保持同级。
2. 在 Surge 的“模块”中添加本地模块 `AI-Unlock-Check.sgmodule`，然后启用。
3. 回到 Surge 首页，在策略选择视图底部找到“AI 解锁检测”面板，点击刷新按钮运行检测。

脚本请求会遵循现有 Surge 规则：ChatGPT 与 Gemini 如果被分流到不同策略组，检测结果也会分别反映各自的真实出口。

## 结果说明

- `✅ 已解锁`：服务网页返回有效响应，且未发现地区限制提示。
- `❌ 未解锁`：检测到地区限制、HTTP 403/451，或 ChatGPT 出口不在官方支持地区列表内。
- `⚠️ 可用但限流`：服务返回 HTTP 429，通常表示出口可访问但当前受到速率限制。
- `⚠️ 网络错误/检测异常`：超时、DNS、TLS 或非预期响应；这不等同于确定的地区封锁。

Gemini 的网页结构会经常变化，因此脚本不依赖单一易失效的 HTML 地区标记；状态以实际 Web 应用响应为主，地区码仅在 Google 返回可识别标记时显示。

## macOS

信息面板是 Surge iOS 功能，所以模块声明为 iOS。若要在 Surge Mac 上使用，可把 `AI-Unlock-Check.js` 添加为 `generic` 脚本并手动运行，结果会通过通知与脚本日志显示：

```ini
[Script]
AI-Unlock-Check = type=generic,timeout=20,engine=webview,script-path=AI-Unlock-Check.js
```

## 数据请求

脚本只访问以下官方服务地址：

- `https://chatgpt.com/`
- `https://chatgpt.com/cdn-cgi/trace`
- `https://gemini.google.com/?hl=en`

模块版本：1.0.0

