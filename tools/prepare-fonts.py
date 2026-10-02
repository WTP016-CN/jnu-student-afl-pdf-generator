# -*- coding: utf-8 -*-
"""生成网页所需的两份裁剪字体（都使用开源字体）。

用法（在项目根目录执行）：
    python tools/prepare-fonts.py

字体来源（首次运行会自动下载到 build/fonts-src/，也可以自己放好文件跳过下载）：

    中文：Noto Serif SC（思源宋体，SIL OFL 1.1）
          google/fonts/ofl/notoserifsc/NotoSerifSC[wght].ttf（可变字体，取 wght=400）
    西文：Tinos（SIL OFL 1.1，与 Times New Roman 度量兼容）
          google/fonts/ofl/tinos/Tinos-Regular.ttf

产物：
    assets/fonts/noto-serif-sc-subset.ttf   中文，保留 GB2312 全部字符 + 常用补充符号
    assets/fonts/tinos-subset.ttf           西文，保留拉丁字母/数字/常用标点
"""
import os
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
SRC = os.path.join(BUILD, "fonts-src")
OUT = os.path.join(ROOT, "assets", "fonts")

GF = "https://github.com/google/fonts/raw/main/"
DOWNLOADS = {
    "NotoSerifSC-var.ttf": GF + "ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf",
    "Tinos-Regular.ttf": GF + "ofl/tinos/Tinos-Regular.ttf",
}


def gb2312_codepoints():
    """GB2312 全集：6763 个汉字 + 全角标点/希腊字母/俄文字母/序号等。"""
    cps = set()
    for hi in range(0xA1, 0xFF):
        for lo in range(0xA1, 0xFF):
            try:
                cps.add(ord(bytes([hi, lo]).decode("gb2312")))
            except UnicodeDecodeError:
                pass
    return cps


# 表里可能被输入、但不在 GB2312 内的常用符号
EXTRA = "√✓×✗□■○●△▲☆★※°′″℃№→←↑↓↔§¶·—–…‰"
ASCII = set(range(0x20, 0x7F))

CJK_CPS = sorted(gb2312_codepoints() | ASCII | {ord(c) for c in EXTRA})
LATIN_CPS = sorted(ASCII | set(range(0xA0, 0x100))
                   | {ord(c) for c in "‘’“”–—…‰°′″×÷√§¶†‡€£¥©®™"})

# 丢弃嵌入点阵(EBDT/EBLC)、竖排度量、数字签名等用不到的表，明显减小体积
DROP_TABLES = "EBDT,EBLC,EBSC,MERG,meta,vmtx,vhea,DSIG"


def retrieve(name, url):
    path = os.path.join(SRC, name)
    if not os.path.exists(path):
        os.makedirs(SRC, exist_ok=True)
        print("下载 %s ..." % name)
        urllib.request.urlretrieve(url, path)
    return path


def run(cmd):
    print("+", " ".join(cmd[1:4]), "...")
    subprocess.run(cmd, check=True)


def static_instance(src, wght=400):
    """把可变字体实例化为静态字体（Noto Serif SC 默认轴值是 ExtraLight）。"""
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer

    name = os.path.splitext(os.path.basename(src))[0] + "-wght%d.ttf" % wght
    dst = os.path.join(SRC, name)
    if not os.path.exists(dst):
        print("实例化 wght=%d ..." % wght)
        font = TTFont(src)
        # updateFontNames：把字体名里的 ExtraLight 改成 Regular，
        # 否则生成的 PDF 里内嵌字体名会标着 ExtraLight，容易引起误解
        instancer.instantiateVariableFont(font, {"wght": wght}, inplace=True, updateFontNames=True)
        font.save(dst)
    return dst


def subset(src, dst, codepoints, label):
    # 字符集太大，写成文件传给 fontTools（Windows 命令行长度有限制）
    ufile = os.path.join(BUILD, os.path.basename(dst) + ".unicodes")
    with open(ufile, "w", encoding="utf-8") as fh:
        fh.write("\n".join("U+%04X" % cp for cp in codepoints))
    run([
        sys.executable, "-m", "fontTools.subset", src,
        "--unicodes-file=" + ufile,
        "--drop-tables+=" + DROP_TABLES,
        "--layout-features=",
        "--name-IDs=*",
        "--output-file=" + dst,
    ])
    print("  %-14s %8.1f KB  (%d 个字符)" % (label, os.path.getsize(dst) / 1024, len(codepoints)))


def main():
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)

    for name, url in DOWNLOADS.items():
        retrieve(name, url)

    cjk_src = static_instance(os.path.join(SRC, "NotoSerifSC-var.ttf"))
    subset(cjk_src, os.path.join(OUT, "noto-serif-sc-subset.ttf"), CJK_CPS, "Noto Serif SC")
    subset(os.path.join(SRC, "Tinos-Regular.ttf"),
           os.path.join(OUT, "tinos-subset.ttf"), LATIN_CPS, "Tinos")


if __name__ == "__main__":
    main()
