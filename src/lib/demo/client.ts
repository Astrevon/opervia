/* eslint-disable @typescript-eslint/no-explicit-any -- mimics the untyped supabase-js surface used by the app */
import "server-only";
import { randomUUID } from "node:crypto";
import { DEMO_COOKIE } from "@/lib/demo/mode";
import { DEMO_PEOPLE, type DemoDb, type Row } from "@/lib/demo/store";
import { DemoError, RPC, canRead, canUpload, db, visible } from "@/lib/demo/engine";

type CookieStore = { get(name: string): { value: string } | undefined; delete(name: string): unknown };

/** Embedded relations used by the app's selects: alias -> (foreign key, target table). */
const RELATIONS: Record<string, Record<string, { fk: string; table: string }>> = {
  content_items: { clients: { fk: "client_id", table: "clients" } },
  memberships: { profiles: { fk: "user_id", table: "profiles" } },
  approval_events: { content_items: { fk: "item_id", table: "content_items" } },
  attachments: { content_versions: { fk: "version_id", table: "content_versions" } },
};

type Field = { col: string } | { rel: string; inner: boolean; cols: Field[] };

function parseSelect(s: string): Field[] {
  const out: Field[] = [];
  let depth = 0;
  let cur = "";
  const parts: string[] = [];
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  for (const p of parts) {
    const m = p.match(/^([a-z_]+)(!inner)?\(([\s\S]*)\)$/);
    if (m) out.push({ rel: m[1], inner: Boolean(m[2]), cols: parseSelect(m[3]) });
    else out.push({ col: p });
  }
  return out;
}

const likeToRegex = (pattern: string, flags: string) =>
  new RegExp(
    "^" +
      pattern
        .replace(/\\([%_\\])/g, "\u0000$1")
        .replace(/[.*+?^${}()|[\]]/g, "\\$&")
        .replace(/%/g, ".*")
        .replace(/_/g, ".")
        .replace(/\u0000(.)/g, (_, c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) +
      "$",
    flags,
  );

class Query implements PromiseLike<any> {
  private filters: ((r: Row) => boolean)[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private max: number | null = null;
  private fields: Field[] = [{ col: "*" }];
  private countMode = false;
  private head = false;
  private singleMode: "one" | "maybe" | null = null;

  constructor(private d: DemoDb, private uid: string | null, private table: string) {}

  select(cols = "*", opts?: { count?: string; head?: boolean }) {
    this.fields = parseSelect(cols);
    this.countMode = Boolean(opts?.count);
    this.head = Boolean(opts?.head);
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  is(col: string, v: null) {
    this.filters.push((r) => (r[col] ?? null) === v);
    return this;
  }
  ilike(col: string, pattern: string) {
    const re = likeToRegex(pattern, "i");
    this.filters.push((r) => re.test(String(r[col] ?? "")));
    return this;
  }
  like(col: string, pattern: string) {
    const re = likeToRegex(pattern, "");
    this.filters.push((r) => re.test(String(r[col] ?? "")));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending ?? true });
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }
  single() {
    this.singleMode = "one";
    return this;
  }

  private project(table: string, row: Row, fields: Field[]): Row | null {
    const out: Row = {};
    for (const f of fields) {
      if ("col" in f) {
        if (f.col === "*") Object.assign(out, row);
        else out[f.col] = row[f.col] ?? null;
      } else {
        const rel = RELATIONS[table]?.[f.rel];
        const target = rel ? (this.d as any)[rel.table].find((x: Row) => x.id === row[rel.fk]) : null;
        const ok = target && visible(this.d, this.uid, rel!.table, target);
        if (!ok && f.inner) return null;
        out[f.rel] = ok ? this.project(rel!.table, target, f.cols) : null;
      }
    }
    return out;
  }

  private run() {
    const rows: Row[] = ((this.d as any)[this.table] ?? []).filter((r: Row) => visible(this.d, this.uid, this.table, r));
    let res = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.orders.length) {
      res = [...res].sort((a, b) => {
        for (const o of this.orders) {
          const x = a[o.col] ?? null;
          const y = b[o.col] ?? null;
          if (x === y) continue;
          // Postgres default: NULLS LAST for ascending, NULLS FIRST for descending.
          if (x === null) return o.asc ? 1 : -1;
          if (y === null) return o.asc ? -1 : 1;
          return (x < y ? -1 : 1) * (o.asc ? 1 : -1);
        }
        return 0;
      });
    }
    const count = res.length;
    if (this.max !== null) res = res.slice(0, this.max);
    const data = res.map((r) => this.project(this.table, r, this.fields)).filter((r): r is Row => r !== null);
    if (this.head) return { data: null, error: null, count };
    if (this.singleMode) {
      if (data.length > 1 || (this.singleMode === "one" && data.length === 0)) {
        return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" }, count: null };
      }
      return { data: structuredClone(data[0] ?? null), error: null, count: this.countMode ? count : null };
    }
    return { data: structuredClone(data), error: null, count: this.countMode ? count : null };
  }

  then<A = any, B = never>(ok?: ((v: any) => A | PromiseLike<A>) | null, err?: ((e: any) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(ok, err);
  }
}

const notInDemo = (what: string) => ({ data: { user: null, session: null }, error: { message: `${what} is disabled in demo mode. Pick a demo person on the sign-in page.` } });

/** A stand-in for the Supabase client, backed by the in-memory demo store. */
export function createDemoClient(cookies: CookieStore) {
  const d = db();
  const cookieUid = cookies.get(DEMO_COOKIE)?.value ?? null;
  const uid = cookieUid && d.profiles.some((p) => p.id === cookieUid) ? cookieUid : null;
  const profile = d.profiles.find((p) => p.id === uid);

  const client = {
    from: (table: string) => new Query(d, uid, table),
    rpc: async (fn: string, args: Row = {}) => {
      const impl = RPC[fn];
      if (!impl) return { data: null, error: { message: `Function ${fn} is not available in demo mode.` } };
      try {
        return { data: impl(d, uid, args) ?? null, error: null };
      } catch (e) {
        if (e instanceof DemoError) return { data: null, error: { message: e.message } };
        throw e;
      }
    },
    auth: {
      getClaims: async () => ({
        data: uid ? { claims: { sub: uid, email: profile?.email, user_metadata: { full_name: profile?.full_name } } } : null,
        error: null,
      }),
      signOut: async () => {
        try {
          cookies.delete(DEMO_COOKIE);
        } catch {
          /* read-only cookie store (server component) */
        }
        return { error: null };
      },
      signInWithPassword: async () => notInDemo("Password sign-in"),
      signUp: async () => notInDemo("Sign-up"),
      resetPasswordForEmail: async () => notInDemo("Password reset"),
      updateUser: async () => notInDemo("Changing passwords"),
      exchangeCodeForSession: async () => notInDemo("Email links"),
      verifyOtp: async () => notInDemo("Email links"),
    },
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path: string) => {
          if (!canUpload(d, uid, path)) return { data: null, error: { message: "new row violates row-level security policy" } };
          if (d.objects.has(path)) return { data: null, error: { message: "The resource already exists" } };
          const token = randomUUID();
          d.tokens.set(token, { path, kind: "upload", exp: Date.now() + 2 * 3600000, uid: uid ?? undefined });
          return { data: { path, token, signedUrl: `/api/demo/upload?token=${token}` }, error: null };
        },
        createSignedUrl: async (path: string, expiresIn: number, opts?: { download?: string | boolean }) => {
          if (!canRead(d, uid, path) || !d.objects.has(path)) return { data: null, error: { message: "Object not found" } };
          const token = randomUUID();
          d.tokens.set(token, { path, kind: "download", exp: Date.now() + expiresIn * 1000 });
          const dl = opts?.download ? `&download=${encodeURIComponent(String(opts.download))}` : "";
          return { data: { signedUrl: `/api/demo/file?token=${token}${dl}` }, error: null };
        },
      }),
    },
  };
  return client;
}

export const DEMO_PEOPLE_LIST = DEMO_PEOPLE;
