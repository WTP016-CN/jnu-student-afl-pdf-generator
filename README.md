# 暨南大学本科学生请假申请表 · 一键生成

给暨南大学本科学生用的网页面：填好信息，一键生成填写完毕的《暨南大学学生请假申请表》PDF，打印后手写签名即可提交。

纯前端实现，所有内容都在浏览器里处理，不会上传到任何服务器。

## 功能

- 填写学号、姓名、学生类别、学院、专业、手机、电邮、请假时间、请假原因类型
- 学号逐格填入申请表上的 10 个方格；学生类别、请假原因自动在对应方框内打“√”
- 请假天数按起止日期自动计算（起止当天都算），无需手填
- 可选择同时填写第 2 页附件的准假条存根（学院存档 / 学生存）
- 学院、专业等文字写不下时自动缩小字号，最小 7pt
- 填写内容的字体：**英文 Times New Roman、中文宋体，默认字号 10.5pt**

生成效果：第 1 页申请人填写部分和附件页均按模板原有横线、方格位置对齐。

## 字体与字号

| 内容 | 字体 |
| --- | --- |
| 数字、字母、半角符号 | Times New Roman |
| 汉字、中文标点、全角符号 | 宋体（SimSun） |

字号统一 10.5pt（五号）。同一行里的中英文会分别用对应字体排版，因此
“自 2026 年 11 月 2 日”这样的混排也是正确的。

## 本地运行

页面用 `fetch` 读取模板和字体，需要用 http(s) 打开（直接双击 `index.html`
会因浏览器限制读不到资源）：

```bash
cd jnu-student-afl-pdf-generator
python -m http.server 8080     # 或 npm run serve
# 然后打开 http://localhost:8080/
```

## 部署

整个仓库是静态站点，直接启用 GitHub Pages（根目录）即可，学生访问网址就能用。

首次打开需加载约 2.2 MB（gzip 后，其中宋体字体 1.4 MB、pdf-lib/fontkit 等库 0.6 MB），
之后走浏览器缓存；页面在打开时就会预加载，点“生成”时无需再等。

## 目录结构

```
index.html              页面
style.css               样式
js/app.js               表单交互、校验、下载
js/fill-pdf.js          把数据画到模板上（浏览器和 Node 共用）
js/pdf-slots.js         模板中各填写位置的坐标（由 PDF 实测得到）
js/template-data.js     模板 PDF 的 base64（由 tools/embed-template.mjs 生成）
assets/template.pdf     请假申请表模板
assets/fonts/           裁剪后的宋体 / Times New Roman
vendor/                 第三方库，见 vendor/PATCHES.md
tools/                  开发工具，不参与页面运行
package.json            仅用于 Node 端脚本
```

模板以 base64 内嵌在 `js/template-data.js` 里而不是直接 `fetch` 那个 PDF：部分
浏览器安全软件/扩展会按文件内容识别 PDF 并掐断响应（表现为 `fetch` 报
NetworkError，改名、换后缀都无效，因为内容一样）。换了模板 PDF 后需要重新生成：

```bash
node tools/embed-template.mjs
```

## 开发

```bash
python tools/prepare-fonts.py            # 从系统字体生成 assets/fonts（需 fontTools）
node tools/embed-template.mjs            # 把 assets/template.pdf 转成 js/template-data.js
node tools/verify.mjs                    # 生成 build/*.pdf 样例
python tools/check-output.py build/*.pdf # 检查内嵌字体有没有缺字（需 fontTools、pypdf）
```

`tools/check-output.py` 是重要回归检查：pdf-lib 依赖的 fontkit 有一个会把字形
数据写坏的 bug，会让 PDF 随机缺字，详见 `vendor/PATCHES.md`。

## 限制

- 字体覆盖 GB2312 全部汉字（7547 字）。生僻字（如“燚”“㸚”）不在范围内，
  页面会提示替换，不会生成缺字的 PDF。
- 请假原因只勾选类型；“因健康原因请假 / 其他”下面的具体情况说明横线留空，由学生打印后手写。
- “申请人签名”“日期”“审批意见”“盖章”等需手写或由学院填写的部分保持空白。
- 已填写的信息可自行核对，本工具不会校验学号、手机号的真实性。

## 字体许可

`assets/fonts/` 里的宋体和 Times New Roman 由 `tools/prepare-fonts.py`
从本机 `C:\Windows\Fonts` 提取并裁剪，两者都是随 Windows 分发的商业字体。
仅建议在校园内部使用；若要公开分发本仓库，请确认字体授权，或改用
思源宋体等开源字体（需自行修改 `tools/prepare-fonts.py` 与页面文案）。
