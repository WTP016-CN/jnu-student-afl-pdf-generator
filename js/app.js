/** 页面交互：收集表单 → 调用 fill-pdf 生成 PDF → 下载。 */
import { buildLeavePdf } from './fill-pdf.js';
import { COLLEGES, COLLEGE_OTHER as COLLEGE_OTHER_NAME } from './colleges.js';
import { TEMPLATE_PDF_BASE64 } from './template-data.js';
import { CJK_COVERAGE_RANGES } from './font-coverage.js';

const $ = (id) => document.getElementById(id);
const form = $('form');
const submitBtn = $('submitBtn');

// 模板以 base64 内嵌在 js/template-data.js 里，不走网络请求：
// 有些浏览器安全软件会按内容识别 PDF 并掐断响应，fetch 会失败。
// 版本号直接取自本模块的 URL（index.html 里统一维护），字体也一起走缓存更新
const ASSET_VERSION = new URL(import.meta.url).search;

// 这两份字体只有生成 PDF 时用得到（页面显示用的是 style.css 里那份黑体），
// 所以不在打开页面时就下载，等用户点「生成」再取。
const ASSETS = {
  cjkFontBytes: `assets/fonts/noto-serif-sc-subset.ttf${ASSET_VERSION}`,
  latinFontBytes: `assets/fonts/tinos-subset.ttf${ASSET_VERSION}`,
};

/**
 * PDF 里的宋体子集覆盖了哪些字。这份表由 tools/prepare-fonts.py 从裁好的字体里
 * 导出（js/font-coverage.js），因此做生僻字检查不必先把 1.8 MB 的字体下下来。
 */
const cjkCharset = new Set();
for (const part of CJK_COVERAGE_RANGES.split(',')) {
  const [from, to = from] = part.split('-');
  for (let cp = parseInt(from, 16); cp <= parseInt(to, 16); cp += 1) cjkCharset.add(cp);
}

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let assetsPromise = null;

/**
 * 生成 PDF 的进度与结果都走这个全局弹窗。
 *
 * 右侧那条填写提示只反映表单状态，生成过程中一动不动 —— 两种信息混在一条提示里，
 * 用户分不清「表单填错了」还是「正在生成」。
 */
let exportBusy = false;

function showExport(text, kind = 'busy') {
  exportBusy = kind === 'busy';
  const icon = $('exportIcon');
  icon.className = `export-icon is-${kind}`;
  icon.textContent = kind === 'done' ? '✓' : (kind === 'error' ? '✕' : '');
  $('exportText').textContent = text;
  $('exportClose').hidden = exportBusy; // 生成中不给关，免得半途中断
  $('exportMask').hidden = false;
  if (!exportBusy) $('exportClose').focus();
}

function closeExport() {
  if (exportBusy) return;
  $('exportMask').hidden = true;
}

/** 强制收起生成弹窗：生成已经结束，不再受「生成中不给关」那条限制 */
function hideExport() {
  exportBusy = false;
  $('exportMask').hidden = true;
}

/* -------------------------------------------------------- 生成前预览 */

let previewUrl = null;
let previewDownload = null; // 用户确认后要执行的那一次下载

/**
 * 生成完先给预览，用户确认无误才真正下载。
 *
 * 预览用浏览器自带的 PDF 阅读器（blob URL 塞进 iframe）：不引额外依赖，
 * 显示的就是真实成品，滚动和缩放都交给它。个别浏览器不渲染 iframe 里的 PDF，
 * 所以旁边留了一条「直接下载」的退路。
 */
function showPreview(bytes, filename) {
  hideExport();
  releasePreview();
  previewUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  previewDownload = () => download(bytes, filename);
  const open = $('previewOpen');
  open.href = previewUrl;
  open.setAttribute('download', filename);
  $('previewFrame').src = previewUrl;
  $('previewMask').hidden = false;
  $('previewConfirm').focus();
}

/** 断开 iframe 并释放 blob，别让阅读器一直占着那份数据 */
function releasePreview() {
  $('previewFrame').removeAttribute('src');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}

/** 返回修改：关掉预览回表单，内容还在，改完可以再生成 */
function closePreview() {
  if ($('previewMask').hidden) return;
  $('previewMask').hidden = true;
  releasePreview();
  previewDownload = null;
}

/** 确认无误：这才真正下载 */
function confirmPreview() {
  const run = previewDownload;
  closePreview();
  if (!run) return;
  run();
  showExport('已生成并开始下载，请检查内容后打印。', 'done');
}

/** 下载生成 PDF 用的两份字体（只下一次，之后走浏览器缓存） */
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
 * 表单一共 9 项：学号、姓名、学生类别、学院、专业、手机、电邮、请假时间、请假原因。
 * 后面两项允许先空着（打印出来的表格上也能由学院或学生手写），其余必须填好才能生成。
 */
const TOTAL_ITEMS = 9;
const OPTIONAL_ITEMS = { period: '请假时间', reason: '请假原因' };

/**
 * 校验规则集中在这里。每条都带：
 *   el   要标红高亮的元素（单选组用 .options 容器）
 *   item 属于哪一项，用来算填写进度
 * 报错文字和右侧提示条都读它，避免几处规则各写一套。
 *
 * 这里只收「填错了」的情况，所以每一条都会拦住生成。
 * 「整项没填」不算错误（可留空的项本来就允许空着），由 optionalGaps() 单独统计。
 */
function collectErrors() {
  const errors = [];
  const add = (el, message, item) => errors.push({ el, message, item });

  const studentId = $('studentId').value.trim();
  if (!studentId) add($('studentId'), '请填写学号', 'studentId');
  else if (!/^\d{10}$/.test(studentId)) add($('studentId'), '学号应为 10 位数字', 'studentId');

  if (!$('name').value.trim()) add($('name'), '请填写姓名', 'name');

  if (!form.querySelector('input[name="category"]:checked')) {
    add($('categoryOptions'), '请选择学生类别', 'category');
  }

  if (!readCollege()) add($('collegeTrigger'), '请选择学院', 'college');

  if (!$('major').value.trim()) add($('major'), '请填写专业', 'major');

  const phone = $('phone').value.trim();
  if (!phone) add($('phone'), '请填写手机号', 'phone');
  else if (!PHONE_RE.test(phone)) add($('phone'), '手机号格式不正确', 'phone');

  if (emailMode() === 'personal') {
    const email = $('email').value.trim();
    if (!email) add($('email'), '请填写电邮地址', 'email');
    else if (!EMAIL_RE.test(email)) add($('email'), '电邮格式不正确', 'email');
  } else {
    const user = $('emailUser').value.trim();
    if (!studentYear()) add($('studentId'), '学号前 4 位用于生成学子邮地址，请填写完整', 'email');
    if (!user) add($('emailUser'), '请填写学子邮用户名', 'email');
    else if (!SCHOOL_USER_RE.test(user)) add($('emailUser'), '学子邮用户名格式不正确', 'email');
  }

  // 请假时间要么整项留空，要么填对：只填一半或填反都拦住生成，
  // 免得用户以为自己填了，PDF 里却整行空白
  const startDate = $('startDate').value;
  const endDate = $('endDate').value;
  if (startDate && !endDate) add($('endDate'), '请选择结束日期', 'period');
  if (!startDate && endDate) add($('startDate'), '请选择开始日期', 'period');
  if (startDate && endDate && daysBetween(startDate, endDate) < 1) {
    add($('startDate'), '开始日期晚于结束日期', 'period');
    add($('endDate'), '结束日期早于开始日期', 'period');
  }

  // 请假原因整项不选不算错误（见 optionalGaps），所以这里不产生条目

  const unsupported = unsupportedChars(
    $('name').value.trim() + readCollege() + $('major').value.trim(),
  );
  if (unsupported.length) {
    add($('major'), `这些字不在字体范围内，请替换：${unsupported.join(' ')}`, 'major');
  }

  return errors;
}

/**
 * 可以留空的两项各自填了没有。
 * 请假时间填一半也算没填 —— PDF 里那一行会整行留白，进度也按没填算。
 * 这两项没填不是「错误」，所以不放进 collectErrors，只影响进度和提示条的状态。
 */
function optionalGaps() {
  const start = $('startDate').value;
  const end = $('endDate').value;
  const gaps = [];
  if (!(start && end && daysBetween(start, end) >= 1)) gaps.push('period');
  if (!form.querySelector('input[name="reasonType"]:checked')) gaps.push('reason');
  return gaps;
}

/**
 * 当前填写状态。
 *   level 'ok'   全填好了
 *         'warn' 只差请假时间和/或请假原因 —— 仍然可以生成
 *         'bad'  还有必填项没填 —— 不能生成
 */
function formState() {
  const errors = collectErrors();
  const gaps = optionalGaps();
  const missing = new Set([...errors.map((e) => e.item), ...gaps]);

  return {
    errors,
    filled: TOTAL_ITEMS - missing.size,
    total: TOTAL_ITEMS,
    missingRequired: new Set(errors.map((e) => e.item)).size,
    missingOptional: gaps.map((key) => OPTIONAL_ITEMS[key]),
    level: errors.length ? 'bad' : (gaps.length ? 'warn' : 'ok'),
  };
}

/** 用过的字段才标红，避免一打开就满屏红 */
const touched = new Set();
let submitted = false;
const isTouched = (el) => touched.has(el) || touched.has(el.closest?.('.field'));

/* 三种状态各自的符号：全部填好 / 只差可留空的两项 / 还有必填没填 */
const BADGE_MARKS = { ok: '✓', warn: '!', bad: '✕' };

/** 把右侧提示条画成某个状态。进度条不归它管，只跟填写进度走。 */
function renderBadge(level, text, note) {
  const badge = $('validity');
  badge.classList.toggle('ok', level === 'ok');
  badge.classList.toggle('warn', level === 'warn');
  badge.classList.toggle('bad', level === 'bad');
  $('validityMark').textContent = BADGE_MARKS[level];
  $('validityText').textContent = text;
  $('validityNote').textContent = note;
}

/** 填写进度条：已完成项 / 总项数 */
function renderMeter(filled, total) {
  $('validityBar').style.width = `${Math.round((filled / total) * 100)}%`;
  $('validityCount').textContent = `${filled} / ${total}`;
}

function refreshValidity() {
  const state = formState();
  const { errors, filled, total, level, missingRequired, missingOptional } = state;

  const badEls = new Set(errors.map((e) => e.el));
  document.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
  for (const el of badEls) {
    if (submitted || isTouched(el)) el.classList.add('invalid');
  }

  if (level === 'ok') {
    renderBadge('ok', '填写完整', '可以生成 PDF');
  } else if (level === 'warn') {
    renderBadge('warn', `${missingOptional.join('、')}未填`, '留空也能生成');
  } else {
    renderBadge('bad', errors[0].message, `还差 ${missingRequired} 项必填`);
  }
  renderMeter(filled, total);
  return state;
}

function readForm() {
  submitted = true;
  const state = refreshValidity();
  // 任何一条校验错误都拦住生成。整项留空的请假时间与请假原因不算错误 ——
  // 那两项允许空着，PDF 里对应整行留白。
  if (state.errors.length) {
    const { el, message } = state.errors[0];
    el.scrollIntoView?.({ block: 'center' });
    el.focus?.();
    throw new Error(message);
  }

  // 请假时间只填了一半或填反了都不写进 PDF，免得画出错位的日期
  const startDate = $('startDate').value;
  const endDate = $('endDate').value;
  const days = startDate && endDate ? daysBetween(startDate, endDate) : 0;
  const hasPeriod = days > 0;

  return {
    studentId: $('studentId').value.trim(),
    name: $('name').value.trim(),
    category: form.querySelector('input[name="category"]:checked').value,
    college: readCollege(),
    major: $('major').value.trim(),
    phone: $('phone').value.trim(),
    email: readEmail(),
    startDate: hasPeriod ? startDate : '',
    endDate: hasPeriod ? endDate : '',
    days,
    reasonType: form.querySelector('input[name="reasonType"]:checked')?.value ?? '',
    fillAttachment: $('fillAttachment').checked,
  };
}

/* ------------------------------------------------------- 面板展开（初次进入） */

/**
 * 初始状态面板只占下方一部分，露出背景；点按钮后铺满整屏，
 * 之后所有滚动都在面板内部完成。
 *
 * 展开是单向的：收回初始状态只有「再点一次按钮」这一种入口，所以没有做。
 * 滑动、方向上键都不再能把它收回去。
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
  // 展开提示按钮到这一步就收起来了（见 style.css），顶部从校徽开始
  pageEl.scrollTop = 0;
}

$('expandBtn').addEventListener('click', expandPage);

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
  const missing = new Set();
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80 || ch.trim() === '') continue; // ASCII 走西文字体
    if (!cjkCharset.has(cp)) missing.add(ch);
  }
  return [...missing];
}

/**
 * 可以取消选择的单选组（标了 data-clearable 的）：再点一次已经选中那一项就清空。
 * 只标在允许留空的组上 —— 必填的组清空没有意义，而且像邮箱方式那种地方，
 * 代码本来就假定一定有一项被选中。
 */
function enableDeselect() {
  for (const group of form.querySelectorAll('.options[data-clearable]')) {
    // click 事件里 checked 已经变成 true 了，分不清「刚选中」和「本来就选中」，
    // 所以自己记着本组当前选的是哪个
    let current = group.querySelector('input:checked')?.value ?? null;

    for (const input of group.querySelectorAll('input[type="radio"]')) {
      input.addEventListener('change', () => {
        current = group.querySelector('input:checked')?.value ?? null;
      });
      input.addEventListener('click', () => {
        if (current !== input.value) return; // 这一下是正常选中，交给 change 去记
        input.checked = false;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
  }
}

function updateDays() {
  const start = $('startDate').value;
  const end = $('endDate').value;
  const hint = $('daysHint');
  if (!start || !end) {
    hint.textContent = '填了会自动算出天数';
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

  // 校验不过就停在原地：高亮字段、右侧提示条给出状态，不弹窗 ——
  // 这时该看的是表单，不是对话框
  let data;
  try {
    data = readForm();
  } catch (err) {
    return;
  }

  submitBtn.disabled = true;
  try {
    showExport('正在准备模板与字体…');
    const assets = { templateBytes: decodeBase64(TEMPLATE_PDF_BASE64), ...(await loadAssets()) };
    showExport('正在生成 PDF…');
    // 让浏览器先把上面的弹窗渲染出来，再做耗时的字体子集化
    await new Promise((resolve) => setTimeout(resolve, 30));
    const bytes = await buildLeavePdf({ ...assets, data });
    // 不直接下载：先给预览，用户点「确认无误」才真的下载（见 showPreview）
    showPreview(bytes, `${data.studentId}_${data.name}_请假申请表.pdf`);
  } catch (err) {
    showExport(err.message || String(err), 'error');
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
enableDeselect();

$('exportClose').addEventListener('click', closeExport);
$('previewBack').addEventListener('click', closePreview);
$('previewConfirm').addEventListener('click', confirmPreview);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!$('previewMask').hidden) closePreview();   // 预览里按 Esc = 返回修改
  else if (!$('exportMask').hidden) closeExport();
});

updateDays();
updateEmailUi();
updateCollegeUi();
refreshValidity();
layoutCollapsed();
window.addEventListener('resize', layoutCollapsed);
