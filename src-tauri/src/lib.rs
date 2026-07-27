use std::path::{Path, PathBuf};
use tauri::ipc::Response;
use tauri_plugin_sql::{Migration, MigrationKind};

fn validate_pdf_path(path: &str) -> Result<PathBuf, String> {
    let requested = Path::new(path);
    let is_pdf = requested
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);

    if !is_pdf {
        return Err("PDF 파일만 열 수 있습니다.".to_string());
    }

    let canonical = requested
        .canonicalize()
        .map_err(|_| "파일을 찾을 수 없습니다. 이동되거나 삭제되었는지 확인해 주세요.".to_string())?;

    if !canonical.is_file() {
        return Err("선택한 경로가 파일이 아닙니다.".to_string());
    }

    Ok(canonical)
}

#[tauri::command]
fn read_pdf(path: String) -> Result<Response, String> {
    let path = validate_pdf_path(&path)?;
    let bytes = std::fs::read(path)
        .map_err(|error| format!("PDF를 읽지 못했습니다: {error}"))?;
    Ok(Response::new(bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_documents_table",
        sql: r#"
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY NOT NULL,
                file_path TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                page_count INTEGER NOT NULL DEFAULT 0,
                last_opened_at TEXT NOT NULL,
                page_number INTEGER NOT NULL DEFAULT 1,
                relative_offset_y REAL NOT NULL DEFAULT 0,
                scale_value TEXT NOT NULL DEFAULT 'page-width',
                scale REAL NOT NULL DEFAULT 1,
                rotation INTEGER NOT NULL DEFAULT 0,
                split_mode TEXT NOT NULL DEFAULT 'side-by-side',
                sync_enabled INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_documents_last_opened
                ON documents(last_opened_at DESC);
        "#,
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:paperloom.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![read_pdf])
        .run(tauri::generate_context!())
        .expect("failed to run Paperloom");
}

