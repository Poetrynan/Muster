use std::sync::Arc;

use crate::moodle::models::ExamSchedule;
use crate::timetable::auth::TimetableAuth;

const TIMETABLE_BASE_URL: &str = "https://my-timetable.monash.edu";
const TIMETABLE_STUDENT_URL: &str = "https://my-timetable.monash.edu/even/student";

#[derive(Debug, Clone)]
pub struct TimetableScraper {
    auth: Arc<TimetableAuth>,
}

impl TimetableScraper {
    pub fn new(auth: Arc<TimetableAuth>) -> Self {
        Self { auth }
    }

    pub async fn fetch_exams(&self) -> Result<Vec<ExamSchedule>, String> {
        let client = self.auth.get_authenticated_client().await?;

        // Step 1: Get the timetable page and extract `ss` token
        let response = client
            .get(TIMETABLE_STUDENT_URL)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch timetable page: {}", e))?;

        let final_url = response.url().as_str().to_string();
        if is_sso_redirect(&final_url) {
            return Err("Timetable session expired".to_string());
        }

        // Extract `ss` token from URL
        let ss_token = extract_ss_token(&final_url)
            .ok_or("No ss token found in timetable URL")?;
        println!("[timetable] Got ss token: {}...", &ss_token[..ss_token.len().min(16)]);

        // Step 2: Get student ID from the page
        let html = response
            .text()
            .await
            .map_err(|e| format!("Failed to read timetable HTML: {}", e))?;

        let student_id = extract_student_id(&html)
            .ok_or("Could not find student ID in timetable page")?;
        println!("[timetable] Student ID: {}", student_id);

        // Step 3: Try the workgroups API (from HAR analysis)
        // URL pattern: /even/rest/student/{studentId}/workgroups/?ss=TOKEN
        let workgroups_url = format!(
            "{}/even/rest/student/{}/workgroups/?ss={}",
            TIMETABLE_BASE_URL, student_id, ss_token
        );
        println!("[timetable] Trying workgroups API: {}", workgroups_url);

        let workgroups_data = match client.get(&workgroups_url).send().await {
            Ok(resp) => {
                let status = resp.status();
                println!("[timetable] Workgroups API status: {}", status);
                if status.is_success() {
                    let text = resp.text().await.unwrap_or_default();
                    // Log first 500 chars for debugging
                    let preview: String = text.chars().take(500).collect();
                    println!("[timetable] Workgroups response: {}", preview);
                    Some(text)
                } else {
                    None
                }
            }
            Err(e) => {
                println!("[timetable] Workgroups API failed: {}", e);
                None
            }
        };

        // Step 4: Try exam-specific endpoints
        let exam_endpoints = [
            format!("{}/even/rest/student/{}/exams/?ss={}", TIMETABLE_BASE_URL, student_id, ss_token),
            format!("{}/even/rest/student/{}/exam/?ss={}", TIMETABLE_BASE_URL, student_id, ss_token),
            format!("{}/even/rest/student/{}/assessments/?ss={}", TIMETABLE_BASE_URL, student_id, ss_token),
            format!("{}/even/rest/student/{}/livecal/?ss={}", TIMETABLE_BASE_URL, student_id, ss_token),
            format!("{}/even/rest/student/{}/livecalendar/?ss={}", TIMETABLE_BASE_URL, student_id, ss_token),
            format!("{}/even/rest/exams/{}/?ss={}", TIMETABLE_BASE_URL, student_id, ss_token),
        ];

        for endpoint in &exam_endpoints {
            println!("[timetable] Trying exam API: {}", endpoint);
            match client.get(endpoint).send().await {
                Ok(resp) => {
                    let status = resp.status();
                    if !status.is_success() {
                        println!("[timetable]   Status: {}", status);
                        continue;
                    }
                    let text = match resp.text().await {
                        Ok(t) => t,
                        Err(_) => continue,
                    };
                    let preview: String = text.chars().take(300).collect();
                    println!("[timetable]   Response: {}", preview);

                    if let Ok(exams) = parse_exam_api_response(&text) {
                        if !exams.is_empty() {
                            println!("[timetable]   Found {} exams!", exams.len());
                            return Ok(exams);
                        }
                    }
                }
                Err(e) => {
                    println!("[timetable]   Error: {}", e);
                }
            }
        }

        // Step 5: Try parsing workgroups data for exam entries
        if let Some(ref data) = workgroups_data {
            if let Some(exams) = parse_exams_from_workgroups(data) {
                if !exams.is_empty() {
                    println!("[timetable] Found {} exams from workgroups data", exams.len());
                    return Ok(exams);
                }
            }
        }

        // Step 6: Parse HTML for exam data
        let exams = parse_exams_from_html(&html);
        if !exams.is_empty() {
            return Ok(exams);
        }

        println!("[timetable] No exams found from any source");
        Ok(vec![])
    }
}

fn extract_ss_token(url: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url).ok()?;
    parsed.query_pairs().find(|(k, _)| k == "ss").map(|(_, v)| v.to_string())
}

fn extract_student_id(html: &str) -> Option<String> {
    // Look for student ID in the HTML
    // Common patterns: data-student-id, studentId in scripts, etc.
    let patterns = [
        r#"studentId['":\s]+(\d+)"#,
        r#"student_id['":\s]+(\d+)"#,
        r#"data-student-id=['"](\d+)"#,
        r#"studentNumber['":\s]+(\d+)"#,
        r#"sNumber['":\s]+(\d+)"#,
    ];

    for pattern in &patterns {
        if let Ok(re) = regex::Regex::new(pattern) {
            if let Some(caps) = re.captures(html) {
                if let Some(m) = caps.get(1) {
                    return Some(m.as_str().to_string());
                }
            }
        }
    }

    // Try to find in script tags
    if let Ok(re) = regex::Regex::new(r#"\d{8,}"#) {
        for cap in re.captures_iter(html) {
            if let Some(m) = cap.get(0) {
                let s = m.as_str();
                if s.len() == 8 || s.len() == 10 {
                    return Some(s.to_string());
                }
            }
        }
    }

    None
}

fn parse_exam_api_response(text: &str) -> Result<Vec<ExamSchedule>, String> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("Failed to parse JSON: {}", e))?;

    let mut exams = Vec::new();

    // Try various JSON structures
    let exam_array = value.as_array()
        .map(|a| a.as_slice())
        .or_else(|| value.get("data").and_then(|d| d.as_array()).map(|a| a.as_slice()))
        .or_else(|| value.get("exams").and_then(|e| e.as_array()).map(|a| a.as_slice()))
        .or_else(|| value.get("results").and_then(|r| r.as_array()).map(|a| a.as_slice()))
        .or_else(|| value.get("events").and_then(|e| e.as_array()).map(|a| a.as_slice()))
        .or_else(|| value.get("items").and_then(|i| i.as_array()).map(|a| a.as_slice()))
        .unwrap_or(&[]);

    for item in exam_array {
        if let Some(exam) = parse_exam_json_item(item) {
            exams.push(exam);
        }
    }

    Ok(exams)
}

fn parse_exam_json_item(value: &serde_json::Value) -> Option<ExamSchedule> {
    let id = value
        .get("id")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("examId").and_then(|v| v.as_str()))
        .or_else(|| value.get("exam_id").and_then(|v| v.as_str()))
        .unwrap_or("unknown")
        .to_string();

    let course_code = value
        .get("courseCode")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("course_code").and_then(|v| v.as_str()))
        .or_else(|| value.get("unitCode").and_then(|v| v.as_str()))
        .or_else(|| value.get("unit_code").and_then(|v| v.as_str()))
        .or_else(|| value.get("displaySubjectCode").and_then(|v| v.as_str()))
        .unwrap_or("Unknown")
        .to_string();

    let course_name = value
        .get("courseName")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("course_name").and_then(|v| v.as_str()))
        .or_else(|| value.get("unitName").and_then(|v| v.as_str()))
        .or_else(|| value.get("subject_description").and_then(|v| v.as_str()))
        .unwrap_or(&course_code)
        .to_string();

    let exam_type = value
        .get("examType")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("exam_type").and_then(|v| v.as_str()))
        .or_else(|| value.get("type").and_then(|v| v.as_str()))
        .or_else(|| value.get("activity_group_code").and_then(|v| v.as_str()))
        .unwrap_or("Final")
        .to_string();

    let date = value
        .get("date")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("examDate").and_then(|v| v.as_str()))
        .or_else(|| value.get("exam_date").and_then(|v| v.as_str()))
        .or_else(|| value.get("startDate").and_then(|v| v.as_str()))
        .or_else(|| value.get("start_date").and_then(|v| v.as_str()))
        .or_else(|| value.get("dateTime").and_then(|v| v.as_str()))
        .unwrap_or("TBD")
        .to_string();

    let start_time = value
        .get("startTime")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("start_time").and_then(|v| v.as_str()))
        .or_else(|| value.get("beginTime").and_then(|v| v.as_str()))
        .unwrap_or("TBD")
        .to_string();

    let end_time = value
        .get("endTime")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("end_time").and_then(|v| v.as_str()))
        .or_else(|| value.get("finishTime").and_then(|v| v.as_str()))
        .unwrap_or("TBD")
        .to_string();

    let location = value
        .get("location")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("venue").and_then(|v| v.as_str()))
        .or_else(|| value.get("room").and_then(|v| v.as_str()))
        .or_else(|| value.get("agv_location").and_then(|v| v.as_str()))
        .unwrap_or("TBD")
        .to_string();

    let seat_number = value
        .get("seatNumber")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("seat_number").and_then(|v| v.as_str()))
        .map(|s| s.to_string());

    let duration_minutes = value
        .get("durationMinutes")
        .and_then(|v| v.as_u64())
        .or_else(|| value.get("duration_minutes").and_then(|v| v.as_u64()))
        .map(|v| v as u32);

    let instructions = value
        .get("instructions")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("notes").and_then(|v| v.as_str()))
        .map(|s| s.to_string());

    let url = value
        .get("url")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Some(ExamSchedule {
        id,
        course_id: None,
        course_name,
        course_code,
        exam_type,
        date,
        start_time,
        end_time,
        location,
        seat_number,
        duration_minutes,
        instructions,
        url,
    })
}

/// Parse exam entries from the workgroups API response.
/// The workgroups API returns timetable entries; exams may appear as
/// special activity types (e.g., activity_group_code == "EXAM").
fn parse_exams_from_workgroups(_text: &str) -> Option<Vec<ExamSchedule>> {
    // This needs calibration against real workgroups response data
    None
}

fn parse_exams_from_html(_html: &str) -> Vec<ExamSchedule> {
    // This needs calibration against real HTML structure
    Vec::new()
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
