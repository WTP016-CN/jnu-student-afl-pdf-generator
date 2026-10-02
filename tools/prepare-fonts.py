# -*- coding: utf-8 -*-
"""从系统字体生成网页所需的两份裁剪字体。

用法（在项目根目录执行）：
    python tools/prepare-fonts.py

产物：
    assets/fonts/simsun-subset.ttf   宋体，保留 GB2312 全部字符 + 常用补充符号
    assets/fonts/times-subset.ttf    Times New Roman，保留拉丁字母/数字/常用标点

说明：宋体与 Times New Roman 是随 Windows 分发的商业字体，此脚本只在本机
从 C:\\Windows\\Fonts 读取并裁剪，裁剪结果仅供本工具生成请假条使用。
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
OUT = os.path.join(ROOT, "assets", "fonts")
WINDIR = os.environ.get("WINDIR", r"C:\Windows")


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

SIMSUN_CPS = sorted(gb2312_codepoints() | ASCII | {ord(c) for c in EXTRA})
TIMES_CPS = sorted(ASCII | set(range(0xA0, 0x100)) | {ord(c) for c in "‘’“”–—…‰°′″×÷√§¶†‡€£¥©®™"})

# 丢弃嵌入点阵(EBDT/EBLC)、竖排度量、数字签名等用不到的表，明显减小体积
DROP_TABLES = "EBDT,EBLC,EBSC,MERG,meta,vmtx,vhea,DSIG"


def run(cmd):
    print("+", " ".join(cmd[1:4]), "...")
    subprocess.run(cmd, check=True)


def ttc_to_ttf(ttc_path, out_path, font_number=0):
    from fontTools.ttLib import TTCollection

    coll = TTCollection(ttc_path)
    coll.fonts[font_number].save(out_path)


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

    simsun_ttf = os.path.join(BUILD, "simsun-full.ttf")
    if not os.path.exists(simsun_ttf):
        print("从 simsun.ttc 提取宋体 ...")
        ttc_to_ttf(os.path.join(WINDIR, "Fonts", "simsun.ttc"), simsun_ttf)

    subset(simsun_ttf, os.path.join(OUT, "simsun-subset.ttf"), SIMSUN_CPS, "SimSun")
    subset(os.path.join(WINDIR, "Fonts", "times.ttf"),
           os.path.join(OUT, "times-subset.ttf"), TIMES_CPS, "Times New Roman")


if __name__ == "__main__":
    main()
