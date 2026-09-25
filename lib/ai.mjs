// (ไม่บังคับ) ให้ Claude เรียบเรียงข้อความสรุปจากข้อเท็จจริง
// เปิดใช้เมื่อตั้ง Environment variables ใน Netlify: ANTHROPIC_API_KEY และ AI_MODEL (ชื่อโมเดล เช่นรุ่น Haiku ล่าสุด)
// ถ้าไม่ได้ตั้ง ระบบใช้ข้อความแบบกฎตายตัวตามปกติ

const MAX_PER_RUN = 3;      // เขียนใหม่ได้สูงสุดกี่จังหวัดต่อรอบ (ฟังก์ชันตั้งเวลามีเวลา 30 วินาที)
const TIMEOUT_MS = 12000;

export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY && process.env.AI_MODEL);

const SYSTEM = `คุณเรียบเรียงสรุปสถานการณ์น้ำรายจังหวัดเป็นภาษาไทยให้ประชาชนอ่านเข้าใจง่าย
กฎ:
- ใช้เฉพาะตัวเลขและชื่อสถานที่ที่อยู่ในข้อมูล JSON ห้ามคำนวณ ประมาณ หรือแต่งตัวเลขใหม่
- ห้ามเพิ่มระดับความรุนแรงเกินกว่าช่อง level และห้ามลดความรุนแรง
- บอกตำบล/อำเภอที่มีจุดล้นตลิ่งหรือเฝ้าระวังก่อน แล้วค่อยบอกแนวโน้ม
- สถานีที่ tide=true ให้บอกว่าระดับขึ้นลงตามน้ำทะเลหนุน
- ถ้ามี notices ให้อ้างอิงแหล่งและวันที่
- ห้ามให้คำแนะนำที่ขัดกับประกาศของหน่วยงาน
- ตอบเป็น JSON: {"paragraphs": ["...", "..."]} 2-4 ย่อหน้า ย่อหน้าละไม่เกิน 2 ประโยค`;

async function writeOne(facts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL,
        max_tokens: 700,
        system: SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(facts) }],
      }),
    });
    if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
    const j = await res.json();
    const text = j.content?.map((c) => c.text || "").join("") || "";
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    if (!Array.isArray(parsed.paragraphs) || !parsed.paragraphs.length) throw new Error("AI ตอบรูปแบบผิด");
    return parsed.paragraphs.map(String).slice(0, 5);
  } finally {
    clearTimeout(t);
  }
}

// เขียนใหม่เฉพาะจังหวัดที่ fingerprint เปลี่ยน ที่เหลือใช้ข้อความ AI เดิม
export async function applyAI(provinces, previous) {
  const log = [];
  if (!aiEnabled()) return log;
  const todo = [];
  for (const [p, cur] of Object.entries(provinces)) {
    const old = previous?.[p];
    if (old?.summaryBy === "ai" && old.fingerprint === cur.fingerprint) {
      cur.summary = old.summary; cur.summaryBy = "ai"; cur.summaryAt = old.summaryAt;
    } else todo.push(p);
  }
  const batch = todo.sort((a, b) => rank(provinces[b].level) - rank(provinces[a].level)).slice(0, MAX_PER_RUN);
  await Promise.all(batch.map(async (p) => {
    const { summary, summaryBy, fingerprint, ...facts } = provinces[p];
    try {
      provinces[p].summary = await writeOne(facts);
      provinces[p].summaryBy = "ai";
      provinces[p].summaryAt = new Date().toISOString();
      log.push(`${p}: ok`);
    } catch (e) {
      log.push(`${p}: ${e.name === "AbortError" ? "timeout" : e.message}`);
    }
  }));
  return log;
}
const rank = (l) => ({ over: 3, watch: 2, ok: 1 }[l] || 0);
