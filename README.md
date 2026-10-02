# 暨南大学本科学生请假申请表 · 一键生成

给暨南大学本科学生用的网页小工具：填好信息，一键下载填写完毕的《暨南大学学生请假申请表》PDF，
打印后手写签名即可提交。纯前端实现，全部在你自己的浏览器里完成，不联网上传任何数据。

> 在线版：<https://pages.wtp016.eu.org/>

## 预览

填写界面：

![填写界面](docs/preview-form.png)

生成结果（申请表第 1 页的申请人填写部分）：

![生成结果](docs/preview-pdf.png)

## 功能

- 填写学号、姓名、学生类别、学院、专业、手机、电邮、请假时间、请假原因类型
- 学院从下拉列表选择，名单以暨南大学官网“院系设置”为基础，并含医学部其他临床医学院；
  两个名称合办的院系（如法学院/知识产权学院）拆成两条分别列出，只列学院、不列研究机构；
  列表里没有的学院可选“其他（手动填写）”
- 电邮可选**学校学子邮**或**自备邮箱**：选学子邮时只需填用户名，域名按学号前 4 位
  （入学年份）自动生成，如学号 `2025103491` + 用户名 `zhangsan` → `zhangsan@stu2025.jnu.edu.cn`
- 学号逐格填入申请表上的 10 个方格
- 学生类别、请假原因自动在对应方框内打“√”
- 请假天数按起止日期自动计算（起止当天都算）
- 可选择同时填写第 2 页附件的准假条（学院、专业、姓名、学号、天数、起止日期）
- 学院、专业等文字写不下时自动缩小字号，最小 7pt
- 填错会即时提示：学号位数、手机/电邮格式、日期先后、生僻字是否在字体范围内

## 字体与字号

| 内容 | 字体 |
| --- | --- |
| 数字、字母、半角符号 | Tinos（与 Times New Roman 度量兼容） |
| 汉字、中文标点、全角符号 | Noto Serif SC（思源宋体） |

字号统一 **10.5pt**。同一行里的中英文会分别用对应字体排版，因此
“自 2026 年 11 月 2 日”这样的混排也是对的。

学校模板原用的是宋体与 Times New Roman，两者都是随 Windows 分发的商业字体，
不适合放进公开仓库再分发，因此换成了观感与排版度量一致的 Noto Serif SC 与 Tinos
（均为 SIL OFL 1.1 开源字体，见 [assets/fonts/LICENSE.md](assets/fonts/LICENSE.md)）。

## 使用

### 直接使用

打开在线版网址，填好信息，点“生成并下载 PDF”。

生成的结果：

- 申请表的“申请人签名”“日期”以及审批、盖章部分**保持空白**，需要手写或由学院填写
- 请假原因只勾选类型，下面的具体情况说明横线留空，由学生手写
- 请用 A4 纸单面打印

### 自己部署

整个仓库就是静态站点，把文件放到任意静态托管即可，推荐 GitHub Pages：
仓库 Settings → Pages → Source 选 `main` 分支根目录 → 保存。

注意：页面用 `fetch` 读取字体，**不能直接双击 `index.html`**（`file://` 下浏览器会拦截）。

### 本地运行

```bash
cd jnu-student-afl-pdf-generator
python -m http.server 8080     # 或 npm run serve
# 然后打开 http://localhost:8080/
```

## 项目结构

```
index.html              页面
style.css               样式
js/app.js               表单交互、校验、下载
js/fill-pdf.js          把数据画到模板上（浏览器和 Node 共用）
js/pdf-slots.js         模板中各填写位置的坐标（由 PDF 实测得到）
js/template-data.js     模板 PDF 的 base64（由脚本生成）
assets/template.pdf     请假申请表模板
assets/fonts/           裁剪后的开源字体及许可
vendor/                 第三方库，见 vendor/PATCHES.md
tools/                  开发脚本，不参与页面运行
docs/                   README 用的预览图
```

## 实现说明

**填写位置是实测的，不是目测的。** `js/pdf-slots.js` 里的每条横线起止 x、基线 y 都取自
模板 PDF 内容流中字符的精确坐标，因此在不同阅读器、不同尺寸打印下都对得齐。

**模板以 base64 内嵌在 `js/template-data.js` 里**，而不是直接 `fetch` 那个 PDF。
原因是部分浏览器的安全软件或扩展会按文件内容识别 PDF 并掐断响应，导致 `fetch` 报
NetworkError（换文件名、换后缀都无效，因为内容没变）。放进 JS 模块传输就绕开了这个问题。

**修了 pdf-lib 依赖的 fontkit 的一个 bug。** fontkit 生成字体子集时会把字形偏移右移一位
写进短格式 loca 表，奇数偏移会被截断，导致后续字形数据整体错位、生成的 PDF 随机缺字。
已改为始终使用长格式 loca，说明见 [vendor/PATCHES.md](vendor/PATCHES.md)，回归检查见
`tools/check-output.py`。

## 开发

需要 Python 3 与 Node.js。字体相关脚本依赖 `fontTools`：

```bash
pip install fonttools brotli

python tools/prepare-fonts.py     # 下载开源字体并裁剪成 assets/fonts/（首次约 25 MB 下载）
node tools/embed-template.mjs     # 把 assets/template.pdf 转成 js/template-data.js
node tools/verify.mjs             # 生成 build/*.pdf 样例
python tools/check-output.py build/*.pdf   # 检查内嵌字体有没有缺字（需 pypdf）
```

换了模板 PDF 之后要重新执行 `embed-template.mjs`。

## 已知限制

- 字体覆盖 GB2312 全部汉字（7547 个）。生僻字（如“燚”“㸚”）不在范围内，
  页面会提示替换，不会生成缺字的 PDF。
- 不校验学号、手机号是否真实，请自行核对。
- 学校模板如有更新，工具需要同步调整填写坐标。

## 隐私

页面没有任何后端，也不发任何网络请求上传数据：模板内嵌在页面里，字体是静态文件，
生成过程全部在浏览器内存中完成，生成后直接由浏览器下载。

## 免责声明

本项目为非官方工具，与暨南大学及其任何部门无关，仅供参考使用。
请假是否批准、表格格式是否符合要求，以学院和教务处的规定为准。

## 许可证

代码以 [GNU General Public License v3.0](LICENSE) 发布，可自由使用、修改、再分发，
衍生作品需同样以 GPL-3.0 开放源代码。

第三方组件：

| 组件 | 许可证 |
| --- | --- |
| [pdf-lib](https://github.com/Hopding/pdf-lib) 1.17.1 | MIT |
| [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) 1.1.1 | MIT |
| [pako](https://github.com/nodeca/pako) 2.1.0 | MIT |
| Noto Serif SC（思源宋体） | SIL OFL 1.1 |
| Tinos | SIL OFL 1.1 |

字体许可见 [assets/fonts/LICENSE.md](assets/fonts/LICENSE.md)。
`assets/template.pdf` 是学校发布的学生请假申请表原件，其中的文字与字体属于原文档。
