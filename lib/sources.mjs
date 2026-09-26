// ดึงและตรวจข้อมูลจาก 3 แหล่ง: ThaiWater (สสน.), กรมชลประทาน, สำนักการระบายน้ำ กทม.
// แต่ละแหล่งคืนผลแบบเดียวกัน: { id, name, ok, httpStatus, ms, bytes, records, latest, note, error }

const UA = "NamThuengNai/0.1 (flood-watch prototype; contact: tnk.satthai@gmail.com)";
const TIMEOUT_MS = 9000;

async function timedFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { "User-Agent": UA, ...(opts.headers || {}) },
    });
    const text = await res.text();
    return { res, text, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

// วันที่แบบไทย dd/mm/yyyy (พ.ศ.) ตามเวลากรุงเทพฯ
export function thaiDateBE(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric",
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("day")}/${get("month")}/${Number(get("year")) + 543}`;
}

function base(id, name) {
  return { id, name, ok: false, httpStatus: null, ms: null, bytes: 0, records: 0, latest: null, note: "", error: null };
}

function errMsg(e) {
  if (e?.name === "AbortError") return `หมดเวลา (เกิน ${TIMEOUT_MS / 1000} วินาที)`;
  return String(e?.cause?.code || e?.message || e);
}

// ---------- 1) ThaiWater ----------
export async function probeThaiWater() {
  const r = base("thaiwater", "ThaiWater (สสน.)");
  try {
    const { res, text, ms } = await timedFetch(
      "https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load",
      { headers: { Accept: "application/json" } }
    );
    Object.assign(r, { httpStatus: res.status, ms, bytes: text.length });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = JSON.parse(text);
    const rows = j?.waterlevel_data?.data;
    if (!Array.isArray(rows)) throw new Error("รูปแบบข้อมูลเปลี่ยน: ไม่พบ waterlevel_data.data");
    r.records = rows.length;
    r.latest = rows.map((x) => x.waterlevel_datetime).filter(Boolean).sort().pop() || null;
    const withTambon = rows.filter((x) => x?.geocode?.tumbon_name?.th).length;
    r.note = `สถานีที่มีชื่อตำบล ${withTambon} แห่ง`;
    r.ok = r.records > 100;
    if (!r.ok) r.error = "จำนวนสถานีน้อยผิดปกติ";
  } catch (e) {
    r.error = errMsg(e);
  }
  return r;
}

// ---------- 2) กรมชลประทาน ----------
// UtokID 5 / BasinID 10 = ภาคกลาง ลุ่มเจ้าพระยา · UtokID 2 / BasinID 8 = ยม · 9 = น่าน
export const RID_GROUPS = [
  { key: "chaophraya", label: "เจ้าพระยา", utok: 5, basin: 10, page: "hydro5h.html" },
  { key: "yom", label: "ยม", utok: 2, basin: 8, page: "hydro2h.html" },
  { key: "nan", label: "น่าน", utok: 2, basin: 9, page: "hydro2h.html" },
];

export async function fetchRidGroup(g, date = thaiDateBE()) {
  const body = new URLSearchParams({
    "DW[UtokID]": String(g.utok),
    "DW[BasinID]": String(g.basin),
    "DW[TimeCurrent]": date,
    _search: "false",
    rows: "100",
    page: "1",
    sidx: "indexhourly",
    sord: "asc",
  });
  const { res, text, ms } = await timedFetch(
    "https://hyd-app-db.rid.go.th/webservice/getGroupHourlyWaterLevelReportAllHL5.ashx",
    {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json, text/javascript, */*; q=0.01",
        Referer: `https://hyd-app-db.rid.go.th/${g.page}`,
        Origin: "https://hyd-app-db.rid.go.th",
      },
    }
  );
  let rows = [];
  if (res.ok && text.trim().startsWith("{")) rows = JSON.parse(text).rows || [];
  const filled = rows.filter((x) => x.wlvalues1 !== null && x.wlvalues1 !== "" && x.wlvalues1 !== undefined);
  return { res, text, ms, rows, filled };
}

export async function probeRID() {
  const r = base("rid", "กรมชลประทาน");
  const parts = [];
  let okGroups = 0, maxMs = 0, bytes = 0, lastStatus = null;
  const results = await Promise.allSettled(RID_GROUPS.map((g) => fetchRidGroup(g)));
  results.forEach((out, i) => {
    const g = RID_GROUPS[i];
    if (out.status === "rejected") { parts.push(`${g.label}: ${errMsg(out.reason)}`); return; }
    const { res, text, ms, filled } = out.value;
    lastStatus = res.status; maxMs = Math.max(maxMs, ms); bytes += text.length;
    if (!res.ok) { parts.push(`${g.label}: HTTP ${res.status}`); return; }
    if (!text.trim()) { parts.push(`${g.label}: ได้คำตอบว่าง (อาจถูกกรองคำขอ)`); return; }
    const last = filled[filled.length - 1];
    parts.push(`${g.label}: ${filled.length} ชั่วโมง ล่าสุด ${last ? last.hourlytime + " น." : "-"}`);
    if (filled.length) { okGroups++; r.records += filled.length; r.latest = r.latest || (last && `${thaiDateBE()} ${last.hourlytime}`); }
  });
  Object.assign(r, { httpStatus: lastStatus, ms: maxMs, bytes, note: parts.join(" · ") });
  r.ok = okGroups === RID_GROUPS.length;
  if (!r.ok) r.error = okGroups ? `ได้ ${okGroups}/${RID_GROUPS.length} ลุ่ม` : "ดึงไม่ได้ทุกลุ่ม";
  return r;
}

// ---------- 3) สำนักการระบายน้ำ กทม. ----------
export async function probeBMA() {
  const r = base("bma", "สำนักการระบายน้ำ กทม.");
  try {
    const { res, text, ms } = await timedFetch("https://weather.bangkok.go.th/water", {
      headers: { Accept: "text/html" },
    });
    Object.assign(r, { httpStatus: res.status, ms, bytes: text.length });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const codes = new Set(text.match(/WL\.[A-Z0-9]{2,4}\.\d{2}/g) || []);
    r.records = codes.size;
    const times = text.match(/\d{2}\/\d{2}\/25\d{2} \d{2}:\d{2}/g) || [];
    const key = (s) => s.slice(6, 10) + s.slice(3, 5) + s.slice(0, 2) + s.slice(11);
    r.latest = times.sort((a, b) => key(a).localeCompare(key(b))).pop() || null;
    r.note = `พบรหัสสถานี ${codes.size} รหัส`;
    r.ok = codes.size > 100;
    if (!r.ok) r.error = "พบสถานีน้อยผิดปกติ (โครงสร้างหน้าเว็บอาจเปลี่ยน)";
  } catch (e) {
    r.error = errMsg(e);
  }
  return r;
}

async function probeSimple(id, name, fn) {
  const r = base(id, name); const t0 = Date.now();
  try { const n = await fn(); Object.assign(r, { ok: n > 0, records: n, httpStatus: 200 }); if (!r.ok) r.error = "ไม่มีข้อมูล"; }
  catch (e) { r.error = errMsg(e); }
  r.ms = Date.now() - t0; return r;
}

export async function probeAll(trigger) {
  const t0 = Date.now();
  const { fetchRidStations, fetchDams } = await import("./rid.mjs");
  const [thaiwater, rid, bma, big, dam] = await Promise.all([
    probeThaiWater(), probeRID(), probeBMA(),
    probeSimple("ridbig", "กรมชลฯ bigdata-swoc (น้ำท่า)", async () => (await fetchRidStations()).length),
    probeSimple("riddam", "กรมชลฯ อ่างเก็บน้ำ", async () => (await fetchDams()).length),
  ]);
  return {
    trigger,
    at: new Date().toISOString(),
    region: process.env.AWS_REGION || process.env.NETLIFY_REGION || null,
    totalMs: Date.now() - t0,
    sources: [thaiwater, rid, bma, big, dam],
  };
}
