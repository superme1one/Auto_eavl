# Bench Suite 说明

`bench_suite` 是一个面向 Windows 端的本地大模型评测脚本集，支持对单个模型或一批模型执行统一评测。当前已经支持 `gguf`、`safetensors`、`onnx` 三类模型的自动识别、自动部署与统一评测，并可按统一配置一键跑通 `gsm8k`、`drop`、`mmlu`、`triviaqa` 等数据集。

## 当前能力

- 支持单模型评测
- 支持批量切换 `model_ref` 顺序评测
- 支持自动扫描 `models / models_ascii` 并批量评测全部模型
- 支持通过 `bench_suite/model_registry.json` 统一管理模型定义
- 支持 `backend.type = "auto"` 自动识别 `gguf / safetensors / onnx`
- 单次 run 会输出 `summary.json` 和 `leaderboard.csv`
- 批量 run 会输出 `batch_summary.json` 和 `batch_leaderboard.csv`
- 批量执行过程中会持续刷新总报告，不需要等整批结束
- 批量任务中单模型失败不会中断后续模型
- 失败模型也会在自己的输出目录中写出 `summary.json`

## 为什么推荐用 PowerShell 包装脚本

在 Windows 上，`llama.cpp` 读取 GGUF 时可能受到非 ASCII 路径影响。当前仓库通过把工作目录映射到 `X:` 的方式规避这个问题。

因此推荐：

- 跑 GGUF 时优先使用 `run_gguf_eval.ps1`
- 跑批量任务时优先使用 `run_multi_eval.ps1`

这两个脚本都会先映射 `X:`，再从映射后的路径启动 Node 脚本。

## 环境准备

先检查环境：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\check_env.ps1
```

如需安装依赖并准备 ONNX 目录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\install.ps1
```

`install.ps1` 会完成以下操作：

- 创建 `.venv`
- 安装 Python 依赖
- 检查 Node.js 与 npm
- 当存在 `package.json` 时执行 `npm install`
- 当 ONNX 文件和 tokenizer 已准备好时整理 `models/Qwen2.5-0.5B-Instruct-ONNX`

## 单模型评测

### 使用自定义配置

复制一份示例配置：

```powershell
Copy-Item .\bench_suite\run_config.example.json .\bench_suite\run_config.local.json
```

常改字段：

- `run_name`：本次输出目录名
- `model_ref`：引用 `model_registry.json` 中的模型
- `model`：直接写模型路径和后端参数
- `datasets`：控制要跑哪些数据集及其样本数、超时、冷却时间

运行方式：

```powershell
node .\bench_suite\run_eval.js --config .\bench_suite\run_config.local.json
```

请在项目根目录执行，不要在 `bench_suite` 子目录执行。

### 使用仓库内置配置

```powershell
node .\bench_suite\run_eval.js --config .\bench_suite\configs\qwen_0_5b_gguf_smoke.json
node .\bench_suite\run_eval.js --config .\bench_suite\configs\qwen_0_5b_gguf_gsm8k_one.json
node .\bench_suite\run_eval.js --config .\bench_suite\configs\qwen_0_5b_gguf_quick_all.json
node .\bench_suite\run_eval.js --config .\bench_suite\configs\qwen_0_5b_safetensors_gsm8k_one.json
node .\bench_suite\run_eval.js --config .\bench_suite\configs\qwen_0_5b_safetensors_all.json
node .\bench_suite\run_eval.js --config .\bench_suite\configs\qwen_0_5b_onnx_gsm8k_one.json
node .\bench_suite\run_eval.js --config .\bench_suite\configs\qwen_0_5b_onnx_quick_all.json
```

### GGUF 推荐跑法

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\run_gguf_eval.ps1 .\bench_suite\configs\qwen_0_5b_gguf_gsm8k_one.json
```

如果项目路径或模型路径包含中文等非 ASCII 字符，不要直接用 `node .\bench_suite\run_eval.js` 跑 GGUF；请使用上面的 PowerShell 包装脚本。

跑一个四数据集的小样本组合：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\run_gguf_eval.ps1 .\bench_suite\configs\qwen_0_5b_gguf_quick_all.json
```

## 批量评测

批量评测会按 `model_refs` 的顺序逐个跑模型。推荐直接使用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\run_multi_eval.ps1 .\bench_suite\configs\model_batch_quick_all.json
```

或者直接调用 Node：

```powershell
node .\bench_suite\run_multi_eval.js --config .\bench_suite\configs\model_batch_quick_all.json
```

更小的批量示例：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\run_multi_eval.ps1 .\bench_suite\configs\model_batch_gsm8k_one.json
```

### 自动扫描模型目录并批量评测

如果你不想手动维护 `model_ref` 或批量配置，可以直接自动扫描 `models/` 和 `models_ascii/` 下的模型：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\run_auto_eval.ps1
```

这个入口会：

- 自动扫描 `models/` 与 `models_ascii/`
- 自动识别 `gguf / safetensors / onnx`
- 自动生成批量任务
- 自动运行全部已支持数据集
- 自动输出批量汇总

如果你只想先确认会扫描到哪些模型，不真正开始评测，可以先执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\run_auto_eval.ps1 --dry-run
```

也可以直接调用 Node 入口：

```powershell
node .\bench_suite\run_multi_eval.js --auto-discover
node .\bench_suite\run_multi_eval.js --auto-discover --dry-run
```

### 批量配置字段

批量配置示例见：

- `bench_suite/configs/model_batch_quick_all.json`
- `bench_suite/configs/model_batch_gsm8k_one.json`

常用字段：

- `batch_name`：本次批量任务名称
- `model_refs`：按顺序执行的模型列表
- `model_registry_path`：可选，自定义模型注册表路径
- `model`：所有模型共享的默认模型配置
- `datasets`：所有模型共享的数据集配置
- `per_model`：给某个 `model_ref` 做额外覆盖

`per_model` 可覆盖：

- `run_name`
- `model`
- `datasets`

同一批次内 `run_name` 必须唯一，否则脚本会直接报错，避免不同模型写到同一个输出目录。

### 批量异常处理

批量任务中如果某个模型失败：

- 会记录失败原因和堆栈
- 会继续执行后续模型
- 会在该模型自己的输出目录写出失败版 `summary.json`
- 会在 `batch_summary.json` 和 `batch_leaderboard.csv` 中标记为 `failed`
- 整批结束后若存在失败模型，进程会返回非零退出码，便于脚本或 CI 感知异常

### 批量总报告

批量执行开始后，会立即创建：

```txt
bench_suite/outputs/<batch_name>/batch_summary.json
bench_suite/outputs/<batch_name>/batch_leaderboard.csv
```

并在每个模型完成后刷新一次，因此即使中途中断，也能保留当前批次的阶段性结果。

`batch_summary.json` 重点字段包括：

- `batch_status`：`running`、`completed`、`completed_with_failures`
- `started_at`
- `finished_at`
- `last_updated_at`
- `duration_ms`
- `totals.completed_models`
- `totals.pending_models`
- `totals.succeeded_models`
- `totals.failed_models`
- `results[]`：每个模型的详细结果

`results[]` 中常见字段：

- `batch_order`
- `model_ref`
- `run_name`
- `status`
- `started_at`
- `finished_at`
- `duration_ms`
- `output_dir`
- `summary_file`
- `leaderboard_file`
- `enabled_datasets`
- `error`

`batch_leaderboard.csv` 会把成功模型按综合准确率优先排序，失败模型排在后面，方便直接横向比较。

## 模型注册表

模型定义集中放在：

```txt
bench_suite/model_registry.json
```

当前仓库里已有：

- `qwen_0_5b_gguf_cpu`
- `qwen_0_5b_safetensors`
- `qwen_0_5b_onnx`

如果你想在多个配置之间切换模型，优先改这里；这样单模型配置和批量配置都能复用同一份模型定义。

## 输出结果

### 单次 run 输出

每次单独评测会写到：

```txt
bench_suite/outputs/<run_name>/
```

通常包含：

- `<dataset>.jsonl`
- `summary.json`
- `leaderboard.csv`

此外，所有成功 run 还会追加到：

```txt
bench_suite/outputs/leaderboard.csv
```

### 批量 run 输出

批量任务的总目录：

```txt
bench_suite/outputs/<batch_name>/
```

其中包含：

- `batch_summary.json`
- `batch_leaderboard.csv`
- `discovered_models.json`：自动扫描模式下记录本次发现到的模型列表

每个模型自己的详细结果仍会写到：

```txt
bench_suite/outputs/<run_name>/
```

默认情况下，`run_name` 为：

```txt
<batch_name>_<model_ref>
```

如果模型成功，该目录下会有正常评测结果；如果模型失败，该目录下至少会保留一份失败版 `summary.json`，用于回看异常。

## 使用建议

- `model_ref` 和 `model` 二选一即可；若同时提供，会在注册表模型定义基础上合并覆盖
- `backend.type = "auto"` 会根据模型路径自动判断后端类型
- `mmlu` 会输出统一的 `mmlu.jsonl`，并在 `summary.json` 中带各 subject 的统计
- 建议优先使用小样本配置验证环境，再切换到完整数据集
- 如果批量任务异常，优先查看：

```txt
bench_suite/outputs/<batch_name>/batch_summary.json
bench_suite/outputs/<run_name>/summary.json
```

## 相关脚本

- `bench_suite/run_eval.js`：单模型评测入口
- `bench_suite/run_multi_eval.js`：批量模型评测入口
- `bench_suite/run_gguf_eval.ps1`：GGUF 推荐入口
- `bench_suite/run_multi_eval.ps1`：批量评测推荐入口
- `bench_suite/run_auto_eval.ps1`：自动扫描模型目录并批量评测
- `bench_suite/check_env.ps1`：环境检查
- `bench_suite/install.ps1`：安装依赖与准备 ONNX 目录

## 备注

- 当前仓库里的 `jiuge_*` 脚本未改动
- 如果后续新增模型格式、数据集或批量汇总字段，建议同步更新本 README
