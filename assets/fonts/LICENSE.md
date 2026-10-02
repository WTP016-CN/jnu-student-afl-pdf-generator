# 字体许可

本目录里的两个字体文件都是开源字体裁剪而来，遵循 **SIL Open Font License 1.1**
（许可全文见同目录的 [OFL.txt](OFL.txt)）。两者都未声明 Reserved Font Name。

| 文件 | 字体 | 版权 | 上游 |
| --- | --- | --- | --- |
| `noto-serif-sc-subset.ttf` | Noto Serif SC（思源宋体） | Copyright 2012 Google Inc.；字体元数据另署 (c) 2017-2024 Adobe | [google/fonts/ofl/notoserifsc](https://github.com/google/fonts/tree/main/ofl/notoserifsc) |
| `tinos-subset.ttf` | Tinos（与 Times New Roman 度量兼容） | Copyright The Tinos Project Authors | [google/fonts/ofl/tinos](https://github.com/google/fonts/tree/main/ofl/tinos) |

## 裁剪方式

由 `tools/prepare-fonts.py` 生成：

- Noto Serif SC 上游是可变字体（字重轴 200–900），脚本先实例化到 **wght=400（Regular）**，
  再裁剪到 GB2312 全部字符（7547 个）及常用补充符号。
- Tinos 裁剪到拉丁字母、数字与常用标点（206 个字符）。

只做了子集化与可变字体实例化，没有改动字形设计，字体名也未更改。

## 为什么不直接用宋体和 Times New Roman

这两个是随 Windows 分发的商业字体，随本仓库再分发存在授权风险。
Noto Serif SC 与 Tinos 分别在中文（宋体风格）和西文上与它们观感一致，
Tinos 更与 Times New Roman 度量兼容，因此排版位置与用 Times 时相同。
