//! WebView cookie extraction for SSO login.
//!
//! The core problem this module solves: after a user completes Monash SSO
//! inside an embedded Tauri WebView, the session cookies (notably the HttpOnly
//! `MoodleSession`) live in the WebView's cookie store, which the Rust `reqwest`
//! client cannot see. The reference project (`monash-moodle-downloader`) solves
//! this with Playwright, which keeps login and HTTP requests in one browser
//! context. We solve it by reading the WebView2 cookie manager directly and
//! handing the cookies to `reqwest`.
//!
//! On Windows we keep the existing `ICoreWebView2CookieManager::GetCookies`
//! implementation. On macOS, Tauri 2.11's WebView cookie API talks to
//! WKWebsiteDataStore and returns HttpOnly cookies as well, so no JavaScript or
//! Objective-C bridge is required.

use crate::moodle::auth::CookieData;

/// Read all cookies for `https://learning.monash.edu` from a Tauri platform
/// webview. Must be called on the main (UI) thread — i.e. inside a
/// `Webview::with_webview` closure.
pub fn extract_moodle_cookies(
    webview: &tauri::webview::PlatformWebview,
) -> Result<Vec<CookieData>, String> {
    #[cfg(windows)]
    {
        extract_cookies_webview2(webview)
    }
    #[cfg(not(windows))]
    {
        let _ = webview;
        Err(
            "WebView cookie extraction is only supported on Windows. \
             Please use the manual Cookie login option instead."
                .to_string(),
        )
    }
}

/// Read Moodle cookies from WKWebView on macOS through Tauri's cross-platform
/// cookie API. This is deliberately a separate entry point so the established
/// Windows COM implementation remains untouched.
#[cfg(target_os = "macos")]
pub fn extract_moodle_cookies_macos(
    webview: &tauri::WebviewWindow,
) -> Result<Vec<CookieData>, String> {
    const MOODLE_URL: &str = "https://learning.monash.edu";

    let url = url::Url::parse(MOODLE_URL)
        .map_err(|e| format!("invalid Moodle URL: {}", e))?;
    let cookies = webview
        .cookies_for_url(url)
        .map_err(|e| format!("Failed to read WKWebView cookies: {}", e))?;

    Ok(cookies
        .into_iter()
        .filter(|cookie| {
            cookie.domain().is_none_or(|domain| {
                let domain = domain.trim_start_matches('.');
                domain == "learning.monash.edu" || domain.ends_with(".monash.edu")
            })
        })
        .map(|cookie| CookieData {
            name: cookie.name().to_string(),
            value: cookie.value().to_string(),
            domain: cookie
                .domain()
                .unwrap_or("learning.monash.edu")
                .to_string(),
            path: cookie.path().unwrap_or("/").to_string(),
        })
        .collect())
}

/// Seed a newly-created macOS in-app WKWebView with the saved Moodle session.
#[cfg(target_os = "macos")]
pub fn inject_moodle_cookies_macos(
    webview: &tauri::WebviewWindow,
    cookies: &[CookieData],
    url: &str,
) -> Result<(), String> {
    let target = url::Url::parse(url).map_err(|e| format!("Invalid target URL: {}", e))?;
    let target_is_monash = target
        .host_str()
        .map(|host| host == "monash.edu" || host.ends_with(".monash.edu"))
        .unwrap_or(false);
    if target.scheme() != "https" || !target_is_monash {
        return Err("Only HTTPS Monash URLs may receive Moodle cookies".to_string());
    }

    for saved in cookies {
        let domain = saved.domain.trim_start_matches('.');
        if domain != "monash.edu" && !domain.ends_with(".monash.edu") {
            continue;
        }

        let cookie = tauri::webview::Cookie::build((saved.name.clone(), saved.value.clone()))
            .domain(saved.domain.clone())
            .path(if saved.path.is_empty() {
                "/".to_string()
            } else {
                saved.path.clone()
            })
            .secure(true)
            .http_only(saved.name.eq_ignore_ascii_case("MoodleSession"))
            .build();
        webview
            .set_cookie(cookie)
            .map_err(|e| format!("Failed to inject WKWebView cookie: {}", e))?;
    }

    webview
        .navigate(target)
        .map_err(|e| format!("Failed to reload authenticated page: {}", e))
}

/// Inject session cookies into WebView2 so the user does not need to re-login in in-app webviews.
pub fn inject_moodle_cookies(
    webview: &tauri::webview::PlatformWebview,
    cookies: &[CookieData],
    url: &str,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        inject_cookies_webview2(webview, cookies, url)
    }
    #[cfg(not(windows))]
    {
        let _ = (webview, cookies, url);
        Ok(())
    }
}

#[cfg(windows)]
fn inject_cookies_webview2(
    webview: &tauri::webview::PlatformWebview,
    cookies: &[CookieData],
    url: &str,
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_2,
    };
    use webview2_com::CoTaskMemPWSTR;
    use windows::core::Interface;

    let controller = webview.controller();
    let core = unsafe {
        controller
            .CoreWebView2()
            .map_err(|e| format!("CoreWebView2: {}", e))?
    };
    let core2: ICoreWebView2_2 = core
        .cast()
        .map_err(|e| format!("cast to ICoreWebView2_2: {}", e))?;
    let cookie_manager = unsafe {
        core2
            .CookieManager()
            .map_err(|e| format!("CookieManager: {}", e))?
    };

    for c in cookies {
        let name = CoTaskMemPWSTR::from(c.name.as_str());
        let val = CoTaskMemPWSTR::from(c.value.as_str());
        let dom = CoTaskMemPWSTR::from(c.domain.as_str());
        let path = CoTaskMemPWSTR::from(c.path.as_str());

        unsafe {
            if let Ok(cookie) = cookie_manager.CreateCookie(
                *name.as_ref().as_pcwstr(),
                *val.as_ref().as_pcwstr(),
                *dom.as_ref().as_pcwstr(),
                *path.as_ref().as_pcwstr(),
            ) {
                let _ = cookie_manager.AddOrUpdateCookie(&cookie);
            }
        }
    }

    // Re-navigate to the target page after injection: makes sure the page loads with the session
    // cookies we just injected.
    // If the first navigation already happened (the page may have jumped to the login page),
    // Navigate reloads the target page with the new cookies.
    let target = CoTaskMemPWSTR::from(url);
    unsafe {
        let _ = core.Navigate(*target.as_ref().as_pcwstr());
    }

    Ok(())
}

#[cfg(windows)]
fn extract_cookies_webview2(
    webview: &tauri::webview::PlatformWebview,
) -> Result<Vec<CookieData>, String> {
    use std::sync::mpsc;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Cookie, ICoreWebView2_2, ICoreWebView2CookieList,
    };
    use webview2_com::{CoTaskMemPWSTR, GetCookiesCompletedHandler};
    use windows::core::Interface;

    const MOODLE_URL: &str = "https://learning.monash.edu";

    // controller -> CoreWebView2 -> ICoreWebView2_2 -> CookieManager
    let controller = webview.controller();
    // SAFETY: CoreWebView2 returns a COM interface pointer owned by `controller`.
    let core = unsafe {
        controller
            .CoreWebView2()
            .map_err(|e| format!("CoreWebView2: {}", e))?
    };
    let core2: ICoreWebView2_2 = core
        .cast()
        .map_err(|e| format!("cast to ICoreWebView2_2: {}", e))?;
    // SAFETY: CookieManager returns a COM interface pointer owned by `core2`.
    let cookie_manager = unsafe {
        core2
            .CookieManager()
            .map_err(|e| format!("CookieManager: {}", e))?
    };

    // Channel to pull the cookie list out of the completion callback.
    let (list_tx, list_rx) = mpsc::channel::<Option<ICoreWebView2CookieList>>();

    // Build a wide-string URI. GetCookies takes PCWSTR; CoTaskMemPWSTR owns the
    // allocation and derefs to PCWSTR for the duration of the borrow.
    let uri = CoTaskMemPWSTR::from(MOODLE_URL);
    let uri_pcwstr = *uri.as_ref().as_pcwstr();

    // `wait_for_async_operation` requires a `'static` closure, so capture owned
    // values rather than references into this stack frame. `cookie_manager` is a
    // COM interface (refcount-cloned); `uri_pcwstr` is a `Copy` PCWSTR. The
    // backing `uri` (CoTaskMemPWSTR) stays alive until the end of this function,
    // and the closure is invoked synchronously before that.
    let cookie_manager_for_op = cookie_manager.clone();
    let uri_pcwstr_for_op = uri_pcwstr;

    // wait_for_async_operation runs the GetCookies call and pumps the Win32
    // message loop until the handler fires. Safe to call on the main thread.
    GetCookiesCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| {
            // SAFETY: GetCookies is an unsafe COM call; both captures are owned
            // and valid for the duration of the call.
            unsafe {
                cookie_manager_for_op
                    .GetCookies(uri_pcwstr_for_op, &handler)
                    .map_err(webview2_com::Error::WindowsError)
            }
        }),
        Box::new(move |result, cookie_list| {
            if result.is_err() {
                let _ = list_tx.send(None);
            } else {
                let _ = list_tx.send(cookie_list);
            }
            Ok(())
        }),
    )
    .map_err(|e| format!("GetCookies: {}", e))?;

    let list = list_rx
        .recv()
        .map_err(|e| format!("cookie list channel closed: {}", e))?
        .ok_or_else(|| "GetCookies callback reported failure".to_string())?;

    let count = {
        let mut c = 0u32;
        // SAFETY: Count writes a u32 into `c`.
        unsafe {
            list.Count(&mut c)
                .map_err(|e| format!("CookieList::Count: {}", e))?;
        }
        c
    };

    let mut cookies = Vec::with_capacity(count as usize);
    for i in 0..count {
        // SAFETY: GetValueAtIndex returns the i-th cookie interface.
        let cookie = match unsafe { list.GetValueAtIndex(i) } {
            Ok(c) => c,
            Err(_) => continue,
        };

        // Each getter writes a CoTaskMemAlloc'd wide string into a PWSTR;
        // `take_pwstr` copies it to a Rust String and frees the allocation.
        // SAFETY: same contract for Name/Value/Domain/Path.
        let name = unsafe { read_cookie_field(&cookie, ICoreWebView2Cookie::Name) };
        if name.is_empty() {
            continue;
        }
        let value = unsafe { read_cookie_field(&cookie, ICoreWebView2Cookie::Value) };
        let domain = unsafe { read_cookie_field(&cookie, ICoreWebView2Cookie::Domain) };
        let path = unsafe { read_cookie_field(&cookie, ICoreWebView2Cookie::Path) };

        cookies.push(CookieData {
            name,
            value,
            domain: if domain.is_empty() {
                "learning.monash.edu".to_string()
            } else {
                domain
            },
            path: if path.is_empty() {
                "/".to_string()
            } else {
                path
            },
        });
    }

    Ok(cookies)
}

#[cfg(windows)]
/// Read one CoTaskMemAlloc'd PWSTR property off a cookie into a Rust String.
///
/// `get` is one of `ICoreWebView2Cookie::{Name,Value,Domain,Path}`.
unsafe fn read_cookie_field(
    cookie: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Cookie,
    get: unsafe fn(
        &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Cookie,
        *mut windows::core::PWSTR,
    ) -> windows::core::Result<()>,
) -> String {
    use webview2_com::take_pwstr;
    use windows::core::PWSTR;

    let mut ptr = PWSTR::null();
    if get(cookie, &mut ptr as *mut PWSTR).is_err() {
        return String::new();
    }
    take_pwstr(ptr)
}
