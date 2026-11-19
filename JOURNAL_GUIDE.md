# 期刊观察 / Journal Explorer

用户已于 2026-11-19 同意发布当前版本，使用现有 GitHub Pages 链路。后续修改仍先在本地预览；没有新的发布授权时不要自行推送或部署。

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
- **日期显示**：页面统一显示为 `YYYY-MM`；只有年份时按用户约定显示该年 `01` 月，月份未知时这不是已核实的任命月份。原始 `since` 不补写月份，交接判断仍使用原始生效日期。
- **维护 IF 与篇幅**：`impact_factor` 记录公开的 JIF 数值、来源、核查日期和已知的指标年份；不要使用 CiteScore 或把旧刊名的 IF 当成现刊指标。用 `details.length` 的 `initial`（和有独立上限时的 `revised`）记录中英文短语及同一个指南来源。区别初稿、修回、收费门槛与出版篇幅；学会通则要注明口径。
- **精简显示**：IF 在表格里只显示数值，年份与来源仍存入数据文件。篇幅显示层省略“双栏”“通常”“正文”，但保留单栏、行距、ACM 格式和参考文献计数等影响口径的信息。只有一条篇幅规则时不重复显示“初投”标签。指南未给出初投上限时，`length` 只记录核查说明、来源和日期，不写 `initial`；只有官网明确表示不限制时才能写“无页数／字数上限”。
- **仅更新期刊资料**：编辑登记表后运行 `python -B scripts/refresh_journals.py --metadata-only`。只更新当前本地快照里的期刊资料，不访问 CFP／OpenAlex，不改写其数据或原快照日期。
- **人工修正**：`tools/journals/overrides.json` 的 `journals` 按期刊 ID 补充内容；`calls` 按快照中已存在的特刊 ID 修正字段，例如客座编辑、预计出版时间或截止日期。使用 ISO 日期 `YYYY-MM-DD`，补日期时将 `status` 一并改为 `dated`。修正后在界面复核。已修正值优先于采集；原始记录仍保留。
- **新增来源**：只填审核过的官方 CFP 入口。适配器覆盖 ComSoc 表格与 TNET 专题、Computer Society（TDSC、TAFFC、TETC）、SPS（TSP、JSTSP）、IoTJ、VTS 和 SCIS。Computer Society 以各专题详情页为准；SCIS 只从英文刊的征稿栏目读取 PDF，不读取已出版专题。TVT 与 SCIS 需要 `pdftotext`。新页面布局请在 `scripts/journal_cfp.py` 增加适配器及测试。
- **更新统计**：使用 OpenAlex 的主发表来源、出版年份、article 与 review；每年独立记录数据源。TNET 2024 年及以前使用前身 ISSN。匿名 API 可用；若有额度限制，可在仓库 Actions Secrets 可选配置 `OPENALEX_API_KEY`。不要把密钥放入前端或 JSON。

## 自动更新与排障

### 分工与频率

| 内容 | 频率 | 维护方式 |
| --- | --- | --- |
| 特刊新增、延期、关闭、客座编辑 | 每日北京时间 08:00 | GitHub Actions 读取官方 CFP，验证后部署快照，保留历史及上次有效数据。 |
| 主编、任期、CCF、IF、投稿篇幅 | 每季度 | 用户调用 Agent 对照官网核查，审核差异后修改登记表，再执行 `--metadata-only`。 |
| OpenAlex 年度收录量 | 每季度 | 人工触发程序更新统计；检查当年数据、缺失值及更名映射。 |
| 样式或期刊增删 | 按需 | 用户提出修改，Agent 实现、运行测试并打开本地预览。 |

日常采集不需要每天调用 Agent 或保持本地电脑开机。程序负责重复、结构明确的工作；Agent 负责核查规则变化和处理页面改版。

GitHub Pages 工作流的 UTC cron 为 `0 0 * * *`。日常运行使用 `--cfp-only`，即使统计缺失或跨年也不会请求 OpenAlex；不会通过自动提交主分支触发部署。季度维护时在 Actions 手动运行并勾选 `refresh_statistics` 才刷新全部统计。主编、IF 和篇幅仍由人工核查登记表。

SI 栏目的「更新」取自快照 `cfp_checked_at`，统一显示北京时间。只有本轮所有已接入的官方征稿目录均成功读取时才推进该时间；部分来源失败则保留上次时间和有效记录。仅编辑期刊资料或刷新浏览器不会改变它。来源详细核查时间和错误状态仍保存在 `cfp_sources` 与 Actions 日志中。

GitHub 定时任务可能延迟，公开仓库连续 60 天无活动时可能停用，见[官方调度说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。

本地可查看采集脚本输出及快照的 `cfp_sources` 和 `detail_stale` 字段，也可在 Actions 日志查看失败原因。遇到限流、访问失败或网页改版，旧数据仍保留。找不到有效线上快照时发布停止；经核对后可用最近一次成功运行的 `journal-data-<run ID>` 产物恢复。产物还包含不带收件地址的邮件预览；网页工作流不发信。

需要独立测试一次刷新时，用非生产输出路径和已验证的旧快照，例如：

```sh
python -B scripts/refresh_journals.py --cfp-only --previous-file tools/journals/snapshot.json --output .journal-check/snapshot.json --digest .journal-check/email-preview.txt
```

## 独立的私人邮件提醒

私人提醒已单独部署到私有仓库 `journal-si-alerts`，不包含网站部署步骤。本人确认测试邮件收到后启用；每日北京时间 08:00 检查，只有实际特刊变化才发送，每日最多一封，不发送 14／7／1 天倒计时提醒。首次读取只建立基线。

发件方式为 Gmail SSL SMTP，收发件地址与应用专用密码仅保存在私库 Secrets，不写入公开仓库。仅发给本人，不开放公众订阅。私库变量 `ALERTS_ENABLED=true` 才允许定时发送，设为 `false` 可暂停发信而保留采集。维护与防重复恢复流程见私库 README。

本网站的 `scripts/journal_digest.py` 仍只生成不带收件地址的预览，没有 SMTP 凭据或真实发送步骤。不要把两套工作流接成重复发送渠道。
