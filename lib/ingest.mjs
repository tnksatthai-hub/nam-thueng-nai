// รอบดึงข้อมูล 1 รอบ: ดึง ThaiWater → ตรวจ → วิเคราะห์ → (AI) → บันทึก latest.json
// ถ้าดึงไม่สำเร็จ จะเก็บข้อมูลรอบก่อนไว้ แล้วบันทึกว่าแหล่งข้อมูลขัดข้อง (หน้าเว็บจะขึ้นป้ายข้อมูลล่าช้า)
import { store } from "./store.mjs";
import { validateRaw, buildSnapshot } from "./analyze.mjs";
import { applyAI, aiEnabled } from "./ai.mjs";
import { RIVERS, PROVINCES } from "./config.mjs";
import { fetchRain } from "./rain.mjs";
import { fetchRidStations, fetchDams } from "./rid.mjs";
import { fetchForecast } from "./forecast.mjs";

const URL_TW = "https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load";
const UA = "NamThuengNai/0.3 (flood-watch; non-commercial)";

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
  const rainP = fetchRain(prev?.rain?.provinces).catch((e) => ({ provinces: prev?.rain?.provinces || {}, errors: [String(e.message || e)] }));
  // กรมชลฯ: ถ้าดึงไม่ได้ ระบบทำงานต่อด้วย ThaiWater (เขื่อนเป็นข้อมูลรายวัน ใช้ค่าเดิมได้)
  const ridP = fetchRidStations().then((v) => ({ ok: true, v }), (e) => ({ ok: false, error: e.message }));
  const fcP = fetchForecast(prev?.forecast, startedAt.getTime());
  const damP = fetchDams(startedAt).then((v) => ({ ok: true, v }), (e) => ({ ok: false, error: e.message }));
  try {
    const [raw, rain, ridR, damR, fc] = await Promise.all([fetchThaiWater(), rainP, ridP, damP, fcP]);
    const rows = validateRaw(raw);
    const dams = damR.ok ? damR.v : (prev?.dams?.list || []);
    snap = buildSnapshot(rows, history || {}, startedAt.getTime(), rain.provinces, { stations: ridR.ok ? ridR.v : [], dams }, fc.provinces);
    snap.forecast = fc;
    snap.sources = {
      thaiwater: { ok: true },
      ridStations: ridR.ok ? { ok: true, count: ridR.v.length, ...snap.ridStats } : { ok: false, error: ridR.error },
      ridDams: damR.ok ? { ok: true, count: damR.v.length } : { ok: false, error: damR.error, usingPrevious: dams.length > 0 },
      rain: { ok: !rain.errors?.length, errors: rain.errors },
      forecast: { ok: !fc.error, error: fc.error || null, reused: !!fc.reused },
    };
    snap.dams = { list: dams, fetchedAt: damR.ok ? startedAt.toISOString() : (prev?.dams?.fetchedAt || null) };
    snap.rain = { fetchedAt: startedAt.toISOString(), errors: rain.errors, provinces: rain.provinces };
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

  const aiLog = await applyAI(snap.provinces, prev?.provinces, startedAt.getTime());
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
    rain: snap.rain,
    dams: snap.dams,
    forecast: snap.forecast,
    sources: snap.sources,
    stations: snap.stations,
  };
  await Promise.all([s.setJSON("data/latest", out), s.setJSON("data/history", snap.history)]);
  return { ok: true, stations: out.stations.length, latestReading: out.latestReading, sources: out.sources, ai: aiLog };
}
