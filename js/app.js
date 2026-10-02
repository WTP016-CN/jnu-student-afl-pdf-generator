/** 页面交互：收集表单 → 调用 fill-pdf 生成 PDF → 下载。 */
import fontkit from '../vendor/fontkit.es.min.js';
import { buildLeavePdf } from './fill-pdf.js';
import { COLLEGES, COLLEGE_OTHER as COLLEGE_OTHER_NAME } from './colleges.js';
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

/**
 * 状态文字只留给读屏，视觉上显示在右侧的提示条里：
 * 生成进度、成功、失败都走同一条提示。
 */
function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
  if (!kind) {
    refreshValidity(); // 空闲时交回常规的填写校验显示
    return;
  }
  const ok = kind === 'done';
  const badge = $('validity');
  badge.classList.toggle('ok', ok);
  badge.classList.toggle('bad', !ok);
  $('validityMark').textContent = ok ? '✓' : '✕';
  $('validityText').textContent = text;
  $('validityNote').textContent = ok ? '可以打印了' : (kind === 'error' ? '请检查填写内容' : '请稍候');
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\-+() ]{7,20}$/;
const SCHOOL_USER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,23}$/;

/**
 * 校验规则集中在这里，返回 [{ el, message }]。
 * el 是要标红高亮的元素（单选组用 .options 容器）。
 * 提交时的报错文字和右上角的 ✓/✕ 指示都用它，避免两处规则不一致。
 */
function collectErrors() {
  const errors = [];
  const add = (el, message) => errors.push({ el, message });

  const studentId = $('studentId').value.trim();
  if (!studentId) add($('studentId'), '请填写学号');
  else if (!/^\d{10}$/.test(studentId)) add($('studentId'), '学号应为 10 位数字');

  if (!$('name').value.trim()) add($('name'), '请填写姓名');

  if (!form.querySelector('input[name="category"]:checked')) {
    add($('categoryOptions'), '请选择学生类别（内招生 / 外招生）');
  }

  if (!readCollege()) add($('collegeTrigger'), '请选择学院');

  if (!$('major').value.trim()) add($('major'), '请填写专业');

  const phone = $('phone').value.trim();
  if (!phone) add($('phone'), '请填写手机号');
  else if (!PHONE_RE.test(phone)) add($('phone'), '手机号格式不正确');

  if (emailMode() === 'personal') {
    const email = $('email').value.trim();
    if (!email) add($('email'), '请填写电邮地址');
    else if (!EMAIL_RE.test(email)) add($('email'), '电邮格式不正确');
  } else {
    const user = $('emailUser').value.trim();
    if (!studentYear()) add($('studentId'), '学号前 4 位用于生成学子邮地址，请填写完整');
    if (!user) add($('emailUser'), '请填写学子邮用户名');
    else if (!SCHOOL_USER_RE.test(user)) add($('emailUser'), '学子邮用户名格式不正确');
  }

  const startDate = $('startDate').value;
  const endDate = $('endDate').value;
  if (!startDate) add($('startDate'), '请选择开始日期');
  if (!endDate) add($('endDate'), '请选择结束日期');
  if (startDate && endDate && daysBetween(startDate, endDate) < 1) {
    add($('startDate'), '开始日期晚于结束日期');
    add($('endDate'), '结束日期早于开始日期');
  }

  if (!form.querySelector('input[name="reasonType"]:checked')) {
    add($('reasonOptions'), '请选择请假原因类型');
  }

  const unsupported = unsupportedChars(
    $('name').value.trim() + readCollege() + $('major').value.trim(),
  );
  if (unsupported.length) {
    add($('major'), `这些字不在字体范围内，请替换：${unsupported.join(' ')}`);
  }

  return errors;
}

/** 用过的字段才标红，避免一打开就满屏红 */
const touched = new Set();
let submitted = false;
const isTouched = (el) => touched.has(el) || touched.has(el.closest?.('.field'));

function refreshValidity() {
  const errors = collectErrors();
  const bad = new Set(errors.map((e) => e.el));

  document.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
  for (const el of bad) {
    if (submitted || isTouched(el)) el.classList.add('invalid');
  }

  const ok = errors.length === 0;
  const badge = $('validity');
  badge.classList.toggle('ok', ok);
  badge.classList.toggle('bad', !ok);
  $('validityMark').textContent = ok ? '✓' : '✕';
  $('validityText').textContent = ok ? '填写完整' : errors[0].message;
  $('validityNote').textContent = ok
    ? '可以生成 PDF'
    : `${errors.length} 项待完善`;
  return errors;
}

function readForm() {
  submitted = true;
  const errors = refreshValidity();
  if (errors.length) {
    const { el, message } = errors[0];
    el.scrollIntoView?.({ block: 'center' });
    el.focus?.();
    throw new Error(message);
  }

  return {
    studentId: $('studentId').value.trim(),
    name: $('name').value.trim(),
    category: form.querySelector('input[name="category"]:checked').value,
    college: readCollege(),
    major: $('major').value.trim(),
    phone: $('phone').value.trim(),
    email: readEmail(),
    startDate: $('startDate').value,
    endDate: $('endDate').value,
    days: daysBetween($('startDate').value, $('endDate').value),
    reasonType: form.querySelector('input[name="reasonType"]:checked').value,
    fillAttachment: $('fillAttachment').checked,
  };
}

/* ------------------------------------------------------- 面板展开（初次进入） */

/**
 * 初始状态面板只占下方一部分，露出背景；用户向上滑动一点点，
 * 面板就自动铺满整屏，之后所有滚动都在面板内部完成。
 */
const pageEl = $('page');
let expanded = false;

/**
 * 收起状态只露出页头区（展开提示 + 校徽）和标题、说明，
 * 下方的表单一点都不能露出来 —— 所以按它们的实际高度算位置，而不是写死比例。
 */
function layoutCollapsed() {
  if (expanded) return;
  const stage = document.querySelector('.stage');
  const header = pageEl.querySelector('.site-header');
  // 收起时露出的高度 = 从内容顶部到标题说明结束为止（含提示、校徽、顶部圆角盖）
  const visible = header.getBoundingClientRect().bottom - pageEl.getBoundingClientRect().top + pageEl.scrollTop;
  pageEl.style.setProperty('--collapsed-top', `${Math.max(0, stage.clientHeight - visible)}px`);
}

function expandPage() {
  if (expanded) return;
  expanded = true;
  pageEl.classList.add('expanded');
  // 展开后滚到标题处：校徽与“向上滑动”提示滑出视野，标题顶在最上面
  const title = pageEl.querySelector('.site-header h1');
  if (title) {
    const offset = title.getBoundingClientRect().top - pageEl.getBoundingClientRect().top + pageEl.scrollTop;
    pageEl.scrollTop = Math.max(0, offset - 12);
  }
}

function collapsePage() {
  if (!expanded) return;
  expanded = false;
  pageEl.classList.remove('expanded');
  pageEl.scrollTop = 0;
  if (footerShown) {
    footerShown = false;
    footerEl.classList.remove('show');
    pageEl.style.setProperty('--footer-h', '0px');
  }
  layoutCollapsed();
}

const footerEl = document.querySelector('.site-footer');
let footerShown = false;

/**
 * 底栏只在内容滑到最底部时从屏幕下方升上来。
 * 因为底栏出现会把卡片顶高一点，用两个阈值（出现/收起）避免来回抖动。
 */
function updateFooter() {
  const remaining = pageEl.scrollHeight - pageEl.scrollTop - pageEl.clientHeight;
  if (!footerShown && remaining <= 8) {
    footerShown = true;
    footerEl.classList.add('show');
    pageEl.style.setProperty('--footer-h', `${footerEl.offsetHeight}px`);
  } else if (footerShown && remaining > footerEl.offsetHeight + 24) {
    footerShown = false;
    footerEl.classList.remove('show');
    pageEl.style.setProperty('--footer-h', '0px');
  }
}

pageEl.addEventListener('scroll', updateFooter, { passive: true });

$('expandBtn').addEventListener('click', expandPage);

// 收起状态禁止滚动内容（只能点按钮展开）；展开后向上滑到顶可收回
pageEl.addEventListener('wheel', (e) => {
  if (expanded && e.deltaY < 0 && pageEl.scrollTop <= 0) collapsePage();
}, { passive: true });

let touchStartY = 0;
pageEl.addEventListener('touchstart', (e) => { touchStartY = e.touches[0].clientY; }, { passive: true });
pageEl.addEventListener('touchmove', (e) => {
  const up = touchStartY - e.touches[0].clientY; // > 0 表示手指上滑
  if (expanded && up < -10 && pageEl.scrollTop <= 0) collapsePage();
}, { passive: true });

document.addEventListener('keydown', (e) => {
  if (expanded && e.key === 'ArrowUp' && pageEl.scrollTop <= 0) collapsePage();
});

/* ------------------------------------------------------------------ 学院选择 */

const COLLEGE_OTHER = COLLEGE_OTHER_NAME;
const collegePicker = $('collegePicker');
const collegeSearch = $('collegeSearch');

let selectedCollege = '';
let matchedColleges = [];
let optionEls = [];
let activeIndex = 0;

/** 按关键词筛选后渲染列表；“其他（手动填写）”始终排在最后，作为兜底入口 */
function renderCollegeList(keyword = '') {
  const kw = keyword.trim();
  const matched = COLLEGES.filter((name) => !kw || name.includes(kw));
  matchedColleges = matched.concat(COLLEGE_OTHER);
  activeIndex = -1; // 默认不高亮，避免看起来像已经选中
  optionEls = [];

  const list = $('collegeOptions');
  list.textContent = '';

  if (!matched.length) {
    const empty = document.createElement('li');
    empty.className = 'sheet-empty';
    empty.textContent = `没有包含“${kw}”的学院，可在下面手动填写`;
    list.append(empty);
  }

  for (const name of matchedColleges) {
    const item = document.createElement('li');
    item.textContent = name;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(name === selectedCollege));
    item.addEventListener('click', () => chooseCollege(name));
    list.append(item);
    optionEls.push(item);
  }
}

function highlight(index) {
  if (!optionEls.length) return;
  activeIndex = (index + optionEls.length) % optionEls.length;
  optionEls.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
  optionEls[activeIndex].scrollIntoView({ block: 'nearest' });
}

function openCollegePicker() {
  collegeSearch.value = '';
  renderCollegeList('');
  collegePicker.hidden = false;
  $('collegeTrigger').setAttribute('aria-expanded', 'true');
  pageEl.classList.add('no-scroll');
  collegeSearch.focus();
}

function closeCollegePicker() {
  collegePicker.hidden = true;
  $('collegeTrigger').setAttribute('aria-expanded', 'false');
  pageEl.classList.remove('no-scroll');
}

function chooseCollege(name) {
  selectedCollege = name;
  const value = $('collegeValue');
  value.textContent = name;
  value.classList.toggle('placeholder', false);
  closeCollegePicker();
  updateCollegeUi();
  refreshValidity();
}

/** 返回最终要填进表格的学院名；未选择（或选了“其他”但没填）时返回空串 */
function readCollege() {
  if (selectedCollege !== COLLEGE_OTHER) return selectedCollege;
  return $('collegeOther').value.trim();
}

/** 选了“其他”才显示手动填写的输入框 */
function updateCollegeUi() {
  $('collegeOtherField').hidden = selectedCollege !== COLLEGE_OTHER;
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
  return emailMode() === 'personal' ? $('email').value.trim() : schoolEmail();
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

form.addEventListener('input', refreshValidity);
form.addEventListener('change', refreshValidity);
form.addEventListener('focusout', (event) => {
  touched.add(event.target);
  refreshValidity();
});

$('startDate').addEventListener('change', updateDays);
$('endDate').addEventListener('change', updateDays);
$('studentId').addEventListener('input', updateEmailUi);
$('collegeTrigger').addEventListener('click', openCollegePicker);
$('collegeClose').addEventListener('click', closeCollegePicker);
collegePicker.addEventListener('click', (event) => {
  if (event.target === collegePicker) closeCollegePicker(); // 点遮罩关闭
});
collegeSearch.addEventListener('input', () => renderCollegeList(collegeSearch.value));
collegeSearch.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') highlight(activeIndex + 1);
  else if (event.key === 'ArrowUp') highlight(activeIndex - 1);
  else if (event.key === 'Enter') {
    event.preventDefault();
    chooseCollege(matchedColleges[activeIndex] ?? matchedColleges[0]);
  } else return;
  event.preventDefault();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !collegePicker.hidden) closeCollegePicker();
});
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
updateCollegeUi();
refreshValidity();
layoutCollapsed();
window.addEventListener('resize', layoutCollapsed);
