// รันอัตโนมัติทุก 30 นาที (นาทีที่ 0 และ 30 ตามเวลา UTC ซึ่งตรงกับนาทีเดียวกันในเวลาไทย)
// ตอนนี้ทำหน้าที่ทดสอบ: ดึงทั้ง 3 แหล่งแล้วบันทึกผลลง Netlify Blobs
// ขั้นถัดไปจะเปลี่ยนเป็นตัวดึงข้อมูลจริง (แปลงข้อมูล + คำนวณสถานะ + เก็บ latest.json)
import { probeAll } from "../../lib/sources.mjs";
import { saveRun } from "../../lib/store.mjs";

export default async () => {
  const report = await probeAll("schedule");
  await saveRun(report);
  console.log(JSON.stringify(report.sources.map((s) => ({ id: s.id, ok: s.ok, ms: s.ms, error: s.error }))));
};

export const config = {
  schedule: "*/30 * * * *",
};
