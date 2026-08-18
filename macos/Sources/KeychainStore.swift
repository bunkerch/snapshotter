import Foundation
import Security

enum KeychainError: LocalizedError {
    case invalidData
    case status(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidData:
            "The Keychain value could not be encoded."
        case let .status(status):
            SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)"
        }
    }
}

struct KeychainStore: Sendable {
    private let service = "app.snapshotter.repository"

    func savePassword(_ password: String, repositoryID: String) throws {
        try save(password, account: repositoryID)
    }

    func saveCredentials(_ credentials: String, repositoryID: String) throws {
        try save(credentials, account: "\(repositoryID).backend")
    }

    func saveApplicationPassword(_ password: String, service: String, account: String) throws {
        try save(password, service: service, account: account, accessible: kSecAttrAccessibleAfterFirstUnlock)
    }

    private func save(_ value: String, account: String) throws {
        try save(value, service: service, account: account, accessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly)
    }

    private func save(_ value: String, service: String, account: String, accessible: CFString) throws {
        guard let data = value.data(using: .utf8) else {
            throw KeychainError.invalidData
        }

        let query = baseQuery(service: service, account: account)
        let attributes = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }
        if updateStatus != errSecItemNotFound {
            throw KeychainError.status(updateStatus)
        }

        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = accessible
        let addStatus = SecItemAdd(item as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw KeychainError.status(addStatus)
        }
    }

    func password(repositoryID: String) throws -> String? {
        try value(account: repositoryID)
    }

    func credentials(repositoryID: String) throws -> String? {
        try value(account: "\(repositoryID).backend")
    }

    func applicationPassword(service: String, account: String) throws -> String? {
        try value(service: service, account: account)
    }

    private func value(account: String) throws -> String? {
        try value(service: service, account: account)
    }

    private func value(service: String, account: String) throws -> String? {
        var query = baseQuery(service: service, account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            throw KeychainError.status(status)
        }
        guard let data = result as? Data, let password = String(data: data, encoding: .utf8) else {
            throw KeychainError.invalidData
        }
        return password
    }

    func removePassword(repositoryID: String) throws {
        let status = SecItemDelete(baseQuery(account: repositoryID) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.status(status)
        }
    }

    func removeCredentials(repositoryID: String) throws {
        let status = SecItemDelete(baseQuery(account: "\(repositoryID).backend") as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.status(status)
        }
    }

    private func baseQuery(account: String) -> [String: Any] {
        baseQuery(service: service, account: account)
    }

    private func baseQuery(service: String, account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
