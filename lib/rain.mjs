// ฝนสะสม 3 วัน และ 7 วัน รายจังหวัด จาก ThaiWater (API เดียวกับศูนย์ข้อมูลน้ำระดับจังหวัด เช่น nonthaburi.thaiwater.net)
// ถ้าดึงไม่ได้บางจังหวัด ระบบยังทำงานต่อ และใช้ค่ารอบก่อน
import { PROVINCE_CODE, RAIN } from "./config.mjs";

const BASE = "https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/";
const UA = "NamThuengNai/0.3 (flood-watch; non-commercial)";

async function getJSON(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export function normalizeRain(rows, field) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      code: r.station?.tele_station_oldcode || String(r.station?.id || ""),
      name: (r.station?.tele_station_name?.th || "").trim(),
      amp: r.geocode?.amphoe_name?.th || "",
      tam: r.geocode?.tumbon_name?.th || "",
      mm: r[field] == null || r[field] === "" ? null : +r[field],
      date: r.rainfall_datetime || r.rainfall_end_date || null,
    }))
    .filter((x) => x.mm != null && !isNaN(x.mm))
    .sort((a, b) => b.mm - a.mm)
    .slice(0, RAIN.top);
}

export async function fetchRain(previous) {
  const out = {};
  const errors = [];
  await Promise.all(Object.entries(PROVINCE_CODE).map(async ([prov, code]) => {
    const prev = previous?.[prov] || null;
    try {
      const [r3, r7] = await Promise.all([
        getJSON(`${BASE}rain3d?province_code=${code}`),
        getJSON(`${BASE}rain7d?province_code=${code}`),
      ]);
      out[prov] = { r3: normalizeRain(r3.data, "rain_3d"), r7: normalizeRain(r7.data, "rain_7d"), fetchedAt: new Date().toISOString() };
    } catch (e) {
      errors.push(`${prov}: ${e.name === "AbortError" ? "timeout" : e.message}`);
      if (prev) out[prov] = { ...prev, stale: true };
    }
  }));
  return { provinces: out, errors };
}
