# 期刊观察 / Journal Explorer

当前仅在本地分支 `local/journal-explorer` 测试。获得正式同意前，不要推送此分支、创建发布 PR 或部署期刊工具。线上个人主页不包含此工具。

四个视图分别用于查期刊、追踪特刊、对比数据和管理本地收藏。特刊页按学会、期刊、主题排列，保留官方 CFP 链接、截止日期、客座编辑；没有检索、日期筛选和日历导出。收藏及备注不会上传。

## 本地预览与验证

在仓库根目录执行：

```sh
python -m pip install -r scripts/requirements-journals.txt
python -B scripts/check_site_contract.py
python -B scripts/refresh_journals.py --validate
python -B -m unittest discover -s scripts -p 'test_journal*.py'
node --test scripts/test_journal_model.mjs
python scripts/serve_site.py 8080
```

打开 `http://127.0.0.1:8080/tools/journals/`，可加 `?lang=zh` 或 `?lang=en`。

## 维护期刊与数据

- **新增期刊**：在 `tools/journals/registry.json` 增加一条记录。用稳定的短 ID，填官方刊名、简称、ISSN、分类、出版方、官网、主题标签和核查日期。可以从现有 TCOM 条目复制字段结构。CCF 需记录目录版本和出处；若未核实请省略，不写成 C。投稿要求、费用和周期使用 `details` 中的 `value`、`url`、`checked_at`，费用有明确年份时填 `year`。
- **人工修正**：`tools/journals/overrides.json` 的 `journals` 按期刊 ID 补充内容；`calls` 按快照中已存在的特刊 ID 修正字段，例如客座编辑、预计出版时间或截止日期。使用 ISO 日期 `YYYY-MM-DD`，补日期时将 `status` 一并改为 `dated`。修正后在界面复核。已修正值优先于采集；原始记录仍保留。
- **新增来源**：只填审核过的官方 CFP 入口。已有适配器包括 ComSoc 表格、Computer Society（TDSC）、SPS（JSTSP）、IoTJ 和 VTS（TVT）。不同页面结构需先在 `scripts/journal_cfp.py` 增加适配器和测试。TVT 官方 PDF 使用 `pdftotext`；未明确标注的日期留空。
- **更新统计**：使用 OpenAlex 的主发表来源、出版年份、article 与 review；每年独立记录数据源。ToN 2024 年及以前使用前身 ISSN。匿名 API 可用；若有额度限制，可在仓库 Actions Secrets 可选配置 `OPENALEX_API_KEY`。不要把密钥放入前端或 JSON。

## 将来获准发布后：自动更新与排障

本地分支保留的 GitHub Pages 工作流原计划按北京时间每日约 08:17 更新 CFP，周日重抓最近五个完整年份及本年统计。线上当前未启用期刊定时采集。正式发布前需重新核对首发快照与部署流程。

特刊页在相应期刊标题下注明来源更新失败；本地可查看采集脚本输出。重新发布后，可在 Actions 日志查看各来源失败原因。遇到限流、访问失败或网页改版，旧数据仍保留。找不到有效线上快照时发布停止；经核对后可用最近一次成功运行的 `journal-data-<run ID>` 产物恢复，不要用空文件替代。产物还包含不带收件地址的邮件预览。

需要独立测试一次刷新时，用非生产输出路径和已验证的旧快照，例如：

```sh
python -B scripts/refresh_journals.py --full --previous-file tools/journals/snapshot.json --output .journal-check/snapshot.json --digest .journal-check/email-preview.txt
```

## 将来启用邮件

目前只生成预览，工作流没有配置发送步骤。以后确定服务商后，给 `scripts/journal_digest.py` 的 `deliver()` 接入 SMTP 或 API 适配器；收件人和凭据通过 GitHub Secrets 输入，发件开关默认关闭。上线前在测试邮箱验证同一事件不会重复发送，且发送失败不会误记为已送达。不要把真实地址、密钥或 SMTP 口令写入仓库或预览。
