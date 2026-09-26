// /api/ai-check ตรวจว่า API key ของ AI แต่ละตัวใช้งานได้ไหม (ไม่แสดง key) กันกดรัว: 1 ครั้งต่อ 2 นาที
import { checkProviders, providers } from "../../lib/ai.mjs";
import { store } from "../../lib/store.mjs";

export default async () => {
  const s = store();
  const last = await s.get("ai/check", { type: "json" });
  if (last && Date.now() - new Date(last.at) < 120e3) {
    return Response.json({ ...last, cached: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const names = providers().map((p) => p.name);
  const results = names.length ? await checkProviders() : [];
  const out = { at: new Date().toISOString(), order: names, results, message: names.length ? null : "ยังไม่ได้ตั้ง API key ของ AI ใน Netlify" };
  await s.setJSON("ai/check", out);
  return Response.json(out, { headers: { "Cache-Control": "no-store" } });
};

export const config = { path: "/api/ai-check" };
