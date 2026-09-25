// เปิด /api/probe เพื่อสั่งทดสอบทันที (ไม่ต้องรอรอบ 30 นาที)
// ผลจะถูกบันทึกลงประวัติด้วย โดยระบุว่าเป็นการสั่งด้วยมือ
import { probeAll } from "../../lib/sources.mjs";
import { saveRun } from "../../lib/store.mjs";

export default async () => {
  const report = await probeAll("manual");
  try { await saveRun(report); } catch (e) { report.storeError = String(e?.message || e); }
  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
};

export const config = { path: "/api/probe" };
