// (ไม่บังคับ) ให้ AI เรียบเรียงข้อความสรุปจากข้อเท็จจริง — รองรับ Gemini (หลาย key), Groq, Claude
// ตั้ง Environment variables ใน Netlify (ใส่เฉพาะตัวที่มี):
//   GEMINI_API_KEY_1, GEMINI_API_KEY_2, GEMINI_API_KEY_3   (หรือ GEMINI_API_KEY)
//   GROQ_API_KEY
//   CLAUDE_API_KEY  (หรือ ANTHROPIC_API_KEY)
// ไม่บังคับ: AI_ORDER="gemini,groq,claude" (ลำดับที่ลอง), GEMINI_MODEL, GROQ_MODEL, CLAUDE_MODEL
// ถ้าไม่มี key เลย ระบบใช้ข้อความแบบกฎตายตัวตามปกติ

const MAX_PER_RUN = 3;          // เขียนใหม่ได้สูงสุดกี่จังหวัดต่อรอบ
const CALL_TIMEOUT_MS = 10000;
const START_BEFORE_MS = 15000;  // ถ้ารอบนี้ดึงข้อมูลนานเกินนี้ ข้าม AI ไปรอบหน้า
const HARD_DEADLINE_MS = 26000; // ฟังก์ชันตั้งเวลามีเวลา 30 วินาที

const DEFAULTS = {
  claude: "claude-haiku-4-5-20251001",
  groq: "llama-3.3-70b-versatile",
  gemini: null, // เลือกอัตโนมัติจากรายชื่อโมเดลของ key (flash ที่ไม่ใช่ preview ก่อน)
};

export function providers(env = process.env) {
  const list = [];
  const gem = [env.GEMINI_API_KEY_1, env.GEMINI_API_KEY_2, env.GEMINI_API_KEY_3, env.GEMINI_API_KEY].filter(Boolean);
  [...new Set(gem)].forEach((key, i) => list.push({ kind: "gemini", name: `Gemini #${i + 1}`, key, model: env.GEMINI_MODEL || DEFAULTS.gemini }));
  if (env.GROQ_API_KEY) list.push({ kind: "groq", name: "Groq", key: env.GROQ_API_KEY, model: env.GROQ_MODEL || DEFAULTS.groq });
  const ck = env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY;
  if (ck) list.push({ kind: "claude", name: "Claude", key: ck, model: env.CLAUDE_MODEL || env.AI_MODEL || DEFAULTS.claude });
  const order = (env.AI_ORDER || "gemini,groq,claude").split(",").map((s) => s.trim().toLowerCase());
  return list.sort((a, b) => (order.indexOf(a.kind) + 99 * (order.indexOf(a.kind) < 0)) - (order.indexOf(b.kind) + 99 * (order.indexOf(b.kind) < 0)));
}
export const aiEnabled = () => providers().length > 0;

// กันตัวเลขแต่ง: ทุกตัวเลขในข้อความ AI ต้องใกล้เคียงตัวเลขที่มีในข้อมูล (ต่างไม่เกิน 1% หรือ 0.5) ไม่งั้นทิ้ง
export function numbersGrounded(paragraphs, facts) {
  const src = JSON.stringify(facts);
  const pool = (src.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const found = paragraphs.join(" ").replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) || [];
  const bad = found.map(Number).filter((n) => !pool.some((v) => Math.abs(Math.abs(v) - n) <= Math.max(0.5, Math.abs(v) * 0.01)));
  return { ok: bad.length === 0, bad };
}

const SYSTEM = `คุณเรียบเรียงสรุปสถานการณ์น้ำรายจังหวัดเป็นภาษาไทยให้ประชาชนอ่านเข้าใจง่าย
กฎ:
- ใช้เฉพาะตัวเลขและชื่อสถานที่ที่อยู่ในข้อมูล JSON ห้ามคำนวณ ประมาณ หรือแต่งตัวเลขใหม่
- ห้ามเพิ่มระดับความรุนแรงเกินกว่าช่อง level และห้ามลดความรุนแรง
- บอกตำบล/อำเภอที่มีจุดล้นตลิ่งหรือเฝ้าระวังก่อน แล้วค่อยบอกแนวโน้ม
- สถานีที่ tide=true ให้บอกว่าระดับขึ้นลงตามน้ำทะเลหนุน
- ถ้ามี notices ให้อ้างอิงแหล่งและวันที่
- ห้ามให้คำแนะนำที่ขัดกับประกาศของหน่วยงาน
- ช่อง forecast คือพยากรณ์จากแบบจำลอง Open-Meteo ต้องบอกว่าเป็น "พยากรณ์จากแบบจำลอง" ไม่ใช่ประกาศของกรมอุตุนิยมวิทยา
- ช่อง rain คือฝนที่ตกไปแล้ว (วัดจริง) ห้ามสับสนกับพยากรณ์
- ปริมาณน้ำ (q) เป็นค่าวัดของกรมชลประทาน หน่วย ลบ.ม./วินาที; เขื่อน (dams) หน่วย ล้าน ลบ.ม./วัน
- ตอบเป็น JSON เท่านั้น: {"paragraphs": ["...", "..."]} 2-4 ย่อหน้า ย่อหน้าละไม่เกิน 2 ประโยค`;

class ProviderError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
  get skipProvider() { return [401, 403, 429].includes(this.status) || this.status >= 500; }
}

async function post(url, headers, body, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { method: "POST", signal: ctrl.signal, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    const txt = await res.text();
    if (!res.ok) throw new ProviderError(explain(res.status, txt), res.status);
    return JSON.parse(txt);
  } catch (e) {
    if (e.name === "AbortError") throw new ProviderError("ไม่ตอบภายในเวลา", 504);
    throw e;
  } finally {
    clearTimeout(t);
  }
}
function explain(status, txt) {
  const t = (txt || "").toLowerCase();
  if (status === 401 || status === 403 || t.includes("api_key_invalid") || t.includes("invalid api key")) return `key ใช้ไม่ได้ (HTTP ${status})`;
  if (status === 429 || t.includes("quota") || t.includes("rate")) return `โควตาเต็ม/เรียกถี่เกิน (HTTP ${status})`;
  if (t.includes("credit balance")) return `เครดิตหมด (HTTP ${status})`;
  if (status === 404) return `ไม่พบโมเดล (HTTP 404)`;
  return `HTTP ${status}`;
}

const geminiModelCache = new Map();
async function geminiModel(p) {
  if (p.model) return p.model;
  if (geminiModelCache.has(p.key)) return geminiModelCache.get(p.key);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { signal: ctrl.signal, headers: { "x-goog-api-key": p.key } });
    const txt = await res.text();
    if (!res.ok) throw new ProviderError(explain(res.status, txt), res.status);
    const models = (JSON.parse(txt).models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => m.name.replace("models/", ""));
    const score = (n) => (n.includes("flash") ? 0 : 10) + (n.includes("preview") || n.includes("exp") ? 5 : 0) + (n.includes("lite") ? 1 : 0) + (n.includes("image") || n.includes("tts") || n.includes("live") || n.includes("audio") ? 50 : 0);
    const pick = models.filter((n) => n.startsWith("gemini")).sort((a, b) => score(a) - score(b) || b.localeCompare(a))[0];
    if (!pick) throw new ProviderError("ไม่พบโมเดล Gemini ที่ใช้ได้", 404);
    geminiModelCache.set(p.key, pick);
    return pick;
  } catch (e) {
    if (e.name === "AbortError") throw new ProviderError("ไม่ตอบภายในเวลา", 504);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// เรียก AI หนึ่งเจ้า คืนข้อความดิบ
export async function callProvider(p, system, user, { maxTokens = 800, ms = CALL_TIMEOUT_MS } = {}) {
  if (p.kind === "claude") {
    const j = await post("https://api.anthropic.com/v1/messages", { "x-api-key": p.key, "anthropic-version": "2023-06-01" },
      { model: p.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }, ms);
    return { text: (j.content || []).map((c) => c.text || "").join(""), model: p.model };
  }
  if (p.kind === "groq") {
    const j = await post("https://api.groq.com/openai/v1/chat/completions", { Authorization: `Bearer ${p.key}` },
      { model: p.model, max_tokens: maxTokens, temperature: 0.2, messages: [{ role: "system", content: system }, { role: "user", content: user }] }, ms);
    return { text: j.choices?.[0]?.message?.content || "", model: p.model };
  }
  if (p.kind === "gemini") {
    const model = await geminiModel(p);
    const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { "x-goog-api-key": p.key },
      { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 } }, ms);
    return { text: (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || "").join(""), model };
  }
  throw new Error("ไม่รู้จักผู้ให้บริการ");
}

function parseParagraphs(text) {
  const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  if (!Array.isArray(parsed.paragraphs) || !parsed.paragraphs.length) throw new Error("AI ตอบรูปแบบผิด");
  return parsed.paragraphs.map(String).slice(0, 5);
}

// ลองทีละเจ้าตามลำดับ ข้ามเจ้าที่ key เสีย/โควตาเต็มไปจนจบรอบ
async function writeOne(facts, chain, down, deadline) {
  const errors = [];
  for (const p of chain) {
    if (down.has(p.name)) continue;
    const remain = deadline - Date.now();
    if (remain < 3000) { errors.push("หมดเวลา"); break; }
    try {
      const r = await callProvider(p, SYSTEM, JSON.stringify(facts), { ms: Math.min(CALL_TIMEOUT_MS, remain - 1000) });
      const paras = parseParagraphs(r.text);
      const g = numbersGrounded(paras, facts);
      if (!g.ok) throw new Error(`ตัวเลขไม่ตรงข้อมูล: ${g.bad.slice(0, 3).join(", ")}`);
      return { paras, provider: p.name, model: r.model };
    } catch (e) {
      if (e instanceof ProviderError && e.skipProvider) down.add(p.name);
      errors.push(`${p.name}: ${e.message}`);
    }
  }
  throw new Error(errors.join(" / ") || "ไม่มีผู้ให้บริการ AI");
}

// เขียนใหม่เฉพาะจังหวัดที่ fingerprint เปลี่ยน ที่เหลือใช้ข้อความ AI เดิม
export async function applyAI(provinces, previous, startedAt = Date.now()) {
  const log = [];
  const chain = providers();
  if (!chain.length) return log;
  const todo = [];
  for (const [p, cur] of Object.entries(provinces)) {
    const old = previous?.[p];
    if (old?.summaryBy === "ai" && old.fingerprint === cur.fingerprint) {
      Object.assign(cur, { summary: old.summary, summaryBy: "ai", summaryAt: old.summaryAt, summaryProvider: old.summaryProvider });
    } else todo.push(p);
  }
  if (!todo.length) return log;
  if (Date.now() - startedAt > START_BEFORE_MS) { log.push(`ข้าม AI รอบนี้ (ดึงข้อมูลนาน) รอ ${todo.length} จังหวัด`); return log; }
  const deadline = startedAt + HARD_DEADLINE_MS;
  const down = new Set();
  const batch = todo.sort((a, b) => rank(provinces[b].level) - rank(provinces[a].level)).slice(0, MAX_PER_RUN);
  await Promise.all(batch.map(async (p) => {
    const { summary, summaryBy, fingerprint, ...facts } = provinces[p];
    try {
      const r = await writeOne(facts, chain, down, deadline);
      Object.assign(provinces[p], { summary: r.paras, summaryBy: "ai", summaryAt: new Date().toISOString(), summaryProvider: r.provider });
      log.push(`${p}: ok (${r.provider} ${r.model})`);
    } catch (e) {
      log.push(`${p}: ${e.message}`);
    }
  }));
  return log;
}
const rank = (l) => ({ over: 3, watch: 2, ok: 1 }[l] || 0);

// ตรวจว่าแต่ละ key ใช้ได้ไหม (ไม่แสดง key) — ใช้ใน /api/ai-check
export async function checkProviders() {
  const chain = providers();
  return Promise.all(chain.map(async (p) => {
    const t0 = Date.now();
    try {
      const r = await callProvider(p, "ตอบสั้นที่สุด", 'ตอบเป็น JSON {"ok":true}', { maxTokens: 20, ms: 10000 });
      return { name: p.name, ok: true, model: r.model, ms: Date.now() - t0, detail: "ใช้งานได้" };
    } catch (e) {
      return { name: p.name, ok: false, model: p.model || null, ms: Date.now() - t0, detail: e.message };
    }
  }));
}
