<#
.SYNOPSIS
使用 GGUF 后端运行单个评测配置。

.DESCRIPTION
自动将当前项目根目录映射到 X:，避免 Windows 中文路径导致 llama.cpp 无法打开 GGUF 模型。

.USAGE
在项目根目录执行：

powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\run_gguf_eval.ps1 .\bench_suite\configs\qwen_0_5b_gguf_quick_all.json
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

    $config = if ($args.Length -gt 0) { $args[0] } else { ".\bench_suite\configs\qwen_0_5b_gguf_smoke.json" }
    Push-Location "$drive\"
    try {
        $env:BENCH_BASE_DIR = "$drive\"
        node .\bench_suite\run_eval.js --config $config
    }
    finally {
        Pop-Location
        Remove-Item Env:BENCH_BASE_DIR -ErrorAction SilentlyContinue
    }
}
finally {
    Pop-Location
}
