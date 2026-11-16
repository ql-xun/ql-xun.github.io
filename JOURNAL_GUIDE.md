# 期刊观察 / Journal Explorer

当前仅在本地分支 `local/journal-explorer` 测试。获得正式同意前，不要推送此分支、创建发布 PR 或部署期刊工具。线上个人主页不包含此工具。

工具保留期刊资料库与特刊追踪。资料库按学会切换，显示主编、CCF、IF、投稿篇幅和最近完整年度的 OpenAlex 收录量。悬停、聚焦或轻点数字可看年度趋势；当前年份标为「年内」。特刊追踪仍是默认视图，从 `society=computer` 或 `society=other` 可直达另外两组；原投稿主题、截止日期和客座编辑不变。

## 本地预览与验证

在仓库根目录执行：

```sh
python -m pip install -r scripts/requirements-journals.txt
python -B scripts/check_site_contract.py
python -B scripts/refresh_journals.py --validate
python -B -m unittest discover -s scripts -p 'test_journal*.py'
python -B -m unittest discover -s scripts -p test_preview.py
node --test scripts/test_journal_model.mjs
python -B scripts/serve_site.py 8775
```

打开 `http://127.0.0.1:8775/tools/journals/?lang=zh`。用 `view=library` 直达资料库，用 `librarySociety=comsoc|computer|acm|other` 指定资料库学会。预览仅监听本机；服务运行时，网页文件保存后会自动刷新。

## 维护期刊与数据

- **新增期刊**：在 `tools/journals/registry.json` 增加一条记录。用稳定的短 ID，填官方刊名、简称、ISSN、分类、出版方、官网、主题标签和核查日期。可以从现有 TCOM 条目复制字段结构。CCF 需记录目录版本和出处；若未核实请省略，不写成 C。投稿要求、费用和周期使用 `details` 中的 `value`、`url`、`checked_at`，费用有明确年份时填 `year`。
- **维护主编**：在期刊的 `editor_in_chief` 下填写 `name`、`source`；上任日期用 `since` 和 `since_source`，保留来源给出的年、年月或年月日。联合主编使用 `co_editors` 数组，分别记录来源和上任时间；有明确生效日的继任者写入 `next`，到该日期切换。
- **维护 IF 与篇幅**：`impact_factor` 记录公开的 JIF 数值、来源、核查日期和已知的指标年份；不要使用 CiteScore 或把旧刊名的 IF 当成现刊指标。用 `details.length` 的 `initial`（和有独立上限时的 `revised`）记录中英文短语及同一个指南来源。区别初稿、修回、收费门槛与出版篇幅；学会通则要注明口径。
- **仅更新期刊资料**：编辑登记表后运行 `python -B scripts/refresh_journals.py --metadata-only`。只更新当前本地快照里的期刊资料，不访问 CFP／OpenAlex，不改写其数据或原快照日期。
- **人工修正**：`tools/journals/overrides.json` 的 `journals` 按期刊 ID 补充内容；`calls` 按快照中已存在的特刊 ID 修正字段，例如客座编辑、预计出版时间或截止日期。使用 ISO 日期 `YYYY-MM-DD`，补日期时将 `status` 一并改为 `dated`。修正后在界面复核。已修正值优先于采集；原始记录仍保留。
- **新增来源**：只填审核过的官方 CFP 入口。适配器覆盖 ComSoc 表格与 TNET 专题、Computer Society（TDSC、TAFFC、TETC）、SPS（TSP、JSTSP）、IoTJ、VTS 和 SCIS。Computer Society 以各专题详情页为准；SCIS 只从英文刊的征稿栏目读取 PDF，不读取已出版专题。TVT 与 SCIS 需要 `pdftotext`。新页面布局请在 `scripts/journal_cfp.py` 增加适配器及测试。
- **更新统计**：使用 OpenAlex 的主发表来源、出版年份、article 与 review；每年独立记录数据源。TNET 2024 年及以前使用前身 ISSN。匿名 API 可用；若有额度限制，可在仓库 Actions Secrets 可选配置 `OPENALEX_API_KEY`。不要把密钥放入前端或 JSON。

## 将来获准发布后：自动更新与排障

本地分支保留的 GitHub Pages 工作流原计划按北京时间每日约 08:17 更新 CFP，周日重抓最近五个完整年份及本年统计。线上当前未启用期刊定时采集。正式发布前需重新核对首发快照与部署流程。

本地可查看采集脚本输出及快照的 `cfp_sources` 和 `detail_stale` 字段；将来发布后，也可在 Actions 日志查看失败原因。遇到限流、访问失败或网页改版，旧数据仍保留。找不到有效线上快照时发布停止；经核对后可用最近一次成功运行的 `journal-data-<run ID>` 产物恢复。产物还包含不带收件地址的邮件预览。

需要独立测试一次刷新时，用非生产输出路径和已验证的旧快照，例如：

```sh
python -B scripts/refresh_journals.py --full --previous-file tools/journals/snapshot.json --output .journal-check/snapshot.json --digest .journal-check/email-preview.txt
```

## 将来启用邮件

目前只生成预览，工作流没有配置发送步骤。以后确定服务商后，给 `scripts/journal_digest.py` 的 `deliver()` 接入 SMTP 或 API 适配器；收件人和凭据通过 GitHub Secrets 输入，发件开关默认关闭。上线前在测试邮箱验证同一事件不会重复发送，且发送失败不会误记为已送达。不要把真实地址、密钥或 SMTP 口令写入仓库或预览。
