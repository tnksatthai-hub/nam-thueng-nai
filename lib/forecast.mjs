// พยากรณ์ฝนรายวันจาก Open-Meteo (แบบจำลองพยากรณ์อากาศ ไม่ใช่กรมอุตุนิยมวิทยา) — ฟรีสำหรับงานไม่เชิงพาณิชย์ ต้องให้เครดิต Open-Meteo.com
// เรียกครั้งเดียวได้ทั้ง 10 จังหวัด และดึงใหม่ทุก FORECAST.refreshHours ชั่วโมง
import { PROVINCES, PROVINCE_POINT, FORECAST } from "./config.mjs";

export function normalizeForecast(json) {
  const arr = Array.isArray(json) ? json : [json];
  const out = {};
  PROVINCES.forEach((p, i) => {
    const d = arr[i]?.daily;
    if (!d?.time) return;
    out[p] = d.time.map((date, k) => ({
      date,
      mm: d.precipitation_sum?.[k] ?? null,
      prob: d.precipitation_probability_max?.[k] ?? null,
    }));
  });
  return out;
}

export async function fetchForecast(previous, now = Date.now()) {
  if (previous?.fetchedAt && now - new Date(previous.fetchedAt) < FORECAST.refreshHours * 3600e3 && previous.provinces) {
    return { ...previous, reused: true };
  }
  const lat = PROVINCES.map((p) => PROVINCE_POINT[p][0]).join(",");
  const lon = PROVINCES.map((p) => PROVINCE_POINT[p][1]).join(",");
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=precipitation_sum,precipitation_probability_max&forecast_days=${FORECAST.days}&timezone=Asia%2FBangkok`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const provinces = normalizeForecast(await res.json());
    if (!Object.keys(provinces).length) throw new Error("ไม่มีข้อมูลพยากรณ์");
    return { provinces, fetchedAt: new Date(now).toISOString(), source: "Open-Meteo.com" };
  } catch (e) {
    const msg = e.name === "AbortError" ? "ไม่ตอบภายใน 8 วินาที" : e.message;
    if (previous?.provinces) return { ...previous, error: msg, stale: true };
    return { provinces: {}, error: msg };
  } finally {
    clearTimeout(t);
  }
}
