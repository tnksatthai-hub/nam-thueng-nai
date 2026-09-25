// /api/latest ส่งข้อมูลล่าสุดให้หน้าเว็บ (cache 2 นาทีที่ CDN เพื่อประหยัดเครดิตเมื่อคนเข้าเยอะ)
import { store } from "../../lib/store.mjs";

export default async () => {
  const data = await store().get("data/latest", { type: "json" });
  if (!data) {
    return Response.json({ empty: true, message: "ยังไม่มีข้อมูล ระบบจะดึงรอบแรกภายใน 30 นาที" }, { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(data, {
    headers: {
      "Cache-Control": "public, max-age=60",
      "Netlify-CDN-Cache-Control": "public, max-age=120, stale-while-revalidate=300",
    },
  });
};

export const config = { path: "/api/latest" };
