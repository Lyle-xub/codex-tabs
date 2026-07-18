import AppKit
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: AppModel
    @State private var featuresExpanded = true
    @State private var previewExpanded = false
    @State private var appearanceExpanded = false
    @State private var logsExpanded = false
    @State private var showingDonation = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollView {
                LazyVStack(spacing: 10) {
                    if let failure = model.failureMessage { failureCard(failure) }
                    settingsSection(
                        title: t("基础功能", "Features"),
                        icon: "switch.2",
                        isExpanded: $featuresExpanded
                    ) {
                        featureSettings
                    }
                    settingsSection(
                        title: t("悬浮预览", "Hover Preview"),
                        icon: "rectangle.and.text.magnifyingglass",
                        isExpanded: $previewExpanded
                    ) {
                        previewSettings
                    }
                    settingsSection(
                        title: t("外观", "Appearance"),
                        icon: "paintbrush",
                        isExpanded: $appearanceExpanded
                    ) {
                        appearanceSettings
                    }
                    settingsSection(
                        title: t("运行日志", "Runtime Log"),
                        icon: "text.alignleft",
                        isExpanded: $logsExpanded
                    ) {
                        logSettings
                    }
                    aboutCard
                }
                .padding(14)
            }
            Divider()
            footer
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .tint(.blue)
        .sheet(isPresented: $showingDonation) {
            DonationView()
                .environmentObject(model)
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in
            model.stop()
        }
    }

    private var header: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Image(nsImage: NSApp.applicationIconImage)
                    .resizable()
                    .interpolation(.high)
                    .frame(width: 42, height: 42)
                    .clipShape(RoundedRectangle(cornerRadius: 11))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Codex Tabs").font(.headline)
                    Text(t("任务标签管理器", "Task tab manager")).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                HStack(spacing: 6) {
                    Circle()
                        .fill(model.isRunning ? Color.green : Color.secondary.opacity(0.45))
                        .frame(width: 7, height: 7)
                    Text(model.serviceTitle)
                        .font(.caption.weight(.medium))
                }
                .padding(.horizontal, 9)
                .padding(.vertical, 6)
                .background(.quaternary, in: Capsule())
            }
            Button {
                model.isRunning ? model.stop() : model.start()
            } label: {
                Label(
                    model.isRunning ? t("停止 Codex Tabs", "Stop Codex Tabs") : t("启动 Codex Tabs", "Start Codex Tabs"),
                    systemImage: model.isRunning ? "stop.fill" : "play.fill"
                )
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding(16)
    }

    private var featureSettings: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(t("当前标签高亮", "Highlight active tab"), isOn: $model.settings.activeHighlight)
            Toggle(t("长按拖动排序", "Hold and drag to reorder"), isOn: $model.settings.enableDrag)
            Toggle(t("Control 数字快捷键", "Control-number shortcuts"), isOn: $model.settings.enableShortcuts)
            Toggle(t("允许右侧同窗任务", "Allow inline task panel"), isOn: $model.settings.enableInlinePanel)
            Toggle(t("侧栏折叠时显示纵向面板", "Show vertical panel when sidebar is collapsed"), isOn: $model.settings.showVerticalPanel)
            Toggle(t("目录预览出现时自动避让", "Hide panel for project preview"), isOn: $model.settings.autoHideDirectoryPreview)
        }
    }

    private var previewSettings: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(t("启用悬浮预览", "Enable hover preview"), isOn: $model.settings.showUsage)
                .fontWeight(.medium)
            Divider()
            Group {
                Toggle(t("任务标题", "Task title"), isOn: $model.settings.previewShowTitle)
                Toggle(t("运行状态与时长", "Run status and duration"), isOn: $model.settings.previewShowStatus)
                Toggle(t("当前工作步骤", "Current work step"), isOn: $model.settings.previewShowActivity)
                Toggle(t("累计 Token", "Total tokens"), isOn: $model.settings.previewShowTotalTokens)
                Toggle(t("输入与非缓存输入", "Input and uncached input"), isOn: $model.settings.previewShowInputTokens)
                Toggle(t("累计输出", "Total output"), isOn: $model.settings.previewShowOutputTokens)
                Toggle(t("缓存输入与命中率", "Cached input and hit rate"), isOn: $model.settings.previewShowCache)
                Toggle(t("当前上下文与使用率", "Current context and usage"), isOn: $model.settings.previewShowContext)
                Toggle(t("对话额度变化与账号额度", "Conversation and account quota"), isOn: $model.settings.previewShowQuota)
                Toggle(t("上下文进度条与说明", "Context progress and note"), isOn: $model.settings.previewShowProgressBar)
            }
            .disabled(!model.settings.showUsage)
            HStack {
                Spacer()
                Button(t("恢复默认", "Restore Defaults")) { model.resetPreviewContent() }
                    .controlSize(.small)
            }
        }
    }

    private var appearanceSettings: some View {
        VStack(alignment: .leading, spacing: 13) {
            Text(t("标签高亮", "Tab Highlight")).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            HexColorPicker(title: t("高亮颜色", "Highlight color"), hex: $model.settings.activeColor)
            ValueSlider(title: t("背景强度", "Background"), value: $model.settings.activeBackgroundOpacity, range: 0...0.4, displayMultiplier: 100, displaySuffix: "%", step: 0.01)
            ValueSlider(title: t("描边强度", "Border"), value: $model.settings.activeBorderOpacity, range: 0...1, displayMultiplier: 100, displaySuffix: "%", step: 0.01)
            ValueSlider(title: t("阴影强度", "Shadow"), value: $model.settings.activeShadowOpacity, range: 0...0.6, displayMultiplier: 100, displaySuffix: "%", step: 0.01)
            ValueSlider(title: t("标签圆角", "Tab corner radius"), value: $model.settings.tabRadius, range: 0...18, suffix: " px")
            Divider()
            Text(t("纵向任务面板", "Vertical Task Panel")).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            ValueSlider(title: t("背景透明度", "Background opacity"), value: $model.settings.panelOpacity, range: 0.65...1, displayMultiplier: 100, displaySuffix: "%", step: 0.01)
            ValueSlider(title: t("面板宽度", "Panel width"), value: $model.settings.verticalWidth, range: 140...320, suffix: " px")
            ValueSlider(title: t("顶部间距", "Top inset"), value: $model.settings.verticalTop, range: 44...180, suffix: " px")
            ValueSlider(title: t("底部间距", "Bottom inset"), value: $model.settings.verticalBottom, range: 0...120, suffix: " px")
            ValueSlider(title: t("面板圆角", "Panel corner radius"), value: $model.settings.verticalRadius, range: 0...28, suffix: " px")
            HStack {
                Spacer()
                Button(t("恢复默认外观", "Restore Appearance")) { model.resetAppearance() }
                    .controlSize(.small)
            }
        }
    }

    private var logSettings: some View {
        VStack(spacing: 10) {
            ScrollView {
                Text(model.log.isEmpty ? t("尚无运行日志。", "No runtime log yet.") : localizedLog)
                    .font(.system(.caption2, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, minHeight: 110, alignment: .topLeading)
                    .padding(10)
            }
            .frame(height: 140)
            .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 7))
            .overlay(RoundedRectangle(cornerRadius: 7).stroke(.separator))
            Button(t("打开配置目录", "Open Configuration Folder")) { model.openSupportFolder() }
                .frame(maxWidth: .infinity, alignment: .trailing)
                .controlSize(.small)
        }
    }

    private var footer: some View {
        HStack {
            Text(t("设置会在约 2 秒内同步到 Codex", "Settings sync to Codex in about 2 seconds"))
            Spacer()
            Text("v\(model.currentVersion)")
        }
        .font(.caption2)
        .foregroundStyle(.tertiary)
        .padding(.horizontal, 16)
        .padding(.vertical, 9)
    }

    private var localizedLog: String {
        guard model.settings.appLanguage == AppLanguage.english.rawValue else { return model.log }
        return model.log
            .replacingOccurrences(of: "已找到 Codex：", with: "Found Codex: ")
            .replacingOccurrences(of: "已连接 Codex：", with: "Connected to Codex: ")
            .replacingOccurrences(of: "注入器正在运行；按 Control-C 会移除标签栏，但不会退出 Codex。", with: "The injector is running. Control-C removes the tabs without quitting Codex.")
            .replacingOccurrences(of: "已注入顶部标签栏，识别到 ", with: "Injected the tab bar; detected ")
            .replacingOccurrences(of: " 个任务", with: " tasks")
            .replacingOccurrences(of: "重新注入失败：", with: "Reinjection failed: ")
            .replacingOccurrences(of: "用量同步失败：", with: "Usage sync failed: ")
            .replacingOccurrences(of: "页面连接失败：", with: "Page connection failed: ")
            .replacingOccurrences(of: "注入器已停止。", with: "The injector has stopped.")
    }

    private var aboutCard: some View {
        VStack(spacing: 13) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .interpolation(.high)
                .frame(width: 64, height: 64)
            VStack(spacing: 3) {
                Text("Codex Tabs").font(.headline)
                Text("\(t("版本", "Version")) \(model.currentVersion)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Text(t("为 Codex 提供标签页、状态预览与同窗任务管理。", "Tabs, status previews, and inline task management for Codex."))
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Divider()
            Picker(t("语言", "Language"), selection: $model.settings.appLanguage) {
                Text("中文").tag(AppLanguage.chinese.rawValue)
                Text("English").tag(AppLanguage.english.rawValue)
            }
            .pickerStyle(.segmented)
            Toggle(t("自动检查更新", "Automatically check for updates"), isOn: $model.settings.autoCheckUpdates)
                .onChange(of: model.settings.autoCheckUpdates) { _, enabled in
                    if enabled { model.checkForUpdates() }
                }
            updateRow
            Button {
                showingDonation = true
            } label: {
                Label(t("Donate · 支持开发", "Donate · Support Development"), systemImage: "heart.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.pink)
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(.quaternary.opacity(0.55), in: RoundedRectangle(cornerRadius: 13))
        .overlay(RoundedRectangle(cornerRadius: 13).stroke(.separator.opacity(0.55)))
    }

    @ViewBuilder
    private var updateRow: some View {
        switch model.updateState {
        case .idle:
            updateButton(t("检查更新", "Check for Updates"), icon: "arrow.clockwise") { model.checkForUpdates() }
        case .checking:
            HStack {
                ProgressView().controlSize(.small)
                Text(t("正在检查更新…", "Checking for updates…")).font(.caption).foregroundStyle(.secondary)
                Spacer()
            }
        case .current:
            HStack {
                Label(t("当前已是最新版本", "You’re up to date"), systemImage: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(.green)
                Spacer()
                Button(t("再次检查", "Check Again")) { model.checkForUpdates() }.controlSize(.small)
            }
        case let .available(version, _):
            updateButton(t("发现新版 v\(version)", "Version \(version) is available"), icon: "arrow.down.circle.fill") {
                model.openAvailableUpdate()
            }
        case let .failed(message):
            VStack(alignment: .leading, spacing: 6) {
                Text(message).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                updateButton(t("重新检查", "Try Again"), icon: "arrow.clockwise") { model.checkForUpdates() }
            }
        }
    }

    private func updateButton(
        _ title: String,
        icon: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
    }

    private func failureCard(_ message: String) -> some View {
        Label(message, systemImage: "exclamationmark.triangle.fill")
            .font(.caption)
            .foregroundStyle(.orange)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 9))
    }

    private func t(_ chinese: String, _ english: String) -> String {
        model.t(chinese, english)
    }

    private func settingsSection<Content: View>(
        title: String,
        icon: String,
        isExpanded: Binding<Bool>,
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        DisclosureGroup(isExpanded: isExpanded) {
            content()
                .padding(.top, 12)
        } label: {
            Label(title, systemImage: icon)
                .font(.subheadline.weight(.semibold))
        }
        .padding(12)
        .background(.quaternary.opacity(0.55), in: RoundedRectangle(cornerRadius: 11))
        .overlay(RoundedRectangle(cornerRadius: 11).stroke(.separator.opacity(0.55)))
    }
}

private struct DonationView: View {
    private enum PaymentMethod: String, CaseIterable, Identifiable {
        case alipay
        case wechat

        var id: String { rawValue }
    }

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var paymentMethod = PaymentMethod.alipay

    private var imageName: String {
        paymentMethod == .alipay ? "AlipayQR" : "WeChatQR"
    }

    private var paymentColor: Color {
        paymentMethod == .alipay
            ? Color(red: 22 / 255, green: 119 / 255, blue: 1)
            : Color(red: 7 / 255, green: 193 / 255, blue: 96 / 255)
    }

    var body: some View {
        VStack(spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(t("支持 Codex Tabs", "Support Codex Tabs"))
                        .font(.title3.weight(.semibold))
                    Text(t("选择一种方式支持后续开发", "Choose a way to support continued development"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.secondary)
                .accessibilityLabel(t("关闭", "Close"))
            }

            Picker(t("支付方式", "Payment Method"), selection: $paymentMethod) {
                Text(t("支付宝", "Alipay")).tag(PaymentMethod.alipay)
                Text(t("微信支付", "WeChat Pay")).tag(PaymentMethod.wechat)
            }
            .pickerStyle(.segmented)

            Group {
                if let image = bundledImage(named: imageName) {
                    Image(nsImage: image)
                        .resizable()
                        .interpolation(.high)
                        .aspectRatio(1, contentMode: .fit)
                } else {
                    ContentUnavailableView(
                        t("二维码不可用", "QR Code Unavailable"),
                        systemImage: "qrcode",
                        description: Text(t("请重新安装 Codex Tabs。", "Please reinstall Codex Tabs."))
                    )
                }
            }
            .frame(width: 310, height: 310)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(paymentColor.opacity(0.3)))

            Text(t("请使用对应 App 扫码", "Scan with the corresponding app"))
                .font(.caption)
                .foregroundStyle(.secondary)

            Divider()

            VStack(spacing: 8) {
                Text(t("也可以通过 Buy Me a Coffee 支持", "You can also support via Buy Me a Coffee"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button {
                    model.openDonate()
                } label: {
                    Label("buymeacoffee.com/lylexub", systemImage: "cup.and.saucer.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.orange)
            }
        }
        .padding(20)
        .frame(width: 400)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private func bundledImage(named name: String) -> NSImage? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "png") else { return nil }
        return NSImage(contentsOf: url)
    }

    private func t(_ chinese: String, _ english: String) -> String {
        model.t(chinese, english)
    }
}

private struct ValueSlider: View {
    let title: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    var suffix = ""
    var displayMultiplier = 1.0
    var displaySuffix: String? = nil
    var step = 1.0

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(title)
                Spacer()
                Text("\(Int((value * displayMultiplier).rounded()))\(displaySuffix ?? suffix)")
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            .font(.caption)
            Slider(value: Binding(
                get: { value },
                set: { newValue in
                    let quantized = (newValue / step).rounded() * step
                    value = min(range.upperBound, max(range.lowerBound, quantized))
                }
            ), in: range)
        }
    }
}

private struct HexColorPicker: View {
    let title: String
    @Binding var hex: String

    var body: some View {
        ColorPicker(title, selection: Binding(
            get: { Color(hexString: hex) },
            set: { hex = $0.hexString }
        ), supportsOpacity: false)
    }
}

private extension Color {
    init(hexString: String) {
        let cleaned = hexString.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        let value = UInt64(cleaned, radix: 16) ?? 0x2F80ED
        self.init(
            .sRGB,
            red: Double((value >> 16) & 0xff) / 255,
            green: Double((value >> 8) & 0xff) / 255,
            blue: Double(value & 0xff) / 255,
            opacity: 1
        )
    }

    var hexString: String {
        guard let color = NSColor(self).usingColorSpace(.sRGB) else { return "#2F80ED" }
        return String(
            format: "#%02X%02X%02X",
            Int((color.redComponent * 255).rounded()),
            Int((color.greenComponent * 255).rounded()),
            Int((color.blueComponent * 255).rounded())
        )
    }
}
