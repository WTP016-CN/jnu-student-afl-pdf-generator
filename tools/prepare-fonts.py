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
    assets/fonts/noto-sans-sc-subset.otf        黑体 Regular·常用（GB2312 全集 + 常用符号）
    assets/fonts/noto-sans-sc-rare-subset.otf   黑体 Regular·生僻（CJK 基本区 + 扩展 A 区里
                                                常用包没覆盖的部分），靠 unicode-range 按需下载
    assets/fonts/noto-sans-sc-bold-subset.otf   黑体 Bold·只裁界面用字（页面加粗的都是写死文案）
    assets/fonts/faces.css                      上面三份的 @font-face 规则（含 unicode-range）
    assets/fonts/noto-serif-sc-subset.ttf       宋体，CJK 基本区 + 扩展 A 区全部码位（PDF 用）
    assets/fonts/tinos-subset.ttf               西文，拉丁字母/数字/常用标点（PDF 用）
    js/font-coverage.js                         宋体覆盖的码位表（生僻字提示用）
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

# 写进 assets/fonts/faces.css 的字体版本号。字体文件变了就得递增它，
# 否则访客拿到的是浏览器缓存里的旧字体（见 README「发布前必做：递增版本号」）。
FONT_VERSION = "20261006a"

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

# CJK 统一汉字基本区 + 扩展 A 区：学生姓名里难免有生僻字（如「燚」「㸚」），
# 生成的 PDF 必须能画出它们，所以宋体裁到这两个区的全部码位。
CJK_BASIC = set(range(0x4E00, 0xA000))
CJK_EXT_A = set(range(0x3400, 0x4DC0))

# 必须写成 GB2312 ∪ 两个 CJK 区：全角标点（（）、“”、《》……）不在 CJK 汉字区里，
# 只取汉字区会把它们漏掉，生成的 PDF 里那些标点会变成空白。
COMMON_CPS = sorted(gb2312_codepoints() | ASCII | {ord(c) for c in EXTRA})
FULL_CPS = sorted(set(COMMON_CPS) | CJK_BASIC | CJK_EXT_A)
RARE_CPS = sorted(set(FULL_CPS) - set(COMMON_CPS))
LATIN_CPS = sorted(ASCII | set(range(0xA0, 0x100))
                   | {ord(c) for c in "‘’“”–—…‰°′″×÷√§¶†‡€£¥©®™"})


def ui_codepoints():
    """页面里可能出现在加粗文案上的字符。

    页面所有加粗的地方都是写死的界面文案（标题、区块名、字段标签、选项、按钮、
    选中的学院名……），用户输入的内容一律是常规字重。所以加粗字体只需要这一小撮字，
    不必跟着裁两万多个汉字 —— 这一下就省掉 1.5 MB 首屏。
    **给用户能输入的内容加粗之前，先确认那些字在这个集合里。**
    """
    chars = set()
    for rel in ("index.html", "js/app.js", "js/colleges.js"):
        with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
            chars |= set(fh.read())
    return sorted({ord(c) for c in chars if ord(c) >= 0x20})


def to_ranges(codepoints):
    """把码位表压成连续区间，用来写 unicode-range。"""
    ranges, start, prev = [], None, None
    for cp in sorted(codepoints):
        if start is None:
            start = prev = cp
        elif cp == prev + 1:
            prev = cp
        else:
            ranges.append((start, prev))
            start = prev = cp
    if start is not None:
        ranges.append((start, prev))
    return ranges


def to_unicode_range(codepoints):
    return ",".join("U+%04X-%04X" % r if r[0] != r[1] else "U+%04X" % r[0]
                    for r in to_ranges(codepoints))


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
    ranges = to_ranges(cps)

    body = ",".join("%04X-%04X" % r if r[0] != r[1] else "%04X" % r[0] for r in ranges)
    banner = ("/* 由 tools/prepare-fonts.py 从裁剪好的字体里导出，请勿手工修改。\n"
              "   换了字体重新执行：python tools/prepare-fonts.py */")
    with open(dst, "w", encoding="utf-8") as fh:
        fh.write('%s\nexport const CJK_COVERAGE_RANGES =\n  \'%s\';\n' % (banner, body))
    print("  %-22s %8.1f KB  (%d 个码位，%d 段)"
          % ("字体覆盖表", os.path.getsize(dst) / 1024, len(cps), len(ranges)))


def write_faces_css(dst):
    """生成 style.css 之外的那份 @font-face 规则。

    黑体靠 unicode-range 拆成「常用字包」与「生僻字包」：浏览器只在页面真的显示到
    某个区间里的字时才去下那个文件。多数人只下常用包（约 1.6 MB）；姓名里有生僻字
    （如「燚」）的人才会额外下生僻包。加粗那份只裁界面用字，见 ui_codepoints()。

    区间表又长又碎（GB2312 在 Unicode 里本来就是散的），所以单独放一个生成文件，
    不塞进手写的 style.css。
    """
    banner = ("/* 由 tools/prepare-fonts.py 生成，请勿手工修改。\n"
              "   黑体分「常用字包 / 生僻字包」，靠 unicode-range 让浏览器按需下载；\n"
              "   重新裁剪字体后要把下面的 FONT_VERSION 一起递增（见脚本顶部）。 */")
    faces = [
        ("noto-sans-sc-subset.otf", 400, COMMON_CPS),
        ("noto-sans-sc-rare-subset.otf", 400, RARE_CPS),
        ("noto-sans-sc-bold-subset.otf", 700, ui_codepoints()),
    ]
    blocks = [banner]
    for name, weight, codepoints in faces:
        blocks.append(
            '@font-face {\n'
            '  font-family: "JNU Sans";\n'
            '  src: url("%s?v=%s") format("opentype");\n'
            '  font-weight: %d;\n'
            '  font-style: normal;\n'
            '  font-display: swap;\n'
            '  unicode-range: %s;\n'
            '}' % (name, FONT_VERSION, weight, to_unicode_range(codepoints)))
    with open(dst, "w", encoding="utf-8") as fh:
        fh.write("\n\n".join(blocks) + "\n")
    print("  %-22s %8.1f KB" % ("@font-face 规则", os.path.getsize(dst) / 1024))


def main():
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)

    for name, url in DOWNLOADS.items():
        retrieve(name, url)

    # 网页显示用的黑体，拆成三份（见 write_faces_css 的说明）
    retrieve_sans_faces()
    subset(os.path.join(SRC, "NotoSansCJK-Regular.ttc"),
           os.path.join(OUT, "noto-sans-sc-subset.otf"), COMMON_CPS, "黑体 Regular·常用", face=SANS_FACE)
    subset(os.path.join(SRC, "NotoSansCJK-Regular.ttc"),
           os.path.join(OUT, "noto-sans-sc-rare-subset.otf"), RARE_CPS, "黑体 Regular·生僻", face=SANS_FACE)
    subset(os.path.join(SRC, "NotoSansCJK-Bold.ttc"),
           os.path.join(OUT, "noto-sans-sc-bold-subset.otf"), ui_codepoints(), "黑体 Bold·界面用字",
           face=SANS_FACE)

    # 下面两份只用于生成 PDF，宋体裁到 CJK 基本区 + 扩展 A 区全部码位
    cjk_src = static_instance(os.path.join(SRC, "NotoSerifSC-var.ttf"))
    serif = os.path.join(OUT, "noto-serif-sc-subset.ttf")
    subset(cjk_src, serif, FULL_CPS, "宋体（PDF）")
    subset(os.path.join(SRC, "Tinos-Regular.ttf"),
           os.path.join(OUT, "tinos-subset.ttf"), LATIN_CPS, "Tinos（PDF）")

    write_faces_css(os.path.join(OUT, "faces.css"))
    write_coverage(serif, os.path.join(ROOT, "js", "font-coverage.js"))


if __name__ == "__main__":
    main()
