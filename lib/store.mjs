import { getStore } from "@netlify/blobs";

const STORE = "nam-thueng-nai";
const KEEP_RUNS = 96; // 48 ชั่วโมงเมื่อรันทุก 30 นาที

export function store() {
  return getStore({ name: STORE, consistency: "strong" });
}

// บันทึกผลรอบล่าสุด + ต่อท้ายประวัติ (ย่อ) ไว้ดูว่าการตั้งเวลาทำงานจริงไหม
export async function saveRun(report) {
  const s = store();
  await s.setJSON("probe/latest", report);
  const log = (await s.get("probe/log", { type: "json" })) || [];
  log.push({
    at: report.at,
    trigger: report.trigger,
    totalMs: report.totalMs,
    ok: Object.fromEntries(report.sources.map((x) => [x.id, x.ok])),
  });
  await s.setJSON("probe/log", log.slice(-KEEP_RUNS));
}

export async function readRuns() {
  const s = store();
  const [latest, log] = await Promise.all([
    s.get("probe/latest", { type: "json" }),
    s.get("probe/log", { type: "json" }),
  ]);
  return { latest: latest || null, log: log || [] };
}
