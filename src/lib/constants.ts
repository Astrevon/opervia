export type Role = "admin" | "team" | "client";
export type Status = "draft" | "pending_approval" | "revision_required" | "approved" | "scheduled" | "rejected";
export type Tone = "slate" | "amber" | "rose" | "emerald" | "blue" | "red";

export const STATUS: Record<Status, { label: string; tone: Tone; hint: string; clientLabel: string }> = {
  draft: { label: "Draft", tone: "slate", hint: "Being prepared by the content team.", clientLabel: "Draft" },
  pending_approval: {
    label: "Pending Approval",
    tone: "amber",
    hint: "Sent to the client approver and waiting for a decision.",
    clientLabel: "Awaiting your review",
  },
  revision_required: {
    label: "Revision Required",
    tone: "rose",
    hint: "Returned to the content team with requested changes.",
    clientLabel: "Being revised",
  },
  approved: {
    label: "Approved",
    tone: "emerald",
    hint: "Approved by the client. Ready to be scheduled.",
    clientLabel: "Approved",
  },
  scheduled: {
    label: "Scheduled for Publishing",
    tone: "blue",
    hint: "The approved version is scheduled for publishing.",
    clientLabel: "Scheduled",
  },
  rejected: {
    label: "Rejected",
    tone: "red",
    hint: "The client declined this item. It will not be published.",
    clientLabel: "Declined",
  },
};

export const STATUS_ORDER: Status[] = ["draft", "pending_approval", "revision_required", "approved", "scheduled", "rejected"];

export const CONTENT_TYPES = [
  { value: "post", label: "Post" },
  { value: "carousel", label: "Carousel" },
  { value: "short_video", label: "Short-form video" },
  { value: "story", label: "Story" },
  { value: "other", label: "Other" },
] as const;

export const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "tiktok", label: "TikTok" },
  { value: "other", label: "Other" },
] as const;

export const ROLES: Record<Role, { label: string; description: string }> = {
  admin: { label: "Agency Admin", description: "Manages the workspace, team, clients and all content." },
  team: { label: "Content Team", description: "Creates, revises, submits and schedules content." },
  client: { label: "Client Approver", description: "Reviews content for one client account and approves or requests changes." },
};

export const EVENT_LABEL: Record<string, string> = {
  created: "Created draft",
  submitted: "Sent for approval",
  resubmitted: "Resubmitted",
  approved: "Approved",
  revision_requested: "Requested revisions",
  rejected: "Rejected",
  scheduled: "Scheduled for publishing",
  unscheduled: "Unscheduled",
  reopened: "Reopened for changes",
};

export const label = (list: readonly { value: string; label: string }[], value: string | null | undefined) =>
  list.find((x) => x.value === value)?.label ?? value ?? "—";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const ALLOWED_UPLOAD_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "application/pdf",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
export const ALLOWED_UPLOAD_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.mp4,.mov,.webm,.pdf,.txt,.docx,.pptx,.xlsx";

/** SOP-002 §8.4 (A-07): two client revision rounds are assumed to be in scope. */
export const INCLUDED_REVISION_ROUNDS = 2;
