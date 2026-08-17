import Foundation
import SQLite3

struct OnePasswordAccount: Sendable {
    let id: String
    let name: String
}

enum OnePasswordAccountDiscovery {
    static func accounts() -> [OnePasswordAccount] {
        // Account discovery is not yet exposed by the SDK. Query only non-secret
        // metadata and fall back to manual entry if 1Password changes this schema.
        let databaseURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Group Containers/2BUA8C4S2C.com.1password")
            .appendingPathComponent("Library/Application Support/1Password/Data/1password.sqlite")
        var database: OpaquePointer?
        let openResult = sqlite3_open_v2(databaseURL.path, &database, SQLITE_OPEN_READONLY, nil)
        guard openResult == SQLITE_OK, let database else {
            if let database { sqlite3_close(database) }
            return []
        }
        defer { sqlite3_close(database) }

        let query = """
            SELECT account_uuid,
                   COALESCE(json_extract(data, '$.team_name'), account_uuid)
            FROM accounts
            WHERE json_extract(data, '$.account_state') = 'A'
            ORDER BY 2 COLLATE NOCASE
            """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, query, -1, &statement, nil) == SQLITE_OK,
              let statement else { return [] }
        defer { sqlite3_finalize(statement) }

        var accounts: [OnePasswordAccount] = []
        var stepResult = sqlite3_step(statement)
        while stepResult == SQLITE_ROW {
            guard let idValue = sqlite3_column_text(statement, 0),
                  let nameValue = sqlite3_column_text(statement, 1) else { continue }
            accounts.append(OnePasswordAccount(
                id: String(cString: idValue),
                name: String(cString: nameValue)
            ))
            stepResult = sqlite3_step(statement)
        }
        return stepResult == SQLITE_DONE ? accounts : []
    }
}
