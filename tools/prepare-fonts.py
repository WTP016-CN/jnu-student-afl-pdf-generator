# -*- coding: utf-8 -*-
"""生成网页与 PDF 所需的三份裁剪字体（都是开源字体）。

用法（在项目根目录执行）：
    python tools/prepare-fonts.py

字体来源（首次运行会把源字体下到 build/fonts-src/，也可以自己放好文件跳过下载）：

    中文黑体：Noto Sans CJK（思源黑体，SIL OFL 1.1）—— 页面显示用
              Ubuntu 打包的 fonts-noto-cjk，从 CERNET 镜像取（比 GitHub 快两个数量级）
    中文宋体：Noto Serif SC（思源宋体，SIL OFL 1.1）—— 只用于生成的 PDF
              google/fonts/ofl/notoserifsc/NotoSerifSC[wght].ttf（可变字体，取 wght=400）
    西文：    Tinos（SIL OFL 1.1，与 Times New Roman 度量兼容）—— 只用于生成的 PDF
              google/fonts/ofl/tinos/Tinos-Regular.ttf

产物：
    assets/fonts/noto-sans-sc-subset.otf        黑体 Regular，GB2312 全集 + 常用补充符号
    assets/fonts/noto-sans-sc-bold-subset.otf   黑体 Bold，字符集同上
    assets/fonts/noto-serif-sc-subset.ttf       宋体，字符集同上（PDF 用）
    assets/fonts/tinos-subset.ttf               西文，拉丁字母/数字/常用标点
"""
import io
import lzma
import os
import subprocess
import sys
import tarfile
import urllib.request

from fontTools.ttLib import TTFont, TTCollection

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
SRC = os.path.join(BUILD, "fonts-src")
OUT = os.path.join(ROOT, "assets", "fonts")

GF = "https://github.com/google/fonts/raw/main/"
DOWNLOADS = {
    "NotoSerifSC-var.ttf": GF + "ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf",
    "Tinos-Regular.ttf": GF + "ofl/tinos/Tinos-Regular.ttf",
}

# 思源黑体走 CERNET 镜像：站点的 /ubuntu/ 会把请求转到离你最近的成员镜像。
# 上游是 Ubuntu 的 fonts-noto-cjk，里面 NotoSansCJK-{Regular,Bold}.ttc 各含
# 10 个字体，[2] 是简体（Noto Sans CJK SC）。
NOTO_CJK_MIRRORS = [
    "https://mirrors.cernet.edu.cn/ubuntu/pool/main/f/fonts-noto-cjk/",
    "https://mirrors.sustech.edu.cn/ubuntu/pool/main/f/fonts-noto-cjk/",
    "https://mirrors.tuna.tsinghua.edu.cn/ubuntu/pool/main/f/fonts-noto-cjk/",
]
SANS_FACE = 2  # .ttc 中 Noto Sans CJK SC 的下标

# 丢弃嵌入点阵(EBDT/EBLC)、竖排度量、数字签名等用不到的表，明显减小体积
DROP_TABLES = "EBDT,EBLC,EBSC,MERG,meta,vmtx,vhea,DSIG"


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


def retrieve(name, url):
    path = os.path.join(SRC, name)
    if not os.path.exists(path):
        os.makedirs(SRC, exist_ok=True)
        print("下载 %s ..." % name)
        urllib.request.urlretrieve(url, path)
    return path


def retrieve_sans_faces():
    """从 CERNET 镜像取 Ubuntu 的 fonts-noto-cjk，解出 Regular/Bold 两个 .ttc。"""
    want = {"NotoSansCJK-Regular.ttc": None, "NotoSansCJK-Bold.ttc": None}
    missing = [n for n in want if not os.path.exists(os.path.join(SRC, n))]
    if not missing:
        return

    os.makedirs(SRC, exist_ok=True)
    last_err = None
    for mirror in NOTO_CJK_MIRRORS:
        try:
            print("从 %s 找 fonts-noto-cjk ..." % mirror)
            listing = urllib.request.urlopen(mirror, timeout=30).read().decode("utf-8", "replace")
            # 取版本号最大的那个 deb；目录里同时留着旧版本
            names = sorted(set(
                part.split('"')[0]
                for part in listing.split("fonts-noto-cjk_")[1:]
            ))
            names = [n.split(".deb")[0] + ".deb" for n in names if ".deb" in n and "extra" not in n]
            if not names:
                raise RuntimeError("目录里没找到 fonts-noto-cjk 的 deb")
            deb_name = names[-1]
            deb_path = os.path.join(SRC, deb_name)
            if not os.path.exists(deb_path):
                print("下载 %s ..." % deb_name)
                urllib.request.urlretrieve(mirror + deb_name, deb_path)
            _extract_deb(deb_path)
            return
        except Exception as exc:                       # 换下一个镜像
            last_err = exc
            print("  失败：%s" % exc)
    raise RuntimeError("所有镜像都没取到字体：%s" % last_err)


def _extract_deb(deb_path):
    """deb 就是 ar 归档，内含 data.tar.{xz,zst}；只用标准库解开，不依赖系统命令。"""
    raw = open(deb_path, "rb").read()
    if raw[:8] != b"!<arch>\n":
        raise RuntimeError("%s 不是 ar 归档" % deb_path)

    offset, data_blob = 8, None
    while offset + 60 <= len(raw):
        header = raw[offset:offset + 60]
        name = header[0:16].decode().strip()
        size = int(header[48:58].decode().strip())
        chunk = raw[offset + 60:offset + 60 + size]
        if name.startswith("data.tar"):
            data_blob = (name, chunk)
        offset += 60 + size + (size % 2)
    if data_blob is None:
        raise RuntimeError("%s 里没有 data.tar" % deb_path)

    name, chunk = data_blob
    if name.endswith(".xz"):
        stream = io.BytesIO(lzma.decompress(chunk))
    elif name.endswith(".zst"):
        from compression import zstd                   # Python 3.14+
        stream = io.BytesIO(zstd.decompress(chunk))
    else:
        import gzip
        stream = io.BytesIO(gzip.decompress(chunk))

    with tarfile.open(fileobj=stream) as tar:
        for member in tar.getmembers():
            base = os.path.basename(member.name)
            if base in ("NotoSansCJK-Regular.ttc", "NotoSansCJK-Bold.ttc"):
                member.name = base                        # 只留文件名，去掉 ./usr/... 前缀
                tar.extract(member, SRC)
                print("  取出 %s（%.1f MB）" % (base, member.size / 1048576))


def run(cmd):
    print("+", " ".join(cmd[1:4]), "...")
    subprocess.run(cmd, check=True)


def static_instance(src, wght=400):
    """把可变字体实例化为静态字体（Noto Serif SC 默认轴值是 ExtraLight）。"""
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


def subset(src, dst, codepoints, label, face=None):
    # 字符集太大，写成文件传给 fontTools（Windows 命令行长度有限制）
    ufile = os.path.join(BUILD, os.path.basename(dst) + ".unicodes")
    with open(ufile, "w", encoding="utf-8") as fh:
        fh.write("\n".join("U+%04X" % cp for cp in codepoints))

    if face is None:
        run([
            sys.executable, "-m", "fontTools.subset", src,
            "--unicodes-file=" + ufile,
            "--drop-tables+=" + DROP_TABLES,
            "--layout-features=",
            "--name-IDs=*",
            "--output-file=" + dst,
        ])
    else:
        # .ttc 里挑其中一个字体来裁剪（fontTools.subset 认不了 ttc）
        font = TTCollection(src, lazy=False).fonts[face]
        from fontTools.subset import Options, Subsetter
        opts = Options()
        opts.drop_tables += DROP_TABLES.split(",")
        opts.layout_features = []
        opts.name_IDs = ["*"]
        opts.notdef_outline = True
        subsetter = Subsetter(options=opts)
        subsetter.populate(unicodes=codepoints)
        subsetter.subset(font)
        font.save(dst)
    print("  %-22s %8.1f KB  (%d 个字符)" % (label, os.path.getsize(dst) / 1024, len(codepoints)))


def write_coverage(font_path, dst):
    """把裁剪后字体真正拥有的码位导出成 js/font-coverage.js。

    页面提示「这些字不在字体范围内」时要用它。直接读这份由字体本身导出的表，
    页面就不必为了做这个检查先把字体下下来（宋体只用于生成 PDF，是等点「生成」才取的）。
    """
    cps = sorted(cp for cp in TTFont(font_path, lazy=True).getBestCmap() if cp >= 0x20)

    ranges, start, prev = [], None, None
    for cp in cps:
        if start is None:
            start = prev = cp
        elif cp == prev + 1:
            prev = cp
        else:
            ranges.append((start, prev))
            start = prev = cp
    if start is not None:
        ranges.append((start, prev))

    body = ",".join("%04X-%04X" % r if r[0] != r[1] else "%04X" % r[0] for r in ranges)
    banner = ("/* 由 tools/prepare-fonts.py 从裁剪好的字体里导出，请勿手工修改。\n"
              "   换了字体重新执行：python tools/prepare-fonts.py */")
    with open(dst, "w", encoding="utf-8") as fh:
        fh.write('%s\nexport const CJK_COVERAGE_RANGES =\n  \'%s\';\n' % (banner, body))
    print("  %-22s %8.1f KB  (%d 个码位，%d 段)"
          % ("字体覆盖表", os.path.getsize(dst) / 1024, len(cps), len(ranges)))


def main():
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)

    for name, url in DOWNLOADS.items():
        retrieve(name, url)

    # 页面显示用的黑体：Regular + Bold 两个字重，网页上就能用真实加粗
    retrieve_sans_faces()
    subset(os.path.join(SRC, "NotoSansCJK-Regular.ttc"),
           os.path.join(OUT, "noto-sans-sc-subset.otf"), CJK_CPS, "Noto Sans SC", face=SANS_FACE)
    subset(os.path.join(SRC, "NotoSansCJK-Bold.ttc"),
           os.path.join(OUT, "noto-sans-sc-bold-subset.otf"), CJK_CPS, "Noto Sans SC Bold", face=SANS_FACE)

    # 下面两份只用于生成 PDF
    cjk_src = static_instance(os.path.join(SRC, "NotoSerifSC-var.ttf"))
    serif = os.path.join(OUT, "noto-serif-sc-subset.ttf")
    subset(cjk_src, serif, CJK_CPS, "Noto Serif SC")
    subset(os.path.join(SRC, "Tinos-Regular.ttf"),
           os.path.join(OUT, "tinos-subset.ttf"), LATIN_CPS, "Tinos")

    write_coverage(serif, os.path.join(ROOT, "js", "font-coverage.js"))


if __name__ == "__main__":
    main()
