// แปลงข้อมูล ThaiWater → สถานีมาตรฐาน → สถานะ แนวโน้ม และสรุปรายจังหวัด (ฟังก์ชันล้วน ทดสอบได้โดยไม่ต้องต่อเน็ต)
import { PROVINCES, THRESHOLDS, TIDE_CODES, KEY_STATION, TRAVEL_FROM_DAM, NOTICES, PROVINCE_NOTES, RAIN, SAME_SPOT_DEG } from "./config.mjs";

const num = (v) => (v === null || v === undefined || v === "" || isNaN(+v) ? null : +v);
export const toISO = (dt) => (dt ? new Date(dt.replace(" ", "T") + ":00+07:00").toISOString() : null);
const RANK = { over: 3, watch: 2, ok: 1, na: 0, stale: -1 };
export const LABEL = { over: "ล้นตลิ่ง", watch: "เฝ้าระวัง", ok: "ปกติ", na: "ไม่มีเกณฑ์", stale: "ข้อมูลเก่า" };

export function validateRaw(raw) {
  const rows = raw?.waterlevel_data?.data;
  if (!Array.isArray(rows)) throw new Error("รูปแบบข้อมูล ThaiWater เปลี่ยน: ไม่พบ waterlevel_data.data");
  if (rows.length < 100) throw new Error(`จำนวนสถานีน้อยผิดปกติ (${rows.length})`);
  return rows;
}

export function normalize(rows) {
  return rows.map((r) => {
    const st = r.station || {}, g = r.geocode || {};
    return {
      id: st.id,
      code: (st.tele_station_oldcode || "").trim() || String(st.id),
      name: (st.tele_station_name?.th || "").trim(),
      prov: g.province_name?.th || "",
      amp: g.amphoe_name?.th || "",
      tam: g.tumbon_name?.th || "",
      basin: (r.basin?.basin_name?.th || "").replace("ลุ่มน้ำ", ""),
      agency: r.agency?.agency_shortname?.th || "",
      lat: num(st.tele_station_lat), lon: num(st.tele_station_long),
      at: toISO(r.waterlevel_datetime),
      lvl: num(r.waterlevel_msl),
      prev: num(r.waterlevel_msl_previous),
      bank: num(st.min_bank),
      pct: num(r.storage_percent),
      level: r.situation_level ?? null,
    };
  });
}

export function statusOf(s, now) {
  if (!s.at || now - new Date(s.at) > THRESHOLDS.staleHours * 3600e3) return "stale";
  if (s.lvl != null && s.bank != null && s.lvl > s.bank) return "over";
  if (s.pct == null) return "na";
  if (s.pct > THRESHOLDS.overPct) return "over";
  if (s.pct >= THRESHOLDS.watchPct) return "watch";
  return "ok";
}

// history: { [code]: [[iso, lvl], ...] } เก็บเฉพาะจังหวัดที่ครอบคลุม
export function updateHistory(history, stations, now) {
  const h = { ...history };
  const cutoff = now - 26 * 3600e3;
  for (const s of stations) {
    if (s.at == null || s.lvl == null) continue;
    const arr = (h[s.code] || []).filter(([t]) => new Date(t) >= cutoff);
    if (!arr.length || arr[arr.length - 1][0] !== s.at) arr.push([s.at, s.lvl]);
    h[s.code] = arr.slice(-80);
  }
  return h;
}

export function trendOf(s, history) {
  const arr = history[s.code] || [];
  const target = new Date(s.at) - THRESHOLDS.trendHours * 3600e3;
  let base = null;
  for (const [t, v] of arr) { if (new Date(t) <= target + 30 * 60e3) base = [t, v]; }
  if (base) return { d: +(s.lvl - base[1]).toFixed(2), hours: +((new Date(s.at) - new Date(base[0])) / 3600e3).toFixed(1) };
  if (arr.length >= 2) {
    const [t0, v0] = arr[0];
    return { d: +(s.lvl - v0).toFixed(2), hours: +((new Date(s.at) - new Date(t0)) / 3600e3).toFixed(1) };
  }
  return null;
}

const margin = (s) => (s.lvl != null && s.bank != null ? +(s.lvl - s.bank).toFixed(2) : null);
const cm = (d) => `${d > 0 ? "+" : ""}${Math.round(d * 100)} ซม.`;

export function activeNotices(now) {
  return NOTICES.filter((n) => now - new Date(n.date + "T00:00:00+07:00") <= n.expireDays * 86400e3);
}

// ข้อเท็จจริงของจังหวัด (ใช้ทั้งทำข้อความแบบกฎ และส่งให้ AI เรียบเรียง)
export function provinceFacts(prov, stations, now, rain) {
  const list = stations.filter((s) => s.prov === prov && !s.dupOf);
  const fresh = list.filter((s) => s.status !== "stale");
  const over = fresh.filter((s) => s.status === "over");
  const watch = fresh.filter((s) => s.status === "watch");
  const rising = fresh.filter((s) => !s.tide && s.trend && s.trend.d * 100 >= THRESHOLDS.risingCm);
  const level = fresh.reduce((w, s) => (RANK[s.status] > RANK[w] ? s.status : w), fresh.length ? "ok" : "na");
  let key = null;
  for (const c of KEY_STATION[prov] || []) { key = fresh.find((s) => s.code === c); if (key) break; }
  if (!key) key = [...fresh].filter((s) => s.pct != null).sort((a, b) => b.pct - a.pct)[0] || null;
  const notices = activeNotices(now).filter((n) => n.districts[prov]).map((n) => ({ date: n.date, source: n.source, url: n.url, text: n.text, districts: n.districts[prov] }));
  return {
    prov, level,
    counts: { total: list.length, fresh: fresh.length, stale: list.length - fresh.length, over: over.length, watch: watch.length, rising: rising.length },
    over: over.map(pick), watch: watch.map(pick), rising: rising.map(pick),
    key: key ? pick(key) : null,
    travelHours: TRAVEL_FROM_DAM[prov] ?? null,
    notices,
    rain: rainFacts(rain?.[prov]),
    note: PROVINCE_NOTES[prov] || null,
  };
}
function rainFacts(r) {
  if (!r) return null;
  const top3 = r.r3?.[0] || null, top7 = r.r7?.[0] || null;
  return { max3d: top3, max7d: top7, stale: !!r.stale };
}
const pick = (s) => ({ code: s.code, name: s.name, amp: s.amp, tam: s.tam, lvl: s.lvl, bank: s.bank, margin: margin(s), pct: s.pct, trend: s.trend, tide: s.tide, at: s.at });

// ข้อความสรุปแบบกฎตายตัว (ใช้เมื่อไม่มี AI หรือ AI ล้มเหลว)
export function templateSummary(f) {
  const p = [];
  if (!f.counts.fresh) return ["ยังไม่มีข้อมูลสถานีที่เป็นปัจจุบันในจังหวัดนี้"];
  if (f.over.length) {
    p.push(`มีจุดน้ำล้นตลิ่ง ${f.over.length} จุด: ` + f.over.map((s) => `${s.tam ? "ต." + s.tam + " " : ""}อ.${s.amp} (${s.name}${s.margin != null && s.margin > 0 ? ` เหนือตลิ่ง ${s.margin.toFixed(2)} ม.` : ""})`).join(", "));
  }
  if (f.watch.length) {
    const amps = [...new Set(f.watch.map((s) => "อ." + s.amp))];
    p.push(`พื้นที่เฝ้าระวัง (น้ำเกิน 80% ของความจุ) ${f.watch.length} จุด ใน ${amps.join(" ")}`);
  }
  if (!f.over.length && !f.watch.length) p.push(`สถานีวัดน้ำ ${f.counts.fresh} แห่งในจังหวัดอยู่ในเกณฑ์ปกติ`);
  if (f.key) {
    const k = f.key;
    let t = `สถานี ${k.code} ${k.name} อ.${k.amp} ระดับ ${k.lvl?.toFixed(2)} ม.รทก.`;
    if (k.margin != null) t += ` ${k.margin > 0 ? "เหนือตลิ่ง" : "ต่ำกว่าตลิ่ง"} ${Math.abs(k.margin).toFixed(2)} ม.`;
    if (k.pct != null) t += ` (${Math.round(k.pct)}% ของความจุ)`;
    if (k.trend) t += k.tide ? ` เปลี่ยน ${cm(k.trend.d)} ใน ${k.trend.hours} ชม. ส่วนใหญ่มาจากน้ำทะเลหนุน` : ` เปลี่ยน ${cm(k.trend.d)} ใน ${k.trend.hours} ชม.`;
    p.push(t);
  }
  if (f.rising.length) p.push(`สถานีที่น้ำกำลังเพิ่มขึ้นเกิน ${THRESHOLDS.risingCm} ซม.: ` + f.rising.slice(0, 5).map((s) => `${s.name} อ.${s.amp} (${cm(s.trend.d)})`).join(", "));
  if (f.rain?.max3d && f.rain.max3d.mm >= RAIN.mention3d) {
    const r = f.rain.max3d;
    p.push(`ฝนสะสม 3 วันสูงสุดในจังหวัด ${Math.round(r.mm)} มม. ที่ ${r.tam ? "ต." + r.tam + " " : ""}อ.${r.amp}${r.mm >= RAIN.high3d ? " ฝนสะสมระดับนี้อาจทำให้น้ำท่วมขังในพื้นที่ลุ่มต่ำได้ แม้แม่น้ำยังไม่ล้นตลิ่ง" : ""}`);
  }
  if (f.travelHours) p.push(`น้ำที่ระบายจากเขื่อนเจ้าพระยาใช้เวลาประมาณ ${f.travelHours} ชั่วโมงกว่าจะถึงพื้นที่นี้ (ค่าประมาณ อาจคลาดเคลื่อน)`);
  for (const n of f.notices) p.push(`ประกาศ${n.source} ${thaiDate(n.date)}: อ.${n.districts.join(" อ.")} ${n.text}`);
  if (f.note) p.push(f.note);
  return p;
}
const thaiDate = (d) => new Date(d + "T00:00:00+07:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Bangkok" });

// ลายนิ้วมือของสถานการณ์: เปลี่ยนเมื่อสถานะหรือชุดจุดเสี่ยงเปลี่ยน → ใช้ตัดสินว่าต้องให้ AI เขียนใหม่ไหม
export function factsFingerprint(f) {
  return JSON.stringify([f.level, f.over.map((s) => s.code).sort(), f.watch.map((s) => s.code).sort(), f.rising.map((s) => s.code).sort(), f.notices.map((n) => n.date), (f.rain?.max3d?.mm ?? 0) >= RAIN.high3d]);
}

export function buildSnapshot(rows, history, now = Date.now(), rain = null) {
  const all = normalize(rows);
  const latestReading = all.map((s) => s.at).filter(Boolean).sort().pop() || null;
  const national = {
    total: all.length,
    over: all.filter((s) => s.level >= 5).length,
    high: all.filter((s) => s.level === 4).length,
  };
  const covered = all.filter((s) => PROVINCES.includes(s.prov));
  const newHistory = updateHistory(history || {}, covered, now);
  for (const s of covered) {
    s.status = statusOf(s, now);
    s.tide = TIDE_CODES.includes(s.code);
    s.trend = s.status === "stale" ? null : trendOf(s, newHistory);
  }
  markDuplicates(covered);
  const provinces = {};
  for (const p of PROVINCES) {
    const facts = provinceFacts(p, covered, now, rain);
    provinces[p] = { ...facts, fingerprint: factsFingerprint(facts), summary: templateSummary(facts), summaryBy: "rule" };
  }
  return { latestReading, national, stations: covered, provinces, history: newHistory };
}

// สถานีของต่างหน่วยงานที่ตั้งอยู่จุดเดียวกัน: เก็บตัวที่รุนแรงกว่า อีกตัวใส่ dupOf (ยังแสดงในผังแม่น้ำ แต่ไม่นับซ้ำ)
export function markDuplicates(stations) {
  const fresh = stations.filter((s) => s.status !== "stale" && s.lat != null && s.lon != null);
  for (let i = 0; i < fresh.length; i++) {
    for (let j = i + 1; j < fresh.length; j++) {
      const a = fresh[i], b = fresh[j];
      if (a.dupOf || b.dupOf || a.prov !== b.prov) continue;
      if (Math.abs(a.lat - b.lat) > SAME_SPOT_DEG || Math.abs(a.lon - b.lon) > SAME_SPOT_DEG) continue;
      const score = (s) => RANK[s.status] * 1000 + (s.pct ?? 0);
      const [keep, drop] = score(a) >= score(b) ? [a, b] : [b, a];
      drop.dupOf = keep.code;
      keep.alsoAt = [...(keep.alsoAt || []), drop.code];
    }
  }
  return stations;
}
