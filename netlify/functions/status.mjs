// /api/status คืนผลรอบล่าสุดและประวัติการรัน สำหรับหน้าเว็บ
import { readRuns } from "../../lib/store.mjs";

export default async () => {
  try {
    const data = await readRuns();
    return Response.json(data, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
};

export const config = { path: "/api/status" };
