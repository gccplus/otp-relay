import SwiftUI

private struct ContentHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

struct MenuView: View {
    @ObservedObject var model: AppModel
    var onSizeChange: ((CGSize) -> Void)?

    @State private var selectedCardId: String?
    @State private var latestCardId: String?
    @State private var listExpanded = false
    @State private var copiedCardId: String?

    private let headerHeight: CGFloat = 64
    private let contentVPadding: CGFloat = 36

    var body: some View {
        VStack(spacing: 0) {
            appHeader
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 16)

            Divider()

            mainContent
                .padding(.horizontal, 20)
                .padding(.vertical, 18)
        }
        .frame(width: 388)
        .contentShape(Rectangle())
        .onTapGesture {
            guard activeCardId != nil else { return }
            withAnimation(.easeInOut(duration: 0.18)) {
                selectedCardId = nil
            }
        }
        .background {
            Rectangle()
                .fill(.regularMaterial)
                .ignoresSafeArea()
        }
        .onPreferenceChange(ContentHeightKey.self) { height in
            guard height > 0 else { return }
            let total = headerHeight + 1 + contentVPadding + height + 6
            let clamped = min(max(total, 180), 600)
            onSizeChange?(CGSize(width: 388, height: clamped))
        }
        .onAppear {
            selectLatestCardIfNeeded()
        }
        .onChange(of: model.cards.map(\.id)) { ids in
            guard let firstId = ids.first else {
                selectedCardId = nil
                latestCardId = nil
                return
            }
            if latestCardId != firstId {
                latestCardId = firstId
                selectedCardId = firstId
            } else if !ids.contains(selectedCardId ?? "") {
                selectedCardId = firstId
            }
        }
    }

    private var appHeader: some View {
        HStack(spacing: 12) {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color.accentColor.opacity(0.12))
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(.separator.opacity(0.5))
                    Image(systemName: "ellipsis.rectangle")
                        .font(.body.weight(.medium))
                        .foregroundStyle(Color.accentColor)
                }
                .frame(width: 30, height: 30)

                Text("验证码同步")
                    .font(.headline)
            }

            Spacer(minLength: 12)

            HStack(spacing: 6) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 8, height: 8)
                Text(model.connectionState.label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(.quaternary, in: Capsule())
        }
    }

    @ViewBuilder
    private var mainContent: some View {
        switch model.connectionState {
        case .connected:
            codeListView
        case .reconnecting:
            statusOnlyView(
                icon: "arrow.triangle.2.circlepath",
                title: "正在重新连接",
                detail: "恢复后会继续接收新验证码"
            )
        case .unpaired:
            unpairedActionView
        case .creatingQR:
            creatingQRView
        case .waitingForAndroid:
            popoverQRPairingView
        case let .waitingForApproval(name):
            popoverApprovalView(name: name)
        case let .failed(message):
            statusOnlyView(
                icon: "exclamationmark.triangle",
                title: "暂时无法使用",
                detail: message
            )
        }
    }

    @ViewBuilder
    private var codeListView: some View {
        if model.cards.isEmpty {
            statusOnlyView(
                icon: "checkmark",
                title: "正在等待验证码",
                detail: "Android 收到验证码短信后\n会安全地显示在这里"
            )
        } else {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(displayedCards.enumerated()), id: \.element.id) {
                            index,
                            card in
                            if index > 0 {
                                Divider()
                            }

                            if card.id == activeCardId {
                                expandedCard(card, now: context.date)
                            } else {
                                compactCard(card, now: context.date)
                            }
                        }

                        if model.cards.count > 3 {
                            Divider()
                            Button {
                                withAnimation(.easeInOut(duration: 0.18)) {
                                    listExpanded.toggle()
                                    if !listExpanded {
                                        selectedCardId = model.cards.first?.id
                                    }
                                }
                            } label: {
                                HStack(spacing: 4) {
                                    Text(
                                        listExpanded
                                            ? "收起列表"
                                            : "展开另外 \(model.cards.count - 3) 条"
                                    )
                                    Image(
                                        systemName: listExpanded
                                            ? "chevron.up"
                                            : "chevron.down"
                                    )
                                }
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                            .padding(.vertical, 10)
                        }
                    }
                    .background {
                        GeometryReader { geo in
                            Color.clear
                                .preference(
                                    key: ContentHeightKey.self,
                                    value: geo.size.height
                                )
                        }
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture {
                    guard activeCardId != nil else { return }
                    withAnimation(.easeInOut(duration: 0.18)) {
                        selectedCardId = nil
                    }
                }
            }
        }
    }

    private func statusOnlyView(
        icon: String,
        title: String,
        detail: String
    ) -> some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Color.accentColor.opacity(0.1))
                Image(systemName: icon)
                    .font(.title3.weight(.medium))
                    .foregroundStyle(Color.accentColor)
            }
            .frame(width: 56, height: 56)

            Text(title)
                .font(.headline)

            Text(detail)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .background {
            GeometryReader { geo in
                Color.clear
                    .preference(key: ContentHeightKey.self, value: geo.size.height)
            }
        }
    }

    private var unpairedActionView: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(Color.accentColor.opacity(0.1))
                Image(systemName: "iphone.and.arrow.forward")
                    .font(.title3.weight(.medium))
                    .foregroundStyle(Color.accentColor)
            }
            .frame(width: 56, height: 56)

            Text("尚未配对")
                .font(.headline)

            Text("配对 Android 手机后\n自动同步验证码到本机")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            Button("开始配对") {
                model.preparePairing()
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background {
            GeometryReader { geo in
                Color.clear
                    .preference(key: ContentHeightKey.self, value: geo.size.height)
            }
        }
    }

    private var creatingQRView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.2)

            Text("正在生成配对二维码...")
                .font(.headline)

            Text("请稍候")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .background {
            GeometryReader { geo in
                Color.clear
                    .preference(key: ContentHeightKey.self, value: geo.size.height)
            }
        }
    }

    private var popoverQRPairingView: some View {
        VStack(spacing: 12) {
            Text("扫描二维码配对")
                .font(.headline)

            Group {
                if let image = model.qrImage {
                    Image(nsImage: image)
                        .interpolation(.none)
                        .resizable()
                } else {
                    ProgressView()
                }
            }
            .frame(width: 140, height: 140)
            .padding(10)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 10))
            .overlay {
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(.separator.opacity(0.5))
            }

            HStack(spacing: 7) {
                Circle()
                    .fill(.green)
                    .frame(width: 7, height: 7)
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
            .buttonStyle(.plain)
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background {
            GeometryReader { geo in
                Color.clear
                    .preference(key: ContentHeightKey.self, value: geo.size.height)
            }
        }
    }

    private func popoverApprovalView(name: String) -> some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Color.accentColor.opacity(0.1))
                Image(systemName: "iphone.gen3")
                    .font(.title3.weight(.medium))
                    .foregroundStyle(Color.accentColor)
            }
            .frame(width: 56, height: 56)

            Text("确认配对")
                .font(.headline)

            Text(name)
                .fontWeight(.medium)

            Text("该设备识别到的验证码将\n端到端加密发送至本机")
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
        .padding(.vertical, 8)
        .background {
            GeometryReader { geo in
                Color.clear
                    .preference(key: ContentHeightKey.self, value: geo.size.height)
            }
        }
    }

    private func expandedCard(_ card: OtpCard, now: Date) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(card.source)
                    .fontWeight(.medium)
                    .lineLimit(1)
                Spacer()
                Text(relativeTime(since: card.receivedAt, now: now))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }

            HStack(spacing: 16) {
                Text(displayCode(card.code))
                    .font(.system(size: 28, weight: .medium, design: .monospaced))
                    .tracking(1.6)
                    .textSelection(.enabled)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)

                Spacer(minLength: 8)

                Text("⌘ ⇧ C")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(
                        .quaternary,
                        in: RoundedRectangle(cornerRadius: 6)
                    )

                Button(copiedCardId == card.id ? "已复制" : "复制") {
                    model.copy(card)
                    copiedCardId = card.id
                    Task {
                        try? await Task.sleep(for: .seconds(1.5))
                        if copiedCardId == card.id {
                            copiedCardId = nil
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut("c", modifiers: [.command, .shift])
            }
            .padding(.top, 24)
            .padding(.bottom, 16)
        }
        .padding(.leading, 12)
        .padding(.top, 18)
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(Color.accentColor.opacity(0.72))
                .frame(width: 3)
                .padding(.vertical, 14)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            withAnimation(.easeInOut(duration: 0.18)) {
                selectedCardId = nil
            }
        }
    }

    private func compactCard(_ card: OtpCard, now: Date) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.18)) {
                selectedCardId = card.id
            }
        } label: {
            HStack(spacing: 12) {
                Text(card.source)
                    .fontWeight(.medium)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .frame(width: 92, alignment: .leading)

                Text(displayCode(card.code))
                    .font(.system(.body, design: .monospaced, weight: .medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                Spacer(minLength: 6)

                Text(relativeTime(since: card.receivedAt, now: now))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .lineLimit(1)
            }
            .contentShape(Rectangle())
            .padding(.vertical, 11)
        }
        .buttonStyle(.plain)
    }

    private var statusColor: Color {
        switch model.connectionState {
        case .connected:
            return .green
        case .failed:
            return .red
        case .reconnecting:
            return .orange
        default:
            return .secondary
        }
    }

    private var activeCardId: String? {
        let ids = Set(model.cards.map(\.id))
        if let selectedCardId, ids.contains(selectedCardId) {
            return selectedCardId
        }
        return nil
    }

    private var displayedCards: [OtpCard] {
        listExpanded ? model.cards : Array(model.cards.prefix(3))
    }

    private func selectLatestCardIfNeeded() {
        guard let firstId = model.cards.first?.id else { return }
        latestCardId = firstId
        if selectedCardId == nil {
            selectedCardId = firstId
        }
    }

    private func relativeTime(since date: Date, now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        switch seconds {
        case 0..<10:
            return "刚刚"
        case 10..<60:
            return "\(seconds)秒前"
        case 60..<3_600:
            return "\(seconds / 60)分钟前"
        default:
            return "\(seconds / 3_600)小时前"
        }
    }

    private func displayCode(_ value: String) -> String {
        let compact = value.replacingOccurrences(of: " ", with: "")
        guard compact.allSatisfy(\.isNumber) else { return compact }
        switch compact.count {
        case 6:
            return "\(compact.prefix(3)) \(compact.suffix(3))"
        case 8:
            return compact.enumerated().reduce(into: "") { result, pair in
                if pair.offset > 0, pair.offset.isMultiple(of: 4) {
                    result.append(" ")
                }
                result.append(pair.element)
            }
        default:
            return compact
        }
    }

    private func remainingTime(until date: Date, now: Date) -> String {
        let seconds = max(0, Int(date.timeIntervalSince(now)))
        return String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }
}
