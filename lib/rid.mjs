// ข้อมูลกรมชลประทาน 2 แหล่ง (ถ้า Netlify เข้าไม่ได้ ระบบข้ามไปและใช้ ThaiWater อย่างเดียว)
// 1) bigdata-swoc.rid.go.th  สถานีน้ำท่า ~1,020 แห่ง มีปริมาณน้ำ (ลบ.ม./วินาที) และ % ความจุลำน้ำ
// 2) app.rid.go.th/reservoir  อ่างเก็บน้ำขนาดใหญ่ รายวัน: % ความจุ น้ำไหลเข้า/ระบาย (ล้าน ลบ.ม./วัน)
import { PROVINCES, DAMS } from "./config.mjs";

const UA = "NamThuengNai/0.4 (flood-watch; non-commercial)";
const num = (v) => (v === null || v === undefined || v === "" || isNaN(+String(v).trim()) ? null : +String(v).trim());

async function req(url, opts = {}, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, headers: { "User-Agent": UA, Accept: "application/json", ...(opts.headers || {}) } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new Error(e.name === "AbortError" ? `ไม่ตอบภายใน ${ms / 1000} วินาที` : e.message);
  } finally {
    clearTimeout(t);
  }
}

// ---------- สถานีน้ำท่า ----------
export function normalizeRidStations(rows) {
  return (rows || [])
    .filter((x) => String(x.id || "").startsWith("RID") && PROVINCES.includes(x.province_t))
    .map((x) => ({
      code: (x.station_code || "").trim(),
      name: (x.station_detail || x.name || "").trim(),
      river: x.river || "",
      prov: x.province_t,
      amp: (x.amphoe || "").replace(/^อ\.|^อำเภอ/, "").trim(),
      tam: "",
      lat: num(x.latitude), lon: num(x.longitude),
      at: x.hourly_time_utc || null,
      lvl: num(x.wl_values_msl),
      bank: num(x.brae_level_msl),
      pct: num(x.wl_percent),
      q: num(x.q_values), qmax: num(x.q_max), qpct: num(x.qpercent),
      qdiff: num(x.qval_diff_yd),
      agency: "กรมชลฯ",
    }))
    .filter((x) => x.code && x.lvl != null);
}

export async function fetchRidStations() {
  const j = await req("https://bigdata-swoc.rid.go.th/api/ma/pier/all/get_pier_data", {}, 12000);
  if (!j?.success || !Array.isArray(j.data)) throw new Error("รูปแบบข้อมูลเปลี่ยน");
  const list = normalizeRidStations(j.data);
  if (list.length < 10) throw new Error(`สถานีน้อยผิดปกติ (${list.length})`);
  return list;
}

// ---------- อ่างเก็บน้ำ ----------
const bkkDate = (d = new Date()) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);

export function normalizeDams(j) {
  const all = (j?.regions || []).flatMap((r) => r.dams || []);
  return DAMS.map((want) => {
    const d = all.find((x) => (x.DAM_Name || "").includes(want.match));
    if (!d) return null;
    return {
      name: d.DAM_Name, river: want.river, date: d.DMD_Date,
      pct: num(d.PERCENT_DMD_QUse), volume: num(d.DMD_QUse), capacity: num(d.DAM_QStore),
      inflow: num(d.DMD_Inflow), outflow: num(d.DMD_Outflow),
    };
  }).filter(Boolean);
}

export async function fetchDams(now = new Date()) {
  const body = new URLSearchParams({ date: bkkDate(now), region: "", percent: "", percent_from: "", percent_to: "" });
  const j = await req("https://app.rid.go.th/reservoir/api/dams", {
    method: "POST", body,
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
  }, 10000);
  const dams = normalizeDams(j);
  if (!dams.length) throw new Error("ไม่พบข้อมูลเขื่อน");
  return dams;
}
