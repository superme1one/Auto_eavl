<#
.SYNOPSIS
批量切换模型并顺序执行评测。

.DESCRIPTION
支持两种模式：
1. 传入批量配置文件；
2. 使用 --auto-discover 自动扫描 models / models_ascii 下的模型并批量评测。

脚本会先映射 X:，确保 GGUF 模型在 Windows 中文路径下也能正常运行。

.USAGE
powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\run_multi_eval.ps1 --config .\bench_suite\configs\model_batch_quick_all.json
powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\run_multi_eval.ps1 --auto-discover
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

    Push-Location "$drive\"
    try {
        $env:BENCH_BASE_DIR = "$drive\"
        $nodeArgs = @(".\bench_suite\run_multi_eval.js")
        if ($args.Length -gt 0) {
            $nodeArgs += $args
        }
        else {
            $nodeArgs += @("--config", ".\bench_suite\configs\model_batch_quick_all.json")
        }
        node @nodeArgs
    }
    finally {
        Pop-Location
        Remove-Item Env:BENCH_BASE_DIR -ErrorAction SilentlyContinue
    }
}
finally {
    Pop-Location
}
