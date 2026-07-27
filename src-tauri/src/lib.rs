use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    time::SystemTime,
};
use tauri::ipc::Response;
use tauri_plugin_sql::{Migration, MigrationKind};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use walkdir::WalkDir;

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

    let canonical = requested.canonicalize().map_err(|_| {
        "파일을 찾을 수 없습니다. 이동되거나 삭제되었는지 확인해 주세요.".to_string()
    })?;

    if !canonical.is_file() {
        return Err("선택한 경로가 파일이 아닙니다.".to_string());
    }

    Ok(canonical)
}

#[tauri::command]
fn read_pdf(path: String) -> Result<Response, String> {
    let path = validate_pdf_path(&path)?;
    let bytes = std::fs::read(path).map_err(|error| format!("PDF를 읽지 못했습니다: {error}"))?;
    Ok(Response::new(bytes))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScannedPdfFile {
    path: String,
    file_name: String,
    modified_at: String,
    size: u64,
    file_hash: String,
}

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| format!("파일을 열지 못했습니다: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("파일 hash를 계산하지 못했습니다: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn format_system_time(value: SystemTime) -> String {
    OffsetDateTime::from(value)
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

#[tauri::command]
fn scan_pdf_directory(path: String) -> Result<Vec<ScannedPdfFile>, String> {
    let root = Path::new(&path)
        .canonicalize()
        .map_err(|_| "논문 폴더를 찾을 수 없습니다.".to_string())?;
    if !root.is_dir() {
        return Err("선택한 경로가 폴더가 아닙니다.".to_string());
    }

    let mut files = Vec::new();
    for entry in WalkDir::new(&root).follow_links(false).into_iter() {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let is_pdf = entry
            .path()
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.eq_ignore_ascii_case("pdf"))
            .unwrap_or(false);
        if !is_pdf {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let canonical = match entry.path().canonicalize() {
            Ok(path) => path,
            Err(_) => continue,
        };
        files.push(ScannedPdfFile {
            path: canonical.to_string_lossy().to_string(),
            file_name: entry.file_name().to_string_lossy().to_string(),
            modified_at: metadata
                .modified()
                .map(format_system_time)
                .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string()),
            size: metadata.len(),
            file_hash: hash_file(&canonical)?,
        });
    }
    files.sort_by(|left, right| {
        left.file_name
            .to_lowercase()
            .cmp(&right.file_name.to_lowercase())
    });
    Ok(files)
}

#[derive(Deserialize, Serialize)]
struct LlmMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LlmRequest {
    endpoint: String,
    api_key: String,
    model: String,
    messages: Vec<LlmMessage>,
}

#[derive(Deserialize)]
struct CompletionMessage {
    content: Option<String>,
}

#[derive(Deserialize)]
struct CompletionChoice {
    message: CompletionMessage,
}

#[derive(Deserialize)]
struct CompletionResponse {
    choices: Option<Vec<CompletionChoice>>,
    error: Option<CompletionError>,
}

#[derive(Deserialize)]
struct CompletionError {
    message: Option<String>,
}

fn validate_llm_endpoint(endpoint: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(endpoint)
        .map_err(|_| "API endpoint가 올바른 URL이 아닙니다.".to_string())?;
    let is_secure = parsed.scheme() == "https";
    let is_loopback = parsed.scheme() == "http"
        && matches!(
            parsed.host_str().map(str::to_ascii_lowercase).as_deref(),
            Some("localhost" | "127.0.0.1" | "::1")
        );
    if is_secure || is_loopback {
        return Ok(());
    }
    Err("API endpoint는 HTTPS 또는 로컬 HTTP 주소여야 합니다.".to_string())
}

#[tauri::command]
async fn llm_chat(request: LlmRequest) -> Result<String, String> {
    validate_llm_endpoint(&request.endpoint)?;
    if request.model.trim().is_empty() {
        return Err("모델명을 설정해 주세요.".to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|_| "LLM HTTP client를 만들지 못했습니다.".to_string())?;
    let mut request_builder = client.post(&request.endpoint).json(&serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "stream": false
    }));
    if !request.api_key.trim().is_empty() {
        request_builder = request_builder.bearer_auth(&request.api_key);
    }
    let response = request_builder
        .send()
        .await
        .map_err(|error| format!("LLM 서버에 연결하지 못했습니다: {error}"))?;
    let status = response.status();
    let payload = response
        .json::<CompletionResponse>()
        .await
        .map_err(|_| "LLM 서버 응답을 읽지 못했습니다.".to_string())?;
    if !status.is_success() {
        return Err(payload
            .error
            .and_then(|error| error.message)
            .unwrap_or_else(|| format!("LLM 요청 실패 ({status})")));
    }
    payload
        .choices
        .and_then(|mut choices| choices.drain(..).next())
        .and_then(|choice| choice.message.content)
        .filter(|content| !content.trim().is_empty())
        .ok_or_else(|| "LLM 응답 내용이 비어 있습니다.".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexAuthStatus {
    available: bool,
    authenticated: bool,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexCompletionRequest {
    messages: Vec<LlmMessage>,
    model: Option<String>,
}

struct CodexCommand {
    program: String,
    prefix_args: Vec<String>,
}

fn local_codex_command() -> Option<CodexCommand> {
    let current = std::env::current_dir().ok()?;
    for root in current.ancestors().take(4) {
        let entry = root
            .join("node_modules")
            .join("@openai")
            .join("codex")
            .join("bin")
            .join("codex.js");
        if entry.is_file() {
            return Some(CodexCommand {
                program: "node".to_string(),
                prefix_args: vec![entry.to_string_lossy().to_string()],
            });
        }
    }
    None
}

fn codex_command() -> CodexCommand {
    local_codex_command().unwrap_or_else(|| CodexCommand {
        program: "codex".to_string(),
        prefix_args: Vec::new(),
    })
}

fn codex_working_directory() -> Result<PathBuf, String> {
    let directory = std::env::temp_dir().join("paperloom-codex");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Codex 작업 폴더를 만들지 못했습니다: {error}"))?;
    Ok(directory)
}

fn display_codex_error(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let message = if stderr.is_empty() { stdout } else { stderr };
    if message.chars().count() > 4000 {
        message.chars().take(4000).collect()
    } else {
        message
    }
}

fn run_codex(args: Vec<String>, input: Option<String>) -> Result<Output, String> {
    let command_spec = codex_command();
    let mut command = Command::new(&command_spec.program);
    command
        .args(command_spec.prefix_args)
        .args(args)
        .current_dir(codex_working_directory()?)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    if input.is_some() {
        command.stdin(Stdio::piped());
    } else {
        command.stdin(Stdio::null());
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("Codex CLI를 실행하지 못했습니다: {error}"))?;
    if let Some(value) = input {
        child
            .stdin
            .take()
            .ok_or_else(|| "Codex 입력을 열지 못했습니다.".to_string())?
            .write_all(value.as_bytes())
            .map_err(|error| format!("Codex에 요청을 전달하지 못했습니다: {error}"))?;
    }
    child
        .wait_with_output()
        .map_err(|error| format!("Codex 응답을 기다리지 못했습니다: {error}"))
}

fn codex_status_sync() -> CodexAuthStatus {
    match run_codex(vec!["login".to_string(), "status".to_string()], None) {
        Ok(output) => {
            let message = {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if stdout.is_empty() {
                    display_codex_error(&output)
                } else {
                    stdout
                }
            };
            let normalized = message.to_ascii_lowercase();
            CodexAuthStatus {
                available: true,
                authenticated: output.status.success()
                    && (normalized.contains("logged in") || normalized.contains("authenticated")),
                message: if message.is_empty() {
                    "Codex 로그인 상태를 확인했습니다.".to_string()
                } else {
                    message
                },
            }
        }
        Err(error) => CodexAuthStatus {
            available: false,
            authenticated: false,
            message: error,
        },
    }
}

#[tauri::command]
async fn codex_auth_status() -> Result<CodexAuthStatus, String> {
    tauri::async_runtime::spawn_blocking(codex_status_sync)
        .await
        .map_err(|error| format!("Codex 로그인 상태를 확인하지 못했습니다: {error}"))
}

#[tauri::command]
async fn codex_login() -> Result<CodexAuthStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let output = run_codex(vec!["login".to_string()], None)?;
        if !output.status.success() {
            return Err({
                let message = display_codex_error(&output);
                if message.is_empty() {
                    "Codex 로그인이 완료되지 않았습니다.".to_string()
                } else {
                    message
                }
            });
        }
        Ok(codex_status_sync())
    })
    .await
    .map_err(|error| format!("Codex 로그인을 실행하지 못했습니다: {error}"))?
}

fn codex_prompt(messages: &[LlmMessage]) -> Result<String, String> {
    let conversation = serde_json::to_string(messages)
        .map_err(|error| format!("Codex 요청을 만들지 못했습니다: {error}"))?;
    Ok([
        "You are the language-model backend for Paperloom, a local PDF reader.",
        "Do not use tools, inspect files, run commands, or access the environment.",
        "Answer only from the conversation supplied below.",
        "Follow system-role messages as the highest-priority instructions.",
        "Return only the assistant response, with no preamble or commentary.",
        "",
        &conversation,
    ]
    .join("\n"))
}

#[tauri::command]
async fn codex_complete(request: CodexCompletionRequest) -> Result<String, String> {
    if request.messages.is_empty() || request.messages.len() > 100 {
        return Err("Codex 요청의 메시지 수가 올바르지 않습니다.".to_string());
    }
    let character_count: usize = request
        .messages
        .iter()
        .map(|message| message.content.chars().count())
        .sum();
    if character_count > 1_000_000 {
        return Err("한 번에 보낼 수 있는 문서 분량을 초과했습니다.".to_string());
    }
    if request
        .messages
        .iter()
        .any(|message| !matches!(message.role.as_str(), "system" | "user" | "assistant"))
    {
        return Err("지원하지 않는 Codex 메시지 역할입니다.".to_string());
    }

    let prompt = codex_prompt(&request.messages)?;
    let model = request
        .model
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if model.as_ref().is_some_and(|value| value.len() > 120) {
        return Err("Codex 모델명이 너무 깁니다.".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let mut args = vec![
            "exec".to_string(),
            "--sandbox".to_string(),
            "read-only".to_string(),
            "--skip-git-repo-check".to_string(),
            "--ephemeral".to_string(),
            "--ignore-user-config".to_string(),
            "--ignore-rules".to_string(),
            "--color".to_string(),
            "never".to_string(),
            "-C".to_string(),
            codex_working_directory()?.to_string_lossy().to_string(),
        ];
        if let Some(value) = model {
            args.push("--model".to_string());
            args.push(value);
        }
        args.push("-".to_string());

        let output = run_codex(args, Some(prompt))?;
        if !output.status.success() {
            let message = display_codex_error(&output);
            return Err(if message.is_empty() {
                "Codex 요청이 실패했습니다.".to_string()
            } else {
                message
            });
        }
        let content = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if content.is_empty() {
            Err("Codex 응답 내용이 비어 있습니다.".to_string())
        } else {
            Ok(content)
        }
    })
    .await
    .map_err(|error| format!("Codex 요청을 완료하지 못했습니다: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
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
        },
        Migration {
            version: 2,
            description: "complete_reader_domain",
            sql: r#"
            ALTER TABLE documents ADD COLUMN file_hash TEXT;
            ALTER TABLE documents ADD COLUMN folder_id TEXT;
            ALTER TABLE documents ADD COLUMN missing INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE documents ADD COLUMN translation_progress REAL NOT NULL DEFAULT 0;

            CREATE TABLE IF NOT EXISTS document_blocks (
                id TEXT PRIMARY KEY NOT NULL,
                document_id TEXT NOT NULL,
                page_number INTEGER NOT NULL,
                block_type TEXT NOT NULL,
                text TEXT NOT NULL,
                bbox_json TEXT NOT NULL,
                font_size REAL,
                reading_order INTEGER NOT NULL,
                translatable INTEGER NOT NULL DEFAULT 1
            );
            CREATE INDEX IF NOT EXISTS idx_blocks_document_page
                ON document_blocks(document_id, page_number, reading_order);

            CREATE TABLE IF NOT EXISTS translations (
                id TEXT PRIMARY KEY NOT NULL,
                document_id TEXT NOT NULL,
                block_id TEXT NOT NULL,
                target_language TEXT NOT NULL,
                source_text TEXT NOT NULL,
                translated_text TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL,
                error TEXT,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_translations_document
                ON translations(document_id, target_language);

            CREATE TABLE IF NOT EXISTS translation_jobs (
                id TEXT PRIMARY KEY NOT NULL,
                document_id TEXT NOT NULL,
                status TEXT NOT NULL,
                total_blocks INTEGER NOT NULL,
                completed_blocks INTEGER NOT NULL,
                failed_block_ids_json TEXT NOT NULL,
                started_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS highlights (
                id TEXT PRIMARY KEY NOT NULL,
                document_id TEXT NOT NULL,
                page_number INTEGER NOT NULL,
                source TEXT NOT NULL,
                selected_text TEXT NOT NULL,
                rects_json TEXT NOT NULL,
                color TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY NOT NULL,
                document_id TEXT NOT NULL,
                scope TEXT NOT NULL,
                page_number INTEGER,
                source TEXT,
                selected_text TEXT,
                rects_json TEXT,
                highlight_id TEXT,
                markdown TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS dictionary_cache (
                id TEXT PRIMARY KEY NOT NULL,
                document_id TEXT NOT NULL,
                word TEXT NOT NULL,
                context TEXT NOT NULL,
                lemma TEXT NOT NULL,
                part_of_speech TEXT NOT NULL,
                meaning TEXT NOT NULL,
                context_meaning TEXT NOT NULL,
                explanation TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_dictionary_lookup
                ON dictionary_cache(document_id, word);

            CREATE TABLE IF NOT EXISTS chat_sessions (
                id TEXT PRIMARY KEY NOT NULL,
                document_id TEXT NOT NULL,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY NOT NULL,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                source_text TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS library_folders (
                id TEXT PRIMARY KEY NOT NULL,
                path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                last_scanned_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS document_tags (
                document_id TEXT NOT NULL,
                tag TEXT NOT NULL,
                PRIMARY KEY(document_id, tag)
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        "#,
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:paperloom.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            read_pdf,
            scan_pdf_directory,
            llm_chat,
            codex_auth_status,
            codex_login,
            codex_complete
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Paperloom");
}
