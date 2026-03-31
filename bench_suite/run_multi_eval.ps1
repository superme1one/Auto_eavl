<#
.SYNOPSIS
批量切换模型并顺序执行评测。

.DESCRIPTION
读取一个包含多个 model_ref 的批量配置文件，按顺序运行 gguf / safetensors / onnx 模型。
脚本同样会先映射 X:，确保 GGUF 模型在 Windows 中文路径下可正常运行。

.USAGE
在项目根目录执行：

powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\run_multi_eval.ps1 .\bench_suite\configs\model_batch_quick_all.json
#>

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspaceDir = Split-Path -Parent $scriptDir
$drive = "X:"

Push-Location $workspaceDir
try {
    try {
        cmd /c "subst $drive /D" | Out-Null
    } catch {
    }

    cmd /c "subst $drive ." | Out-Null
    if (-not (Test-Path "$drive\")) {
        throw "Failed to map $drive to current workspace"
    }

    $config = if ($args.Length -gt 0) { $args[0] } else { ".\bench_suite\configs\model_batch_quick_all.json" }
    Push-Location "$drive\"
    try {
        $env:BENCH_BASE_DIR = "$drive\"
        node .\bench_suite\run_multi_eval.js --config $config
    }
    finally {
        Pop-Location
        Remove-Item Env:BENCH_BASE_DIR -ErrorAction SilentlyContinue
    }
}
finally {
    Pop-Location
}
