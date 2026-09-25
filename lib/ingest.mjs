// รอบดึงข้อมูล 1 รอบ: ดึง ThaiWater → ตรวจ → วิเคราะห์ → (AI) → บันทึก latest.json
// ถ้าดึงไม่สำเร็จ จะเก็บข้อมูลรอบก่อนไว้ แล้วบันทึกว่าแหล่งข้อมูลขัดข้อง (หน้าเว็บจะขึ้นป้ายข้อมูลล่าช้า)
import { store } from "./store.mjs";
import { validateRaw, buildSnapshot } from "./analyze.mjs";
import { applyAI, aiEnabled } from "./ai.mjs";
import { RIVERS, PROVINCES } from "./config.mjs";

const URL_TW = "https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load";
const UA = "NamThuengNai/0.2 (flood-watch; non-commercial)";

async function fetchThaiWater() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(URL_TW, { signal: ctrl.signal, headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) throw new Error(`ThaiWater HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function runIngest(trigger = "schedule") {
  const s = store();
  const startedAt = new Date();
  const [prev, history] = await Promise.all([
    s.get("data/latest", { type: "json" }),
    s.get("data/history", { type: "json" }),
  ]);

  let snap, error = null;
  try {
    const raw = await fetchThaiWater();
    const rows = validateRaw(raw);
    snap = buildSnapshot(rows, history || {}, startedAt.getTime());
  } catch (e) {
    error = e.name === "AbortError" ? "ThaiWater ไม่ตอบภายใน 12 วินาที" : String(e.message || e);
  }

  if (!snap) {
    // เก็บข้อมูลเดิม แค่อัปเดตสถานะแหล่งข้อมูล
    const kept = prev || { provinces: {}, stations: [], national: null, latestReading: null };
    kept.source = { ...(kept.source || {}), ok: false, lastAttempt: startedAt.toISOString(), error };
    kept.trigger = trigger;
    await s.setJSON("data/latest", kept);
    return { ok: false, error };
  }

  const aiLog = await applyAI(snap.provinces, prev?.provinces);
  const out = {
    version: 2,
    generatedAt: new Date().toISOString(),
    trigger,
    latestReading: snap.latestReading,
    source: { name: "ThaiWater (สสน.)", ok: true, lastAttempt: startedAt.toISOString(), lastSuccess: startedAt.toISOString(), error: null },
    ai: { enabled: aiEnabled(), log: aiLog },
    national: snap.national,
    provinceOrder: PROVINCES,
    rivers: RIVERS,
    provinces: snap.provinces,
    stations: snap.stations,
  };
  await Promise.all([s.setJSON("data/latest", out), s.setJSON("data/history", snap.history)]);
  return { ok: true, stations: out.stations.length, latestReading: out.latestReading, ai: aiLog };
}
