# Android 客户端

## 构建环境

- Android Studio Meerkat 2024.3.1 或更高
- JDK 17
- Android SDK Platform 36
- Android SDK Build Tools 36.x

工程使用 `compileSdk = 36`、`targetSdk = 36`，对应 Android 16。打开 `android/` 后由 Android Studio 完成 Gradle 同步。

## 真机验证顺序

1. 安装 Debug APK。
2. 允许“接收短信”，确认系统权限列表中没有“读取短信”。
3. 在 Mac 或 Windows 端生成二维码并扫码，由该电脑确认设备；可重复此步骤添加多台电脑。
4. 先点击“发送测试消息”，确认所有已绑定电脑都收到各自的密文。
5. 再发送脱敏模拟验证码短信。
6. 最后使用低风险真实验证码验证锁屏、后台和重启场景。

Debug 版本允许连接局域网 HTTP 地址。Release 版本只接受 HTTPS。

## 多电脑日志与名称

- 一条验证码短信只生成一条日志，展开后可查看每台电脑的发送结果；部分电脑失败时显示“部分送达”。
- 在“已绑定电脑”中点击“改名”，可设置 1～32 个字符的手机端备注名称。改名不修改电脑系统名称，也不影响云端凭证和端到端加密密钥。
