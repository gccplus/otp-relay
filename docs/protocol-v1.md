# OTP Relay Protocol V1

本文件是三端实现共用的协议约束；产品定义以 MVP PRD 为准。

## 配对二维码

二维码为 UTF-8 JSON：

```json
{
  "serviceBaseUrl": "https://relay.example.com",
  "pairingSessionId": "UUID",
  "claimSecret": "Base64URL",
  "macPublicKey": "Base64URL",
  "protocolVersion": 1
}
```

- `macPublicKey` 为 P-256 Key Agreement 公钥的 65 字节 ANSI X9.63 非压缩表示。
- `claimSecret` 单次有效，二维码和配对会话均在 5 分钟后过期。
- 正式客户端只接受 HTTPS 服务地址；HTTP 仅用于本机 Debug。

## 多电脑配对与投递

- 同一 Android 设备可以保存多条活跃配对；每台 Mac 或 Windows 电脑对应独立的 `pairingId`、电脑端公钥和两端凭证。
- 每台电脑仍只允许存在一条活跃配对，解除其中一台电脑不会影响其他电脑。
- 收到验证码后，Android 必须针对每条活跃配对分别生成临时密钥、`messageId`、nonce 和密文信封，再使用该配对的 Android 凭证上传。
- 密文信封只能投递给其 `pairingId` 对应的电脑，禁止在不同配对之间复用密文或凭证。
- V1 字段名中的 `mac*` 为兼容既有客户端保留，语义上同时适用于 Windows 电脑端。

## 明文载荷

验证码离开 Android 前的唯一明文业务结构：

```json
{
  "code": "482917",
  "source": "示例服务",
  "purpose": "登录",
  "receivedAt": "2026-07-27T10:30:00.000Z"
}
```

短信正文不属于协议字段，不得写入上传队列、客户端日志或云端。

## 加密

1. 每台电脑端长期保存自己的 P-256 私钥，二维码公开对应公钥。
2. Android 每条消息生成新的 P-256 临时密钥对。
3. 双方执行 ECDH。
4. HKDF-SHA256：
   - salt：`SHA-256(UTF8(pairingId))`
   - info：`UTF8("otp-relay-message-v1:{messageId}")`
   - 输出：32 字节
5. 使用随机 12 字节 nonce 和 AES-256-GCM 加密 UTF-8 JSON。
6. `ciphertext` 字段按 `ciphertext || 16-byte tag` 拼接后 Base64URL 编码。

AAD 必须是以下 UTF-8 字节，字段之间为一个 LF：

```text
{protocolVersion}\n{messageId}\n{pairingId}\n{expiresAt}
```

所有时间字段使用 UTC ISO 8601。生成 AAD 时必须直接使用信封中的 `expiresAt` 原始字符串，不得解析后重新格式化。

## 密文信封

```json
{
  "messageId": "UUID",
  "pairingId": "UUID",
  "protocolVersion": 1,
  "receivedAt": "2026-07-27T10:30:00.000Z",
  "expiresAt": "2026-07-27T10:35:00.000Z",
  "ephemeralPublicKey": "Base64URL",
  "nonce": "Base64URL",
  "ciphertext": "Base64URL"
}
```

- `messageId` 是上传、推送、补发和 ACK 的全链路幂等键。
- 客户端有效期固定为 5 分钟，服务端只可缩短、不可延长。
- Bearer 凭证只允许出现在 `Authorization` 请求头。
