import AppKit
import Foundation

struct TabSettings: Codable, Equatable {
    var appLanguage = AppLanguage.chinese.rawValue
    var showUsage = true
    var enableShortcuts = true
    var enableDrag = true
    var enableInlinePanel = true
    var autoHideDirectoryPreview = true
    var showVerticalPanel = true
    var activeHighlight = true
    var activeColor = "#2F80ED"
    var activeBackgroundOpacity = 0.07
    var activeBorderOpacity = 0.38
    var activeShadowOpacity = 0.12
    var tabRadius = 7.0
    var panelOpacity = 1.0
    var verticalWidth = 176.0
    var verticalTop = 52.0
    var verticalBottom = 12.0
    var verticalRadius = 11.0
    var previewShowTitle = true
    var previewShowStatus = true
    var previewShowActivity = true
    var previewShowTotalTokens = true
    var previewShowInputTokens = true
    var previewShowOutputTokens = true
    var previewShowCache = true
    var previewShowContext = true
    var previewShowQuota = true
    var previewShowProgressBar = true
    var autoCheckUpdates = true

    static let defaults = TabSettings()
}

extension TabSettings {
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let defaults = Self.defaults
        appLanguage = try values.decodeIfPresent(String.self, forKey: .appLanguage) ?? defaults.appLanguage
        showUsage = try values.decodeIfPresent(Bool.self, forKey: .showUsage) ?? defaults.showUsage
        enableShortcuts = try values.decodeIfPresent(Bool.self, forKey: .enableShortcuts) ?? defaults.enableShortcuts
        enableDrag = try values.decodeIfPresent(Bool.self, forKey: .enableDrag) ?? defaults.enableDrag
        enableInlinePanel = try values.decodeIfPresent(Bool.self, forKey: .enableInlinePanel) ?? defaults.enableInlinePanel
        autoHideDirectoryPreview = try values.decodeIfPresent(Bool.self, forKey: .autoHideDirectoryPreview) ?? defaults.autoHideDirectoryPreview
        showVerticalPanel = try values.decodeIfPresent(Bool.self, forKey: .showVerticalPanel) ?? defaults.showVerticalPanel
        activeHighlight = try values.decodeIfPresent(Bool.self, forKey: .activeHighlight) ?? defaults.activeHighlight
        activeColor = try values.decodeIfPresent(String.self, forKey: .activeColor) ?? defaults.activeColor
        activeBackgroundOpacity = try values.decodeIfPresent(Double.self, forKey: .activeBackgroundOpacity) ?? defaults.activeBackgroundOpacity
        activeBorderOpacity = try values.decodeIfPresent(Double.self, forKey: .activeBorderOpacity) ?? defaults.activeBorderOpacity
        activeShadowOpacity = try values.decodeIfPresent(Double.self, forKey: .activeShadowOpacity) ?? defaults.activeShadowOpacity
        tabRadius = try values.decodeIfPresent(Double.self, forKey: .tabRadius) ?? defaults.tabRadius
        panelOpacity = try values.decodeIfPresent(Double.self, forKey: .panelOpacity) ?? defaults.panelOpacity
        verticalWidth = try values.decodeIfPresent(Double.self, forKey: .verticalWidth) ?? defaults.verticalWidth
        verticalTop = try values.decodeIfPresent(Double.self, forKey: .verticalTop) ?? defaults.verticalTop
        verticalBottom = try values.decodeIfPresent(Double.self, forKey: .verticalBottom) ?? defaults.verticalBottom
        verticalRadius = try values.decodeIfPresent(Double.self, forKey: .verticalRadius) ?? defaults.verticalRadius
        previewShowTitle = try values.decodeIfPresent(Bool.self, forKey: .previewShowTitle) ?? defaults.previewShowTitle
        previewShowStatus = try values.decodeIfPresent(Bool.self, forKey: .previewShowStatus) ?? defaults.previewShowStatus
        previewShowActivity = try values.decodeIfPresent(Bool.self, forKey: .previewShowActivity) ?? defaults.previewShowActivity
        previewShowTotalTokens = try values.decodeIfPresent(Bool.self, forKey: .previewShowTotalTokens) ?? defaults.previewShowTotalTokens
        previewShowInputTokens = try values.decodeIfPresent(Bool.self, forKey: .previewShowInputTokens) ?? defaults.previewShowInputTokens
        previewShowOutputTokens = try values.decodeIfPresent(Bool.self, forKey: .previewShowOutputTokens) ?? defaults.previewShowOutputTokens
        previewShowCache = try values.decodeIfPresent(Bool.self, forKey: .previewShowCache) ?? defaults.previewShowCache
        previewShowContext = try values.decodeIfPresent(Bool.self, forKey: .previewShowContext) ?? defaults.previewShowContext
        previewShowQuota = try values.decodeIfPresent(Bool.self, forKey: .previewShowQuota) ?? defaults.previewShowQuota
        previewShowProgressBar = try values.decodeIfPresent(Bool.self, forKey: .previewShowProgressBar) ?? defaults.previewShowProgressBar
        autoCheckUpdates = try values.decodeIfPresent(Bool.self, forKey: .autoCheckUpdates) ?? defaults.autoCheckUpdates
    }
}

@MainActor
final class AppModel: ObservableObject {
    enum ServiceState: Equatable {
        case stopped
        case starting
        case running
        case failed(String)

        func title(language: String) -> String {
            switch self {
            case .stopped: return AppLocalization.text("未运行", "Stopped", language: language)
            case .starting: return AppLocalization.text("正在启动", "Starting", language: language)
            case .running: return AppLocalization.text("运行中", "Running", language: language)
            case .failed: return AppLocalization.text("需要处理", "Action needed", language: language)
            }
        }
    }

    enum UpdateState: Equatable {
        case idle
        case checking
        case current
        case available(version: String, url: URL)
        case failed(String)
    }

    @Published private(set) var serviceState: ServiceState = .stopped
    @Published private(set) var log = ""
    @Published private(set) var updateState: UpdateState = .idle
    @Published var settings: TabSettings {
        didSet { saveSettings() }
    }

    private var injector: Process?
    private var outputPipe: Pipe?
    private let supportDirectory: URL
    private let configURL: URL

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Codex Tabs", isDirectory: true)
        supportDirectory = base
        configURL = base.appendingPathComponent("config.json")
        settings = Self.loadSettings(from: configURL)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        Task { [weak self] in
            await Task.yield()
            guard let self,
                  !NSRunningApplication.runningApplications(
                    withBundleIdentifier: "com.openai.codex"
                  ).isEmpty,
                  self.existingDebugPort() != nil else { return }
            self.start()
        }
        Task { [weak self] in
            await Task.yield()
            guard let self, self.settings.autoCheckUpdates else { return }
            self.checkForUpdates(manual: false)
        }
    }

    var isRunning: Bool { injector?.isRunning == true }
    var serviceTitle: String { serviceState.title(language: settings.appLanguage) }

    var failureMessage: String? {
        if case let .failed(message) = serviceState { return message }
        return nil
    }

    func start() {
        guard injector?.isRunning != true else { return }
        saveSettings()

        guard let node = findNode() else {
            serviceState = .failed(t(
                "没有找到 Node.js 22 或更高版本。请先安装 Node.js，或把 node 放在 /opt/homebrew/bin 或 /usr/local/bin。",
                "Node.js 22 or later was not found. Install Node.js or place it in /opt/homebrew/bin or /usr/local/bin."
            ))
            return
        }
        guard let runtime = runtimeDirectory() else {
            serviceState = .failed(t(
                "应用内置运行时缺失，请重新构建或安装 Codex Tabs.app。",
                "The bundled runtime is missing. Rebuild or reinstall Codex Tabs.app."
            ))
            return
        }

        let process = Process()
        let pipe = Pipe()
        process.executableURL = node
        let cli = runtime.appendingPathComponent("src/cli.mjs").path
        let codexIsRunning = !NSRunningApplication.runningApplications(
            withBundleIdentifier: "com.openai.codex"
        ).isEmpty
        if codexIsRunning {
            guard let port = existingDebugPort() else {
                serviceState = .failed(t(
                    "Codex 已经运行，但不是由 Codex Tabs 启动的。请先在 Codex 中按 ⌘Q 正常退出，再从菜单栏启动。",
                    "Codex is already running without a Codex Tabs debug connection. Quit Codex with ⌘Q, then start it from the menu bar."
                ))
                return
            }
            process.arguments = [cli, "attach", String(port)]
        } else {
            process.arguments = [cli, "start"]
        }
        var environment = ProcessInfo.processInfo.environment
        environment["CODEX_TABS_CONFIG"] = configURL.path
        environment["CODEX_TABS_STATE_DIR"] = supportDirectory.path
        process.environment = environment
        process.standardOutput = pipe
        process.standardError = pipe
        outputPipe = pipe
        log = ""
        serviceState = .starting

        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            Task { @MainActor in
                self?.appendLog(text)
            }
        }
        process.terminationHandler = { [weak self] process in
            Task { @MainActor in
                self?.outputPipe?.fileHandleForReading.readabilityHandler = nil
                self?.injector = nil
                if process.terminationStatus == 0 || process.terminationReason == .uncaughtSignal {
                    self?.serviceState = .stopped
                } else {
                    self?.serviceState = .failed(self?.t(
                        "注入器已经退出，请查看运行日志。",
                        "The injector exited. Check the runtime log for details."
                    ) ?? "The injector exited.")
                }
            }
        }

        do {
            try process.run()
            injector = process
            serviceState = .running
        } catch {
            serviceState = .failed(t(
                "无法启动注入器：\(error.localizedDescription)",
                "Unable to start the injector: \(error.localizedDescription)"
            ))
        }
    }

    func stop() {
        guard let injector, injector.isRunning else {
            serviceState = .stopped
            return
        }
        injector.interrupt()
        serviceState = .stopped
    }

    func resetSettings() {
        settings = .defaults
    }

    func resetAppearance() {
        let defaults = TabSettings.defaults
        var value = settings
        value.activeColor = defaults.activeColor
        value.activeBackgroundOpacity = defaults.activeBackgroundOpacity
        value.activeBorderOpacity = defaults.activeBorderOpacity
        value.activeShadowOpacity = defaults.activeShadowOpacity
        value.tabRadius = defaults.tabRadius
        value.panelOpacity = defaults.panelOpacity
        value.verticalWidth = defaults.verticalWidth
        value.verticalTop = defaults.verticalTop
        value.verticalBottom = defaults.verticalBottom
        value.verticalRadius = defaults.verticalRadius
        settings = value
    }

    func resetPreviewContent() {
        let defaults = TabSettings.defaults
        var value = settings
        value.previewShowTitle = defaults.previewShowTitle
        value.previewShowStatus = defaults.previewShowStatus
        value.previewShowActivity = defaults.previewShowActivity
        value.previewShowTotalTokens = defaults.previewShowTotalTokens
        value.previewShowInputTokens = defaults.previewShowInputTokens
        value.previewShowOutputTokens = defaults.previewShowOutputTokens
        value.previewShowCache = defaults.previewShowCache
        value.previewShowContext = defaults.previewShowContext
        value.previewShowQuota = defaults.previewShowQuota
        value.previewShowProgressBar = defaults.previewShowProgressBar
        settings = value
    }

    func openSupportFolder() {
        NSWorkspace.shared.open(supportDirectory)
    }

    func checkForUpdates(manual: Bool = true) {
        if !manual {
            let lastCheck = UserDefaults.standard.double(forKey: "lastUpdateCheck")
            if Date().timeIntervalSince1970 - lastCheck < 86_400 { return }
        }
        guard let value = Bundle.main.object(forInfoDictionaryKey: "CodexTabsUpdateFeedURL") as? String,
              let url = URL(string: value), !value.isEmpty else {
            updateState = .failed(t("尚未配置更新源", "No update feed is configured"))
            return
        }
        updateState = .checking
        var request = URLRequest(url: url)
        request.setValue("Codex-Tabs/\(currentVersion)", forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 15
        URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
            Task { @MainActor in
                guard let self else { return }
                if let error {
                    self.updateState = .failed(error.localizedDescription)
                    return
                }
                guard let data,
                      let release = try? JSONDecoder().decode(GitHubRelease.self, from: data) else {
                    self.updateState = .failed(self.t(
                        "更新服务器暂时不可用",
                        "The update server is temporarily unavailable"
                    ))
                    return
                }
                UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "lastUpdateCheck")
                let remote = release.tagName.trimmingCharacters(in: CharacterSet(charactersIn: "vV"))
                self.updateState = self.isVersion(remote, newerThan: self.currentVersion)
                    ? .available(version: remote, url: release.htmlURL)
                    : .current
            }
        }.resume()
    }

    func openAvailableUpdate() {
        guard case let .available(_, url) = updateState else { return }
        NSWorkspace.shared.open(url)
    }

    func openDonate() {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "CodexTabsDonateURL") as? String,
              let url = URL(string: value), !value.isEmpty else { return }
        NSWorkspace.shared.open(url)
    }

    var currentVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    }

    func t(_ chinese: String, _ english: String) -> String {
        AppLocalization.text(chinese, english, language: settings.appLanguage)
    }

    private func appendLog(_ text: String) {
        log.append(text)
        if log.count > 30_000 { log.removeFirst(log.count - 30_000) }
    }

    private func saveSettings() {
        try? FileManager.default.createDirectory(at: supportDirectory, withIntermediateDirectories: true)
        guard let data = try? JSONEncoder.pretty.encode(settings) else { return }
        try? data.write(to: configURL, options: .atomic)
    }

    private static func loadSettings(from url: URL) -> TabSettings {
        guard let data = try? Data(contentsOf: url),
              let value = try? JSONDecoder().decode(TabSettings.self, from: data) else {
            return .defaults
        }
        return value
    }

    private func runtimeDirectory() -> URL? {
        if let override = ProcessInfo.processInfo.environment["CODEX_TABS_RUNTIME"] {
            return URL(fileURLWithPath: override)
        }
        guard let resources = Bundle.main.resourceURL else { return nil }
        let bundled = resources.appendingPathComponent("runtime", isDirectory: true)
        return FileManager.default.fileExists(atPath: bundled.appendingPathComponent("src/cli.mjs").path)
            ? bundled : nil
    }

    private func existingDebugPort() -> Int? {
        let url = supportDirectory.appendingPathComponent(".codex-tabs-port")
        guard let text = try? String(contentsOf: url, encoding: .utf8),
              let port = Int(text.trimmingCharacters(in: .whitespacesAndNewlines)),
              (1...65_535).contains(port) else {
            return nil
        }
        return port
    }

    private func isVersion(_ candidate: String, newerThan current: String) -> Bool {
        let left = candidate.split(separator: ".").map { Int($0) ?? 0 }
        let right = current.split(separator: ".").map { Int($0) ?? 0 }
        for index in 0..<max(left.count, right.count) {
            let lhs = index < left.count ? left[index] : 0
            let rhs = index < right.count ? right[index] : 0
            if lhs != rhs { return lhs > rhs }
        }
        return false
    }

    private func findNode() -> URL? {
        if let resources = Bundle.main.resourceURL {
            let bundled = resources.appendingPathComponent("runtime/bin/node")
            if FileManager.default.isExecutableFile(atPath: bundled.path) { return bundled }
        }
        let candidates = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ]
        if let path = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) {
            return URL(fileURLWithPath: path)
        }

        let shell = Process()
        let pipe = Pipe()
        shell.executableURL = URL(fileURLWithPath: "/bin/zsh")
        shell.arguments = ["-lc", "command -v node"]
        shell.standardOutput = pipe
        shell.standardError = FileHandle.nullDevice
        try? shell.run()
        shell.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let path = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return FileManager.default.isExecutableFile(atPath: path) ? URL(fileURLWithPath: path) : nil
    }
}

private struct GitHubRelease: Decodable {
    let tagName: String
    let htmlURL: URL

    enum CodingKeys: String, CodingKey {
        case tagName = "tag_name"
        case htmlURL = "html_url"
    }
}

private extension JSONEncoder {
    static var pretty: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }
}
