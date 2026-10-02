/**
 * 请假申请表模板中各个填写位置的坐标（PDF 用户坐标系，原点在左下角，单位 pt）。
 *
 * 数据来源：模板 assets/template.pdf（暨南大学学生请假申请表202504.pdf）实测
 *   - 页面尺寸 595.3 x 841.9（A4）
 *   - 下划线（"_"字符）的起止 x、基线 y 均取自 PDF 内容流中字符的 origin，
 *     未使用估算值，因此在任意阅读器中位置一致。
 */

export const FONT_SIZE = 10.5; // 默认字号：10.5pt（五号）

/** 第 1 页（申请表）的基线 y —— pdf_y = 841.9 - 基线(自上而下) */
export const P1 = {
  studentIdRow: 602.45, // 1.学号 / 2.姓名 / 3.学生类别
  collegeRow: 582.41, // 4.学院 / 5.专业
  contactRow: 562.49, // 6.手机 / 电邮
  periodRow: 542.45, // 7.请假时间
  reasonTypeRow: 502.49, // 请假原因勾选框
};

/** 第 1 页各填空横线的 x 区间 */
export const P1X = {
  name: [293.52, 379.01],
  college: [95.52, 244.01],
  major: [293.52, 473.56],
  phone: [217.08, 347.57],
  email: [379.08, 554.57],
  // 7.请假时间：自 __年 __月 __日至 __年 __月 __日，共 __天
  startYear: [122.52, 154.02],
  startMonth: [163.08, 194.58],
  startDay: [203.52, 235.02],
  endYear: [257.52, 289.02],
  endMonth: [298.08, 329.58],
  endDay: [338.52, 370.02],
  totalDays: [397.08, 428.58],
};

/** 3.学生类别 与 请假原因 的勾选框（方括号内的空格区域，x 为括号内空白的中心） */
export const BOX = {
  categoryDomestic: 462.27, // “[ ] 内招生”
  categoryOverseas: 511.83, // “[ ] 外招生”
  reasonHealth: 66.27, // “[ ] 因健康原因请假”
  reasonOther: 232.83, // “[ ] 其他，请详细说明”
};

/** 1.学号 的 10 个方格 */
export const ID_CELLS = {
  left: 99.5,
  right: 244.0, // 等分 10 格
  count: 10,
  top: 615.05, // pdf_y
  bottom: 600.65, // pdf_y
};

/** 第 2 页（附件·准假条存根）两组相同表格的基线 y */
export const P2 = [
  { collegeRow: 683.81, studentRow: 660.41, periodRow: 637.01 }, // 学院存档
  { collegeRow: 277.13, studentRow: 253.73, periodRow: 230.33 }, // 学生存
];

/** 第 2 页各填空横线的 x 区间 */
export const P2X = {
  college: [155.52, 323.52],
  major: [347.52, 515.52],
  name: [83.52, 227.52],
  studentId: [262.56, 406.56],
  totalDays: [453.6, 543.6],
  startYear: [83.52, 125.52],
  startMonth: [137.52, 173.52],
  startDay: [185.52, 221.52],
  endYear: [251.52, 293.52],
  endMonth: [305.52, 341.52],
  endDay: [353.52, 389.52],
};
