# vendor 目录说明

这里放的是第三方库的构建产物，页面直接用 `import` 加载，无需打包工具。

| 文件 | 来源 | 版本 |
| --- | --- | --- |
| `pdf-lib.esm.min.js` | npm `pdf-lib` `dist/pdf-lib.esm.min.js` | 1.17.1 |
| `fontkit.es.min.js` | npm `@pdf-lib/fontkit` `dist/fontkit.es.min.js` | 1.1.1 |
| `pako.esm.js` | npm `pako` `dist/pako.esm.mjs` | 2.1.0 |

## 对 fontkit.es.min.js 的改动（两处）

**1. 把裸模块名 `pako` 改为相对路径 `./pako.esm.js`。**
原构建里有 `import e from "pako"`，浏览器和 Node 都无法解析裸模块名。
`pako.esm.js` 就是 pako 的官方 ESM 构建，原样下载，未做改动。

**2. 修正 `loca.preEncode`：始终使用长格式 loca。**

原实现（`loca` 表用于记录每个字形在 glyf 表中的偏移）：

```js
if (this.version == null) {
  this.version = this.offsets[this.offsets.length - 1] > 0xffff ? 1 : 0;  // 0 = 短格式
  if (this.version === 0) {
    for (let i = 0; i < this.offsets.length; i++) this.offsets[i] >>>= 1;  // 偏移除以 2
  }
}
```

短格式 loca 只能存偶数偏移（存的是「偏移 ÷ 2」）。而 `>>> 1` 是**无符号右移，
会直接丢掉奇数偏移的最后一位**——只要某个字形数据的长度是奇数，它自己和后面
所有字形的偏移就整体错位 1 字节，读出来的字形数据全乱，最终生成的 PDF 出现
随机缺字（有的字有、有的字没有，且与输入内容无关）。

字体本身并不保证字形数据长度为偶数，我们裁剪出来的宋体就有 3820 个奇数偏移，
所以这个 bug 一定会被触发。改为始终写长格式（每字形多 4 字节偏移，输出的 PDF
只大几百字节），偏移原样写入，问题消失。

相关的回归检查见 `tools/check-output.py`。

## 重新生成

```bash
npm pack pdf-lib@1.17.1 @pdf-lib/fontkit@1.1.1 pako@2.1.0
# 解包后取上述三个文件，再按本文件说明打两处补丁
```
