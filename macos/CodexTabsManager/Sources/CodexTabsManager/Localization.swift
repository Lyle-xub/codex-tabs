import Foundation

enum AppLanguage: String, CaseIterable, Identifiable {
    case chinese = "zh-Hans"
    case english = "en"

    var id: String { rawValue }
}

enum AppLocalization {
    static func text(_ chinese: String, _ english: String, language: String) -> String {
        language == AppLanguage.english.rawValue ? english : chinese
    }
}
