export type ActionState = {
  ok: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  data?: Record<string, unknown>;
  /** Changes on every submission so client components can react to each result. */
  at?: number;
};

export const idle: ActionState = { ok: false };

/** Turns database / auth errors into messages a user can act on. */
export function friendlyError(err: unknown): string {
  const raw =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "Something went wrong.";
  if (/permission denied/i.test(raw)) return "You don't have permission to do that.";
  if (/JWT|not authenticated|signed in/i.test(raw) && !/must be signed in/i.test(raw)) return "Your session has expired. Please sign in again.";
  if (/fetch failed|ECONNREFUSED|NetworkError|Failed to fetch/i.test(raw)) return "Can't reach the server right now. Check your connection and try again.";
  if (/duplicate key/i.test(raw)) return "That already exists.";
  if (/violates row-level security/i.test(raw)) return "You don't have permission to do that.";
  return raw.replace(/^Error:\s*/, "");
}

export const fail = (error: unknown, fieldErrors?: Record<string, string>): ActionState => ({
  ok: false,
  error: friendlyError(error),
  fieldErrors,
  at: Date.now(),
});

export const success = (message?: string, data?: Record<string, unknown>): ActionState => ({
  ok: true,
  message,
  data,
  at: Date.now(),
});
