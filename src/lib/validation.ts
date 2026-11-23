import { z } from "zod";
import { ALLOWED_UPLOAD_TYPES, CONTENT_TYPES, MAX_UPLOAD_BYTES, PLATFORMS } from "@/lib/constants";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid id");
const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v && v.length ? v : null))
  .pipe(uuid.nullable());

const isoDate = z
  .string()
  .optional()
  .transform((v) => (v && v.length ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a valid date");

const isoDateTime = z
  .string()
  .optional()
  .transform((v) => (v && v.length ? v : null))
  .refine((v) => v === null || !Number.isNaN(Date.parse(v)), "Use a valid date and time");

export const contentSchema = z.object({
  client_id: uuid.describe("client"),
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(160, "Keep the title under 160 characters"),
  content_type: z.enum(CONTENT_TYPES.map((c) => c.value) as [string, ...string[]], { message: "Choose a content type" }),
  platform: z.enum(PLATFORMS.map((p) => p.value) as [string, ...string[]], { message: "Choose a platform" }),
  assignee_id: optionalUuid,
  due_date: isoDate,
  planned_publish_at: isoDateTime,
  description: z.string().max(5000, "Description is too long (5,000 characters max)").default(""),
  body: z.string().max(10000, "Caption is too long (10,000 characters max)").default(""),
});

export const idSchema = uuid;

export const commentSchema = (min: number, message: string) => z.string().trim().min(min, message).max(5000, "Keep it under 5,000 characters");

export const uploadRequestSchema = z.object({
  itemId: uuid,
  fileName: z.string().trim().min(1).max(200),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES, "Files must be 25 MB or smaller"),
  type: z.string().refine((t) => ALLOWED_UPLOAD_TYPES.includes(t), "This file type isn't allowed"),
});

export const inviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Enter a valid email address"),
    full_name: z.string().trim().max(120).optional().default(""),
    role: z.enum(["admin", "team", "client"], { message: "Choose a role" }),
    client_id: optionalUuid,
  })
  .refine((v) => v.role !== "client" || v.client_id, { message: "Choose the client this approver belongs to", path: ["client_id"] });

export const clientSchema = z.object({
  id: optionalUuid,
  name: z.string().trim().min(2, "Client name must be at least 2 characters").max(120),
  contact_name: z.string().trim().max(120).optional().default(""),
  contact_email: z
    .string()
    .trim()
    .optional()
    .default("")
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email"),
  timezone: z.string().trim().min(1).max(64),
  notes: z.string().trim().max(2000).optional().default(""),
  is_active: z.boolean(),
});

export function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Strips anything that is not safe in a storage object key. */
export function safeFileName(name: string) {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(-120);
  return cleaned.replace(/^[.-]+/, "") || "file";
}
