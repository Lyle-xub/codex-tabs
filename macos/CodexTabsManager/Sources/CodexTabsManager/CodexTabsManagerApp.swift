import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
    }
}

@main
struct CodexTabsManagerApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel()

    var body: some Scene {
        MenuBarExtra {
            MenuBarPanel()
                .environmentObject(model)
        } label: {
            Image(nsImage: menuBarIcon)
                .accessibilityLabel("Codex Tabs")
        }
        .menuBarExtraStyle(.window)

        Settings {
            ContentView()
                .environmentObject(model)
                .frame(minWidth: 440, idealWidth: 480, minHeight: 500, idealHeight: 620)
        }
        .defaultSize(width: 480, height: 620)
    }

    private var menuBarIcon: NSImage {
        let image = Bundle.main.url(forResource: "MenuBarIcon", withExtension: "png")
            .flatMap(NSImage.init(contentsOf:))
            ?? NSApp.applicationIconImage
            ?? NSImage(systemSymbolName: "rectangle.3.group", accessibilityDescription: nil)
            ?? NSImage(size: NSSize(width: 18, height: 18))
        image.isTemplate = true
        image.size = NSSize(width: 18, height: 18)
        return image
    }
}

private struct MenuBarPanel: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 13) {
            header
            statusCard
            startButton
            quickControls
            Divider()
            footer
        }
        .padding(14)
        .frame(width: 300)
        .background(.regularMaterial)
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .interpolation(.high)
                .frame(width: 36, height: 36)
                .clipShape(RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 1) {
                Text("Codex Tabs").font(.headline)
                Text(t("任务标签管理器", "Task tab manager")).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            Circle()
                .fill(model.isRunning ? Color.green : Color.secondary.opacity(0.45))
                .frame(width: 8, height: 8)
                .shadow(color: model.isRunning ? .green.opacity(0.35) : .clear, radius: 3)
        }
    }

    private var statusCard: some View {
        HStack(spacing: 10) {
            Image(systemName: model.isRunning ? "checkmark.circle.fill" : "pause.circle.fill")
                .font(.system(size: 17))
                .foregroundStyle(model.isRunning ? .green : .secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(model.serviceTitle)
                    .font(.subheadline.weight(.semibold))
                Text(statusDescription)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer()
        }
        .padding(10)
        .background(.quaternary.opacity(0.75), in: RoundedRectangle(cornerRadius: 10))
    }

    private var statusDescription: String {
        if let failure = model.failureMessage { return failure }
        return model.isRunning
            ? t("标签和用量状态正在同步", "Tabs and usage are syncing")
            : t("启动后自动连接 Codex", "Connect to Codex when started")
    }

    private var startButton: some View {
        Button {
            model.isRunning ? model.stop() : model.start()
        } label: {
            Label(
                model.isRunning ? t("停止同步", "Stop Syncing") : t("启动 Codex Tabs", "Start Codex Tabs"),
                systemImage: model.isRunning ? "stop.fill" : "play.fill"
            )
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
    }

    private var quickControls: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(t("快捷开关", "Quick Controls"))
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            HStack(spacing: 7) {
                QuickSetting(
                    title: t("高亮", "Highlight"),
                    icon: "cursorarrow.click.2",
                    isOn: $model.settings.activeHighlight
                )
                QuickSetting(
                    title: t("预览", "Preview"),
                    icon: "rectangle.and.text.magnifyingglass",
                    isOn: $model.settings.showUsage
                )
                QuickSetting(
                    title: t("纵向栏", "Side Panel"),
                    icon: "sidebar.left",
                    isOn: $model.settings.showVerticalPanel
                )
            }
        }
    }

    private var footer: some View {
        HStack(spacing: 8) {
            SettingsLink {
                Label(t("完整设置", "Settings"), systemImage: "slider.horizontal.3")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            Button {
                model.stop()
                NSApp.terminate(nil)
            } label: {
                Image(systemName: "power")
                    .frame(width: 20)
            }
            .buttonStyle(.bordered)
            .help(t("退出 Codex Tabs", "Quit Codex Tabs"))
        }
        .controlSize(.regular)
    }

    private func t(_ chinese: String, _ english: String) -> String {
        model.t(chinese, english)
    }
}

private struct QuickSetting: View {
    @EnvironmentObject private var model: AppModel
    let title: String
    let icon: String
    @Binding var isOn: Bool

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            VStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .medium))
                Text(title).font(.caption2.weight(.medium))
            }
            .foregroundStyle(isOn ? Color.blue : Color.secondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .background(
                isOn ? Color.blue.opacity(0.11) : Color.secondary.opacity(0.07),
                in: RoundedRectangle(cornerRadius: 9)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 9)
                    .stroke(isOn ? Color.blue.opacity(0.28) : Color.clear)
            )
        }
        .buttonStyle(.plain)
        .help(isOn ? model.t("已开启", "On") : model.t("已关闭", "Off"))
    }
}
