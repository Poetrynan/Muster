use reqwest::{Client, cookie::CookieStore};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use keyring::Entry;
use tauri::Emitter;

use crate::moodle::models::{LoginResponse, User};
use crate::moodle::scraper::MoodleScraper;

const MOODLE_BASE_URL: &str = "https://learning.monash.edu";
const LOGIN_URL: &str = "https://learning.monash.edu/login/index.php";
const MY_COURSES_URL: &str = "https://learning.monash.edu/my/";
const TOKEN_URL: &str = "https://learning.monash.edu/login/token.php";

/// Session data that can be saved and reused
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionData {
    pub cookies: Vec<CookieData>,
    pub user_agent: String,
    pub timestamp: String,
}

/// Result of session restore: whether a session was found, plus the logged-in
/// user (if we could fetch it). Serialized to `{ loggedIn, user }` for the
/// frontend (camelCase) so the app can repopulate the user object on restart
/// instead of falling back to the persisted placeholder.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub logged_in: bool,
    pub user: Option<User>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CookieData {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
}

/// Authentication service for Moodle
#[derive(Debug, Clone)]
pub struct MoodleAuth {
    client: Client,
    cookie_store: Arc<reqwest::cookie::Jar>,
    base_url: String,
    is_logged_in: Arc<Mutex<bool>>,
    session: Arc<Mutex<Option<SessionData>>>,
    session_path: PathBuf,
}

impl MoodleAuth {
    pub fn new() -> Self {
        let cookie_store = Arc::new(reqwest::cookie::Jar::default());
        
        let client = Client::builder()
            .cookie_provider(cookie_store.clone())
            .redirect(reqwest::redirect::Policy::limited(10))
            .timeout(std::time::Duration::from_secs(30))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()
            .expect("Failed to create HTTP client");

        let session_path = Self::get_session_path();

        Self {
            client,
            cookie_store,
            base_url: MOODLE_BASE_URL.to_string(),
            is_logged_in: Arc::new(Mutex::new(false)),
            session: Arc::new(Mutex::new(None)),
            session_path,
        }
    }

    /// Get the path for storing session data
    fn get_session_path() -> PathBuf {
        let mut path = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
        path.push("muster");
        path.push("session.json");
        path
    }

    /// Extract cookies from the cookie store for a specific URL
    fn extract_cookies(&self, url: &str) -> Vec<CookieData> {
        let url = match url.parse::<reqwest::Url>() {
            Ok(u) => u,
            Err(_) => return vec![],
        };

        // Get cookies header value from the store
        let cookies_header = self.cookie_store.cookies(&url);
        
        // Parse the cookie header
        let mut cookies = Vec::new();
        if let Some(header_value) = cookies_header {
            if let Ok(header_str) = header_value.to_str() {
                for cookie_pair in header_str.split(';') {
                    let parts: Vec<&str> = cookie_pair.trim().splitn(2, '=').collect();
                    if parts.len() == 2 {
                        cookies.push(CookieData {
                            name: parts[0].trim().to_string(),
                            value: parts[1].trim().to_string(),
                            domain: url.host_str().unwrap_or("").to_string(),
                            path: "/".to_string(),
                        });
                    }
                }
            }
        }
        
        cookies
    }

    /// Create a new client with stored session cookies
    pub fn create_client_with_session(session: &SessionData) -> Result<Client, String> {
        let cookie_jar = reqwest::cookie::Jar::default();
        
        for cookie_data in &session.cookies {
            let cookie_string = format!("{}={}", cookie_data.name, cookie_data.value);
            let domain = &cookie_data.domain;
            cookie_jar.add_cookie_str(
                &cookie_string,
                &format!("https://{}", domain).parse().map_err(|e: url::ParseError| e.to_string())?,
            );
        }

        Client::builder()
            .cookie_provider(Arc::new(cookie_jar))
            .redirect(reqwest::redirect::Policy::limited(10))
            .timeout(std::time::Duration::from_secs(30))
            .user_agent(&session.user_agent)
            .build()
            .map_err(|e| format!("Failed to create client: {}", e))
    }

    /// Login with username and password using Moodle Mobile App token
    pub async fn login(&self, username: &str, password: &str) -> Result<LoginResponse, String> {
        // Try token-based login first (works with moodle_mobile_app service)
        let token_params = [
            ("username", username),
            ("password", password),
            ("service", "moodle_mobile_app"),
        ];

        println!("Attempting token-based login for: {}", username);
        
        let token_response = self
            .client
            .post(TOKEN_URL)
            .form(&token_params)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch token: {}", e))?;

        let token_url = token_response.url().as_str().to_string();
        println!("Token response URL: {}", token_url);

        // Check if redirected to SSO
        if token_url.contains("okta.com") || token_url.contains("accounts.google.com") || token_url.contains("microsoftonline.com") {
            return Err("SSO_REQUIRED".to_string());
        }

        let token_text = token_response
            .text()
            .await
            .map_err(|e| format!("Failed to read token response: {}", e))?;

        println!("Token response: {}", token_text);

        // Try to parse as JSON (successful token response)
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&token_text) {
            if let Some(token) = json.get("token").and_then(|t| t.as_str()) {
                println!("Got token: {}", token);
                
                // Save the token and return success
                let session = SessionData {
                    cookies: vec![CookieData {
                        name: "MoodleMobileAppToken".to_string(),
                        value: token.to_string(),
                        domain: "learning.monash.edu".to_string(),
                        path: "/".to_string(),
                    }],
                    user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".to_string(),
                    timestamp: chrono::Local::now().to_rfc3339(),
                };
                self.save_session_data(&session).await?;

                let mut is_logged_in = self.is_logged_in.lock().await;
                *is_logged_in = true;

                return Ok(LoginResponse {
                    success: true,
                    message: "Login successful".to_string(),
                    user: Some(User {
                        id: 1,
                        username: username.to_string(),
                        full_name: username.to_string(),
                        email: format!("{}@monash.edu", username),
                        profile_image: String::new(),
                    }),
                });
            }
        }

        // If we get here, token login failed
        Err("Invalid credentials or SSO required".to_string())
    }

    /// Legacy form-based login (may not work with SSO)
    pub async fn login_legacy(&self, username: &str, password: &str) -> Result<LoginResponse, String> {
        // First, get the login page to obtain the token
        let login_page = self
            .client
            .get(LOGIN_URL)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch login page: {}", e))?;

        // Check for redirects
        let final_url = login_page.url().as_str().to_string();
        println!("Login page URL: {}", final_url);
        
        // If redirected to a different login page (SSO), handle accordingly
        if final_url.contains("okta.com") || final_url.contains("accounts.google.com") || final_url.contains("microsoftonline.com") {
            return Err("SSO_REQUIRED".to_string());
        }

        let login_page_text = login_page
            .text()
            .await
            .map_err(|e| format!("Failed to read login page: {}", e))?;

        // Extract logintoken from the page
        let token = match self.extract_login_token(&login_page_text) {
            Ok(t) => t,
            Err(_e) => {
                self.extract_login_token_alternative(&login_page_text)?
            }
        };

        // Prepare login form data
        let form_data = [
            ("username", username),
            ("password", password),
            ("logintoken", &token),
        ];

        // Submit login form
        let response = self
            .client
            .post(LOGIN_URL)
            .form(&form_data)
            .send()
            .await
            .map_err(|e| format!("Failed to submit login: {}", e))?;

        // Check if login was successful
        let final_url = response.url().as_str().to_string();
        let success = !final_url.contains("login/index.php");

        if success {
            // Extract and save cookies
            let cookies = self.extract_cookies(MOODLE_BASE_URL);
            
            if cookies.is_empty() {
                // Try extracting with http prefix
                let http_cookies = self.extract_cookies(&format!("http://{}", MOODLE_BASE_URL.replace("https://", "")));
                if !http_cookies.is_empty() {
                    let session = SessionData {
                        cookies: http_cookies,
                        user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".to_string(),
                        timestamp: chrono::Local::now().to_rfc3339(),
                    };
                    self.save_session_data(&session).await?;
                    let mut session_guard = self.session.lock().await;
                    *session_guard = Some(session);
                }
            } else {
                let session = SessionData {
                    cookies,
                    user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".to_string(),
                    timestamp: chrono::Local::now().to_rfc3339(),
                };
                self.save_session_data(&session).await?;
                let mut session_guard = self.session.lock().await;
                *session_guard = Some(session);
            }

            let mut is_logged_in = self.is_logged_in.lock().await;
            *is_logged_in = true;

            // Extract user info
            let user = self.fetch_user_info().await.ok();

            Ok(LoginResponse {
                success: true,
                message: "Login successful".to_string(),
                user,
            })
        } else {
            Ok(LoginResponse {
                success: false,
                message: "Invalid username or password".to_string(),
                user: None,
            })
        }
    }

    /// Login with session cookies (from WebView login)
    ///
    /// This is the path used after the embedded WebView completes SSO: the
    /// WebView's cookies (including HttpOnly `MoodleSession`) are handed to a
    /// fresh `reqwest` client that becomes the authenticated client for all
    /// later scraping. Verifies the session actually reaches the dashboard
    /// before persisting it.
    pub async fn login_with_cookies(&self, cookies: Vec<CookieData>) -> Result<LoginResponse, String> {
        if cookies.is_empty() {
            return Err("No cookies provided".to_string());
        }

        let session = SessionData {
            cookies,
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".to_string(),
            timestamp: chrono::Local::now().to_rfc3339(),
        };

        // Verify the session by making a request to the dashboard.
        let client = Self::create_client_with_session(&session)?;
        let response = client
            .get(MY_COURSES_URL)
            .send()
            .await
            .map_err(|e| format!("Failed to verify session: {}", e))?;

        let final_url = response.url().as_str().to_string();
        let status = response.status();
        println!(
            "Cookie login verification: status={}, url={}",
            status, final_url
        );

        // If we were bounced to a login/SSO page, the session is no good.
        if is_logged_out_url(&final_url) {
            return Ok(LoginResponse {
                success: false,
                message: "Cookie is invalid or expired. Please log in again.".to_string(),
                user: None,
            });
        }

        // Save the session and mark logged in.
        self.save_session_data(&session).await?;

        let mut is_logged_in = self.is_logged_in.lock().await;
        *is_logged_in = true;

        let user = self.fetch_user_info_with_client(&client).await.ok();

        Ok(LoginResponse {
            success: true,
            message: "Login successful".to_string(),
            user,
        })
    }

    /// Login after SSO callback - try to get session from the redirect chain
    /// 
    /// This function is called after the SSO callback is received.
    /// It attempts to establish a session with Moodle by making a request
    /// and following the redirect chain.
    /// 
    /// NOTE: This approach has limitations because the browser and Rust client
    /// have separate cookie stores. For a more reliable SSO login, consider
    /// using the WebView-based approach (start_sso_login_webview) which can
    /// share cookies with the app.
    pub async fn login_with_sso_callback(&self) -> Result<LoginResponse, String> {
        println!("Attempting to establish session after SSO callback...");
        
        // Create a client with cookie store
        let cookie_store = Arc::new(reqwest::cookie::Jar::default());
        let client = Client::builder()
            .cookie_provider(cookie_store.clone())
            .redirect(reqwest::redirect::Policy::limited(10))
            .timeout(Duration::from_secs(30))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()
            .map_err(|e| format!("Failed to create client: {}", e))?;

        // Make request to Moodle my page
        let response = client
            .get(MY_COURSES_URL)
            .send()
            .await
            .map_err(|e| format!("Failed to connect to Moodle: {}", e))?;

        let status = response.status();
        let final_url = response.url().as_str().to_string();

        println!("SSO callback check - status: {}, url: {}", status, final_url);

        // Check if we got redirected to login page or SSO provider
        if final_url.contains("login") || final_url.contains("okta.com") || final_url.contains("accounts.google.com") || final_url.contains("microsoftonline.com") {
            println!("SSO login required - user not authenticated");
            return Ok(LoginResponse {
                success: false,
                message: "SSO login required. Please complete the login in the browser.".to_string(),
                user: None,
            });
        }

        // Check if we successfully reached the dashboard
        if status.is_success() && !final_url.contains("login") {
            // Extract cookies from the cookie store
            let moodle_url = url::Url::parse(&self.base_url)
                .map_err(|e| format!("Failed to parse URL: {}", e))?;

            let cookies: Vec<CookieData> = cookie_store
                .cookies(&moodle_url)
                .iter()
                .filter_map(|cookie| {
                    let cookie_str = cookie.to_str().ok()?;
                    let parts: Vec<&str> = cookie_str.splitn(2, '=').collect();
                    if parts.len() == 2 {
                        Some(CookieData {
                            name: parts[0].trim().to_string(),
                            value: parts[1].trim().to_string(),
                            domain: "learning.monash.edu".to_string(),
                            path: "/".to_string(),
                        })
                    } else {
                        None
                    }
                })
                .collect();

            if !cookies.is_empty() {
                println!("Found {} cookies, establishing session...", cookies.len());
                
                // Create session with cookies
                let session = SessionData {
                    cookies,
                    user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".to_string(),
                    timestamp: chrono::Local::now().to_rfc3339(),
                };

                // Save the session
                self.save_session_data(&session).await?;

                let mut is_logged_in = self.is_logged_in.lock().await;
                *is_logged_in = true;

                let mut session_guard = self.session.lock().await;
                *session_guard = Some(session);

                return Ok(LoginResponse {
                    success: true,
                    message: "Login successful".to_string(),
                    user: None,
                });
            } else {
                println!("No cookies found in response");
            }
        }

        // If we get here, the SSO session couldn't be established
        // This is expected when using the system browser approach because
        // cookies are domain-specific and won't be shared with our Rust client
        println!("Could not establish SSO session - cookies not available to Rust client");
        Ok(LoginResponse {
            success: false,
            message: "SSO session could not be established. The browser and app have separate cookie stores. \
                     Please try using the WebView login option or contact support.".to_string(),
            user: None,
        })
    }

    /// Check if user is logged in
    pub async fn is_logged_in(&self) -> bool {
        *self.is_logged_in.lock().await
    }

    fn get_keyring_entry() -> Result<Entry, String> {
        Entry::new("com.poetrynan.muster", "session")
            .map_err(|e| format!("Failed to access OS keyring: {}", e))
    }

    /// Logout from Moodle
    pub async fn logout(&self) -> Result<(), String> {
        // Clear saved session from OS keyring
        if let Ok(entry) = Self::get_keyring_entry() {
            let _ = entry.delete_password();
        }

        // Clean up legacy plaintext session file if it exists
        if self.session_path.exists() {
            let _ = fs::remove_file(&self.session_path);
        }

        let mut is_logged_in = self.is_logged_in.lock().await;
        *is_logged_in = false;

        let mut session = self.session.lock().await;
        *session = None;

        Ok(())
    }

    /// Fast path: Load saved session from OS Keyring, populate auth state and scraper,
    /// and return `Ok(true)` immediately in <5ms without blocking on network requests.
    /// Spawns an asynchronous un-awaited Tokio task to verify session validity in background.
    pub async fn load_saved_session(
        &self,
        app_handle: tauri::AppHandle,
        scraper: Arc<Mutex<Option<MoodleScraper>>>,
    ) -> Result<SessionInfo, String> {
        // 1. Try loading session from OS keyring
        let mut content = None;
        if let Ok(entry) = Self::get_keyring_entry() {
            if let Ok(pwd) = entry.get_password() {
                if !pwd.trim().is_empty() {
                    content = Some(pwd);
                }
            }
        }

        // 2. Fallback: Check local storage session file
        if content.is_none() && self.session_path.exists() {
            if let Ok(file_content) = fs::read_to_string(&self.session_path) {
                if !file_content.trim().is_empty() {
                    content = Some(file_content);
                }
            }
        }

        let Some(json_str) = content else {
            return Ok(SessionInfo { logged_in: false, user: None });
        };

        let session: SessionData = match serde_json::from_str(&json_str) {
            Ok(s) => s,
            Err(_) => {
                if let Ok(entry) = Self::get_keyring_entry() {
                    let _ = entry.delete_password();
                }
                return Ok(SessionInfo { logged_in: false, user: None });
            }
        };

        if session.cookies.is_empty() {
            if let Ok(entry) = Self::get_keyring_entry() {
                let _ = entry.delete_password();
            }
            return Ok(SessionInfo { logged_in: false, user: None });
        }

        // Fast path: Immediately set auth state and initialize scraper instance
        {
            let mut is_logged_in = self.is_logged_in.lock().await;
            *is_logged_in = true;
        }

        {
            let mut session_guard = self.session.lock().await;
            *session_guard = Some(session.clone());
        }

        {
            let mut scraper_guard = scraper.lock().await;
            *scraper_guard = Some(MoodleScraper::new(Arc::new(self.clone())));
        }

        // Background verification: Spawn asynchronous un-awaited Tokio task
        let auth_clone = self.clone();
        let session_clone = session.clone();
        let scraper_clone = scraper.clone();
        tokio::spawn(async move {
            auth_clone
                .verify_session_background(session_clone, app_handle, scraper_clone)
                .await;
        });

        // Repopulate the user object from the restored session so the frontend
        // does not fall back to the persisted placeholder on restart. Network
        // failure here must NOT fail the restore — degrade to `user: None`.
        let client = match Self::create_client_with_session(&session) {
            Ok(c) => c,
            Err(_) => return Ok(SessionInfo { logged_in: true, user: None }),
        };
        let user = self.fetch_user_info_with_client(&client).await.ok();

        Ok(SessionInfo { logged_in: true, user })
    }

    /// Background session verification task.
    /// Pings MY_COURSES_URL in the background. If session is expired or invalid,
    /// purges keyring, resets auth and scraper state, and emits session-expired event.
    pub async fn verify_session_background(
        &self,
        session: SessionData,
        app_handle: tauri::AppHandle,
        scraper: Arc<Mutex<Option<MoodleScraper>>>,
    ) {
        let client = match Self::create_client_with_session(&session) {
            Ok(c) => c,
            Err(_) => {
                self.handle_session_expired(app_handle, scraper).await;
                return;
            }
        };

        let is_valid = match client
            .get(MY_COURSES_URL)
            .timeout(std::time::Duration::from_secs(4))
            .send()
            .await
        {
            Ok(resp) => {
                let final_url = resp.url().as_str().to_string();
                !is_logged_out_url(&final_url)
            }
            Err(_) => {
                // Network error — offline mode fallback, consider session valid
                true
            }
        };

        if !is_valid {
            println!("Background verification: Session expired, purging auth state and emitting session-expired");
            self.handle_session_expired(app_handle, scraper).await;
        }
    }

    /// Handle expired session by clearing credentials and notifying frontend
    async fn handle_session_expired(
        &self,
        app_handle: tauri::AppHandle,
        scraper: Arc<Mutex<Option<MoodleScraper>>>,
    ) {
        if let Ok(entry) = Self::get_keyring_entry() {
            let _ = entry.delete_password();
        }
        if self.session_path.exists() {
            let _ = fs::remove_file(&self.session_path);
        }

        {
            let mut is_logged_in = self.is_logged_in.lock().await;
            *is_logged_in = false;
        }

        {
            let mut session_guard = self.session.lock().await;
            *session_guard = None;
        }

        {
            let mut scraper_guard = scraper.lock().await;
            *scraper_guard = None;
        }

        let _ = app_handle.emit("session-expired", ());
    }

    /// Get the HTTP client for making authenticated requests
    pub async fn get_authenticated_client(&self) -> Result<Client, String> {
        let session_guard = self.session.lock().await;
        let session = session_guard.as_ref().ok_or("Not logged in")?;
        Self::create_client_with_session(session)
    }

    /// Get the saved session cookies (if any)
    pub async fn get_saved_cookies(&self) -> Vec<CookieData> {
        if let Some(session) = self.session.lock().await.as_ref() {
            return session.cookies.clone();
        }
        Vec::new()
    }

    /// Get the base URL
    pub fn get_base_url(&self) -> &str {
        &self.base_url
    }

    /// Fetch user info from Moodle using the authenticated session client.
    ///
    /// `self.client` has an empty cookie jar, so after a cookie-based login we
    /// must pass the session-bearing client explicitly. Parses the dashboard
    /// HTML for the logged-in user's name; falls back to a placeholder.
    async fn fetch_user_info_with_client(&self, client: &Client) -> Result<User, String> {
        let response = client
            .get(MY_COURSES_URL)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch dashboard for user info: {}", e))?;

        let html = response
            .text()
            .await
            .map_err(|e| format!("Failed to read dashboard: {}", e))?;

        // The /my/ dashboard only reliably exposes the numeric user id and the
        // display name. The email + authcate login id are NOT in this page
        // (verified on the live dump: 0 matches for @monash.edu / data-useremail
        // / data-username), so we fetch the user's own profile page next.
        let (user_id, full_name) = parse_user_from_dashboard(&html);

        let (profile_email, profile_username) = match user_id {
            Some(uid) => self.fetch_profile_contact(client, uid).await.unwrap_or((None, None)),
            None => (None, None),
        };

        // Build the login id: prefer the profile email prefix (cf123456), then a
        // profile username that looks like an account (no spaces), else placeholder.
        let login_id = profile_email
            .as_ref()
            .and_then(|e| e.split('@').next())
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                profile_username
                    .as_ref()
                    .filter(|u| !u.contains(' ') && !u.is_empty())
                    .cloned()
            })
            .unwrap_or_else(|| "student".to_string());

        let final_email = profile_email.unwrap_or_else(|| {
            if login_id != "student" {
                format!("{}@student.monash.edu", login_id)
            } else {
                // Total failure: dump the dashboard HTML to the project samples/
                // directory so it can be inspected without manual file transfers.
                let uid = user_id.map(|id| id.to_string()).unwrap_or_else(|| "unknown".to_string());
                let p = dump_auth_debug_html(&format!("debug_userinfo_fail_{}.html", uid), &html);
                eprintln!(
                    "[user-info] Could not parse an email from the dashboard or profile page; HTML saved to {}",
                    p.display()
                );
                "student@monash.edu".to_string()
            }
        });

        Ok(User {
            id: user_id.unwrap_or(1001),
            username: login_id,
            full_name: full_name.unwrap_or_else(|| "Monash Student".to_string()),
            email: final_email,
            profile_image: String::new(),
        })
    }

    /// Fetch the user's own profile page and extract the real email + authcate
    /// username. The `/my/` dashboard no longer exposes these (verified: live
    /// dump has 0 matches for `@monash.edu` / `data-useremail` / `data-username`),
    /// so the profile page is the canonical source. Network/parse failure
    /// degrades to `(None, None)` — callers must handle the placeholder case.
    async fn fetch_profile_contact(
        &self,
        client: &Client,
        user_id: u64,
    ) -> Result<(Option<String>, Option<String>), String> {
        let url = format!("{}/user/profile.php?id={}", MOODLE_BASE_URL, user_id);
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch profile page: {}", e))?;
        let html = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read profile page: {}", e))?;
        let result = parse_contact_from_profile(&html);
        if result.0.is_none() {
            // On parse failure, dump to the project's samples/ so the real location where Monash
            // exposes the email can be tracked down offline.
            // (Note: this file contains your own profile page HTML, for local debugging only.)
            let p = dump_auth_debug_html(&format!("debug_profile_fail_{}.html", user_id), &html);
            eprintln!(
                "[user-info] Could not parse an email from the profile page; raw HTML saved to {}",
                p.display()
            );
        }
        Ok(result)
    }

    /// Fetch user info from Moodle (legacy, used by form-based login paths).
    async fn fetch_user_info(&self) -> Result<User, String> {
        self.fetch_user_info_with_client(&self.client).await
    }

    /// Extract login token from login page HTML
    fn extract_login_token(&self, html: &str) -> Result<String, String> {
        let re = regex::Regex::new(r#"name="logintoken" value="([^"]+)""#)
            .map_err(|e| format!("Failed to compile regex: {}", e))?;

        re.captures(html)
            .and_then(|cap| cap.get(1))
            .map(|m| m.as_str().to_string())
            .ok_or_else(|| "Could not find login token".to_string())
    }

    /// Try alternative patterns to extract login token
    fn extract_login_token_alternative(&self, html: &str) -> Result<String, String> {
        // Try different patterns that Moodle might use
        let patterns = [
            r#"logintoken" value="([^"]+)""#,
            r#"name="logintoken"\s+value="([^"]+)""#,
            r#"value="([^"]+)"\s+name="logintoken""#,
            r#"logintoken"\s*value="([^"]+)""#,
        ];

        for pattern in &patterns {
            if let Ok(re) = regex::Regex::new(pattern) {
                if let Some(cap) = re.captures(html) {
                    if let Some(m) = cap.get(1) {
                        let token = m.as_str().to_string();
                        if !token.is_empty() {
                            println!("Found token with pattern: {}", pattern);
                            return Ok(token);
                        }
                    }
                }
            }
        }

        Err("Could not find login token with any pattern".to_string())
    }

    /// Filter out bulky third-party tracking/analytics cookies (e.g. Google Analytics, AWS ALB)
    /// while strictly preserving all Moodle core and Monash domain cookies.
    fn filter_essential_cookies(cookies: &[CookieData]) -> Vec<CookieData> {
        let mut moodle_cookies = Vec::new();
        let mut other_cookies = Vec::new();

        for c in cookies {
            let name_lower = c.name.to_lowercase();
            // Skip tracking/analytics noise
            if name_lower.starts_with("_ga")
                || name_lower.starts_with("_gid")
                || name_lower.starts_with("_gat")
                || name_lower.starts_with("_fbp")
                || name_lower.starts_with("_hj")
                || name_lower.starts_with("awsalb")
                || name_lower.starts_with("intercom")
            {
                continue;
            }

            if name_lower.contains("moodle") || name_lower.starts_with("moodleid") {
                moodle_cookies.push(c.clone());
            } else {
                other_cookies.push(c.clone());
            }
        }

        let mut result = moodle_cookies;
        for c in other_cookies {
            if result.len() < 12 {
                result.push(c);
            }
        }

        if result.is_empty() {
            cookies.to_vec()
        } else {
            result
        }
    }

    /// Save session data to OS keyring with graceful local file fallback
    async fn save_session_data(&self, session: &SessionData) -> Result<(), String> {
        let filtered_cookies = Self::filter_essential_cookies(&session.cookies);
        let compact_session = SessionData {
            cookies: filtered_cookies,
            user_agent: session.user_agent.clone(),
            timestamp: session.timestamp.clone(),
        };

        let json = serde_json::to_string(&compact_session)
            .map_err(|e| format!("Failed to serialize session: {}", e))?;

        let mut saved_to_keyring = false;
        // Windows Credential Manager has a 2560-character limit.
        if json.len() <= 2400 {
            if let Ok(entry) = Self::get_keyring_entry() {
                if entry.set_password(&json).is_ok() {
                    saved_to_keyring = true;
                }
            }
        }

        // Fallback to local secure app data path if keyring failed or payload was too large
        if !saved_to_keyring {
            if let Some(parent) = self.session_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            fs::write(&self.session_path, &json)
                .map_err(|e| format!("Failed to save session to local storage: {}", e))?;
        } else if self.session_path.exists() {
            let _ = fs::remove_file(&self.session_path);
        }

        let mut session_guard = self.session.lock().await;
        *session_guard = Some(compact_session);

        Ok(())
    }
}

impl Default for MoodleAuth {
    fn default() -> Self {
        Self::new()
    }
}

/// Does this final URL indicate the session is NOT authenticated?
///
/// True when the request was bounced to a login page or an external SSO
/// provider. A bare `learning.monash.edu/my/` URL contains none of these
/// substrings and is treated as authenticated.
fn is_logged_out_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.contains("/login")
        || lower.contains("okta.com")
        || lower.contains("accounts.google.com")
        || lower.contains("microsoftonline.com")
        || lower.contains("/signin")
}

/// Best-effort extraction of the logged-in user's numeric ID and display name
/// from the Moodle dashboard HTML.
///
/// NOTE: The Monash `/my/` dashboard no longer embeds the user's email or
/// authcate login id (verified on the live dump: 0 matches for `@monash.edu`,
/// `data-useremail`, `data-username`). Those must be fetched from the user's
/// profile page — see `fetch_profile_contact`. Here we only grab what the
/// dashboard reliably exposes: `data-userid` and the "You are logged in as"
/// banner name.
fn parse_user_from_dashboard(html: &str) -> (Option<u64>, Option<String>) {
    let user_id = regex::Regex::new(r#"(?:data-userid=|user/profile\.php\?id=|user/view\.php\?id=)"?(\d+)"?"#)
        .ok()
        .and_then(|re| re.captures(html))
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<u64>().ok());

    let full_name = regex::Regex::new(r#"(?i)data-userfullname="([^"]+)""#)
        .ok()
        .and_then(|re| re.captures(html))
        .and_then(|c| c.get(1))
        .map(|m| decode_html_entities(m.as_str()))
        // Fallback: "You are logged in as <a ...>Jane Student</a>" banner, which
        // is present even when data-userfullname is missing (verified on the
        // live /my/ dump). The name sits inside the <a> anchor.
        .or_else(|| {
            regex::Regex::new(r#"(?i)logged in as\s*<a[^>]*>([^<]+)</a>"#)
                .ok()
                .and_then(|re| re.captures(html))
                .and_then(|c| c.get(1))
                .map(|m| decode_html_entities(m.as_str()).trim().to_string())
        })
        // Secondary fallback: plain text "You are logged in as Jane Student (Log out)"
        .or_else(|| {
            regex::Regex::new(r#"(?i)logged in as\s+([^<(]+)"#)
                .ok()
                .and_then(|re| re.captures(html))
                .and_then(|c| c.get(1))
                .map(|m| decode_html_entities(m.as_str()).trim().to_string())
        });

    (user_id, full_name)
}

/// Extract the user's email and authcate username from their profile page HTML.
/// Moodle renders these in the user detail table (Email / Username rows) and/or
/// Extract the user's real email + authcate login id from the profile page.
///
/// Monash obfuscates the email as a *URL-encoded* `mailto:` href, e.g.
/// `<a href="mailto:cf123456@%73%74%75d%65%6e%74%2e%6dona%73%68.ed%75">`.
/// The *visible* text may be injected by JavaScript after load, so the
/// reliable source is the `href` attribute. We URL-decode it, then run the
/// markup-agnostic email regex. The `Username` row is usually absent on the
/// Monash profile page, so the caller derives the login id from the email
/// prefix. Returns `(email, username)`; either may be `None`.
fn parse_contact_from_profile(html: &str) -> (Option<String>, Option<String>) {
    let email = extract_email_from_mailto(html).or_else(|| {
        // Fallback: a literal email sitting anywhere in the (server-rendered) HTML.
        regex::Regex::new(r"[a-zA-Z0-9._%+-]+@(?:student\.)?monash\.edu")
            .ok()
            .and_then(|re| re.captures(html))
            .and_then(|c| c.get(0))
            .map(|m| m.as_str().to_string())
    });

    // Moodle profile "Username" row — tolerant of both old (<th>/<td>) and
    // Bootstrap (<dt>/<dd>) markup. Bonus only; the email prefix is primary.
    let username = regex::Regex::new(
        r#"(?is)Username\s*</(?:th|dt)>\s*<(?:td|dd)[^>]*>\s*([^<]+?)\s*</(?:td|dd)>"#,
    )
    .ok()
    .and_then(|re| re.captures(html))
    .and_then(|c| c.get(1))
    .map(|m| decode_html_entities(m.as_str().trim()).to_string());

    (email, username)
}

/// Pull the email out of a `mailto:` href, URL-decoding the obfuscated form
/// Monash uses (e.g. `mailto:cf%65%6e...` -> `cf123456@student.monash.edu`).
fn extract_email_from_mailto(html: &str) -> Option<String> {
    // Monash double-encodes the email href as *numeric* HTML entities wrapping
    // a percent-encoded `mailto:` (`&#109;&#97;i&#108;&#116;&#111;:` == "mailto:").
    // Decode those first, otherwise the literal `mailto:` regex never matches.
    let html = decode_html_entities(html);
    let href = regex::Regex::new(r#"mailto:([^"'\s]+)"#)
        .ok()
        .and_then(|re| re.captures(&html))
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())?;
    let decoded = mailto_url_decode(&href);
    regex::Regex::new(r"[a-zA-Z0-9._%+-]+@(?:student\.)?monash\.edu")
        .ok()
        .and_then(|re| re.find(&decoded))
        .map(|m| m.as_str().to_string())
}

/// Minimal percent-decoder for `mailto:` obfuscation (`%XX` -> byte).
fn mailto_url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Dump raw HTML into the project `samples/` directory for offline debugging.
/// Mirrors the pattern used by `scraper.rs` so the same folder is inspected
/// (and the assistant can read it without the user manually sending files).
fn dump_auth_debug_html(filename: &str, html: &str) -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../samples");
    let _ = fs::create_dir_all(&dir);
    let path = dir.join(filename);
    let _ = fs::write(&path, html);
    path
}

/// Decode HTML entities in a (server-rendered) fragment:
/// - the named entities Moodle commonly emits in user names/usernames;
/// - numeric entities, both decimal (`&#NNN;`) and hex (`&#xHH;`).
///
/// Monash double-encodes the profile email href as numeric HTML entities
/// wrapping a percent-encoded `mailto:` string
/// (`&#109;&#97;i&#108;&#116;&#111;:` == "mailto:", then `%63%66%65...` == "cfe...").
/// Without decoding the numeric layer the literal `mailto:` regex would never
/// match and we'd fall back to `student@monash.edu`.
fn decode_html_entities(s: &str) -> String {
    // 1. Resolve the handful of named entities first.
    let s = s
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#039;", "'")
        .replace("&apos;", "'");

    // 2. Resolve numeric entities (`&#DDD;` / `&#xHH;`) by walking chars so
    //    surrounding UTF-8 is preserved byte-for-byte.
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '&' && i + 1 < chars.len() && chars[i + 1] == '#' {
            let mut j = i + 2;
            let mut hex = false;
            if j < chars.len() && (chars[j] == 'x' || chars[j] == 'X') {
                hex = true;
                j += 1;
            }
            let start = j;
            while j < chars.len() && chars[j] != ';' {
                j += 1;
            }
            if j < chars.len() && chars[j] == ';' && j > start {
                let num_str: String = chars[start..j].iter().collect();
                let parsed = if hex {
                    u32::from_str_radix(&num_str, 16)
                } else {
                    num_str.parse::<u32>()
                };
                if let Ok(cp) = parsed {
                    if let Some(ch) = char::from_u32(cp) {
                        out.push(ch);
                        i = j + 1;
                        continue;
                    }
                }
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{parse_contact_from_profile, parse_user_from_dashboard};

    // Mirrors the live /my/ dump: has data-userid + "logged in as" banner but
    // NO email / data-useremail / data-username (verified on the real page).
    const DASHBOARD: &str = r#"<div class="logininfo">You are logged in as <a href="https://learning.monash.edu/user/profile.php?id=100001">Jane Student</a> (<a href="https://learning.monash.edu/login/logout.php?sesskey=F3GYS4xL9H">Log out</a>)</div>"#;

    #[test]
    fn parses_id_and_name_from_dashboard_banner() {
        let (user_id, full_name) = parse_user_from_dashboard(DASHBOARD);
        assert_eq!(user_id, Some(100001));
        assert_eq!(full_name.as_deref(), Some("Jane Student"));
    }

    #[test]
    fn data_userfullname_still_takes_precedence() {
        let html = r#"<body data-userid="1" data-userfullname="Jane Doe"><div class="logininfo">You are logged in as <a href="x">Ignored Name</a></div></body>"#;
        let (_id, full_name) = parse_user_from_dashboard(html);
        assert_eq!(full_name.as_deref(), Some("Jane Doe"));
    }

    // The email / authcate id live on the profile page, not the dashboard.
    #[test]
    fn parses_email_and_username_from_profile_page() {
        let profile = r#"
            <table>
              <tbody>
                <tr><th scope="row">Username</th><td>cf123456</td></tr>
                <tr><th scope="row">Email address</th><td><a href="mailto:cf123456@student.monash.edu">cf123456@student.monash.edu</a></td></tr>
              </tbody>
            </table>"#;
        let (email, username) = parse_contact_from_profile(profile);
        assert_eq!(email.as_deref(), Some("cf123456@student.monash.edu"));
        assert_eq!(username.as_deref(), Some("cf123456"));
    }

    // Bootstrap-style profile markup uses <dt>/<dd> instead of <th>/<td>.
    #[test]
    fn parses_username_from_bootstrap_profile_markup() {
        let profile = r#"<dl><dt>Username</dt><dd>cf123456</dd><dt>Email address</dt><dd>cf123456@student.monash.edu</dd></dl>"#;
        let (email, username) = parse_contact_from_profile(profile);
        assert_eq!(email.as_deref(), Some("cf123456@student.monash.edu"));
        assert_eq!(username.as_deref(), Some("cf123456"));
    }

    // Monash obfuscates the email as a URL-encoded mailto: href; the visible
    // text may be JS-injected, so we must read + decode the href attribute.
    #[test]
    fn parses_email_from_encoded_mailto_href() {
        let profile = r#"<a href="mailto:cf123456@%73%74%75d%65%6e%74%2e%6dona%73%68.ed%75">cf123456@student.monash.edu</a>"#;
        let (email, _username) = parse_contact_from_profile(profile);
        assert_eq!(email.as_deref(), Some("cf123456@student.monash.edu"));
    }

    // REAL Monash format (from debug_profile_fail_100001.html): the email href
    // is double-encoded — HTML *numeric* entities wrap a percent-encoded
    // `mailto:` (`&#109;&#97;i&#108;&#116;&#111;:` => "mailto:"). Without
    // decoding the numeric layer the literal `mailto:` regex never matches.
    #[test]
    fn parses_email_from_numeric_entity_encoded_mailto_href() {
        let profile = r#"<dt>Email address</dt><dd><a href="&#109;&#97;i&#108;&#116;&#111;:%63f123456@%73tu%64%65%6e%74%2e%6d%6f%6eas%68.ed%75">cf123456@student.monash.edu</a></dd>"#;
        let (email, _username) = parse_contact_from_profile(profile);
        assert_eq!(email.as_deref(), Some("cf123456@student.monash.edu"));
    }
}
