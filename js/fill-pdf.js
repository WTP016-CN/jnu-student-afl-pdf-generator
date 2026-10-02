/**
 * 把学生填写的信息绘制到请假申请表模板上。
 *
 * 字体规则（对应需求 3）：
 *   - 英文（数字、字母、半角符号）→ Times New Roman
 *   - 中文（汉字、中文标点、全角符号）→ 宋体
 *   - 默认字号 10.5pt；某一行写不下时自动缩小，最小 7pt
 */
import { PDFDocument, rgb } from '../vendor/pdf-lib.esm.min.js';
import fontkit from '../vendor/fontkit.es.min.js';
import { FONT_SIZE, P1, P1X, BOX, ID_CELLS, P2, P2X } from './pdf-slots.js';

const BLACK = rgb(0, 0, 0);
const MIN_FONT_SIZE = 7;
// 文字与横线起点留一点间距，避免紧贴前面的标签
const SLOT_PAD = 1.5;

// Times New Roman 数字高度（capHeight 662/1000 em），用于把学号在方格内垂直居中
const DIGIT_HEIGHT_RATIO = 0.662;

/* ------------------------------------------------------------------ 字体分段 */

/** 判断是否为需要用宋体渲染的字符（汉字、中文标点、全角符号） */
function isCJK(cp) {
  return (
    (cp >= 0x2e80 && cp <= 0x9fff) || // 汉字、部首、假名（含 0x3000-0x303F 中文标点）
    (cp >= 0x2000 && cp <= 0x206f) || // —…“”‘’ 等通用标点
    (cp >= 0x2100 && cp <= 0x214f) || // ℃ № ™
    (cp >= 0x2460 && cp <= 0x24ff) || // ① ② ③
    (cp >= 0x25a0 && cp <= 0x25ff) || // ■ □ ● ○
    (cp >= 0xff00 && cp <= 0xffef) || // 全角字符
    cp === 0x00b7 // ·
  );
}

/** 按字体把字符串切成若干连续的片段 */
function splitRuns(text) {
  const runs = [];
  for (const ch of text) {
    const cjk = isCJK(ch.codePointAt(0));
    const last = runs[runs.length - 1];
    if (last && last.cjk === cjk) last.text += ch;
    else runs.push({ text: ch, cjk });
  }
  return runs;
}

/* ------------------------------------------------------------------ 绘制工具 */

function measure(text, fonts, size) {
  return splitRuns(text).reduce(
    (w, run) => w + (run.cjk ? fonts.cjk : fonts.latin).widthOfTextAtSize(run.text, size),
    0,
  );
}

/** 太长时从尾部截断并加省略号（正常情况用不到，兜底避免文字压出行外） */
function ellipsize(text, fonts, size, maxWidth) {
  const chars = [...text];
  while (chars.length && measure(chars.join('') + '…', fonts, size) > maxWidth) chars.pop();
  return chars.join('') + '…';
}

/**
 * 绘制一段中英混排的文字，返回实际使用的字号。
 * maxWidth 存在且写不下时自动缩小字号，最小 MIN_FONT_SIZE。
 */
function drawMixed(page, fonts, text, { x, y, maxWidth, size = FONT_SIZE }) {
  if (!text) return size;
  let s = size;
  if (maxWidth) {
    while (s > MIN_FONT_SIZE && measure(text, fonts, s) > maxWidth) s -= 0.25;
    if (measure(text, fonts, s) > maxWidth) text = ellipsize(text, fonts, s, maxWidth);
  }
  let cursor = x;
  for (const run of splitRuns(text)) {
    const font = run.cjk ? fonts.cjk : fonts.latin;
    page.drawText(run.text, { x: cursor, y, size: s, font, color: BLACK });
    cursor += font.widthOfTextAtSize(run.text, s);
  }
  return s;
}

/** 在一条填空横线上写字（横线的 x 区间取自模板实测值） */
function drawSlot(page, fonts, text, slot, y) {
  const [x0, x1] = slot;
  return drawMixed(page, fonts, text, { x: x0 + SLOT_PAD, y, maxWidth: x1 - x0 - SLOT_PAD });
}

/** 在方括号 [ ] 内打勾 */
function drawTick(page, fonts, boxCenterX, baselineY) {
  const size = FONT_SIZE;
  // 宋体 “√” 字形在字身内约占 0.285em~0.785em，据此把笔画对准方框中心
  const inkLeft = 0.285 * size;
  const inkWidth = 0.5 * size;
  page.drawText('√', {
    x: boxCenterX - inkLeft - inkWidth / 2,
    y: baselineY - 0.04 * size, // 笔画在基线以上 0~0.73em，下移一点使它在方括号中居中
    size,
    font: fonts.cjk,
    color: BLACK,
  });
}

/** 把学号填入 10 个方格，每个数字在格内居中 */
function drawStudentId(page, fonts, studentId) {
  const digits = [...studentId.replace(/\D/g, '')].slice(0, ID_CELLS.count);
  const cellWidth = (ID_CELLS.right - ID_CELLS.left) / ID_CELLS.count;
  const baseline =
    ID_CELLS.bottom + (ID_CELLS.top - ID_CELLS.bottom - DIGIT_HEIGHT_RATIO * FONT_SIZE) / 2;
  digits.forEach((digit, i) => {
    const w = fonts.latin.widthOfTextAtSize(digit, FONT_SIZE);
    page.drawText(digit, {
      x: ID_CELLS.left + cellWidth * i + (cellWidth - w) / 2,
      y: baseline,
      size: FONT_SIZE,
      font: fonts.latin,
      color: BLACK,
    });
  });
}

/**
 * 写入“自 __年 __月 __日 至 __年 __月 __日”，以及请假天数。
 * 天数的位置单独用 daysY 指定：第 2 页的天数和起止日期不在同一行。
 */
function drawPeriod(page, fonts, x, { start, end, days }, y, daysY = y) {
  drawSlot(page, fonts, start[0], x.startYear, y);
  drawSlot(page, fonts, start[1], x.startMonth, y);
  drawSlot(page, fonts, start[2], x.startDay, y);
  drawSlot(page, fonts, end[0], x.endYear, y);
  drawSlot(page, fonts, end[1], x.endMonth, y);
  drawSlot(page, fonts, end[2], x.endDay, y);
  drawSlot(page, fonts, days, x.totalDays, daysY);
}

/* ------------------------------------------------------------------ 主流程 */

/**
 * @param {Uint8Array} templateBytes  模板 PDF
 * @param {Uint8Array} latinFontBytes Times New Roman 裁剪字体
 * @param {Uint8Array} cjkFontBytes   宋体裁剪字体
 * @param {object} data               学生填写的数据
 * @returns {Promise<Uint8Array>}     生成好的 PDF
 */
export async function buildLeavePdf({ templateBytes, latinFontBytes, cjkFontBytes, data }) {
  const pdf = await PDFDocument.load(templateBytes);
  pdf.registerFontkit(fontkit);
  const fonts = {
    latin: await pdf.embedFont(latinFontBytes, { subset: true }),
    cjk: await pdf.embedFont(cjkFontBytes, { subset: true }),
  };

  const page1 = pdf.getPage(0);
  const page2 = pdf.getPage(1);
  const [sy, sm, sd] = data.startDate.split('-');
  const [ey, em, ed] = data.endDate.split('-');
  const start = [sy, String(Number(sm)), String(Number(sd))];
  const end = [ey, String(Number(em)), String(Number(ed))];

  /* ---------- 第 1 页：申请人填写部分 ---------- */
  drawStudentId(page1, fonts, data.studentId);
  drawSlot(page1, fonts, data.name, P1X.name, P1.studentIdRow);

  if (data.category === '内招生') drawTick(page1, fonts, BOX.categoryDomestic, P1.studentIdRow);
  else if (data.category === '外招生') drawTick(page1, fonts, BOX.categoryOverseas, P1.studentIdRow);

  drawSlot(page1, fonts, data.college, P1X.college, P1.collegeRow);
  drawSlot(page1, fonts, data.major, P1X.major, P1.collegeRow);
  drawSlot(page1, fonts, data.phone, P1X.phone, P1.contactRow);
  drawSlot(page1, fonts, data.email, P1X.email, P1.contactRow);

  drawPeriod(page1, fonts, P1X, { start, end, days: String(data.days) }, P1.periodRow);

  if (data.reasonType === 'health') drawTick(page1, fonts, BOX.reasonHealth, P1.reasonTypeRow);
  else if (data.reasonType === 'other') drawTick(page1, fonts, BOX.reasonOther, P1.reasonTypeRow);
  // 原因下面的具体情况说明横线留空，由学生打印后手写

  /* ---------- 第 2 页：附件准假条存根（可选） ---------- */
  if (data.fillAttachment) {
    for (const rows of P2) {
      const period = { start, end, days: String(data.days) };
      drawSlot(page2, fonts, data.college, P2X.college, rows.collegeRow);
      drawSlot(page2, fonts, data.major, P2X.major, rows.collegeRow);
      drawSlot(page2, fonts, data.name, P2X.name, rows.studentRow);
      drawSlot(page2, fonts, data.studentId, P2X.studentId, rows.studentRow);
      drawPeriod(page2, fonts, P2X, period, rows.periodRow, rows.studentRow);
    }
  }

  return pdf.save();
}
