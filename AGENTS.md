# AGENTS.md

写给在本仓库里干活的编码代理（Claude Code、Codex、Cursor 等）。
里面的「不可违反的约定」对人类同事同样有效，动代码前请先读完那一节。

## 这是什么项目

暨南大学本科学生请假申请表的**纯前端**填写工具：学生在网页上填好学号、学院、请假时间等信息，
点一下就在浏览器里生成填好的 PDF，打印后手写签名即可提交。

- 没有后端、没有数据库、没有构建步骤，仓库本身就是可部署的静态站点
- 生成过程全部在浏览器内存里完成，**任何数据都不上传**
- 在线版：<https://pages.wtp016.eu.org/>（GitHub Pages，`main` 分支根目录）
- 阅读代码之外的项目背景，看 [README.md](README.md)

## 30 秒上手

```bash
cd jnu-student-afl-pdf-generator
python -m http.server 8080        # 或 npm run serve
# 浏览器打开 http://localhost:8080/
```

- **必须用 http(s) 打开。** `app.js` 用 `fetch` 读字体，`file://` 下会被浏览器拦截，页面直接报「资源加载失败」。
- **没有安装步骤。** 不用 `npm install`，没有打包器，`node_modules/` 只在你手动装了别的东西时才会出现。
- 运行环境：Python 3 与 Node.js。`tools/` 里的 Python 脚本需要额外依赖：

  ```bash
  pip install fonttools brotli pypdf
  ```

- Windows 控制台里 Python 脚本的中文输出可能乱码，加 `PYTHONUTF8=1` 前缀即可：

  ```bash
  PYTHONUTF8=1 python tools/check-output.py build/sample.pdf
  ```

## 架构与数据流

纯静态页面 + 原生 ES 模块，靠 `index.html` 里的 `<script type="importmap">` 把模块路径
映射到带版本号的 URL，**没有任何打包步骤**，改完文件刷新即生效。

生成一份 PDF 的完整链路（`js/app.js`）：

```
用户提交表单
  → collectErrors()          校验规则集中在这一处（提交报错和右侧 ✓/✕ 提示共用它）
  → readForm()               汇总成 data 对象
  → decodeBase64(TEMPLATE_PDF_BASE64)   模板（内嵌在 js/template-data.js）
  → loadAssets()             下载 PDF 用的宋体与 Tinos（点「生成」时才下，之后走缓存）
  → buildLeavePdf({...})     js/fill-pdf.js：按坐标往模板上画字、打勾
  → Blob + <a download>      直接交给浏览器下载
```

`js/fill-pdf.js` 是**浏览器和 Node 共用**的：`tools/verify.mjs` 在 Node 里用同一份代码
产出样例 PDF，所以命令行验证的结果和网页里生成的结果一致。改生成逻辑时不要写只在浏览器
或只在 Node 能跑的代码。

### 文件职责

| 文件 | 职责 |
| --- | --- |
| `index.html` | 页面骨架、importmap、**所有资源版本号** |
| `style.css` | 全部样式（含卡片展开、提示条、生成弹窗等状态类） |
| `js/app.js` | 表单交互、校验、学院选择面板、展开、生成与下载 |
| `js/fill-pdf.js` | 把数据画到模板 PDF 上（中英混排、自动缩字号、打勾、学号方格） |
| `js/pdf-slots.js` | 模板中各填写位置的坐标常量（**实测值**，见下） |
| `js/colleges.js` | 43 个学院名单 + 「其他（手动填写）」 |
| `js/template-data.js` | 模板 PDF 的 base64，**由脚本生成，勿手改** |
| `js/font-coverage.js` | 裁剪后字体覆盖的码位表，**由脚本生成，勿手改**（生僻字提示用） |
| `assets/template.pdf` | 学校发布的请假申请表原件（2 页，A4） |
| `assets/fonts/` | 裁剪后的开源字体：**黑体**（网页显示）、**宋体 + Tinos**（生成 PDF）及许可 |
| `assets/background.jpg` | 页面背景（校园牌坊，4000×2219 JPEG，812 KB） |
| `assets/jnu-emblem.svg` | 页头校徽 |
| `vendor/` | pdf-lib / fontkit / pako 的 ESM 构建产物，见 [vendor/PATCHES.md](vendor/PATCHES.md) |
| `tools/` | 开发脚本，**不参与页面运行**，不部署也能跑 |
| `docs/` | README 引用的预览图 |
| `build/` | 各种产物与缓存，已被 `.gitignore` 忽略，**不要提交** |

## 不可违反的约定

1. **不引入任何网络请求或后端。** 页面唯一允许的请求就是本站的静态资源（字体）。
   这是对用户的隐私承诺，写在 README 和页脚里。加统计、加 CDN、加接口都属于破坏承诺。

2. **模板必须保持 base64 内嵌，不要「优化」成 `fetch('assets/template.pdf')`。**
   部分浏览器的安全软件/扩展会按文件内容识别 PDF 并掐断响应，`fetch` 会报 NetworkError
   （改文件名、换后缀都没用，因为内容没变）。这是踩过坑之后的设计，不是偷懒。

3. **`js/template-data.js` 是生成物，不要手工编辑。** 换了 `assets/template.pdf` 之后跑：

   ```bash
   node tools/embed-template.mjs
   ```

4. **`vendor/` 是第三方库的构建产物，不要手改，也不要随手升级。**
   其中 `fontkit.es.min.js` 带着两处**必须保留**的补丁（裸模块名 `pako` 改为相对路径；
   `loca` 始终写长格式）。去掉第二处会导致生成的 PDF **随机缺字**。
   真要升级或重新生成，必须同步更新 [vendor/PATCHES.md](vendor/PATCHES.md)，
   并跑 `tools/check-output.py` 回归。

5. **填写坐标必须实测，不能目测或估算。** `js/pdf-slots.js` 里每条横线的起止 x、基线 y
   都取自模板 PDF 内容流中字符的精确 origin（页面 595.3 × 841.9 pt，`pdf_y = 841.9 - 自上而下的基线`）。
   要重新测量：用 `pdftotext -bbox`（poppler）或 pypdf 的 `visitor_text` 打印每个字符的位置，
   取横线/方括号字符的 origin，而不是照截图量像素。

6. **只允许开源字体。** 学校模板原本用宋体与 Times New Roman，两者都是随 Windows 分发的
   商业字体，不能进公开仓库。现在网页显示用思源黑体（Noto Sans CJK SC），生成 PDF 用
   思源宋体（Noto Serif SC）+ Tinos，都是 SIL OFL 1.1，度量与原字体兼容。
   **不要**为了「更好看」引入任何需要授权的字体。
   **三份中文字体必须用同一套字符集裁剪**（`prepare-fonts.py` 里的 `CJK_CPS`），
   否则生僻字检查会说谎。

7. **许可证是 GPL-3.0，外加字体/三方库的各自许可。** 新增依赖前先确认许可证兼容；
   新增第三方代码要同时更新 README 的组件表。

8. **改了 `style.css` 或任何 `js/` 文件，必须递增版本号**，否则访客会拿到「新 HTML + 旧资源」
   的错位页面。详见下一节。

9. **界面文案与代码注释一律用中文**，与现有风格保持一致；注释解释「为什么」，
   不要复述代码在做什么。

10. **`build/` 与临时文件不入库。** 顺手把 `git status` 里的杂物确认一遍再提交。

## 发布前必做：递增版本号

GitHub Pages 对 `css` / `js` / 图片缓存 **4 小时**，而 HTML 只缓存 10 分钟。
不加版本号就会出现新版 HTML 配旧版资源的错位。因此**每个静态资源的 URL 都带 `?v=`**。

版本号字面量分布在这两个文件里：

| 位置 | 覆盖的资源 | 当前值 |
| --- | --- | --- |
| `index.html` `<link rel="stylesheet">` | `style.css` | `20261003b` |
| `index.html` importmap 的 7 条映射 | `js/*.js`、`vendor/*.js` | `20261003a` |
| `index.html` 末尾 `<script type="module">` | `js/app.js` | `20261003a` |
| `index.html` 里的 `<img class="emblem">` | `assets/jnu-emblem.svg` | `20261003a` |
| `style.css` 里的 `background` | `assets/background.jpg` | `20261003b` |

**每个 URL 的版本号各自独立**，只递增内容真的变了的那些，不必全站一起换——全站一起换会让
访客白白重下一遍没变的 pdf-lib、fontkit 等（约 1.4 MB）。版本号写成「日期 + 序号」
（`20261003a`、`20261003b`…），同一天多次发布就顺延字母。

**一个容易漏的连带关系**：`style.css` 的内容改了，`index.html` 里引用它的 `style.css?v=…`
必须一起递增，否则 CDN 会把整份旧样式返给访客，改了等于没改。换 `assets/background.jpg`
同理：图片 URL 上的 `?v=` 不变，最长 4 小时内访客看到的还是旧图。

**字体不用管**：`app.js` 用 `new URL(import.meta.url).search` 取自己的版本号再拼字体 URL，
所以递增 importmap 里 `js/app.js` 的版本号时，字体缓存也一起刷新。

操作：把两个文件里的旧字面量全部替换成新值，再确认没有遗漏：

```bash
grep -rn "v=[0-9]\{8\}" index.html style.css
```

## 常见任务

### 改表单字段或校验规则

- HTML 在 `index.html` 的 `<form>` 里，交互在 `js/app.js`
- **校验规则集中在 `collectErrors()` 一处**，每条都带 `item`（属于哪一项，用来算进度）。
  提交报错、右侧提示条都读它，不要另写一套
- 全表共 9 项（`TOTAL_ITEMS`）：学号、姓名、学生类别、学院、专业、手机、电邮、请假时间、
  请假原因。**只有后两项允许留空**，PDF 里那两行整行留白（纸质表格上本来也能手写）
- 判断分两层，别混：
  - `collectErrors()` 只收**填错了**的情况，每条都拦住生成
  - `optionalGaps()` 统计那两个可留空项**整项没填**，不算错误，只影响进度条与提示条状态
  - 所以「请假时间整项空着」放行，而「只填一半 / 开始晚于结束」算错误、拦住生成 ——
    否则用户以为自己填了，PDF 里却整行空白
- 提示条状态由 `formState().level` 决定，三档：`ok` / `warn`（只差可留空的两项，仍可生成）/
  `bad`（有校验错误，拦住生成）。符号与配色在 `style.css` 的 `.validity.ok/.warn/.bad`
- 可留空的单选组标了 `data-clearable`（目前只有请假原因），由 `enableDeselect()` 实现
  「再点一次已选中的项 = 取消选择」。**只标在能留空的组上**：必填组清空没有意义，
  而且 `emailMode()` 这类代码假定一定有一项被选中，清空会直接抛错
- 改这块务必跑 `verify.mjs` 的 `blank` 用例，确认留空的两行是干净留白
- 右侧提示条默认只给「碰过」的字段标红（`touched` 集合），避免一打开满屏红
- **界面说明只留在「看不出来、不写会填错」的地方**（如「再点一下可取消选择」这种
  隐藏行为）。别复述界面上已经有的信息：域名就显示在输入框旁边，学院按钮自带箭头、
  面板里有搜索框 —— 这些都不用再写一行提示。加提示前先问：用户不写会做错吗
- **生成过程的反馈走全局弹窗**（`.export-mask` + `showExport()`），**不动右侧提示条** ——
  提示条只反映表单填写状态。别把生成进度塞回提示条：两种信息混在一条提示里，
  用户分不清「表单填错了」还是「正在生成」。校验没过时**不弹窗**，就停在表单上，
  该看的是字段高亮和提示条
- **生成完先预览，用户确认后才下载**（`showPreview()` / `confirmPreview()`）。预览用的是
  浏览器自带的 PDF 阅读器：blob URL 塞进 iframe，显示的就是真实成品。**不要**为了
  「更好看」去引 pdf.js —— 那要多 1 MB 以上，而首屏已经 4.6 MB。个别浏览器不渲染
  iframe 里的 PDF，所以留了 `.preview-open` 直接下载兜底。关预览时记得
  `releasePreview()` 释放 blob，别漏

### 改填写位置

1. 按约定 5 实测坐标，改 `js/pdf-slots.js`
2. `node tools/verify.mjs` 生成 `build/*.pdf`
3. 打开 PDF 核对，必要时截图存到 `build/`（截图是人工产物，没有生成脚本）

### 换模板 PDF

```bash
# 覆盖 assets/template.pdf 之后：
node tools/embed-template.mjs     # 重新生成 js/template-data.js
node tools/verify.mjs             # 出样例，检查坐标是否仍然对得上
python tools/check-output.py build/*.pdf
```

### 改字体或字符范围

```bash
python tools/prepare-fonts.py     # 下载源字体、裁剪成 assets/fonts/，并生成 js/font-coverage.js
```

脚本裁出 GB2312 全集加常用补充符号（见脚本里的 `EXTRA`），产出四份字体：

| 产物 | 用途 | 字重 |
| --- | --- | --- |
| `noto-sans-sc-subset.otf` | 网页显示（`style.css` 里的 `@font-face`） | 400 |
| `noto-sans-sc-bold-subset.otf` | 网页显示 | 700 |
| `noto-serif-sc-subset.ttf` | 生成 PDF | 400 |
| `tinos-subset.ttf` | 生成 PDF 里的西文 | 400 |

黑体的源字体走 **CERNET 镜像**（`NOTO_CJK_MIRRORS`）取 Ubuntu 的 `fonts-noto-cjk`，
比从 GitHub 下快两个数量级；宋体和 Tinos 仍从 google/fonts 取。

脚本还会把裁好字体的真实码位导出到 `js/font-coverage.js`。`app.js` 的 `unsupportedChars()`
读这份表来提示「这些字不在字体范围内」——**它是从字体导出的，所以重做字体后提示会自动跟着变，
不用手改名单**；反过来说，改完字体一定要重跑这个脚本，否则表和字体就对不上了。

提交前注意：`assets/fonts/*` 是二进制，看一眼体积；`js/font-coverage.js` 是生成物，别手改。

### 改样式

`style.css` 里的状态类大多跟 `js/app.js` 成对出现（`.page.expanded`、`.page.no-scroll`、
`.invalid`、`.validity.ok/.bad`）。改动画/布局时两边一起看。**改完记得递增版本号。**

两处不明显的耦合，动之前先读一眼：

- **字体分了两摊**：网页显示用的思源黑体写在 `style.css` 的 `@font-face` 里；
  生成 PDF 用的宋体与 Tinos 不在 CSS 里，由 `app.js` 等用户点「生成」时才下载。
  所以在 CSS 里找不到宋体、在 `app.js` 里也找不到页面字体，这是有意的，不是漏了。
- **吸底按钮的白色底衬依赖 `.page` 没有底部内边距。** 卡片底部留白由最后一块
  （`.site-footer`）的下外边距承担；如果给 `.page` 加回 `padding-bottom`，
  内容就会从按钮下方那一小条里露出来。
- **展开是单向的，别再给它加「收回」。** 展开后 `.page-hint` 由 CSS 隐藏、`scrollTop` 归零，
  顶部从校徽开始；滑动、滚轮、方向上键都不收回。这是有意去掉的，不是漏了。
- **免责声明是卡片内容的最后一块，不是浮层。** 它靠普通文档流「滚到最底才可见」，
  不要改回 `position: fixed` 之类——那样就得再引入一套出现/收起的判定，
  还免不了防抖阈值和闪烁。

## 验证（Definition of Done）

仓库**没有单元测试框架**，回归靠下面两条命令行检查 + 人工核对 PDF：

```bash
node tools/verify.mjs                          # 生成 build/sample.pdf、stress.pdf、long.pdf
python tools/check-output.py build/*.pdf       # 检查内嵌字体有没有缺字
```

- `verify.mjs` 的四个用例是有意挑的：`sample` 普通情况、`stress` 大量不同汉字（逼出缺字 bug）、
  `long` 超长学院/专业（触发自动缩小字号）与不足 10 位的学号、`blank` 请假时间与原因全空。
  **改生成逻辑后四个都要看**，`blank` 那份尤其要确认那两行是干净留白，没有空串、`NaN`
  或错位的字。
- `check-output.py` 是 fontkit 那个 loca bug 的回归检查（约定 4）。**改动 `vendor/` 或重做字体后必须跑。**
- 涉及页面交互的改动（展开、学院面板、提示条、生成弹窗）没有自动检查，请在浏览器里实际点一遍，
  手机宽度（≤ 520px）也看一眼——`@media (max-width: 520px)` 有单独的布局分支。

提交前的最短清单：

1. `node tools/verify.mjs && python tools/check-output.py build/*.pdf`
2. 浏览器里跑 `python -m http.server 8080`，把改到的交互点一遍
3. 改了 `style.css` / `js/` → 递增 `index.html` 里的版本号
4. `git status` 确认没有把 `build/` 或临时文件加进来

## 已知的坑

- **日期计算用 `Date.UTC`**（`daysBetween()`），不要换成 `new Date('YYYY-MM-DD')`，
  后者按 UTC 解析再取本地字段，在某些时区会差一天。天数把起止当天都算在内。
- **学子邮域名靠学号前 4 位**：学号 `2025103491` + 用户名 `zhangsan` → `zhangsan@stu2025.jnu.edu.cn`，
  所以学号没填够 4 位时，报错会标在**学号**输入框上而不是用户名上。
- **生僻字会提示而不是静默生成缺字 PDF**：字体覆盖 GB2312（6763 汉字 + 符号），
  「燚」「㸚」这类字会被 `collectErrors()` 拦下。
- **备案号那行默认 `hidden`**（`index.html` 的 `.icp`）。GitHub Pages 属于境外托管无法备案，
  将来真要备案得先把站点迁到境内主机。别顺手把它去掉 `hidden`。
- **`CNAME`** 里是 `pages.wtp016.eu.org`，改域名时别漏了它和 README 里的在线地址。
- **每次提交前确认自己在 `main` 上**：`main` 分支根目录即部署内容，推上去几分钟内就对外生效。

## 提交与协作

- 提交信息用中文短句概括改动，与现有历史一致（如「学院点击后弹出选择面板并支持搜索」）；
  沿用历史里的英文短句也可以，但**不要**在一个仓库里混用两种风格。
- 不要把格式化和重构混进功能提交；改动尽量局限在用户要求的那几行。
- 不要重写已推送的 `main` 历史，也不要 `--force` 推送——它同时是线上站点。
