# Auto_eval

`Auto_eval` 是一个面向 Windows 端的本地大模型自动化评测项目，用于统一管理本地模型、启动后端服务、执行多数据集评测，并输出结构化结果与排行榜。

当前项目已经支持：

- `gguf`
- `safetensors`
- `onnx`

项目可以按统一配置完成模型自动识别、自动部署和统一评测，并支持单模型评测与批量模型评测两种工作方式。
在当前版本中，也支持直接自动扫描 `models/` 和 `models_ascii/` 目录，对发现到的全部模型执行统一评测，无需再手工维护模型列表。

## 项目结构

```txt
auto_eval/
├─ bench_suite/     # 评测脚本、配置、后端适配、输出目录
├─ data_sets/       # 数据集目录，仅保留目录结构，不提交数据文件
├─ models/          # 模型目录，仅保留目录结构，不提交模型文件
├─ models_ascii/    # ASCII 安全模型目录，仅保留目录结构，不提交模型文件
├─ llama.cpp/       # llama.cpp 源码或依赖目录
└─ README.md
```

## 目录说明

### `bench_suite/`

核心评测目录，包含：

- 单模型评测入口 `run_eval.js`
- 批量评测入口 `run_multi_eval.js`
- GGUF 包装脚本 `run_gguf_eval.ps1`
- 批量运行包装脚本 `run_multi_eval.ps1`
- 模型注册表 `model_registry.json`
- 配置样例与预置配置

更详细的使用说明见：

[bench_suite/README.md](bench_suite/README.md)

### `models/`

用于存放本地模型文件，例如：

- Hugging Face 模型目录
- ONNX 模型目录
- 其他本地模型资源

当前仓库只保留目录结构，不提交实际模型文件。

### `models_ascii/`

用于存放 ASCII 路径安全的模型文件，主要是给 Windows 下的 GGUF 运行准备。  
原因是 `llama.cpp` 在 Windows 环境中读取 GGUF 时，可能无法正确处理包含中文等非 ASCII 字符的路径。

因此有两种常见做法：

- 把 GGUF 模型放到 ASCII 路径目录中，例如 `models_ascii/`
- 通过 PowerShell 包装脚本把工作目录映射到 `X:` 再运行

当前仓库只保留目录结构，不提交实际模型文件。

### `data_sets/`

用于存放评测数据集，例如：

- `GSM8k`
- `DROP`
- `MMLU`
- `TriviaQA`

当前仓库只保留目录结构，不提交数据集文件。

### `llama.cpp/`

用于放置 `llama.cpp` 相关源码或依赖，供 GGUF 模型评测使用。

## 功能概览

- 支持单模型评测
- 支持批量切换模型评测
- 支持自动扫描模型目录并批量评测全部模型
- 支持 `backend.type = "auto"` 自动识别模型类型
- 支持统一配置运行全部数据集
- 支持批量任务失败不中断后续模型
- 支持批量任务总汇总输出

## 使用入口

常用入口如下：

- `bench_suite/run_eval.js`
- `bench_suite/run_multi_eval.js`
- `bench_suite/run_gguf_eval.ps1`
- `bench_suite/run_multi_eval.ps1`

如果是 GGUF 且路径中包含中文，推荐使用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\run_gguf_eval.ps1 .\bench_suite\run_config.local.json
```

如果是批量评测，推荐使用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\run_multi_eval.ps1 .\bench_suite\configs\model_batch_quick_all.json
```

如果希望直接扫描本地模型目录并一键评测全部模型，推荐使用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\run_auto_eval.ps1
```

## Git 提交说明

为避免仓库体积过大，当前 `.gitignore` 已配置为：

- 保留 `models/`、`models_ascii/`、`data_sets/`、`bench_suite/outputs/` 的目录结构
- 忽略这些目录中的实际模型文件、数据文件和输出结果
- 保留必要的 `.gitkeep` 文件，便于在 GitHub 上展示目录层级

如果后续你想改成“部分示例数据也一起提交”，可以再单独调整 `.gitignore` 规则。
