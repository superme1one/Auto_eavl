# 自动执行说明

本文档单独说明如何使用项目中的“自动扫描模型目录并一键评测”功能。

## 功能说明

该功能会自动扫描项目根目录下的：

- `models/`
- `models_ascii/`

并自动完成以下流程：

- 识别模型类型
- 识别 `gguf`、`safetensors`、`onnx`
- 自动生成批量评测任务
- 自动顺序部署并运行所有已发现模型
- 自动执行四个默认评测数据集
- 默认每个数据集只跑 100 题
- 单模型默认总题量控制在约 400 题
- 自动输出批量汇总结果

使用这个功能时，不需要手动编辑 `model_registry.json`，也不需要手动写一份批量配置文件。

## 推荐命令

在项目根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\run_auto_eval.ps1
```

这是推荐入口，适合 Windows 环境，尤其适合包含 GGUF 模型的情况。

执行该命令后，结果会默认保存到项目根目录的：

我现在还想加一个需求，现在是用powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\run_auto_eval.ps1每个数据集只跑100题，我想再来一个run_auto_eval_all的，可以跑所有数据集的所有题
还有模型目录，现在是几个模型运行跑，怎么有五个，以及每个模型是如何启动
```txt
result/
```

## 执行前建议

建议先确认以下目录中已经放好了需要评测的模型：

- `models/`
- `models_ascii/`

例如：

- `models/Qwen2.5-0.5B-Instruct`
- `models/Qwen2.5-0.5B-Instruct-ONNX`
- `models_ascii/qwen_0_5b_q4_k_m.gguf`

同时建议先确认数据集目录已准备好：

- `data_sets/GSM8k`
- `data_sets/DROP`
- `data_sets/MMLU`
- `data_sets/TriviaQA`

## 先查看会扫描到哪些模型

如果你想先确认会扫描到哪些模型，而不立即开始评测，可以先执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\run_auto_eval.ps1 --dry-run
```

这个命令会输出本次扫描到的模型列表，并写出发现结果文件。
即使是 `--dry-run`，也会在 `result/` 下写出扫描结果，方便你确认本次会跑哪些模型。

## 可选命令

### 直接调用 Node 入口

```powershell
node .\bench_suite\run_multi_eval.js --auto-discover
```

如果只是做扫描预览：

```powershell
node .\bench_suite\run_multi_eval.js --auto-discover --dry-run
```

### 自定义批次名称

```powershell
node .\bench_suite\run_multi_eval.js --auto-discover --batch-name my_auto_batch
```

### 只扫描指定目录

只扫描 `models/`：

```powershell
node .\bench_suite\run_multi_eval.js --auto-discover --scan-root models
```

只扫描 `models_ascii/`：

```powershell
node .\bench_suite\run_multi_eval.js --auto-discover --scan-root models_ascii
```

## 默认行为

自动执行模式下，系统会：

- 默认扫描 `models/` 和 `models_ascii/`
- 自动按发现顺序生成批量任务
- 自动为每个模型分配运行端口
- 自动运行四个默认评测数据集
- 默认每个数据集限制为 100 题
- 单模型默认总题量约 400 题
- 自动写出单模型结果和批量总报告
- 自动把结果写到根目录 `result/`

当前默认题量策略如下：

- `gsm8k`：100 题
- `drop`：100 题
- `mmlu`：100 题
- `triviaqa`：100 题

## 输出位置

自动执行任务的输出会写到：

```txt
result/<batch_name>/
```

其中常见文件包括：

- `batch_summary.json`
- `batch_leaderboard.csv`
- `discovered_models.json`

每个模型自己的详细结果仍会写到：

```txt
result/<run_name>/
```

此外，`result/` 根目录下还会有一份总表：

```txt
result/leaderboard.csv
```

## 常见说明

### 1. 为什么推荐用 PowerShell 入口

如果目录路径中包含中文，而模型里有 GGUF，直接用 Node 启动可能会因为 Windows 下的路径编码问题导致 `llama.cpp` 无法打开模型。

因此推荐优先使用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\run_auto_eval.ps1
```

### 2. 自动执行会不会因为某个模型失败就中断

不会。

当前批量逻辑已经支持：

- 单模型失败后继续跑后续模型
- 记录失败原因
- 输出失败模型的 `summary.json`
- 在批量汇总里标记失败状态

### 3. 自动执行会不会上传或改写模型文件

不会。

该功能只会读取模型目录并执行评测，不会修改模型文件本身。

## 推荐使用流程

建议按下面顺序使用：

1. 把要评测的模型放入 `models/` 或 `models_ascii/`
2. 确认 `data_sets/` 中的数据集已准备好
3. 先运行 `--dry-run` 检查自动发现结果
4. 再运行正式命令启动批量评测
5. 查看 `result/` 下的 `batch_summary.json` 和 `batch_leaderboard.csv`

## 相关文件

- `bench_suite/run_auto_eval.ps1`
- `bench_suite/run_multi_eval.ps1`
- `bench_suite/run_multi_eval.js`
- `bench_suite/lib/discovery.js`
- `bench_suite/README.md`
