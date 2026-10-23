use reqwest::Client;
use reqwest::cookie::CookieStore;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

use crate::moodle::auth::{CookieData, SessionData};

const TIMETABLE_BASE_URL: &str = "https://my-timetable.monash.edu";
const TIMETABLE_STUDENT_URL: &str = "https://my-timetable.monash.edu/even/student";

/// Authentication service for my-timetable.monash.edu.
///
/// Uses the parent Moodle session's `.monash.edu` cookies for SSO, then
/// extracts the `ss` token from the timetable page URL for API calls.
#[derive(Debug, Clone)]
pub struct TimetableAuth {
    client: Client,
    cookie_jar: Arc<reqwest::cookie::Jar>,
    is_logged_in: Arc<Mutex<bool>>,
    session: Arc<Mutex<Option<SessionData>>>,
}

impl TimetableAuth {
    pub fn new(parent_session: &SessionData) -> Result<Self, String> {
        let parent_cookies: Vec<CookieData> = parent_session
            .cookies
            .iter()
            .filter(|c| {
                c.domain == "monash.edu"
                    || c.domain == ".monash.edu"
                    || c.domain.ends_with(".monash.edu")
            })
            .cloned()
            .collect();

        if parent_cookies.is_empty() {
            return Err("No parent-domain cookies found in Moodle session".to_string());
        }

        let cookie_jar = Arc::new(reqwest::cookie::Jar::default());
        for cookie_data in &parent_cookies {
            let cookie_string = format!("{}={}", cookie_data.name, cookie_data.value);
            let domain = &cookie_data.domain;
            cookie_jar.add_cookie_str(
                &cookie_string,
                &format!("https://{}", domain.trim_start_matches('.'))
                    .parse()
                    .map_err(|e: url::ParseError| e.to_string())?,
            );
        }

        let client = Client::builder()
            .cookie_provider(cookie_jar.clone())
            .redirect(reqwest::redirect::Policy::limited(10))
            .timeout(Duration::from_secs(30))
            .user_agent(&parent_session.user_agent)
            .build()
            .map_err(|e| format!("Failed to create timetable HTTP client: {}", e))?;

        Ok(Self {
            client,
            cookie_jar,
            is_logged_in: Arc::new(Mutex::new(false)),
            session: Arc::new(Mutex::new(None)),
        })
    }

    /// Initialize by fetching the timetable page and extracting the `ss` token.
    pub async fn initialize(&self) -> Result<SessionData, String> {
        let response = self
            .client
            .get(TIMETABLE_STUDENT_URL)
            .send()
            .await
            .map_err(|e| format!("Failed to connect to timetable: {}", e))?;

        let final_url = response.url().as_str().to_string();
        println!(
            "[timetable] init: status={}, url={}",
            response.status(),
            final_url
        );

        if is_sso_redirect(&final_url) {
            return Err("Timetable session expired — SSO redirect detected.".to_string());
        }

        // Extract `ss` token from the URL query parameters
        let ss_token = extract_ss_token(&final_url);
        println!(
            "[timetable] ss_token from URL: {}",
            ss_token.as_deref().unwrap_or("NOT FOUND")
        );

        // Also check cookies for any session token
        let timetable_url = reqwest::Url::parse(TIMETABLE_BASE_URL)
            .map_err(|e| format!("Failed to parse timetable URL: {}", e))?;

        let cookies: Vec<CookieData> = self
            .cookie_jar
            .cookies(&timetable_url)
            .iter()
            .filter_map(|cookie| {
                let cookie_str = cookie.to_str().ok()?;
                let parts: Vec<&str> = cookie_str.splitn(2, '=').collect();
                if parts.len() == 2 {
                    Some(CookieData {
                        name: parts[0].trim().to_string(),
                        value: parts[1].trim().to_string(),
                        domain: "my-timetable.monash.edu".to_string(),
                        path: "/".to_string(),
                    })
                } else {
                    None
                }
            })
            .collect();

        let session = SessionData {
            cookies,
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".to_string(),
            timestamp: chrono::Local::now().to_rfc3339(),
        };

        {
            let mut is_logged_in = self.is_logged_in.lock().await;
            *is_logged_in = true;
        }
        {
            let mut session_guard = self.session.lock().await;
            *session_guard = Some(session.clone());
        }

        Ok(session)
    }

    pub async fn get_authenticated_client(&self) -> Result<Client, String> {
        Ok(self.client.clone())
    }

    pub async fn verify_session(&self) -> Result<bool, String> {
        let response = self
            .client
            .get(TIMETABLE_STUDENT_URL)
            .timeout(Duration::from_secs(10))
            .send()
            .await;

        match response {
            Ok(resp) => {
                let final_url = resp.url().as_str().to_string();
                Ok(!is_sso_redirect(&final_url))
            }
            Err(_) => Ok(true),
        }
    }

    pub async fn is_logged_in(&self) -> bool {
        *self.is_logged_in.lock().await
    }
}

/// Extract the `ss` token from a timetable URL.
fn extract_ss_token(url: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url).ok()?;
    parsed.query_pairs().find(|(k, _)| k == "ss").map(|(_, v)| v.to_string())
}

fn is_sso_redirect(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.contains("monash-auth.prd.jdr.plus")
        || lower.contains("/login")
        || lower.contains("okta.com")
        || lower.contains("accounts.google.com")
        || lower.contains("microsoftonline.com")
        || lower.contains("/signin")
}
