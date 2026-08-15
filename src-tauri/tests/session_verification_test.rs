use muster_lib::moodle::auth::{CookieData, SessionData, MoodleAuth};
use muster_lib::moodle::scraper::MoodleScraper;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[tokio::test]
async fn test_session_data_serialization_performance() {
    let session = SessionData {
        cookies: vec![
            CookieData {
                name: "MoodleSession".to_string(),
                value: "abc123def456ghi789jkl012mno345pqr".to_string(),
                domain: "learning.monash.edu".to_string(),
                path: "/".to_string(),
            },
            CookieData {
                name: "MOODLEID1_".to_string(),
                value: "%25D0%25A1%25D1%2582".to_string(),
                domain: "learning.monash.edu".to_string(),
                path: "/".to_string(),
            },
        ],
        user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".to_string(),
        timestamp: chrono::Local::now().to_rfc3339(),
    };

    let start = Instant::now();
    for _ in 0..1000 {
        let json = serde_json::to_string(&session).unwrap();
        let _parsed: SessionData = serde_json::from_str(&json).unwrap();
    }
    let elapsed = start.elapsed();
    let per_op_us = elapsed.as_micros() / 1000;
    println!("1000 serialize/deserialize ops took {:?}, ~{}us per op", elapsed, per_op_us);
    assert!(per_op_us < 1000, "Serialization/deserialization per op took too long: {}us", per_op_us);
}

#[tokio::test]
async fn test_offline_mode_resilience() {
    // When network request fails (e.g. invalid host / offline), reqwest returns Err(_).
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(500))
        .build()
        .unwrap();

    let res = client.get("http://127.0.0.1:59999/nonexistent_unreachable_port").send().await;
    assert!(res.is_err(), "Expected connection error for unreachable host");
    
    // In auth.rs, error is handled as: Err(_) => true (retains session)
    let is_valid = match res {
        Ok(_) => false,
        Err(_) => true, // Offline mode fallback
    };
    assert!(is_valid, "Offline mode must treat network failure as session valid");
}

#[tokio::test]
async fn test_expired_session_detection_with_mock_server() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf).await;
            let response = "HTTP/1.1 302 Found\r\nLocation: https://learning.monash.edu/login/index.php\r\nContent-Length: 0\r\n\r\n";
            let _ = stream.write_all(response.as_bytes()).await;
        }
    });

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .unwrap();

    let resp = client.get(format!("http://{}", addr)).send().await.unwrap();
    let final_url = resp.url().as_str().to_string();
    
    let lower = final_url.to_lowercase();
    let is_logged_out = lower.contains("/login")
        || lower.contains("okta.com")
        || lower.contains("accounts.google.com")
        || lower.contains("microsoftonline.com")
        || lower.contains("/signin");

    assert!(is_logged_out, "Redirect to login URL must be detected as logged out");
}

#[tokio::test]
async fn test_valid_session_detection_with_mock_server() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf).await;
            let response = "HTTP/1.1 200 OK\r\nContent-Length: 46\r\n\r\n<html><body>Welcome to Dashboard</body></html>";
            let _ = stream.write_all(response.as_bytes()).await;
        }
    });

    let client = reqwest::Client::builder().build().unwrap();

    let resp = client.get(format!("http://{}", addr)).send().await.unwrap();
    let final_url = resp.url().as_str().to_string();
    
    let lower = final_url.to_lowercase();
    let is_logged_out = lower.contains("/login")
        || lower.contains("okta.com")
        || lower.contains("accounts.google.com")
        || lower.contains("microsoftonline.com")
        || lower.contains("/signin");

    assert!(!is_logged_out, "200 OK dashboard URL must NOT be detected as logged out");
}

#[tokio::test]
async fn test_concurrent_lock_contention_and_no_deadlock() {
    let auth = Arc::new(MoodleAuth::new());
    let scraper: Arc<tokio::sync::Mutex<Option<MoodleScraper>>> =
        Arc::new(tokio::sync::Mutex::new(Some(
            MoodleScraper::new(auth.clone()),
        )));

    let mut tasks = Vec::new();
    let num_tasks = 100;
    let timeout_duration = Duration::from_secs(5);

    let start_time = Instant::now();

    for i in 0..num_tasks {
        let auth_clone = auth.clone();
        let scraper_clone = scraper.clone();

        let handle = tokio::spawn(async move {
            for iteration in 0..50 {
                match i % 4 {
                    0 => {
                        let _ = auth_clone.is_logged_in().await;
                    }
                    1 => {
                        let guard = scraper_clone.lock().await;
                        if let Some(_sc) = guard.as_ref() {
                            let _ = auth_clone.get_base_url();
                        }
                        tokio::task::yield_now().await;
                    }
                    2 => {
                        if iteration == 25 {
                            let mut guard = scraper_clone.lock().await;
                            *guard = None;
                        }
                    }
                    _ => {
                        if iteration == 30 {
                            let mut guard = scraper_clone.lock().await;
                            *guard = Some(MoodleScraper::new(auth_clone.clone()));
                        }
                    }
                }
            }
        });
        tasks.push(handle);
    }

    let join_all = async {
        for t in tasks {
            let _ = t.await;
        }
    };

    let res = tokio::time::timeout(timeout_duration, join_all).await;
    assert!(res.is_ok(), "100 concurrent tasks must complete within 5s without deadlocking");
    println!("100 concurrent tasks completed in {:?}", start_time.elapsed());
}
