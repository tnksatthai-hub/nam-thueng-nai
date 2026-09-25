// ดึงข้อมูลอัตโนมัติทุก 30 นาที (นาทีที่ :00 และ :30)
import { runIngest } from "../../lib/ingest.mjs";

export default async () => {
  const r = await runIngest("schedule");
  console.log(JSON.stringify(r));
};

export const config = {
  schedule: "*/30 * * * *",
};
