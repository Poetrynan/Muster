interface SubmissionEvidence { submitted: boolean; graded?: boolean; grade?: string | null }
interface AssessmentEvidence { status?: string; grade?: string | null }
const hasScore = (value?: string | null) => !!value?.trim() && !/^(?:-|–|—)$/.test(value.trim());
/** A released grade takes precedence over Moodle's separate submission flag. */
export function resolveSubmissionState(detail: SubmissionEvidence, assessment?: AssessmentEvidence): "graded" | "submitted" | "notSubmitted" {
  if (detail.graded || hasScore(detail.grade) || hasScore(assessment?.grade) || assessment?.status === "graded") return "graded";
  if (detail.submitted || assessment?.status === "submitted") return "submitted";
  return "notSubmitted";
}
