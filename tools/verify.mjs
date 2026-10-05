/**
 * 开发用：在 Node 里用同一份生成逻辑产出样例 PDF，供人工/脚本核对位置与字体。
 *   node tools/verify.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { buildLeavePdf } from '../js/fill-pdf.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root));

const data = {
  studentId: '2023101234',
  name: '张三',
  category: '内招生',
  college: '信息科学技术学院',
  major: '计算机科学与技术',
  phone: '13800138000',
  email: 'zhangsan@stu2023.jnu.edu.cn',  // 学子邮：域名按学号前 4 位生成
  startDate: '2026-10-08',
  endDate: '2026-10-12',
  days: 5,
  reasonType: 'other',
  fillAttachment: true,
};

const assets = {
  templateBytes: await read('assets/template.pdf'),
  latinFontBytes: await read('assets/fonts/tinos-subset.ttf'),
  cjkFontBytes: await read('assets/fonts/noto-serif-sc-subset.ttf'),
};

// 缺字回归用例：尽量多地用到不同汉字，配合 tools/check-output.py 检查字形有没有丢
const stress = {
  ...data,
  name: '欧阳曦',
  college: '暨南大学国际商学院',
  major: '金融学（全英文授课）',
  reasonType: 'health',
  startDate: '2026-11-02',
  endDate: '2026-11-30',
  days: 29,
};

// 边界用例：学院/专业超长（触发自动缩小字号）、学号不足 10 位、纯英文姓名
const long = {
  ...data,
  studentId: '20231012',
  name: 'Anna',
  reasonType: 'other',
  college: '暨南大学国际关系学院/华侨华人研究院',
  major: '国际政治（国际关系与国际商务双学位实验班）',
};

// 留空用例：请假时间和原因都不填（页面允许这样直接生成），
// PDF 里那两处必须干净留白，不能出现空串、NaN 或错位的字
const blank = {
  ...data,
  startDate: '',
  endDate: '',
  days: 0,
  reasonType: '',
  fillAttachment: true,
};

for (const [file, payload] of [
  ['build/sample.pdf', data],
  ['build/stress.pdf', stress],
  ['build/long.pdf', long],
  ['build/blank.pdf', blank],
]) {
  const pdf = await buildLeavePdf({ ...assets, data: payload });
  await writeFile(new URL(file, root), pdf);
  console.log('已生成 %s，共 %d 字节', file, pdf.length);
}
