# 字体许可

本目录里的字体文件都是开源字体裁剪而来，遵循 **SIL Open Font License 1.1**
（许可全文见同目录的 [OFL.txt](OFL.txt)）。都未声明 Reserved Font Name。

| 文件 | 字体 | 用途 | 版权 | 上游 |
| --- | --- | --- | --- | --- |
| `noto-sans-sc-subset.otf` | Noto Sans CJK SC（思源黑体） | 页面显示 | Copyright 2014-2021 Adobe（与 Google 共同开发） | [notofonts/noto-cjk](https://github.com/notofonts/noto-cjk)、Ubuntu `fonts-noto-cjk` |
| `noto-sans-sc-bold-subset.otf` | 同上，Bold 字重 | 页面显示 | 同上 | 同上 |
| `noto-serif-sc-subset.ttf` | Noto Serif SC（思源宋体） | 生成 PDF | Copyright 2012 Google Inc.；字体元数据另署 (c) 2017-2024 Adobe | [google/fonts/ofl/notoserifsc](https://github.com/google/fonts/tree/main/ofl/notoserifsc) |
| `tinos-subset.ttf` | Tinos（与 Times New Roman 度量兼容） | 生成 PDF | Copyright The Tinos Project Authors | [google/fonts/ofl/tinos](https://github.com/google/fonts/tree/main/ofl/tinos) |

## 裁剪方式

由 `tools/prepare-fonts.py` 生成，三份中文字体裁的是**同一套字符集**：
GB2312 全部字符（7547 个）及常用补充符号。

- Noto Sans CJK SC 来自 Ubuntu 的 `fonts-noto-cjk` 包（从 CERNET 镜像取），
  取其中的简体字面，Regular 与 Bold 各裁一份，页面因此有真实字重。
- Noto Serif SC 上游是可变字体（字重轴 200–900），脚本先实例化到 **wght=400（Regular）**，
  再裁剪。
- Tinos 裁剪到拉丁字母、数字与常用标点（206 个字符）。

脚本同时把裁好的字符集导出到 `js/font-coverage.js`，页面用它判断生僻字，
这样就不必为了做这个检查下载字体。

只做了子集化与可变字体实例化，没有改动字形设计，字体名也未更改。

## 为什么不直接用宋体和 Times New Roman

这两个是随 Windows 分发的商业字体，随本仓库再分发存在授权风险。
Noto Serif SC 与 Tinos 分别在中文（宋体风格）和西文上与它们观感一致，
Tinos 更与 Times New Roman 度量兼容，因此排版位置与用 Times 时相同。
