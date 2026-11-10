import { beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "./useAppStore";
import type { Assignment } from "../services/api";
vi.mock("../services/idbStorage", () => ({ idbStorage: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));

const base = { id: 7, name: "Assessment 3: Group Project", courseId: 10, url: "https://example.test/mod/assign/view.php?id=7", assessmentType: "assignment" } as unknown as Assignment;
const merge = (a: Assignment) => useAppStore.getState().updateAllSyncedData({ assignments: [a] });
const status = () => useAppStore.getState().assignments.find((a) => a.id === 7)?.status;

beforeEach(() => useAppStore.getState().reset());

it("repairs a cached 'submitted' when the item's own page says nothing was submitted", () => {
  merge({ ...base, status: "submitted", hasSubmissionStatus: true } as Assignment);
  merge({ ...base, status: "pending", hasSubmissionStatus: true } as Assignment);
  expect(status()).toBe("pending");
});

it("keeps a settled status when this sync could not read the item's page", () => {
  merge({ ...base, status: "submitted", hasSubmissionStatus: true } as Assignment);
  merge({ ...base, status: "pending", hasSubmissionStatus: false } as Assignment);
  expect(status()).toBe("submitted");
});

it("never downgrades a graded item", () => {
  merge({ ...base, status: "graded", grade: "80", hasSubmissionStatus: true } as Assignment);
  merge({ ...base, status: "pending", hasSubmissionStatus: true } as Assignment);
  expect(status()).toBe("graded");
});
