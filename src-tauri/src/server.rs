use tokio::net::TcpListener;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use std::sync::Arc;
use tokio::sync::Mutex;
use std::time::Duration;

/// Callback data received from browser
#[derive(Debug, Clone)]
pub struct CallbackData {
    pub url: String,
    pub cookies: Vec<String>,
    pub session_detected: bool,
}

/// Local HTTP server for capturing OAuth/SSO callback
pub struct CallbackServer {
    port: u16,
    result: Arc<Mutex<Option<CallbackData>>>,
    shutdown: Arc<Mutex<bool>>,
}

impl CallbackServer {
    /// Create a new callback server bound to a random port
    pub async fn new() -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0").await
            .map_err(|e| format!("Failed to bind server: {}", e))?;
        let port = listener.local_addr()
            .map_err(|e| format!("Failed to get port: {}", e))?
            .port();
        
        let result = Arc::new(Mutex::new(None));
        let shutdown = Arc::new(Mutex::new(false));
        
        let result_clone = result.clone();
        let shutdown_clone = shutdown.clone();
        
        // Spawn server task
        tokio::spawn(async move {
            loop {
                // Check for shutdown
                if *shutdown_clone.lock().await {
                    break;
                }
                
                // Accept with timeout
                match tokio::time::timeout(
                    Duration::from_millis(500),
                    listener.accept()
                ).await {
                    Ok(Ok((mut stream, _addr))) => {
                        let result = result_clone.clone();
                        let shutdown = shutdown_clone.clone();
                        
                        tokio::spawn(async move {
                            let mut buffer = [0u8; 4096];
                            match stream.read(&mut buffer).await {
                                Ok(n) if n > 0 => {
                                    let request = String::from_utf8_lossy(&buffer[..n]);
                                    
                                    let mut url = String::new();
                                    let mut cookies = Vec::new();
                                    
                                    // Parse request line and headers
                                    for line in request.lines() {
                                        // First line is request line
                                        if url.is_empty() {
                                            let parts: Vec<&str> = line.split_whitespace().collect();
                                            if parts.len() >= 2 {
                                                url = parts[1].to_string();
                                            }
                                        } else if line.to_lowercase().starts_with("cookie:") {
                                            // Extract cookies from Cookie header
                                            let cookie_str = line[7..].trim();
                                            for cookie in cookie_str.split(';') {
                                                let cookie = cookie.trim();
                                                if !cookie.is_empty() {
                                                    cookies.push(cookie.to_string());
                                                }
                                            }
                                        }
                                    }
                                    
                                    // Store the callback data
                                    // session_detected indicates if we received any callback (even without cookies)
                                    let has_cookies = !cookies.is_empty();
                                    let mut res = result.lock().await;
                                    *res = Some(CallbackData { 
                                        url, 
                                        cookies,
                                        session_detected: true,
                                    });
                                    
                                    // Signal shutdown
                                    let mut sd = shutdown.lock().await;
                                    *sd = true;
                                    
                                    // Send success response
                                    let response = if has_cookies {
                                        "HTTP/1.1 200 OK\r\n\
                                            Content-Type: text/html; charset=utf-8\r\n\
                                            Connection: close\r\n\
                                            \r\n\
                                            <!DOCTYPE html>\
                                            <html>\
                                            <head><title>Login Successful</title></head>\
                                            <body style=\"font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5;\">\
                                            <div style=\"text-align: center; padding: 2rem; background: white; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);\">\
                                            <h1 style=\"color: #16A34A;\">✓ Login Successful</h1>\
                                            <p>You can close this tab and return to the app.</p>\
                                            </div>\
                                            </body>\
                                            </html>"
                                    } else {
                                        "HTTP/1.1 200 OK\r\n\
                                            Content-Type: text/html; charset=utf-8\r\n\
                                            Connection: close\r\n\
                                            \r\n\
                                            <!DOCTYPE html>\
                                            <html>\
                                            <head><title>Processing Login</title></head>\
                                            <body style=\"font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5;\">\
                                            <div style=\"text-align: center; padding: 2rem; background: white; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);\">\
                                            <h1 style=\"color: #3B82F6;\">⏳ Processing Login...</h1>\
                                            <p>Please wait while we verify your session.</p>\
                                            <p>You can close this tab.</p>\
                                            </div>\
                                            </body>\
                                            </html>"
                                    };
                                    
                                    let _ = stream.write_all(response.as_bytes()).await;
                                    let _ = stream.flush().await;
                                }
                                _ => {}
                            }
                        });
                    }
                    Ok(Err(_)) => break,
                    Err(_) => continue, // Timeout, check shutdown and continue
                }
            }
        });
        
        Ok(Self {
            port,
            result,
            shutdown,
        })
    }
    
    /// Get the port number
    pub fn port(&self) -> u16 {
        self.port
    }
    
    /// Wait for callback with timeout
    pub async fn wait_for_callback(&self, timeout_secs: u64) -> Result<CallbackData, String> {
        let start = std::time::Instant::now();
        let timeout = Duration::from_secs(timeout_secs);
        
        loop {
            // Check if we have a result
            let result = self.result.lock().await;
            if let Some(data) = result.as_ref() {
                return Ok(data.clone());
            }
            drop(result);
            
            // Check timeout
            if start.elapsed() > timeout {
                // Signal shutdown
                let mut shutdown = self.shutdown.lock().await;
                *shutdown = true;
                return Err("Login timeout - no callback received. Please ensure you complete the login in the browser and are redirected back to the app.".to_string());
            }
            
            // Wait before checking again
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
    
    /// Shutdown the server
    pub async fn shutdown(&self) {
        let mut shutdown = self.shutdown.lock().await;
        *shutdown = true;
    }
}

impl Drop for CallbackServer {
    fn drop(&mut self) {
        // Note: Can't async drop, but the server will timeout
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_server_creation() {
        let server = CallbackServer::new().await.unwrap();
        assert!(server.port() > 0);
    }
}
