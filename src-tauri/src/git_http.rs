// Adapted from tetorica-fm2612-playground-tauri for Tetorica MIDI Playground.
//! HTTPS transport for isomorphic-git. Credentials never cross the WebView IPC.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    io::Read,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, WebviewWindow};
use zeroize::Zeroizing;
type Result<T> = std::result::Result<T, String>;
const LIMIT: usize = 64 * 1024 * 1024;
struct Session {
    id: String,
    repository: tauri::Url,
    operation: String,
    branch: String,
    commit: String,
    token: Zeroizing<String>,
    token_id: String,
    expires: Instant,
}
#[derive(Default)]
pub struct Transport(Mutex<Option<Session>>, AtomicU64);
impl Transport {
    fn generation(&self) -> u64 {
        self.1.load(Ordering::Acquire)
    }
    fn install(&self, generation: u64, session: Session) -> Result<()> {
        let mut scope = self.0.lock().map_err(|e| e.to_string())?;
        if self.generation() != generation {
            return Err("Git connection cancelled; retry the operation".into());
        }
        if scope.as_ref().is_some_and(|s| s.expires > Instant::now()) {
            return Err("A remote Git operation is already running".into());
        }
        *scope = Some(session);
        Ok(())
    }
    pub fn clear(&self) -> Result<()> {
        // Invalidate authentication dialogs which have not returned a session yet.
        self.1.fetch_add(1, Ordering::AcqRel);
        *self.0.lock().map_err(|e| e.to_string())? = None;
        Ok(())
    }
    pub fn revoke_token(&self, id: &str) -> Result<()> {
        // A pending dialog may already have copied the previous token value.
        self.1.fetch_add(1, Ordering::AcqRel);
        let mut session = self.0.lock().map_err(|e| e.to_string())?;
        if session
            .as_ref()
            .is_some_and(|session| session.token_id == id)
        {
            *session = None;
        }
        Ok(())
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Begin {
    url: String,
    operation: String,
    branch: String,
    commit: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    session: String,
    url: String,
    method: String,
    headers: BTreeMap<String, String>,
    body: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    url: String,
    status_code: u16,
    status_message: String,
    headers: BTreeMap<String, String>,
    body: String,
}
pub(crate) fn repository_url(value: &str) -> Result<tauri::Url> {
    let url = tauri::Url::parse(value).map_err(|_| "Invalid repository URL")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.path().ends_with(".git")
        || url.path().contains('%')
    {
        return Err(
            "Use an HTTPS repository URL ending in .git, without embedded credentials".into(),
        );
    }
    Ok(url)
}
fn endpoint(
    repository: &tauri::Url,
    operation: &str,
    value: &str,
    method: &str,
) -> Result<tauri::Url> {
    let url = tauri::Url::parse(value).map_err(|_| "Invalid Git request URL")?;
    if url.origin() != repository.origin()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("Git request is outside the approved repository".into());
    }
    let service = if operation == "push" {
        "git-receive-pack"
    } else {
        "git-upload-pack"
    };
    let base = repository.path().trim_end_matches('/');
    let valid = method == "GET"
        && url.path() == format!("{base}/info/refs")
        && url.query() == Some(format!("service={service}").as_str())
        || method == "POST" && url.path() == format!("{base}/{service}") && url.query().is_none();
    if !valid {
        return Err("Unsupported Git HTTPS endpoint or method".into());
    }
    Ok(url)
}
fn reviewed_push(body: &[u8], branch: &str, commit: &str) -> Result<()> {
    let length = body
        .get(..4)
        .and_then(|b| std::str::from_utf8(b).ok())
        .and_then(|s| usize::from_str_radix(s, 16).ok())
        .filter(|n| *n >= 4)
        .ok_or("Invalid push packet")?;
    let line = body
        .get(4..length)
        .and_then(|b| std::str::from_utf8(b).ok())
        .ok_or("Invalid push packet")?;
    let fields: Vec<_> = line
        .split('\0')
        .next()
        .unwrap_or("")
        .trim_end()
        .split(' ')
        .collect();
    if fields.len() != 3
        || fields[0].len() != 40
        || !fields[0].bytes().all(|b| b.is_ascii_hexdigit())
        || fields[1] != commit
        || fields[2] != format!("refs/heads/{branch}")
        || body.get(length..length + 4) != Some(b"0000")
    {
        return Err("Push packet does not match the reviewed commit and branch".into());
    }
    Ok(())
}
fn valid_branch(branch: &str) -> bool {
    !branch.is_empty()
        && branch.len() <= 256
        && !branch.starts_with(['-', '/'])
        && !branch.ends_with(['/', '.'])
        && !branch.contains("..")
        && !branch.contains("@{")
        && branch != "@"
        && !branch
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || "~^:?*[\\".contains(c))
        && branch
            .split('/')
            .all(|part| !part.is_empty() && !part.starts_with('.') && !part.ends_with(".lock"))
}
fn validate_headers(headers: &BTreeMap<String, String>) -> Result<()> {
    for (name, value) in headers {
        if !["content-type", "accept", "git-protocol"].contains(&name.to_ascii_lowercase().as_str())
            || value.len() > 1024
            || value.chars().any(char::is_control)
        {
            return Err("Unsupported Git request header".into());
        }
    }
    Ok(())
}
fn authentication(
    call: reqwest::blocking::RequestBuilder,
    token: &str,
) -> reqwest::blocking::RequestBuilder {
    if token.is_empty() {
        call
    } else {
        call.basic_auth("x-access-token", Some(token))
    }
}
#[tauri::command]
pub async fn git_https_begin(
    window: WebviewWindow,
    app: AppHandle,
    state: tauri::State<'_, Transport>,
    request: Begin,
) -> Result<String> {
    super::allowed(&window)?;
    let repository = repository_url(&request.url)?;
    if !["push", "fetch", "pull"].contains(&request.operation.as_str()) {
        return Err("Unsupported remote operation".into());
    }
    if !valid_branch(&request.branch)
        || request.commit.len() > 64
        || !request.commit.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Invalid branch or commit".into());
    }
    if request.operation == "push" && request.commit.len() != 40 {
        return Err("Commit changes before pushing".into());
    }
    let generation = state.generation();
    // No credential value is accepted as a command argument.
    let operation = request.operation.clone();
    let url = request.url.clone();
    let branch = request.branch.clone();
    let commit = request.commit.clone();
    let (token, token_id) = tauri::async_runtime::spawn_blocking(move || -> Result<(Zeroizing<String>, String)> {
        let state = app.state::<crate::git_tokens::Tokens>();
        let (entries, preferred) = state.0.lock().map_err(|e| e.to_string())?.available_choices(&url)?;
        if entries.is_empty() {
            if operation == "push" {
                return Err("No saved token for this host. Register one in Menu → Git settings before pushing".into());
            }
            crate::git_dialog::confirm(&app, "Tetorica MIDI Playground — Confirm Git connection", &format!("Operation: {operation}\nDestination: {url}\nBranch: {}\n\nNo saved token matches this host. Continue without authentication? Public repositories may allow this.", request.branch))?;
            return Ok((Zeroizing::new(String::new()), String::new()));
        }
        let index = preferred.as_ref().and_then(|id| entries.iter().position(|entry| &entry.id == id)).unwrap_or(0);
        let description = if operation == "push" {
            format!("Destination: {}\nBranch: {}\nCommit: {}\n\nSelect a token to use.", url, request.branch, request.commit)
        } else {
            format!("Operation: {}\nDestination: {}\n\nSelect a token to use.", operation, url)
        };
        let selected = crate::git_dialog::choose_token(&app, description, entries.iter().map(|entry| entry.name.clone()).collect(), index)?;
        let mut store = state.0.lock().map_err(|e| e.to_string())?;
        let entry = store.choose(&url, &entries[selected].id)?;
        let secret = store.read(&entry)?;
        Ok((secret, entry.id))
    })
    .await
    .map_err(|e| e.to_string())??;
    if token.chars().any(char::is_control) {
        return Err("Invalid token".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    state.install(
        generation,
        Session {
            id: id.clone(),
            repository,
            operation: request.operation,
            branch,
            commit,
            token,
            token_id,
            expires: Instant::now() + Duration::from_secs(180),
        },
    )?;
    Ok(id)
}
#[tauri::command]
pub async fn git_https_request(
    window: WebviewWindow,
    state: tauri::State<'_, Transport>,
    request: Request,
) -> Result<Response> {
    super::allowed(&window)?;
    let (url, token, reviewed) = {
        let scope = state.0.lock().map_err(|e| e.to_string())?;
        let session = scope
            .as_ref()
            .filter(|s| s.id == request.session && s.expires > Instant::now())
            .ok_or("Git authentication expired; retry the operation")?;
        (
            endpoint(
                &session.repository,
                &session.operation,
                &request.url,
                &request.method,
            )?,
            Zeroizing::new(session.token.to_string()),
            if session.operation == "push" && request.method == "POST" {
                Some((session.branch.clone(), session.commit.clone()))
            } else {
                None
            },
        )
    };
    if request.body.len() > LIMIT * 4 / 3 + 8 {
        return Err("Git request exceeds 64 MiB".into());
    }
    let body = STANDARD
        .decode(&request.body)
        .map_err(|_| "Invalid request body")?;
    if body.len() > LIMIT {
        return Err("Git request exceeds 64 MiB".into());
    }
    if let Some((branch, commit)) = reviewed {
        reviewed_push(&body, &branch, &commit)?;
    }
    validate_headers(&request.headers)?;
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .user_agent("tetorica-midi-playground")
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|e| e.to_string())?;
        let method =
            reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|_| "Invalid method")?;
        let mut call = authentication(client.request(method, url.as_str()).body(body), &token);
        for (name, value) in request.headers {
            call = call.header(name, value);
        }
        let response = call.send().map_err(|e| e.to_string())?;
        let status = response.status();
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err(
                "Git host rejected authentication. Check token permissions and the repository URL"
                    .into(),
            );
        }
        if status.is_redirection() {
            return Err(
                "Repository redirected; set origin to its final HTTPS URL and retry".into(),
            );
        }
        let headers = response
            .headers()
            .iter()
            .filter(|(name, _)| ["content-type", "content-length"].contains(&name.as_str()))
            .filter_map(|(name, value)| {
                value
                    .to_str()
                    .ok()
                    .map(|v| (name.to_string(), v.to_owned()))
            })
            .collect();
        let mut bytes = Vec::new();
        response
            .take((LIMIT + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > LIMIT {
            return Err("Git response exceeds 64 MiB".into());
        }
        Ok(Response {
            url: url.to_string(),
            status_code: status.as_u16(),
            status_message: status.canonical_reason().unwrap_or("").into(),
            headers,
            body: STANDARD.encode(bytes),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn git_https_end(
    window: WebviewWindow,
    state: tauri::State<'_, Transport>,
    session: String,
) -> Result<()> {
    super::allowed(&window)?;
    let mut scope = state.0.lock().map_err(|e| e.to_string())?;
    if scope.as_ref().is_some_and(|s| s.id == session) {
        *scope = None;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn anonymous_requests_omit_credentials_and_headers_cannot_override_native_auth() {
        let client = reqwest::blocking::Client::new();
        let url = "https://github.com/owner/repository.git/info/refs?service=git-upload-pack";
        let anonymous = authentication(client.get(url), "").build().unwrap();
        assert!(!anonymous.headers().contains_key("authorization"));
        let authenticated = authentication(client.get(url), "dummy-token")
            .build()
            .unwrap();
        assert_eq!(
            authenticated.headers()["authorization"],
            format!("Basic {}", STANDARD.encode("x-access-token:dummy-token"))
        );
        assert!(validate_headers(&BTreeMap::from([(
            "Content-Type".into(),
            "application/x-git-upload-pack-request".into()
        )]))
        .is_ok());
        for (name, value) in [
            ("Authorization", "Bearer supplied-by-js"),
            ("Cookie", "secret=1"),
            ("Accept", "good\r\nBad: injected"),
        ] {
            assert!(validate_headers(&BTreeMap::from([(name.into(), value.into())])).is_err());
        }
    }
    #[test]
    fn begin_and_request_ipc_reject_supplied_secrets() {
        assert!(serde_json::from_value::<Begin>(serde_json::json!({"url":"https://github.com/owner/repository.git", "operation":"push", "branch":"main", "commit":"a".repeat(40), "token":"supplied-by-js"})).is_err());
        assert!(serde_json::from_value::<Request>(serde_json::json!({"session":"session", "url":"https://github.com/owner/repository.git", "method":"GET", "headers":{}, "body":"", "password":"supplied-by-js"})).is_err());
    }
    #[test]
    fn native_branch_validation_rejects_ambiguous_refs() {
        for branch in ["main", "feature/pcm", "release-2026.11"] {
            assert!(valid_branch(branch), "{branch}");
        }
        for branch in [
            "",
            "-main",
            "main/",
            "/main",
            "main..old",
            "main@{0}",
            "@",
            "main.lock",
            "work/.hidden",
            "main with space",
            "work//main",
            "main?",
            "main\\other",
        ] {
            assert!(!valid_branch(branch), "{branch}");
        }
    }
    #[test]
    fn replacing_or_deleting_a_token_revokes_its_active_session() {
        let transport = Transport::default();
        transport
            .install(transport.generation(), fake_session())
            .unwrap();
        transport.revoke_token("other-token").unwrap();
        assert!(transport.0.lock().unwrap().is_some());
        transport.revoke_token("saved-token").unwrap();
        assert!(transport.0.lock().unwrap().is_none());
        transport.clear().unwrap();
    }
    fn fake_session() -> Session {
        Session {
            id: "session".into(),
            repository: repository_url("https://github.com/owner/repository.git").unwrap(),
            operation: "push".into(),
            branch: "main".into(),
            commit: "a".repeat(40),
            token: Zeroizing::new("dummy-token".into()),
            token_id: "saved-token".into(),
            expires: Instant::now() + Duration::from_secs(60),
        }
    }
    #[test]
    fn destroying_the_window_prevents_pending_authentication_from_recreating_a_session() {
        let transport = Transport::default();
        let pending = transport.generation();
        transport.clear().unwrap();
        assert!(transport.install(pending, fake_session()).is_err());
        assert!(transport.0.lock().unwrap().is_none());
        transport
            .install(transport.generation(), fake_session())
            .unwrap();
    }
    #[test]
    fn token_changes_invalidate_secrets_copied_by_pending_authentication() {
        let transport = Transport::default();
        let pending = transport.generation();
        transport.revoke_token("saved-token").unwrap();
        assert!(transport.install(pending, fake_session()).is_err());
        assert!(transport.0.lock().unwrap().is_none());
        transport
            .install(transport.generation(), fake_session())
            .unwrap();
    }
    #[test]
    fn transport_is_scoped_to_an_approved_repository_and_protocol() {
        let repo = repository_url("https://github.com/owner/repository.git").unwrap();
        assert!(endpoint(
            &repo,
            "push",
            "https://github.com/owner/repository.git/info/refs?service=git-receive-pack",
            "GET"
        )
        .is_ok());
        assert!(endpoint(
            &repo,
            "push",
            "https://github.com/owner/repository.git/git-receive-pack",
            "POST"
        )
        .is_ok());
        for value in [
            "https://evil.example/owner/repository.git/git-receive-pack",
            "https://github.com/other/repository.git/git-receive-pack",
            "https://github.com/owner/repository.git/git-upload-pack",
            "https://user:token@github.com/owner/repository.git/git-receive-pack",
        ] {
            assert!(endpoint(&repo, "push", value, "POST").is_err());
        }
        assert!(repository_url("http://github.com/owner/repository.git").is_err());
        assert!(repository_url("https://token@github.com/owner/repository.git").is_err());
    }
    #[test]
    fn push_packet_must_match_reviewed_branch_and_commit() {
        let oid = "a".repeat(40);
        let line = format!(
            "{} {} refs/heads/main\0 report-status side-band-64k\n",
            "0".repeat(40),
            oid
        );
        let packet = format!("{:04x}{}0000PACK", line.len() + 4, line).into_bytes();
        assert!(reviewed_push(&packet, "main", &oid).is_ok());
        assert!(reviewed_push(&packet, "other", &oid).is_err());
        assert!(reviewed_push(&packet, "main", &"b".repeat(40)).is_err());
        let multi = format!("{:04x}{}0010extra-ref", line.len() + 4, line).into_bytes();
        assert!(reviewed_push(&multi, "main", &oid).is_err());
    }
}
