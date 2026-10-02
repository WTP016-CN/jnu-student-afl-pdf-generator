/**
 * 把 assets/template.pdf 转成 js/template-data.js（base64 字符串）。
 *
 * 为什么不让页面直接 fetch 模板 PDF：部分浏览器安全软件/扩展会按文件内容识别
 * PDF 并掐断响应，导致 fetch 报 NetworkError（改名、换后缀都无效，因为内容是
 * 一样的）。放进 JS 模块里传输就没有这个问题。
 *
 * 换了模板 PDF 之后需要重新执行：node tools/embed-template.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const pdf = await readFile(new URL('assets/template.pdf', root));
const base64 = pdf.toString('base64');

const banner = `/* 由 tools/embed-template.mjs 从 assets/template.pdf 生成，请勿手工修改。
   模板换了以后重新执行：node tools/embed-template.mjs */`;

await writeFile(
  new URL('js/template-data.js', root),
  `${banner}\nexport const TEMPLATE_PDF_BASE64 =\n  '${base64}';\n`,
);
console.log('js/template-data.js 已生成：%d 字节 PDF → %d 字节 base64', pdf.length, base64.length);
