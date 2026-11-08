import type { Resource, Assignment, Announcement, CalendarEvent, UnitInfo, Schedule } from '../../services/api';
export const GUIDE_SCHEMA = 1;
export const GUIDE_PROMPT = 'arrangements-1';
export interface GuideScope {
    accountScope: string;
    courseId: number;
    weekId: string;
    selectedWeek: number | null;
    localDate: string;
    timezone: string;
    now: string;
    language: string;
    model: string;
    availableMinutes: number;
    provider?: string;
}
export interface GuideSnapshot {
    resources: Resource[];
    assignments: Assignment[];
    announcements: Announcement[];
    events: CalendarEvent[];
    unitInfo?: UnitInfo;
    schedule?: Schedule;
    syncedAt?: string;
}
export interface SourceRecord {
    id: string;
    courseId: number;
    kind: 'resource' | 'assignment' | 'announcement' | 'event' | 'unit' | 'schedule';
    title: string;
    url?: string;
    locator: string;
    excerpt: string;
    coverage: 'body' | 'title-only';
    week: number | null;
    contentHash: string;
    syncedAt?: string;
    assignment?: Assignment;
    event?: CalendarEvent;
}
export interface SourceSelection {
    included: SourceRecord[];
    excluded: SourceRecord[];
    coverage: {
        body: number;
        titleOnly: number;
        unknownWeek: number;
    };
    inputHash: string;
}
export interface FactRecord {
    id: string;
    sourceIds: string[];
    field: 'dueAt' | 'status' | 'grade' | 'weight' | 'remainingHours';
    value: string | number;
    status: 'verified' | 'estimated' | 'unknown' | 'conflicting';
}
export interface GuideCard {
    id: string;
    kind: 'action' | 'plan';
    title: string;
    explanation?: string;
    sourceIds: string[];
    factIds: string[];
    suggestedMinutes?: number;
    priority?: 'urgent' | 'important' | 'normal';
    origin?: 'rule' | 'ai';
}
export interface GuideFacts {
    facts: FactRecord[];
    actions: GuideCard[];
    conflicts: string[][];
}
export type GenerationStatus = 'idle' | 'streaming' | 'ready' | 'text-only' | 'partial' | 'failed' | 'stale';
export interface GuideArtifact {
    schemaVersion: number;
    promptVersion: string;
    key: string;
    inputHash: string;
    scope: GuideScope;
    generatedAt: string;
    status: 'ready' | 'text-only';
    markdown: string;
    cards: GuideCard[];
    includedSourceIds: string[];
    omittedSourceIds: string[];
    warnings: number;
    sources?: SourceRecord[];
    facts?: FactRecord[];
}
export interface GuideProgress {
    done?: boolean;
    text?: string;
    card?: GuideCard;
}
export interface GuideContext {
    prompt: string;
    includedSourceIds: string[];
    omittedSourceIds: string[];
    inputHash: string;
}
