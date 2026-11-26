use chrono::NaiveDate;
use scraper::{ElementRef, Html, Selector};
use serde::Serialize;
use std::time::Duration;

const CALENDAR_URL: &str = "https://www.monash.edu/students/admin/dates/summary-dates";

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AcademicTerm {
    key: String,
    teaching_start: String,
    teaching_end: String,
    break_start: String,
    break_end: String,
}

#[tauri::command]
pub async fn fetch_academic_calendar() -> Result<Vec<AcademicTerm>, String> {
    let html = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| error.to_string())?
        .get(CALENDAR_URL)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| error.to_string())?
        .text()
        .await
        .map_err(|error| error.to_string())?;
    parse_calendar(&html).ok_or_else(|| "Could not read Monash semester dates".into())
}

fn normalized_text(cell: ElementRef<'_>) -> String {
    cell.text()
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn calendar_day(day_month: &str, year: u32) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(&format!("{} {year}", day_month.trim()), "%e %b %Y").ok()
}

fn date_range(text: &str, year: u32) -> Option<(NaiveDate, NaiveDate)> {
    let (start, end) = text.split_once(['–', '—', '-'])?;
    let end = end.trim();
    let end_date = calendar_day(end, year)?;
    let start = start.trim();
    let start_date = if start.bytes().all(|byte| byte.is_ascii_digit()) {
        calendar_day(&format!("{start} {}", end.split_whitespace().last()?), year)?
    } else {
        calendar_day(start, year)?
    };
    Some((start_date, end_date))
}

fn parse_calendar(html: &str) -> Option<Vec<AcademicTerm>> {
    let doc = Html::parse_document(html);
    let table_selector = Selector::parse("table").ok()?;
    let semester_selector = Selector::parse("th#semester-one").ok()?;
    let year_selector = Selector::parse("thead th").ok()?;
    let row_selector = Selector::parse("tbody tr").ok()?;
    let cell_selector = Selector::parse("th, td").ok()?;
    let table = doc
        .select(&table_selector)
        .find(|table| table.select(&semester_selector).next().is_some())?;
    // The year headings are authoritative. Some cells still have old years in their headers attributes.
    let years = table
        .select(&year_selector)
        .map(|cell| normalized_text(cell).parse::<u32>().ok())
        .collect::<Option<Vec<_>>>()?;
    if years.is_empty() || years.windows(2).any(|pair| pair[0] + 1 != pair[1]) {
        return None;
    }
    let mut semester = 0;
    let mut rows = std::collections::HashMap::new();
    for row in table.select(&row_selector) {
        let mut cells = row.select(&cell_selector);
        let Some(heading) = cells.next() else {
            continue;
        };
        match heading.value().id() {
            Some("semester-one") => semester = 1,
            Some("semester-two") => semester = 2,
            _ => {}
        }
        let field = match normalized_text(heading).to_lowercase().as_str() {
            "semester one teaching period" | "semester two teaching period" => "period",
            "mid-semester break" => "break",
            "teaching weeks finish" => "end",
            _ => continue,
        };
        let dates = cells.map(normalized_text).collect::<Vec<_>>();
        if dates.len() != years.len() || rows.insert((semester, field), dates).is_some() {
            return None;
        }
    }

    let mut terms = Vec::new();
    for semester in [1, 2] {
        for (index, &year) in years.iter().enumerate() {
            let (teaching_start, term_end) =
                date_range(&rows.get(&(semester, "period"))?[index], year)?;
            let (break_start, break_end) =
                date_range(&rows.get(&(semester, "break"))?[index], year)?;
            let teaching_end = calendar_day(&rows.get(&(semester, "end"))?[index], year)?;
            if !(teaching_start < break_start
                && break_start <= break_end
                && break_end < teaching_end
                && teaching_end <= term_end)
            {
                return None;
            }
            terms.push(AcademicTerm {
                key: format!("{year}-S{semester}"),
                teaching_start: teaching_start.to_string(),
                teaching_end: teaching_end.to_string(),
                break_start: break_start.to_string(),
                break_end: break_end.to_string(),
            });
        }
    }
    Some(terms)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SUMMARY: &str = r#"
      <table><thead><tr><td></td><th>2026</th><th>2027</th><th>2028</th></tr></thead><tbody>
      <tr><th id="semester-one">Semester one<br />teaching period</th><td>2 Mar &ndash; 26 Jun</td><td>1 Mar – 25 Jun</td><td headers="2025 semester-one">28 Feb – 23 Jun</td></tr>
      <tr><th>Mid-semester break</th><td>6&ndash;10 Apr</td><td>29 Mar – 2 Apr</td><td>17–21&nbsp; Apr</td></tr>
      <tr><th>Teaching weeks finish</th><td>29 May</td><td>28 May</td><td>26 May</td></tr>
      <tr><th id="semester-two">Semester two<br />teaching period</th><td>27 Jul – 18 Nov</td><td>26 Jul – 19 Nov</td><td>24 Jul – 17 Nov</td></tr>
      <tr><th>Mid-semester break</th><td>21–25 Sep</td><td>20–24 Sep</td><td>18–22 Sep</td></tr>
      <tr><th>Teaching weeks finish</th><td>23 Oct</td><td>22 Oct</td><td>20 Oct</td></tr>
      </tbody></table>"#;

    #[test]
    fn calendar_reads_year_headings_break_spans_and_teaching_end() {
        let terms = parse_calendar(SUMMARY).unwrap();
        assert_eq!(terms.len(), 6);
        assert_eq!(terms[1].break_start, "2027-03-29");
        assert_eq!(terms[1].break_end, "2027-04-02");
        assert_eq!(terms[2].teaching_start, "2028-02-28");
        assert_eq!(terms[3].teaching_end, "2026-10-23");
    }

    #[test]
    fn incomplete_calendar_cannot_replace_known_dates() {
        assert!(parse_calendar(&SUMMARY.replace("<td>23 Oct</td>", "")).is_none());
    }
}
