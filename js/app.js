/** 页面交互：收集表单 → 调用 fill-pdf 生成 PDF → 下载。 */
import fontkit from '../vendor/fontkit.es.min.js';
import { buildLeavePdf } from './fill-pdf.js';
import { TEMPLATE_PDF_BASE64 } from './template-data.js';

const $ = (id) => document.getElementById(id);
const form = $('form');
const statusEl = $('status');
const submitBtn = $('submitBtn');

// 模板以 base64 内嵌在 js/template-data.js 里，不走网络请求：
// 有些浏览器安全软件会按内容识别 PDF 并掐断响应，fetch 会失败。
const ASSETS = {
  cjkFontBytes: 'assets/fonts/noto-serif-sc-subset.ttf',
  latinFontBytes: 'assets/fonts/tinos-subset.ttf',
};

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let assetsPromise = null;
let cjkCharset = null;

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

/** 加载两份字体（只加载一次，之后走缓存） */
function loadAssets() {
  if (!assetsPromise) {
    assetsPromise = Promise.all(
      Object.entries(ASSETS).map(async ([key, url]) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`加载 ${url} 失败（HTTP ${res.status}）`);
        return [key, new Uint8Array(await res.arrayBuffer())];
      }),
    )
      .then(Object.fromEntries)
      .catch((err) => {
        assetsPromise = null;
        throw err;
      });
  }
  return assetsPromise;
}

/* --------------------------------------------------------------- 表单处理 */

function fail(field, message) {
  field.focus();
  throw new Error(message);
}

function readForm() {
  const studentId = $('studentId').value.trim();
  if (!/^\d{1,10}$/.test(studentId)) fail($('studentId'), '请填写学号（最多 10 位数字）');

  const name = $('name').value.trim();
  if (!name) fail($('name'), '请填写姓名');

  const category = form.querySelector('input[name="category"]:checked');
  if (!category) fail($('studentId'), '请选择学生类别（内招生 / 外招生）');

  const college = $('college').value.trim();
  if (!college) fail($('college'), '请填写学院');

  const major = $('major').value.trim();
  if (!major) fail($('major'), '请填写专业');

  const phone = $('phone').value.trim();
  if (!/^[\d\-+() ]{7,20}$/.test(phone)) fail($('phone'), '请填写正确的手机号码');

  const email = readEmail();

  const startDate = $('startDate').value;
  const endDate = $('endDate').value;
  if (!startDate) fail($('startDate'), '请选择开始日期');
  if (!endDate) fail($('endDate'), '请选择结束日期');
  const days = daysBetween(startDate, endDate);
  if (days < 1) fail($('endDate'), '结束日期不能早于开始日期');

  const reasonType = form.querySelector('input[name="reasonType"]:checked');
  if (!reasonType) fail($('startDate'), '请选择请假原因类型');

  const unsupported = unsupportedChars(name + college + major);
  if (unsupported.length) throw new Error(`这些字不在字体范围内，请替换或用其他字：${unsupported.join(' ')}`);

  return {
    studentId,
    name,
    category: category.value,
    college,
    major,
    phone,
    email,
    startDate,
    endDate,
    days,
    reasonType: reasonType.value,
    fillAttachment: $('fillAttachment').checked,
  };
}

/* --------------------------------------------------------- 电邮（学子邮 / 自备） */

const SCHOOL_EMAIL_DOMAIN_SUFFIX = '.jnu.edu.cn';

function emailMode() {
  return form.querySelector('input[name="emailMode"]:checked').value;
}

/**
 * 学子邮按“用户名@stu+入学年份.jnu.edu.cn”生成，入学年份取学号前 4 位。
 * 例：学号 2025103491、用户名 zhangsan → zhangsan@stu2025.jnu.edu.cn
 */
function studentYear() {
  const studentId = $('studentId').value.trim();
  return /^\d{4}/.test(studentId) ? studentId.slice(0, 4) : null;
}

function schoolEmail() {
  const year = studentYear();
  return year ? `${$('emailUser').value.trim()}@stu${year}${SCHOOL_EMAIL_DOMAIN_SUFFIX}` : '';
}

function readEmail() {
  if (emailMode() === 'personal') {
    const email = $('email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail($('email'), '请填写正确的电邮地址');
    return email;
  }
  if (!studentYear()) fail($('studentId'), '请先填写学号：学子邮域名要取学号前 4 位（入学年份）');
  const user = $('emailUser').value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,23}$/.test(user)) {
    fail($('emailUser'), '请填写学子邮用户名（字母或数字开头，可用 . _ -，最多 24 位）');
  }
  return schoolEmail();
}

/** 切换邮箱方式、并同步学子邮域名里的年份 */
function updateEmailUi() {
  const school = emailMode() === 'school';
  $('schoolEmailField').hidden = !school;
  $('personalEmailField').hidden = school;
  $('emailYear').textContent = studentYear() || '____';
}

/** 请假天数按自然日计算，起止当天都算在内 */
function daysBetween(start, end) {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const startUTC = Date.UTC(sy, sm - 1, sd);
  const endUTC = Date.UTC(ey, em - 1, ed);
  return Math.round((endUTC - startUTC) / 86400000) + 1;
}

/** 找出中文字体里没有的字符，避免生成出缺字的 PDF */
function unsupportedChars(text) {
  if (!cjkCharset) return [];
  const missing = new Set();
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80 || ch.trim() === '') continue; // ASCII 走西文字体
    if (!cjkCharset.has(cp)) missing.add(ch);
  }
  return [...missing];
}

function updateDays() {
  const start = $('startDate').value;
  const end = $('endDate').value;
  const hint = $('daysHint');
  if (!start || !end) {
    hint.textContent = '选择起止日期后自动计算请假天数';
    return;
  }
  const days = daysBetween(start, end);
  hint.textContent = days < 1
    ? '结束日期不能早于开始日期'
    : `共 ${days} 天（起止当天都算），将填入申请表`;
}

/* --------------------------------------------------------------- 生成下载 */

function download(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submitBtn.disabled = true;
  try {
    const data = readForm();
    setStatus('正在准备模板与字体…');
    const assets = { templateBytes: decodeBase64(TEMPLATE_PDF_BASE64), ...(await loadAssets()) };
    setStatus('正在生成 PDF…');
    // 让浏览器先把上面的状态渲染出来，再做耗时的字体子集化
    await new Promise((resolve) => setTimeout(resolve, 30));
    const bytes = await buildLeavePdf({ ...assets, data });
    download(bytes, `${data.studentId}_${data.name}_请假申请表.pdf`);
    setStatus('已生成并开始下载，请检查内容后打印。', 'done');
  } catch (err) {
    setStatus(err.message || String(err), 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

$('startDate').addEventListener('change', updateDays);
$('endDate').addEventListener('change', updateDays);
$('studentId').addEventListener('input', updateEmailUi);
form.querySelectorAll('input[name="emailMode"]').forEach((el) => {
  el.addEventListener('change', updateEmailUi);
});

// 提前把字体读进内存，点“生成”时就不用等
loadAssets()
  .then((assets) => {
    cjkCharset = new Set(fontkit.create(assets.cjkFontBytes).characterSet);
    setStatus('准备就绪，填好信息即可生成。');
  })
  .catch(() => setStatus('资源加载失败，请确认通过 http(s) 访问本页面。', 'error'));
updateDays();
updateEmailUi();
