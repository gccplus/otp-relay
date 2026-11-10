# Windows 客户端

Windows 客户端与当前 Mac 客户端使用同一云端协议和 Android 应用，提供：

- Windows 托盘常驻与点击展开验证码面板
- 托盘面板固定为紧凑宽度，并在显示时自动修复最大化、吸附和异常页面缩放
- 扫描二维码配对、电脑端二次确认
- P-256 ECDH、HKDF-SHA256、AES-256-GCM 端到端解密
- WebSocket 实时接收、心跳检测、断线指数退避重连及离线补发
- 新验证码默认自动复制，可在设置中关闭
- 面板内 `Ctrl + Shift + C` 复制当前展开的验证码
- 最近 24 小时验证码历史、开机自启、解除配对
- 使用 Windows DPAPI（Electron `safeStorage`）加密保存私钥、凭证和历史

协议为兼容 V1 保留了 `macPublicKey`、`macDeviceId`、`/v1/mac/stream` 等字段名；
这些字段在 Windows 端表示“桌面接收端”，无需修改现有服务端。

## 开发运行

需要 Node.js 22 或更高版本：

```powershell
cd windows
npm ci
npm test
npm start
```

应用启动后常驻系统托盘。左键打开或收起验证码面板，右键可进入偏好设置或退出。
首次使用需在偏好设置中开始配对，并用现有 Android 客户端扫描二维码。

## 构建 Windows 安装包

建议在 Windows 10/11 x64 环境执行：

```powershell
cd windows
npm ci
npm test
npm run build:win
```

产物位于 `windows/dist/`，默认生成 Windows x64 的 NSIS 安装程序和免安装版。未配置 Windows
代码签名证书时，安装程序可以用于本地测试，但 Windows SmartScreen 可能显示未知
发布者提示；正式分发前应配置 Authenticode 代码签名。

如在 Apple Silicon Mac 上交叉构建，NSIS 的 x86_64 `makensis` 可能因本机未安装
Rosetta 而无法运行；可直接生成解压即用的 Windows x64 ZIP：

```bash
npm run build:win-zip
```

## 本地数据

本机状态位于 Electron 的 `userData` 目录。`secure-state.json` 只保存 DPAPI 加密后的
密文载荷；私钥、设备凭证及验证码历史不会以明文写入文件。解除配对会撤销云端凭证
并清除本机验证码历史，但保留本机长期私钥供下次配对使用，与 Mac 客户端行为一致。

如果状态文件损坏，或从其他 Windows 用户/电脑复制而来，DPAPI 将拒绝解密。客户端
会把原文件改名为 `secure-state.json.unreadable-*.bak` 后重建本机密钥，并提示重新
配对；不会直接删除无法解密的原文件。
