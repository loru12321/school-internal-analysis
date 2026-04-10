# 校内分析

这是一个独立于桌面 `system` 仓库的新项目，只借鉴原系统的分析口径，不修改原系统代码。

## 目标

- 只服务一个学校
- 保留学生成绩分析、班级比较、教师同学科比较、两率一分综合指数
- 去掉乡镇学校横向对比与“考务工具”等模块
- 把考试数据与学校配置同步到 Cloudflare D1

## 当前功能

- 导入成绩文件：支持 `.xlsx` 与 `.csv`
- 导入任课文件：按“班级 + 学科 + 教师”建立任课映射
- 导回 JSON 备份：可把系统导出的考试 JSON 重新恢复到本地
- 学生分析：总分、年级排名、班级排名、优势学科、临界提醒
- 班级比较：平均分、优秀率、及格率、低分率、综合指数
- 教师比较：同学科内按任课班级汇总比较
- 云端同步：通过 Cloudflare Worker + D1 读写考试数据

## 本地运行

```bash
npm install
npm run verify
npm run dev
```

本地开发时，若未额外设置 `VITE_API_BASE`，前端会直接请求已部署的 Cloudflare Worker，方便直接调试云端接口。

## 打包

```bash
npm run build
```

## Cloudflare

1. 创建 D1 数据库

```bash
npx wrangler d1 create school-internal-analysis-db
```

2. 把返回的 `database_id` 写入 `wrangler.jsonc`

3. 初始化表结构

```bash
npx wrangler d1 execute school-internal-analysis-db --remote --file cloudflare/d1/001_init.sql
```

4. 部署

```bash
npm run build
npm run cf:deploy
```

## 导入模板

成绩模板示例：

```text
姓名,班级,学号,语文,数学,英语,物理,化学,总分
张三,1班,20260101,98,102,94,68,61,423
```

任课模板示例：

```text
班级,学科,教师
1班,语文,李老师
1班,数学,王老师
```

## 说明

- 旧式 `.xls` 建议先另存为 `.xlsx` 后再导入
- 所有本地考试默认先保存在浏览器本地存储
- 云端同步是增量的，不会影响原桌面 `system` 项目
