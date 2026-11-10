import AppKit
import SwiftUI

private struct SettingsContentSizeKey: PreferenceKey {
    static let defaultValue: CGSize = .zero
    static func reduce(value: inout CGSize, nextValue: () -> CGSize) {
        value = nextValue()
    }
}

struct SettingsView: View {
    @ObservedObject var model: AppModel
    var onContentSizeChange: ((CGSize) -> Void)?
    @State private var showingUnpairConfirmation = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                pairingSection

                Divider()
                settingsToggleRow(
                    title: "自动复制验证码",
                    detail: "收到新验证码时自动复制到剪贴板",
                    isOn: Binding(
                        get: { model.autoCopyEnabled },
                        set: { model.setAutoCopyEnabled($0) }
                    )
                )

                Divider()
                settingsToggleRow(
                    title: "开机自动启动",
                    detail: model.isPaired
                        ? "登录 Mac 后保持同步"
                        : "登录 Mac 后保持应用运行",
                    isOn: Binding(
                        get: { model.launchAtLoginEnabled },
                        set: { model.setLaunchAtLoginEnabled($0) }
                    )
                )

                Divider()
                serverSettingsRow

                Divider()
                versionRow

                if showingUnpairConfirmation {
                    pairingActionConfirmation
                        .padding(.top, 14)
                }
            }
            .padding(24)
            .background {
                GeometryReader { geometry in
                    Color.clear
                        .preference(
                            key: SettingsContentSizeKey.self,
                            value: geometry.size
                        )
                }
            }
            .onPreferenceChange(SettingsContentSizeKey.self) { size in
                onContentSizeChange?(size)
            }
            .background(HiddenVerticalScrollIndicator())
        }
        .frame(minWidth: 430)
        .background(Color(nsColor: .windowBackgroundColor))
        .scrollIndicators(.hidden)
    }

    @ViewBuilder
    private var pairingSection: some View {
        if model.isPaired {
            pairedDeviceRow
        } else {
            switch model.connectionState {
            case .creatingQR, .waitingForAndroid:
                qrPairingView
            case let .waitingForApproval(name):
                approvalView(name: name)
            default:
                unpairedDeviceRow
            }
        }
    }

    private var pairedDeviceRow: some View {
        HStack(spacing: 12) {
            phoneIcon
            VStack(alignment: .leading, spacing: 3) {
                Text("已配对设备")
                Text(model.pairedDeviceName ?? "Android 手机")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("解除配对") {
                showingUnpairConfirmation = true
            }
        }
        .frame(minHeight: 62)
    }

    private var unpairedDeviceRow: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                phoneIcon
                VStack(alignment: .leading, spacing: 3) {
                    Text("配对设备")
                    Text(connectionFailureText ?? "尚未连接 Android 手机")
                        .font(.caption)
                        .foregroundStyle(
                            connectionFailureText == nil
                                ? Color.secondary
                                : Color.red
                        )
                }
                Spacer()
                Button("开始配对") {
                    model.preparePairing()
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .frame(minHeight: 62)
    }

    private var qrPairingView: some View {
        VStack(spacing: 12) {
            Text("连接 Android 手机")
                .font(.headline)
            Text("打开 Android 客户端，扫描下方二维码")
                .font(.caption)
                .foregroundStyle(.secondary)

            Group {
                if let image = model.qrImage {
                    Image(nsImage: image)
                        .interpolation(.none)
                        .resizable()
                } else {
                    ProgressView()
                }
            }
            .frame(width: 180, height: 180)
            .padding(14)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 12))
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(.separator.opacity(0.5))
            }

            HStack(spacing: 7) {
                Circle()
                    .fill(.green)
                    .frame(width: 8, height: 8)
                Text("\(model.activeServerDomain) · 加密连接")
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            if let expiresAt = model.pairingExpiresAt {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(
                        "二维码 \(remainingTime(until: expiresAt, now: context.date)) 后失效"
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                }
            }

            Button("重新生成") {
                model.preparePairing()
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }

    private func approvalView(name: String) -> some View {
        VStack(spacing: 12) {
            phoneIcon
                .scaleEffect(1.5)
                .padding(8)
            Text("确认配对")
                .font(.headline)
            Text(name)
                .fontWeight(.medium)
            Text("配对后，该手机识别到的验证码将端到端加密发送至本机")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            HStack(spacing: 12) {
                Button("拒绝", role: .cancel) {
                    model.rejectPairing()
                }
                Button("允许配对") {
                    model.approvePairing()
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
    }

    private var serverSettingsRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("云端服务")
                    Text(
                        model.isPaired
                            ? "端到端加密；解除配对后可修改"
                            : "仅填写域名，不包含协议或路径"
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                Spacer()

                if model.isPaired {
                    Text(model.activeServerDomain)
                        .foregroundStyle(.secondary)
                } else {
                    TextField(
                        "otp.example.com",
                        text: Binding(
                            get: { model.serverDomain },
                            set: { model.setServerDomain($0) }
                        )
                    )
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 170)
                    .multilineTextAlignment(.trailing)
                }
            }

            if !model.isPaired, let error = model.serverDomainError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .frame(minHeight: 62)
    }

    private var phoneIcon: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(Color.accentColor.opacity(0.12))
            Image(systemName: "iphone")
        }
        .frame(width: 32, height: 32)
    }

    private var versionRow: some View {
        HStack {
            Text("版本")
            Spacer()
            Text(versionDescription)
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
        .frame(minHeight: 62)
    }

    private var versionDescription: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
            ?? "未知"
    }

    private func settingsToggleRow(
        title: String,
        detail: String,
        isOn: Binding<Bool>
    ) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Toggle(title, isOn: isOn)
                .labelsHidden()
                .toggleStyle(.switch)
        }
        .frame(minHeight: 62)
    }

    private var pairingActionConfirmation: some View {
        VStack(spacing: 10) {
            Divider()
            Text("确认解除配对？")
                .fontWeight(.medium)
            Text("Android 将停止同步，本机和云端配对凭证会立即失效")
            .font(.caption)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)

            HStack(spacing: 12) {
                Button("取消") {
                    showingUnpairConfirmation = false
                }
                Button(
                    "确认解除",
                    role: .destructive
                ) {
                    showingUnpairConfirmation = false
                    model.unpair()
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
            }
        }
    }

    private var connectionFailureText: String? {
        if case let .failed(message) = model.connectionState {
            return message
        }
        return nil
    }

    private func remainingTime(until date: Date, now: Date) -> String {
        let seconds = max(0, Int(date.timeIntervalSince(now)))
        return String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }
}

private struct HiddenVerticalScrollIndicator: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        view.hideVerticalScrollIndicator()
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        nsView.hideVerticalScrollIndicator()
    }
}

private extension NSView {
    func hideVerticalScrollIndicator() {
        DispatchQueue.main.async { [weak self] in
            var current = self?.superview
            while let view = current {
                if let scrollView = view as? NSScrollView {
                    scrollView.hasVerticalScroller = false
                    scrollView.verticalScroller?.isHidden = true
                    return
                }
                current = view.superview
            }
        }
    }
}
