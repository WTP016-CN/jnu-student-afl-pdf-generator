# 字体许可

本目录里的字体文件都是开源字体裁剪而来，遵循 **SIL Open Font License 1.1**
（许可全文见同目录的 [OFL.txt](OFL.txt)）。都未声明 Reserved Font Name。

| 文件 | 字体 | 用途 | 版权 | 上游 |
| --- | --- | --- | --- | --- |
| `noto-sans-sc-subset.otf` | Noto Sans CJK SC（思源黑体） | 网页显示·常用字 | Copyright 2014-2021 Adobe（与 Google 共同开发） | [notofonts/noto-cjk](https://github.com/notofonts/noto-cjk)、Ubuntu `fonts-noto-cjk` |
| `noto-sans-sc-rare-subset.otf` | 同上 | 网页显示·生僻字 | 同上 | 同上 |
| `noto-sans-sc-bold-subset.otf` | 同上，Bold 字重 | 网页显示的加粗文案 | 同上 | 同上 |
| `noto-serif-sc-subset.ttf` | Noto Serif SC（思源宋体） | 生成 PDF | Copyright 2012 Google Inc.；字体元数据另署 (c) 2017-2024 Adobe | [google/fonts/ofl/notoserifsc](https://github.com/google/fonts/tree/main/ofl/notoserifsc) |
| `tinos-subset.ttf` | Tinos（与 Times New Roman 度量兼容） | 生成 PDF 里的西文 | Copyright The Tinos Project Authors | [google/fonts/ofl/tinos](https://github.com/google/fonts/tree/main/ofl/tinos) |

`faces.css` 不是字体，是脚本生成的 `@font-face` 规则（含上万段的 `unicode-range`）。

## 裁剪方式

由 `tools/prepare-fonts.py` 生成。字符集分两档：

- **常用字**：GB2312 全集（7547 字）加常用补充符号 —— 网页的常用字包用它。
- **CJK 统一汉字基本区（U+4E00–U+9FFF）+ 扩展 A 区（U+3400–U+4DBF）**，也就是
  基本区与扩展 A 区的**全部**码位（两万八千余字），再加上常用字那一档 ——
  生成 PDF 的宋体用它，学生的姓名里有生僻字（如「燚」「㸚」）也画得出来。

几份黑体各有分工：

- **常规字重拆成两包**，`faces.css` 里用 `unicode-range` 分开声明。浏览器只在页面
  真的显示到某个区间里的字时才去下那个文件 —— 多数人只下常用字包（约 1.6 MB），
  姓名里有生僻字的人才会多下生僻字包。
- **加粗只裁界面用字**（637 字）：页面所有加粗的地方都是写死的界面文案，用户输入的
  内容一律是常规字重。这一下省掉了一兆多。
- Noto Serif SC 上游是可变字体（字重轴 200–900），脚本先实例化到 **wght=400（Regular）**，
  再裁剪。
- Tinos 裁剪到拉丁字母、数字与常用标点（206 个字符）。

脚本同时把宋体裁好的字符集导出到 `js/font-coverage.js`，页面用它判断生僻字，
这样就不必为了做这个检查下载字体。

只做了子集化与可变字体实例化，没有改动字形设计，字体名也未更改。

## 为什么不直接用宋体和 Times New Roman

这两个是随 Windows 分发的商业字体，随本仓库再分发存在授权风险。
Noto Serif SC 与 Tinos 分别在中文（宋体风格）和西文上与它们观感一致，
Tinos 更与 Times New Roman 度量兼容，因此排版位置与用 Times 时相同。
