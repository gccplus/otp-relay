import AppKit
import Combine
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private var popover: NSPopover?
    private var settingsWindowController: NSWindowController?
    private var model: AppModel?
    private var autoHideTask: Task<Void, Never>?
    private var cancellables = Set<AnyCancellable>()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.accessory)

        let model = AppModel()
        self.model = model

        let workspaceNotifications = NSWorkspace.shared.notificationCenter
        workspaceNotifications.addObserver(
            self,
            selector: #selector(systemWillSleep(_:)),
            name: NSWorkspace.willSleepNotification,
            object: nil
        )
        workspaceNotifications.addObserver(
            self,
            selector: #selector(systemDidWake(_:)),
            name: NSWorkspace.didWakeNotification,
            object: nil
        )

        let popover = NSPopover()
        popover.behavior = .transient
        popover.animates = true
        let menuView = MenuView(model: model) { [weak popover] newSize in
            guard let popover else { return }
            let clampedHeight = min(max(newSize.height, 180), 600)
            guard clampedHeight != popover.contentSize.height else { return }
            popover.contentSize = NSSize(width: 388, height: clampedHeight)
        }
        popover.contentViewController = NSHostingController(
            rootView: menuView
        )
        self.popover = popover

        let statusItem = NSStatusBar.system.statusItem(
            withLength: NSStatusItem.squareLength
        )
        if let button = statusItem.button {
            button.image = NSImage(
                systemSymbolName: "ellipsis.rectangle",
                accessibilityDescription: "验证码同步"
            )
            button.image?.isTemplate = true
            button.toolTip = "验证码同步；右键打开设置或退出"
            button.target = self
            button.action = #selector(handleStatusItemClick(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        self.statusItem = statusItem

        model.$lastMessageReceivedAt
            .receive(on: DispatchQueue.main)
            .sink { [weak self] date in
                guard let self, date != nil else { return }
                self.showPopoverForNewMessage()
            }
            .store(in: &cancellables)
    }

    func applicationWillTerminate(_ notification: Notification) {
        NSWorkspace.shared.notificationCenter.removeObserver(self)
    }

    @objc
    private func systemWillSleep(_ notification: Notification) {
        model?.prepareForSystemSleep()
    }

    @objc
    private func systemDidWake(_ notification: Notification) {
        model?.resumeAfterSystemWake()
    }

    @objc
    private func handleStatusItemClick(_ sender: NSStatusBarButton) {
        guard let event = NSApplication.shared.currentEvent else { return }
        if event.type == .rightMouseUp {
            showContextMenu(event: event, from: sender)
        } else {
            togglePopover(from: sender)
        }
    }

    private func togglePopover(from button: NSStatusBarButton) {
        guard let popover else { return }
        if popover.isShown {
            cancelAutoHide()
            popover.performClose(nil)
        } else {
            showPopover(from: button)
        }
    }

    private func showPopover(
        from button: NSStatusBarButton,
        activate: Bool = true
    ) {
        guard let popover else { return }
        if activate {
            NSApplication.shared.activate(ignoringOtherApps: true)
        }
        popover.show(
            relativeTo: button.bounds,
            of: button,
            preferredEdge: .minY
        )
        DispatchQueue.main.async {
            popover.contentViewController?.view.window?.makeKey()
        }
    }

    private func showPopoverForNewMessage() {
        guard let popover, let button = statusItem?.button else { return }
        cancelAutoHide()

        if !popover.isShown {
            showPopover(from: button, activate: false)
        }

        autoHideTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(8))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                self?.popover?.performClose(nil)
            }
        }
    }

    private func cancelAutoHide() {
        autoHideTask?.cancel()
        autoHideTask = nil
    }

    private func showContextMenu(
        event: NSEvent,
        from button: NSStatusBarButton
    ) {
        popover?.performClose(nil)

        let menu = NSMenu()
        menu.minimumWidth = 190

        let quitItem = NSMenuItem(
            title: "退出",
            action: #selector(quitApplication),
            keyEquivalent: ""
        )
        quitItem.target = self
        menu.addItem(quitItem)

        let openPanelItem = NSMenuItem(
            title: "打开验证码面板",
            action: #selector(openVerificationPanel),
            keyEquivalent: ""
        )
        openPanelItem.target = self
        menu.addItem(openPanelItem)

        menu.addItem(.separator())

        let settingsItem = NSMenuItem(
            title: "偏好设置",
            action: #selector(showSettings),
            keyEquivalent: ""
        )
        settingsItem.target = self
        menu.addItem(settingsItem)
        NSMenu.popUpContextMenu(menu, with: event, for: button)
    }

    @objc
    private func openVerificationPanel() {
        guard let button = statusItem?.button, let popover else { return }
        DispatchQueue.main.async {
            popover.show(
                relativeTo: button.bounds,
                of: button,
                preferredEdge: .minY
            )
        }
    }

    @objc
    private func showSettings() {
        guard let model else { return }

        if settingsWindowController == nil {
            let settingsView = SettingsView(model: model) { [weak self] newSize in
                guard let self, let window = self.settingsWindowController?.window else { return }
                let clampedHeight = min(max(newSize.height, 280), 700)
                let clampedWidth = max(newSize.width, 430)
                let proposed = NSSize(width: clampedWidth, height: clampedHeight)
                guard proposed != window.contentRect(forFrameRect: window.frame).size else { return }
                window.setContentSize(proposed)
            }
            let hostingController = NSHostingController(
                rootView: settingsView
            )
            let window = NSWindow(contentViewController: hostingController)
            window.title = "验证码同步设置"
            window.styleMask = [.titled, .closable, .miniaturizable]
            window.setContentSize(NSSize(width: 430, height: 360))
            window.contentMinSize = NSSize(width: 430, height: 280)
            window.isReleasedWhenClosed = false
            window.center()
            settingsWindowController = NSWindowController(window: window)
        }

        NSApplication.shared.activate(ignoringOtherApps: true)
        settingsWindowController?.showWindow(nil)
        settingsWindowController?.window?.makeKeyAndOrderFront(nil)
    }

    @objc
    private func quitApplication() {
        guard let model else { return }
        guard model.isPaired else {
            model.exitApplication()
            return
        }

        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = "确认退出应用？"
        alert.informativeText =
            "配对信息已缓存，下次启动无需重新配对。\n如需解绑，请在设置中手动操作。"
        alert.addButton(withTitle: "退出")
        alert.addButton(withTitle: "取消")

        NSApplication.shared.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertFirstButtonReturn {
            model.exitApplication()
        }
    }
}
