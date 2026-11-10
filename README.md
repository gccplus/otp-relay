# OTP Relay · 安卓验证码同步工具

将 Android 新收到的短信验证码同步到 macOS 菜单栏或 Windows 托盘。中转服务可自托管。一台手机可以绑定多台电脑，分别加密投递，也可以单独解除配对。

## 开始使用

1. 准备自己的 HTTPS 域名，按[服务端部署指南](server/README.md)启动中转服务。桌面客户端使用 `https://你的域名/otp-relay`，设置时只需填写域名。
2. 按 [Android 构建指南](android/README.md)安装客户端，授权接收短信。
3. 启动 [macOS 客户端](mac/README.md)或 [Windows 客户端](windows/README.md)，在偏好设置中填写服务域名并生成配对二维码。
4. 用 Android 客户端扫码，在电脑上确认配对，再从手机发送测试消息。添加其他电脑时重复配对流程。

`otp.example.com` 是配置示例。桌面客户端首次使用时需换成自己的域名。

## 开发与构建

| 目录 | 用途 | 验证命令（在相应目录执行） |
| --- | --- | --- |
| [server](server/README.md) | Node.js 中转服务。生产部署使用 PostgreSQL 和 Redis | `npm ci`、`npm run typecheck`、`npm test` |
| [android](android/README.md) | 接收短信、识别验证码并加密发送 | `./gradlew :app:testDebugUnitTest :app:assembleDebug` |
| [mac](mac/README.md) | macOS 菜单栏应用 | `swift test` |
| [windows](windows/README.md) | Electron 托盘应用 | `npm ci`、`npm test` |

服务端本地开发使用 Node.js 22 或更高版本。在 `server/` 执行 `npm ci` 和 `npm run dev`，默认启动内存模式，监听 `http://127.0.0.1:39002`。完整的桌面配对流程使用 HTTPS 域名。

## 数据与权限

Android 客户端通过接收短信权限处理新到短信，在手机上识别验证码。服务端只中转加密后的验证码载荷，待投递密文最多保留 5 分钟。桌面端解密后在本机保留最近 24 小时的验证码记录，并可在设置中调整自动复制。配对、加密、投递和解绑细节见 [V1 协议](docs/protocol-v1.md)。
