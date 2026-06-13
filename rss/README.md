# AI 日报 RSS 采集器

`rss/` 从 Linux.do「前沿快讯」RSS 2.0 源获取最近 24 小时内容，完成去重、AI 筛选和整理，最终生成项目根目录的 `data-scheme/data.json`。

## 修改或添加 RSS 源

- 修改当前 Linux.do RSS 地址、分页数量或翻页间隔：编辑 `linuxdo_adapter.go`。
- 添加新的 RSS 2.0 来源：新建类似 `example_adapter.go` 的来源适配器，并在 `main.go` 中接入抓取入口。
- 通用 RSS 2.0 XML 解析位于 `rss2.go`，添加来源时通常不需要修改。
- 不支持 RSS 1.0 或 Atom。

每个来源适配器负责定义 RSS 地址、分页方式，以及来源特有的条目转换规则。例如 `linuxdo_adapter.go` 会从 Linux.do 链接中提取 Topic ID。

## 目录说明

```text
rss/
├── main.go
├── config.go               # 配置文件：快照路径、数量与长度等固定配置
├── env.go                  # env加载
│
├── linuxdo_adapter.go      # Linux.do 专用适配器：RSS 地址、分页、Topic ID
├── rss2.go                 # 通用 RSS 2.0 下载、XML 解析和时间窗口过滤
├── rss2_clean_text.go      # 清洗 RSS 正文 HTML，生成供模型使用的纯文本
├── state.go                # 与上一次抓取快照比较，并覆盖 rss-state.json
│
├── model.go                # 调用 OpenAI 兼容模型接口
├── ranking.go              # 新闻兴趣评分和排除规则
├── grouping.go             # 合并相似新闻
├── story_tabs.go           # 为每个 Story 生成 Tabs 和字幕
├── prompts.go              # AI 提示词
├── vision.go               # 按需分析 RSS 正文中的远程图片
│
├── generate_datajson.go    # 生成项目 data-scheme/data.json
├── output.go               # 输出终端处理结果
├── types.go                # 共享数据结构
├── text.go                 # 通用文本截断工具
├── vpnproxy.go             # HTTP 客户端和代理检测
├── main_test.go            # 测试
├── rss-state.json          # 上一次完整抓取快照，运行后生成（gitignore）
└── README.md               # 当前说明
```

## 运行流程

```text
linuxdo_adapter.go
        ↓
rss2.go 抓取并解析 RSS 2.0
        ↓
state.go 与上一次快照去重
        ↓
ranking.go → grouping.go → story_tabs.go
        ↓
generate_datajson.go
        ↓
data-scheme/data.json
```

`story_tabs.go` 会在写入前校验 Tab 数量、来源证据、摘要与字幕质量。未达标的 Story 会按批次携带失败原因重试；重试没有提升时立即停止，最终仍不足才使用本地保底内容。

## 去重规则

`rss-state.json` 只保存上一次完整抓取快照，不累计历史。

例如上一次抓取为 `A1...A50`，本次为 `A40...B40`，本次只处理 `B1...B40`，然后将 `A40...B40` 保存为下一次比较快照。

快照只会在本次无需生成，或 `data.json` 成功写出后更新。若 AI 编排或写出失败，旧快照保持不变，下一次运行仍可重新处理这批内容。
