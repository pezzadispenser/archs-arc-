import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SB = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SIGN_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-arc-token, content-type, x-cron-secret, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const enc = new TextEncoder();

function b64u(buf: ArrayBuffer | Uint8Array) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; b.forEach((x) => (s += String.fromCharCode(x)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function hmac(msg: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(SIGN_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
async function sha256hex(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return Array.from(d).map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function makeToken(m: { id: string; role: string }) {
  const body = b64u(enc.encode(JSON.stringify({ m: m.id, r: m.role, exp: Date.now() + 180 * 864e5 })));
  return body + "." + (await hmac(body));
}
async function readToken(req: Request) {
  const t = req.headers.get("x-arc-token") || "";
  const [body, sig] = t.split(".");
  if (!body || !sig || (await hmac(body)) !== sig) return null;
  try {
    const p = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
    if (p.exp < Date.now()) return null;
    return { id: p.m as string, role: p.r as string };
  } catch { return null; }
}

/* ---------- dates (Europe/London) ---------- */
function londonNow() {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p: Record<string, string> = {};
  f.formatToParts(new Date()).forEach((x) => (p[x.type] = x.value));
  return { date: `${p.year}-${p.month}-${p.day}`, mins: +p.hour * 60 + +p.minute };
}
const parts = (k: string) => k.split("-").map(Number);
const addDays = (k: string, n: number) => { const p = parts(k); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); };
const dow = (k: string) => { const p = parts(k); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); };
const diffDays = (a: string, b: string) => { const pa = parts(a), pb = parts(b); return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 864e5); };
const ANCHOR_US = "2026-11-10";
function weekType(k: string) { const back = (dow(k) - 2 + 7) % 7; const tue = addDays(k, -back); const w = Math.round(diffDays(ANCHOR_US, tue) / 7); return ((w % 2) + 2) % 2 === 0 ? "us" : "dad"; }
const HOLS: [string, string][] = [["2026-10-22", "2026-11-01"], ["2026-12-21", "2027-01-03"], ["2027-02-13", "2027-02-21"], ["2027-03-26", "2027-04-11"], ["2027-05-03", "2027-05-03"], ["2027-05-29", "2027-06-06"]];
const isHoliday = (k: string) => HOLS.some(([a, b]) => k >= a && k <= b);
const hm = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

const MORNING: Record<number, { up: string; leave: string; train: string }> = {
  1: { up: "07:18", leave: "08:08", train: "8:18" },
  2: { up: "08:48", leave: "09:38", train: "9:48" },
  3: { up: "08:48", leave: "09:38", train: "9:48" },
  4: { up: "07:48", leave: "08:38", train: "8:48" },
  5: { up: "07:18", leave: "08:08", train: "8:18" },
};

function remindersFor(k: string, where: string) {
  const d = dow(k), out: { id: string; at: string; title: string; body: string }[] = [];
  const atPez = where === "pez" || where === "";
  if (d >= 1 && d <= 5 && !isHoliday(k)) {
    const m = MORNING[d];
    out.push({ id: "up", at: m.up, title: "Morning quest", body: atPez ? `Up now. Your train is the ${m.train} from Ashwell.` : "Up now. Check your leave time." });
    if (atPez) {
      const l10 = hm(m.leave) - 10;
      out.push({ id: "leave10", at: `${String(Math.floor(l10 / 60)).padStart(2, "0")}:${String(l10 % 60).padStart(2, "0")}`, title: "10 minutes", body: `Leave in 10 for the ${m.train}. Bag from the launch pad.` });
      out.push({ id: "leave", at: m.leave, title: "Go now", body: `Out of the door now for the ${m.train}. Keep the combo alive.` });
    }
    if (d === 4) out.push({ id: "evid", at: "20:30", title: "Business evidence", body: "Due 9am tomorrow. Is it in the folder or on Teams?" });
  }
  if (d === 2) out.push({ id: "gym", at: "16:45", title: "Gym quest", body: "Gym session today? +25 XP." });
  if (d === 3 && where === "pez") out.push({ id: "bins", at: "19:00", title: "Bins", body: "Bins out tonight. Food waste, plus black or blue and green." });
  if (d === 0) out.push({ id: "week", at: "19:00", title: "Week ahead", body: "Pick your houses for the week and send My week." });
  out.push({ id: "bed", at: "21:30", title: "Before-bed quests", body: "Bag packed, clothes out, football stuff, phone on charge." });
  return out;
}

async function secret(name: string) {
  const { data } = await SB.from("app_secrets").select("value").eq("name", name).maybeSingle();
  return data?.value as string | undefined;
}
let vapidReady = false;
async function setupPush() {
  if (vapidReady) return;
  webpush.setVapidDetails("https://archs-arc.vercel.app", (await secret("vapid_public"))!, (await secret("vapid_private"))!);
  vapidReady = true;
}
async function pushTo(memberId: string, payload: { title: string; body: string; tag?: string }) {
  await setupPush();
  const { data: subs } = await SB.from("push_subs").select("endpoint, sub").eq("member_id", memberId);
  let sent = 0;
  for (const s of subs || []) {
    try { await webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: 3600 }); sent++; }
    catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await SB.from("push_subs").delete().eq("endpoint", s.endpoint);
    }
  }
  return sent;
}

const PATH_OK = /^(days\/\d{4}-\d{2}-\d{2}|plan\/stay|log\/homework|ideas\/list|config\/rewards)$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const route = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  try {
    if (route === "login" && req.method === "POST") {
      const { id, pin } = await req.json();
      const { data: m } = await SB.from("members").select("*").eq("id", String(id || "")).maybeSingle();
      if (!m) return json({ error: "Unknown name" }, 401);
      if (m.locked_until && new Date(m.locked_until) > new Date()) return json({ error: "Too many tries. Wait 15 minutes." }, 429);
      if ((await sha256hex(m.pin_salt + ":" + String(pin || ""))) !== m.pin_hash) {
        const failed = (m.failed || 0) + 1;
        await SB.from("members").update({ failed: failed >= 5 ? 0 : failed, locked_until: failed >= 5 ? new Date(Date.now() + 15 * 60e3).toISOString() : null }).eq("id", m.id);
        return json({ error: "Wrong PIN" }, 401);
      }
      await SB.from("members").update({ failed: 0, locked_until: null }).eq("id", m.id);
      return json({ token: await makeToken(m), me: { id: m.id, name: m.name, role: m.role } });
    }
    if (route === "members" && req.method === "GET") {
      const { data } = await SB.from("members").select("id, name").order("id");
      return json({ members: data });
    }
    if (route === "notify" && req.method === "POST") {
      if (req.headers.get("x-cron-secret") !== (await secret("cron"))) return json({ error: "no" }, 403);
      const { date, mins } = londonNow();
      const { data: st } = await SB.from("docs").select("data").eq("path", "plan/stay").maybeSingle();
      const v = (st?.data as { days?: Record<string, { where?: string }> })?.days?.[date] || {};
      const where = v.where === "pez" || v.where === "grace" || v.where === "dad" ? v.where : (weekType(date) === "dad" ? "dad" : "");
      let n = 0;
      for (const r of remindersFor(date, where)) {
        const at = hm(r.at);
        if (mins < at || mins > at + 9) continue;
        const key = `${date}:${r.id}`;
        const { error } = await SB.from("sent_log").insert({ key });
        if (error) continue; // already sent
        n += await pushTo("archie", { title: r.title, body: r.body, tag: r.id });
      }
      await SB.from("sent_log").delete().lt("sent_at", new Date(Date.now() - 14 * 864e5).toISOString());
      return json({ ok: true, date, mins, where, sent: n });
    }

    const me = await readToken(req);
    if (!me) return json({ error: "Please sign in" }, 401);

    if (route === "state" && req.method === "GET") {
      const { data } = await SB.from("docs").select("path, data");
      const docs: Record<string, unknown> = {};
      (data || []).forEach((r) => (docs[r.path] = r.data));
      const { data: subs } = await SB.from("push_subs").select("endpoint").eq("member_id", me.id);
      return json({ docs, me, vapid: await secret("vapid_public"), subs: (subs || []).length });
    }
    if (route === "save" && req.method === "POST") {
      const { path, data } = await req.json();
      if (!PATH_OK.test(String(path))) return json({ error: "Bad path" }, 400);
      if (String(path).startsWith("config/") && me.role !== "parent") return json({ error: "Parents only" }, 403);
      if (typeof data !== "object" || data === null || JSON.stringify(data).length > 200000) return json({ error: "Bad data" }, 400);
      const { error } = await SB.from("docs").upsert({ path, data, updated_at: new Date().toISOString(), updated_by: me.id });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
    if (route === "subscribe" && req.method === "POST") {
      const { sub } = await req.json();
      if (!sub?.endpoint) return json({ error: "Bad subscription" }, 400);
      await SB.from("push_subs").upsert({ endpoint: sub.endpoint, member_id: me.id, sub });
      return json({ ok: true });
    }
    if (route === "unsubscribe" && req.method === "POST") {
      const { endpoint } = await req.json();
      await SB.from("push_subs").delete().eq("endpoint", String(endpoint || "")).eq("member_id", me.id);
      return json({ ok: true });
    }
    if (route === "testpush" && req.method === "POST") {
      const n = await pushTo(me.id, { title: "Arch's Arc", body: "Reminders are on. You're all set.", tag: "test" });
      return json({ ok: true, sent: n });
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
