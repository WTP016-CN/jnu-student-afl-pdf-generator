# -*- coding: utf-8 -*-
"""检查生成出来的 PDF：内嵌字体里每个用到的字形都必须有轮廓。

背景：pdf-lib 依赖的 fontkit 在写短格式 loca 时会截断奇数偏移，导致字形
数据错位、PDF 随机缺字（见 vendor/PATCHES.md）。这个脚本用来守住这条线。

用法：
    python tools/check-output.py build/sample.pdf build/stress.pdf
需要 fontTools、pypdf。
"""
import io
import struct
import sys

import pypdf
from fontTools.ttLib import TTFont


def embedded_fonts(pdf_path):
    """取出 PDF 中所有内嵌的 TrueType 字体字节。"""
    reader = pypdf.PdfReader(pdf_path)
    seen = set()
    for page in reader.pages:
        fonts = (page.get("/Resources") or {}).get("/Font") or {}
        for ref in fonts.values():
            font = ref.get_object()
            if font.get("/Subtype") != "/Type0":
                continue
            desc = font["/DescendantFonts"][0].get_object()["/FontDescriptor"]
            stream = desc.get("/FontFile2")
            if stream is None:
                continue
            name = str(desc.get("/FontName"))
            # 模板自带的字体（带 ABCDEF+ 子集前缀）字形编号本来就是稀疏的，
            # 只检查本工具新嵌入的字体
            if "+" in name or name in seen:
                continue
            seen.add(name)
            yield name, stream.get_data()


def empty_glyphs(data):
    """返回 (字形数, 空轮廓字形编号) —— .notdef 与空格不计。"""
    font = TTFont(io.BytesIO(data))
    raw = data
    num_tables = struct.unpack(">H", raw[4:6])[0]
    tables = {}
    for i in range(num_tables):
        off = 12 + i * 16
        tag = raw[off:off + 4].decode("latin-1")
        start, length = struct.unpack(">II", raw[off + 8:off + 16])
        tables[tag] = (start, length)

    head = tables["head"][0]
    loca_format = struct.unpack(">h", raw[head + 50:head + 52])[0]
    nglyphs = font["maxp"].numGlyphs
    loca_off = tables["loca"][0]
    if loca_format == 1:
        locs = [struct.unpack(">I", raw[loca_off + 4 * i:loca_off + 4 * i + 4])[0] for i in range(nglyphs + 1)]
    else:
        locs = [struct.unpack(">H", raw[loca_off + 2 * i:loca_off + 2 * i + 2])[0] * 2 for i in range(nglyphs + 1)]

    glyf_off = tables["glyf"][0]
    broken = []
    for gid in range(1, nglyphs):
        length = locs[gid + 1] - locs[gid]
        if length == 0:
            # 空格一类没有轮廓的字形，数据本来就是空的
            continue
        data = raw[glyf_off + locs[gid]:glyf_off + locs[gid] + min(length, 10)]
        if len(data) < 10:
            broken.append(gid)
            continue
        contours = struct.unpack(">h", data[0:2])[0]
        if contours == -1:  # 复合字形
            continue
        if not (0 <= contours < 200):  # 轮廓数离谱 => 数据错位
            broken.append(gid)
    return nglyphs, broken


def main(paths):
    failed = False
    for path in paths:
        for name, data in embedded_fonts(path):
            nglyphs, empty = empty_glyphs(data)
            status = "OK" if not empty else "字形损坏 %s" % empty[:10]
            print("%-30s %-28s 字形 %3d  %s" % (path, name, nglyphs, status))
            if empty:
                failed = True
    if failed:
        sys.exit("发现空字形：内嵌字体可能已损坏")
    print("检查通过：所有内嵌字形都有轮廓")


if __name__ == "__main__":
    main(sys.argv[1:] or ["build/sample.pdf"])
