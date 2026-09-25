// /api/refresh สั่งดึงข้อมูลทันที (ใช้ครั้งแรกหลัง deploy หรือตอนทดสอบ)
// กันการกดรัว: ถ้ารอบล่าสุดยังไม่ถึง 5 นาที จะไม่ดึงซ้ำ
import { runIngest } from "../../lib/ingest.mjs";
import { store } from "../../lib/store.mjs";

const MIN_GAP_MS = 5 * 60e3;

export default async () => {
  const latest = await store().get("data/latest", { type: "json" });
  const last = latest?.source?.lastAttempt ? new Date(latest.source.lastAttempt).getTime() : 0;
  if (Date.now() - last < MIN_GAP_MS) {
    return Response.json({ ok: true, skipped: true, message: "เพิ่งดึงข้อมูลไปเมื่อไม่ถึง 5 นาทีที่แล้ว" }, { headers: { "Cache-Control": "no-store" } });
  }
  const r = await runIngest("manual");
  return Response.json(r, { status: r.ok ? 200 : 502, headers: { "Cache-Control": "no-store" } });
};

export const config = { path: "/api/refresh" };
