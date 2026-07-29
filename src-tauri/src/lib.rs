use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
};
use tauri::{ipc::Response, Manager};
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

fn project_pdf_path(app: &tauri::AppHandle, document_id: &str) -> Result<PathBuf, String> {
    if document_id.is_empty()
        || document_id.len() > 96
        || !document_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
    {
        return Err("논문 식별자가 올바르지 않습니다.".to_string());
    }
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("앱 데이터 위치를 찾지 못했습니다: {error}"))?
        .join("accepted-papers");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("한국어 논문 저장 폴더를 만들지 못했습니다: {error}"))?;
    Ok(directory.join(format!("{document_id}.pdf")))
}

#[tauri::command]
fn write_project_pdf(
    app: tauri::AppHandle,
    document_id: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    if bytes.len() < 5 || !bytes.starts_with(b"%PDF-") {
        return Err("생성된 파일이 PDF 형식이 아닙니다.".to_string());
    }
    let path = project_pdf_path(&app, &document_id)?;
    let temporary = path.with_extension("pdf.tmp");
    let backup = path.with_extension("pdf.bak");
    fs::write(&temporary, bytes)
        .map_err(|error| format!("한국어 논문을 저장하지 못했습니다: {error}"))?;
    if path.is_file() {
        if backup.is_file() {
            fs::remove_file(&backup)
                .map_err(|error| format!("이전 임시 백업을 정리하지 못했습니다: {error}"))?;
        }
        fs::rename(&path, &backup)
            .map_err(|error| format!("기존 한국어 논문을 보호하지 못했습니다: {error}"))?;
    }
    if let Err(error) = fs::rename(&temporary, &path) {
        if backup.is_file() {
            let _ = fs::rename(&backup, &path);
        }
        return Err(format!("한국어 논문 저장을 완료하지 못했습니다: {error}"));
    }
    if backup.is_file() {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

#[tauri::command]
fn read_project_pdf(app: tauri::AppHandle, document_id: String) -> Result<Response, String> {
    let path = project_pdf_path(&app, &document_id)?;
    if !path.is_file() {
        return Ok(Response::new(Vec::<u8>::new()));
    }
    let bytes =
        fs::read(path).map_err(|error| format!("저장된 한국어 논문을 읽지 못했습니다: {error}"))?;
    Ok(Response::new(bytes))
}

const TYPESETTING_VERSION: &str = "nanum-korean-weights-stix-math-7ff85c8";
const SERIF_FONT_URL: &str = "https://raw.githubusercontent.com/google/fonts/7ff85c87f93ea6cca5f41c69f2e4edcb90240f26/ofl/nanummyeongjo/NanumMyeongjo-Regular.ttf";
const SERIF_BOLD_FONT_URL: &str = "https://raw.githubusercontent.com/google/fonts/7ff85c87f93ea6cca5f41c69f2e4edcb90240f26/ofl/nanummyeongjo/NanumMyeongjo-Bold.ttf";
const SANS_FONT_URL: &str = "https://raw.githubusercontent.com/google/fonts/7ff85c87f93ea6cca5f41c69f2e4edcb90240f26/ofl/nanumgothic/NanumGothic-Regular.ttf";
const SANS_BOLD_FONT_URL: &str = "https://raw.githubusercontent.com/google/fonts/7ff85c87f93ea6cca5f41c69f2e4edcb90240f26/ofl/nanumgothic/NanumGothic-Bold.ttf";
const MATH_FONT_URL: &str = "https://raw.githubusercontent.com/google/fonts/7ff85c87f93ea6cca5f41c69f2e4edcb90240f26/ofl/stixtwomath/STIXTwoMath-Regular.ttf";
const SERIF_FONT_SHA256: &str = "7ed9e8653a8ed04285d51dc343ffea6eb3d9c73afc27383ea8929ee4ffd03205";
const SERIF_BOLD_FONT_SHA256: &str =
    "bc9ed8e60d93fe6db054b8fb988481b625f2eef8cb2317ad0e9834681b8fe3f3";
const SANS_FONT_SHA256: &str = "76f45ef4a6bcff344c837c95a7dcc26e017e38b5846d5ae0cdcb5b86be2e2d31";
const SANS_BOLD_FONT_SHA256: &str =
    "f96298f9fb18e364d2370f4c3ce948ac67a2b61af992d7234bc15c42b033c674";
const MATH_FONT_SHA256: &str = "562551b15b836e6e01d1b7350909baf3c8c8d83260c1190fbf4544333e6936de";
const SERIF_FONT_BYTES: u64 = 3_058_408;
const SERIF_BOLD_FONT_BYTES: u64 = 3_074_720;
const SANS_FONT_BYTES: u64 = 2_054_744;
const SANS_BOLD_FONT_BYTES: u64 = 2_073_868;
const MATH_FONT_BYTES: u64 = 1_517_976;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TypesettingPackageStatus {
    installed: bool,
    total_bytes: u64,
    installed_bytes: u64,
    version: String,
}

fn typesetting_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("앱 캐시 위치를 찾지 못했습니다: {error}"))?
        .join("typesetting")
        .join(TYPESETTING_VERSION);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("한글 조판 패키지 폴더를 만들지 못했습니다: {error}"))?;
    Ok(directory)
}

fn typesetting_font_path(app: &tauri::AppHandle, kind: &str) -> Result<PathBuf, String> {
    let file_name = match kind {
        "serif" => "NanumMyeongjo-Regular.ttf",
        "serifBold" => "NanumMyeongjo-Bold.ttf",
        "sans" => "NanumGothic-Regular.ttf",
        "sansBold" => "NanumGothic-Bold.ttf",
        "math" => "STIXTwoMath-Regular.ttf",
        _ => return Err("지원하지 않는 조판 글꼴입니다.".to_string()),
    };
    Ok(typesetting_directory(app)?.join(file_name))
}

fn installed_font_bytes(path: &Path, expected: u64) -> u64 {
    path.metadata()
        .ok()
        .filter(|metadata| metadata.is_file() && metadata.len() == expected)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

fn typesetting_status(app: &tauri::AppHandle) -> Result<TypesettingPackageStatus, String> {
    let serif = installed_font_bytes(&typesetting_font_path(app, "serif")?, SERIF_FONT_BYTES);
    let serif_bold = installed_font_bytes(
        &typesetting_font_path(app, "serifBold")?,
        SERIF_BOLD_FONT_BYTES,
    );
    let sans = installed_font_bytes(&typesetting_font_path(app, "sans")?, SANS_FONT_BYTES);
    let sans_bold = installed_font_bytes(
        &typesetting_font_path(app, "sansBold")?,
        SANS_BOLD_FONT_BYTES,
    );
    let math = installed_font_bytes(&typesetting_font_path(app, "math")?, MATH_FONT_BYTES);
    Ok(TypesettingPackageStatus {
        installed: serif == SERIF_FONT_BYTES
            && serif_bold == SERIF_BOLD_FONT_BYTES
            && sans == SANS_FONT_BYTES
            && sans_bold == SANS_BOLD_FONT_BYTES
            && math == MATH_FONT_BYTES,
        total_bytes: SERIF_FONT_BYTES
            + SERIF_BOLD_FONT_BYTES
            + SANS_FONT_BYTES
            + SANS_BOLD_FONT_BYTES
            + MATH_FONT_BYTES,
        installed_bytes: serif + serif_bold + sans + sans_bold + math,
        version: TYPESETTING_VERSION.to_string(),
    })
}

#[tauri::command]
fn typesetting_package_status(app: tauri::AppHandle) -> Result<TypesettingPackageStatus, String> {
    typesetting_status(&app)
}

async fn download_font(
    client: &reqwest::Client,
    url: &str,
    destination: &Path,
    expected_size: u64,
    expected_sha256: &str,
) -> Result<(), String> {
    if installed_font_bytes(destination, expected_size) == expected_size {
        return Ok(());
    }
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("한글 조판 글꼴을 받지 못했습니다: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "한글 조판 글꼴 다운로드가 실패했습니다 ({})",
            response.status()
        ));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("한글 조판 글꼴을 읽지 못했습니다: {error}"))?;
    if bytes.len() as u64 != expected_size {
        return Err("받은 한글 조판 글꼴의 크기가 예상과 다릅니다.".to_string());
    }
    let actual_sha256 = format!("{:x}", Sha256::digest(&bytes));
    if actual_sha256 != expected_sha256 {
        return Err("받은 한글 조판 글꼴의 무결성 확인에 실패했습니다.".to_string());
    }
    let temporary = destination.with_extension("download");
    fs::write(&temporary, &bytes)
        .map_err(|error| format!("한글 조판 글꼴을 저장하지 못했습니다: {error}"))?;
    if destination.exists() {
        fs::remove_file(destination)
            .map_err(|error| format!("기존 조판 글꼴을 교체하지 못했습니다: {error}"))?;
    }
    fs::rename(&temporary, destination)
        .map_err(|error| format!("한글 조판 글꼴 설치를 완료하지 못했습니다: {error}"))?;
    Ok(())
}

#[tauri::command]
async fn install_typesetting_package(
    app: tauri::AppHandle,
) -> Result<TypesettingPackageStatus, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|error| format!("다운로드 연결을 만들지 못했습니다: {error}"))?;
    download_font(
        &client,
        SERIF_FONT_URL,
        &typesetting_font_path(&app, "serif")?,
        SERIF_FONT_BYTES,
        SERIF_FONT_SHA256,
    )
    .await?;
    download_font(
        &client,
        SERIF_BOLD_FONT_URL,
        &typesetting_font_path(&app, "serifBold")?,
        SERIF_BOLD_FONT_BYTES,
        SERIF_BOLD_FONT_SHA256,
    )
    .await?;
    download_font(
        &client,
        SANS_FONT_URL,
        &typesetting_font_path(&app, "sans")?,
        SANS_FONT_BYTES,
        SANS_FONT_SHA256,
    )
    .await?;
    download_font(
        &client,
        SANS_BOLD_FONT_URL,
        &typesetting_font_path(&app, "sansBold")?,
        SANS_BOLD_FONT_BYTES,
        SANS_BOLD_FONT_SHA256,
    )
    .await?;
    download_font(
        &client,
        MATH_FONT_URL,
        &typesetting_font_path(&app, "math")?,
        MATH_FONT_BYTES,
        MATH_FONT_SHA256,
    )
    .await?;
    typesetting_status(&app)
}

#[tauri::command]
fn read_typesetting_font(app: tauri::AppHandle, kind: String) -> Result<Response, String> {
    let path = typesetting_font_path(&app, &kind)?;
    let bytes = fs::read(path).map_err(|_| "한글 조판 패키지를 먼저 설치해 주세요.".to_string())?;
    Ok(Response::new(bytes))
}

#[tauri::command]
fn write_generated_pdf(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let target = PathBuf::from(path);
    let is_pdf = target
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);
    if !is_pdf {
        return Err("PDF 확장자로 저장해 주세요.".to_string());
    }
    if bytes.len() < 5 || !bytes.starts_with(b"%PDF-") {
        return Err("생성된 PDF 데이터가 올바르지 않습니다.".to_string());
    }
    let parent = target
        .parent()
        .ok_or_else(|| "저장 위치가 올바르지 않습니다.".to_string())?;
    if !parent.is_dir() {
        return Err("선택한 저장 폴더를 찾을 수 없습니다.".to_string());
    }
    fs::write(&target, bytes).map_err(|error| format!("PDF를 저장하지 못했습니다: {error}"))
}

fn validate_profile_id(profile_id: &str) -> Result<&str, String> {
    let trimmed = profile_id.trim();
    if trimmed.is_empty()
        || trimmed.len() > 120
        || !trimmed
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("모델 연결 프로필 식별자가 올바르지 않습니다.".to_string());
    }
    Ok(trimmed)
}

fn provider_secret_entry(profile_id: &str) -> Result<keyring::Entry, String> {
    let account = validate_profile_id(profile_id)?;
    keyring::Entry::new("paperloom.model-connection", account)
        .map_err(|error| format!("운영체제 보안 저장소를 열지 못했습니다: {error}"))
}

#[tauri::command]
fn store_provider_secret(profile_id: String, secret: String) -> Result<(), String> {
    let entry = provider_secret_entry(&profile_id)?;
    if secret.is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("기존 API 키를 지우지 못했습니다: {error}")),
        }
    } else {
        entry
            .set_password(&secret)
            .map_err(|error| format!("API 키를 보안 저장소에 저장하지 못했습니다: {error}"))
    }
}

#[tauri::command]
fn read_provider_secret(profile_id: String) -> Result<Option<String>, String> {
    let entry = provider_secret_entry(&profile_id)?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("API 키를 보안 저장소에서 읽지 못했습니다: {error}")),
    }
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
    effort: Option<String>,
    messages: Vec<LlmMessage>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PdfUploadRequest {
    endpoint: String,
    api_key: String,
    bytes: Vec<u8>,
    file_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PdfQuestionRequest {
    endpoint: String,
    api_key: String,
    model: String,
    effort: Option<String>,
    file_id: String,
    messages: Vec<LlmMessage>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteRemoteFileRequest {
    endpoint: String,
    api_key: String,
    file_id: String,
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
    usage: Option<CompletionUsage>,
    error: Option<CompletionError>,
}

#[derive(Deserialize)]
struct CompletionUsage {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    total_tokens: Option<u64>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmTokenUsage {
    input_tokens: u64,
    output_tokens: u64,
    total_tokens: u64,
    estimated: bool,
}

#[derive(Serialize)]
struct LlmCompletionResult {
    content: String,
    usage: Option<LlmTokenUsage>,
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

fn llm_api_url(endpoint: &str, suffix: &str) -> Result<String, String> {
    validate_llm_endpoint(endpoint)?;
    Ok(format!(
        "{}/{}",
        endpoint.trim_end_matches('/'),
        suffix.trim_start_matches('/')
    ))
}

fn response_error(payload: &serde_json::Value, fallback: String) -> String {
    payload
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .unwrap_or(fallback)
}

fn valid_remote_file_id(file_id: &str) -> bool {
    !file_id.is_empty()
        && file_id.len() <= 200
        && file_id.chars().all(|character| {
            character.is_ascii_alphanumeric()
                || character == '-'
                || character == '_'
                || character == '.'
        })
}

#[tauri::command]
async fn llm_upload_pdf(request: PdfUploadRequest) -> Result<String, String> {
    if request.bytes.len() < 5 || !request.bytes.starts_with(b"%PDF-") {
        return Err("업로드할 파일이 PDF 형식이 아닙니다.".to_string());
    }
    if request.bytes.len() > 50 * 1024 * 1024 {
        return Err("PDF 파일은 50MB 이하여야 합니다.".to_string());
    }
    let file_name = if request.file_name.to_ascii_lowercase().ends_with(".pdf") {
        request.file_name
    } else {
        "paper.pdf".to_string()
    };
    let part = reqwest::multipart::Part::bytes(request.bytes)
        .file_name(file_name)
        .mime_str("application/pdf")
        .map_err(|_| "PDF 업로드 형식을 만들지 못했습니다.".to_string())?;
    let form = reqwest::multipart::Form::new()
        .text("purpose", "user_data")
        .part("file", part);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|_| "LLM HTTP client를 만들지 못했습니다.".to_string())?;
    let mut builder = client
        .post(llm_api_url(&request.endpoint, "files")?)
        .multipart(form);
    if !request.api_key.trim().is_empty() {
        builder = builder.bearer_auth(&request.api_key);
    }
    let response = builder
        .send()
        .await
        .map_err(|error| format!("PDF를 모델 제공자에 업로드하지 못했습니다: {error}"))?;
    let status = response.status();
    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|_| "PDF 업로드 응답을 읽지 못했습니다.".to_string())?;
    if !status.is_success() {
        return Err(response_error(
            &payload,
            format!("PDF 업로드 실패 ({status})"),
        ));
    }
    payload
        .get("id")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| "업로드된 PDF 식별자가 없습니다.".to_string())
}

fn responses_output_text(payload: &serde_json::Value) -> Option<String> {
    if let Some(text) = payload
        .get("output_text")
        .and_then(serde_json::Value::as_str)
        .filter(|text| !text.trim().is_empty())
    {
        return Some(text.to_string());
    }
    payload
        .get("output")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|item| {
            item.get("content")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
        })
        .find_map(|content| {
            content
                .get("text")
                .and_then(serde_json::Value::as_str)
                .filter(|text| !text.trim().is_empty())
                .map(str::to_string)
        })
}

#[tauri::command]
async fn llm_question_pdf(request: PdfQuestionRequest) -> Result<String, String> {
    if request.model.trim().is_empty() {
        return Err("모델명을 설정해 주세요.".to_string());
    }
    if !valid_remote_file_id(request.file_id.trim()) {
        return Err("업로드된 PDF 식별자가 올바르지 않습니다.".to_string());
    }
    let file_id = request.file_id.clone();
    let input = request
        .messages
        .into_iter()
        .map(|message| {
            let mut content = vec![serde_json::json!({
                "type": "input_text",
                "text": message.content
            })];
            if message.role == "user" {
                content.insert(
                    0,
                    serde_json::json!({
                        "type": "input_file",
                        "file_id": &file_id
                    }),
                );
            }
            serde_json::json!({
                "role": message.role,
                "content": content
            })
        })
        .collect::<Vec<_>>();
    let mut payload = serde_json::json!({
        "model": request.model,
        "input": input
    });
    if let Some(effort) = request
        .effort
        .as_deref()
        .filter(|effort| *effort != "default")
    {
        if !matches!(effort, "low" | "high" | "max") {
            return Err("지원하지 않는 추론 강도입니다.".to_string());
        }
        payload["reasoning"] = serde_json::json!({ "effort": effort });
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|_| "LLM HTTP client를 만들지 못했습니다.".to_string())?;
    let mut builder = client
        .post(llm_api_url(&request.endpoint, "responses")?)
        .json(&payload);
    if !request.api_key.trim().is_empty() {
        builder = builder.bearer_auth(&request.api_key);
    }
    let response = builder
        .send()
        .await
        .map_err(|error| format!("PDF 질문 요청에 실패했습니다: {error}"))?;
    let status = response.status();
    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|_| "PDF 질문 응답을 읽지 못했습니다.".to_string())?;
    if !status.is_success() {
        return Err(response_error(
            &payload,
            format!("PDF 질문 요청 실패 ({status})"),
        ));
    }
    responses_output_text(&payload)
        .filter(|content| !content.trim().is_empty())
        .ok_or_else(|| "LLM 응답 내용이 비어 있습니다.".to_string())
}

#[tauri::command]
async fn llm_delete_file(request: DeleteRemoteFileRequest) -> Result<(), String> {
    if !valid_remote_file_id(request.file_id.trim()) {
        return Err("업로드된 PDF 식별자가 올바르지 않습니다.".to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|_| "LLM HTTP client를 만들지 못했습니다.".to_string())?;
    let mut builder = client.delete(llm_api_url(
        &request.endpoint,
        &format!("files/{}", request.file_id),
    )?);
    if !request.api_key.trim().is_empty() {
        builder = builder.bearer_auth(&request.api_key);
    }
    let response = builder
        .send()
        .await
        .map_err(|error| format!("원격 PDF 삭제 요청에 실패했습니다: {error}"))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("원격 PDF 삭제 요청 실패 ({})", response.status()))
    }
}

#[tauri::command]
async fn llm_chat(request: LlmRequest) -> Result<LlmCompletionResult, String> {
    validate_llm_endpoint(&request.endpoint)?;
    if request.model.trim().is_empty() {
        return Err("모델명을 설정해 주세요.".to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|_| "LLM HTTP client를 만들지 못했습니다.".to_string())?;
    let mut payload = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "stream": false
    });
    if let Some(effort) = request
        .effort
        .as_deref()
        .filter(|effort| *effort != "default")
    {
        if !matches!(effort, "low" | "high" | "max") {
            return Err("지원하지 않는 추론 강도입니다.".to_string());
        }
        payload["reasoning_effort"] = serde_json::Value::String(effort.to_string());
    }
    let mut request_builder = client.post(&request.endpoint).json(&payload);
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
    let usage = payload.usage.and_then(|usage| {
        let input_tokens = usage.input_tokens.or(usage.prompt_tokens)?;
        let output_tokens = usage.output_tokens.or(usage.completion_tokens)?;
        Some(LlmTokenUsage {
            input_tokens,
            output_tokens,
            total_tokens: usage.total_tokens.unwrap_or(input_tokens + output_tokens),
            estimated: false,
        })
    });
    let content = payload
        .choices
        .and_then(|mut choices| choices.drain(..).next())
        .and_then(|choice| choice.message.content)
        .filter(|content| !content.trim().is_empty())
        .ok_or_else(|| "LLM 응답 내용이 비어 있습니다.".to_string())?;
    Ok(LlmCompletionResult { content, usage })
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
    effort: Option<String>,
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
async fn codex_models() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let output = run_codex(vec!["debug".to_string(), "models".to_string()], None)?;
        if !output.status.success() {
            return Err({
                let message = display_codex_error(&output);
                if message.is_empty() {
                    "Codex 모델 목록을 읽지 못했습니다.".to_string()
                } else {
                    message
                }
            });
        }
        let catalog: serde_json::Value = serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("Codex 모델 목록 형식이 올바르지 않습니다: {error}"))?;
        let models = catalog
            .get("models")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| "Codex 모델 목록이 비어 있습니다.".to_string())?;
        let data = models
            .iter()
            .filter(|model| {
                model
                    .get("visibility")
                    .and_then(serde_json::Value::as_str)
                    .map_or(true, |visibility| visibility == "list")
            })
            .enumerate()
            .map(|(index, model)| {
                let id = model
                    .get("slug")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default();
                let display_name = model
                    .get("display_name")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(id);
                let supported = model
                    .get("supported_reasoning_levels")
                    .and_then(serde_json::Value::as_array)
                    .map(|levels| {
                        levels
                            .iter()
                            .map(|level| {
                                serde_json::json!({
                                    "reasoningEffort": level
                                        .get("effort")
                                        .and_then(serde_json::Value::as_str)
                                        .unwrap_or("default"),
                                    "description": level
                                        .get("description")
                                        .and_then(serde_json::Value::as_str)
                                        .unwrap_or_default(),
                                })
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                serde_json::json!({
                    "id": id,
                    "model": id,
                    "displayName": display_name,
                    "hidden": false,
                    "isDefault": index == 0,
                    "defaultReasoningEffort": model
                        .get("default_reasoning_level")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("default"),
                    "supportedReasoningEfforts": supported,
                    "inputModalities": ["text", "image"],
                })
            })
            .collect::<Vec<_>>();
        Ok(serde_json::json!({ "data": data }))
    })
    .await
    .map_err(|error| format!("Codex 모델 목록 작업을 완료하지 못했습니다: {error}"))?
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
    let effort = request
        .effort
        .filter(|value| value != "default")
        .map(|value| {
            if matches!(
                value.as_str(),
                "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra"
            ) {
                Ok(value)
            } else {
                Err("지원하지 않는 Codex 추론 강도입니다.".to_string())
            }
        })
        .transpose()?;

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
        if let Some(value) = effort {
            args.push("--config".to_string());
            args.push(format!("model_reasoning_effort=\"{value}\""));
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
        Migration {
            version: 3,
            description: "retypeset_translation_state",
            sql: r#"
            ALTER TABLE translations ADD COLUMN section_id TEXT;
            ALTER TABLE translations ADD COLUMN manually_edited INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE translations ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "bilingual_viewer_and_paper_ask",
            sql: r#"
            ALTER TABLE documents ADD COLUMN active_profile_id TEXT;
            ALTER TABLE documents ADD COLUMN reasoning_effort TEXT;
            ALTER TABLE chat_messages ADD COLUMN context_mode TEXT;
            ALTER TABLE chat_messages ADD COLUMN evidence_json TEXT;
            CREATE INDEX IF NOT EXISTS idx_documents_file_hash
                ON documents(file_hash);
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
            write_project_pdf,
            read_project_pdf,
            typesetting_package_status,
            install_typesetting_package,
            read_typesetting_font,
            write_generated_pdf,
            store_provider_secret,
            read_provider_secret,
            llm_chat,
            llm_upload_pdf,
            llm_question_pdf,
            llm_delete_file,
            codex_auth_status,
            codex_login,
            codex_models,
            codex_complete
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Paperloom");
}
