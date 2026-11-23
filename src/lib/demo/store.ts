/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory demo tables are loosely typed rows */
import "server-only";
import { deflateSync } from "node:zlib";

/**
 * In-memory "database" for DEMO MODE. Lives on globalThis so it survives hot
 * reloads; it is reset when the dev server restarts.
 */
export type Row = Record<string, any>;
export type DemoDb = {
  organizations: Row[];
  profiles: Row[];
  clients: Row[];
  memberships: Row[];
  invitations: Row[];
  content_items: Row[];
  content_versions: Row[];
  attachments: Row[];
  approval_events: Row[];
  notifications: Row[];
  objects: Map<string, { bytes: Buffer; mime: string; size: number }>;
  tokens: Map<string, { path: string; kind: "upload" | "download"; exp: number; uid?: string }>;
  clock: number | null;
};

/** Fixed ids so a demo sign-in cookie survives server restarts. */
export const DEMO_PEOPLE = [
  { id: "d0000000-0000-4000-8000-000000000001", name: "Maya Okafor", email: "maya.okafor@northstar-demo.example", title: "Agency Admin", subtitle: "Head of Marketing Operations" },
  { id: "d0000000-0000-4000-8000-000000000002", name: "Leo Brandt", email: "leo.brandt@northstar-demo.example", title: "Content Team", subtitle: "Social Media Manager" },
  { id: "d0000000-0000-4000-8000-000000000003", name: "Priya Nair", email: "priya.nair@northstar-demo.example", title: "Content Team", subtitle: "Account Lead" },
  { id: "d0000000-0000-4000-8000-000000000004", name: "Jonas Weller", email: "jonas.weller@northstar-demo.example", title: "Client Approver", subtitle: "Halden Coffee Roasters" },
  { id: "d0000000-0000-4000-8000-000000000005", name: "Ana Ferreira", email: "ana.ferreira@northstar-demo.example", title: "Client Approver", subtitle: "Verde Living Studio" },
] as const;

const g = globalThis as unknown as { __operviaDemoDb?: DemoDb; __operviaDemoSeeding?: boolean };

export function emptyDb(): DemoDb {
  return {
    organizations: [],
    profiles: [],
    clients: [],
    memberships: [],
    invitations: [],
    content_items: [],
    content_versions: [],
    attachments: [],
    approval_events: [],
    notifications: [],
    objects: new Map(),
    tokens: new Map(),
    clock: null,
  };
}

export function getDb(seed: (db: DemoDb) => void): DemoDb {
  if (!g.__operviaDemoDb) {
    const db = emptyDb();
    g.__operviaDemoDb = db;
    seed(db);
  }
  return g.__operviaDemoDb;
}

export function resetDb(seed: (db: DemoDb) => void) {
  g.__operviaDemoDb = undefined;
  return getDb(seed);
}

export function nowIso(db: DemoDb) {
  return new Date(db.clock ?? Date.now()).toISOString();
}

/* Placeholder creative (PNG) so attachments have real previews. */
function crc32(buf: Buffer) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function placeholderPng(a: number[], b: number[], size = 480) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      const band = y > size * 0.62 && y < size * 0.8 && x > size * 0.1 && x < size * 0.9;
      const ring = Math.abs(Math.hypot(x - size * 0.5, y - size * 0.36) - size * 0.16) < size * 0.025;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) {
        let v = a[i] + (b[i] - a[i]) * t;
        if (band) v = v * 0.55 + 255 * 0.45;
        if (ring) v = 255;
        raw[o + i] = Math.max(0, Math.min(255, Math.round(v)));
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
