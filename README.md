# น้ำถึงไหน · ขั้นทดสอบบน Netlify

ทดสอบว่าเซิร์ฟเวอร์ของ Netlify ดึงข้อมูลจาก 3 แหล่งได้หรือไม่ และการตั้งเวลาทุก 30 นาทีทำงานจริงไหม

| แหล่ง | ทดสอบอะไร |
|---|---|
| ThaiWater (สสน.) | GET JSON สถานีโทรมาตรทั่วประเทศ นับสถานีและเวลาล่าสุด |
| กรมชลประทาน | POST 3 ลุ่ม (เจ้าพระยา ยม น่าน) นับชั่วโมงที่มีข้อมูลวันนี้ |
| สำนักการระบายน้ำ กทม. | GET หน้า HTML นับรหัสสถานี `WL.xxx.nn` |

## โครงสร้าง

```
netlify.toml                      ตั้งค่า publish = public, functions = netlify/functions
public/index.html                 หน้าสถานะการทดสอบ
netlify/functions/fetch-scheduled.mjs   รันเองทุก 30 นาที (*/30 * * * *)
netlify/functions/probe.mjs       /api/probe  สั่งทดสอบทันที
netlify/functions/status.mjs      /api/status ผลล่าสุด + ประวัติ 48 ชม.
lib/sources.mjs                   โค้ดดึงและตรวจแต่ละแหล่ง
lib/store.mjs                     เก็บผลลง Netlify Blobs
```

## วิธี deploy

> **Netlify Drop (ลากโฟลเดอร์ไปวาง) ใช้ไม่ได้** เพราะไม่รองรับ Functions ต้องใช้วิธี A หรือ B

### A) ผ่าน Netlify CLI (เร็วสุดสำหรับทดสอบ)

ต้องมี Node.js 18 ขึ้นไปในเครื่อง

```bash
cd nam-thueng-nai
npm install
npx netlify-cli login          # เปิดเบราว์เซอร์ให้ล็อกอิน Netlify
npx netlify-cli deploy --prod  # ครั้งแรกจะถามให้สร้าง site ใหม่ → ตอบ Create & configure a new project
```

### B) ผ่าน GitHub (เหมาะกับระยะยาว)

1. สร้าง repository ใหม่บน GitHub แล้วอัปโหลดไฟล์ทั้งหมด (ยกเว้น `node_modules`)
2. ใน Netlify กด **Add new project → Import an existing project → GitHub** เลือก repo นี้
3. ไม่ต้องตั้ง build command ใด ๆ (อ่านจาก `netlify.toml`) กด Deploy
4. การแก้โค้ดครั้งต่อไปแค่ push ขึ้น GitHub (แต่ละ production deploy ใช้ 15 เครดิต)

## หลัง deploy ให้ตรวจ 3 อย่าง

1. เปิดหน้าเว็บ กด **ทดสอบตอนนี้** ดูว่าแต่ละแหล่งขึ้น “ดึงได้” หรือ “ดึงไม่ได้” พร้อมเหตุผล
2. ใน Netlify ไปที่ **Logs → Functions → fetch-scheduled** ควรเห็นคำว่า Scheduled และเวลารอบถัดไป
3. รอราว 1 ชั่วโมง แล้วกลับมาดูตาราง **ประวัติการรัน** ต้องมีแถว “อัตโนมัติ” ขึ้นทุก 30 นาที

## อ่านผล

- **ดึงได้ทั้ง 3 แหล่ง + มีรอบอัตโนมัติ** → ไปขั้นต่อไปได้เลย (เปลี่ยนตัวทดสอบเป็นตัวดึงข้อมูลจริง)
- **HTTP 403 / หมดเวลา / ได้คำตอบว่าง** ที่กรมชลฯ หรือ สนน. → น่าจะบล็อก IP ต่างประเทศ ต้องมีตัวดึงข้อมูลเล็ก ๆ ที่รันในไทยสำหรับแหล่งนั้น
- **ไม่มีรอบอัตโนมัติเลย** → Netlify อาจไม่รับ `*/30` ให้เปลี่ยน `schedule` ใน `fetch-scheduled.mjs` เป็น `"@hourly"` แล้ว deploy ใหม่

ข้อมูลเป็นของกรมชลประทาน สถาบันสารสนเทศทรัพยากรน้ำ และสำนักการระบายน้ำ กทม. ก่อนเปิดให้ประชาชนใช้ ควรขออนุญาตใช้ข้อมูลจากหน่วยงาน
