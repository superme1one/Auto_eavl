<#
.SYNOPSIS
自动扫描 models / models_ascii 下的所有模型并执行全数据集评测。

.DESCRIPTION
默认将自动执行结果写入项目根目录的 result/ 目录。

.USAGE
powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\run_auto_eval.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\run_auto_eval.ps1 --dry-run
#>

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspaceDir = Split-Path -Parent $scriptDir
$runner = Join-Path $scriptDir "run_multi_eval.ps1"
$resultDir = Join-Path $workspaceDir "result"

New-Item -ItemType Directory -Path $resultDir -Force | Out-Null
$env:BENCH_OUTPUT_ROOT = $resultDir

try {
    powershell -NoProfile -ExecutionPolicy Bypass -File $runner --auto-discover @args
}
finally {
    Remove-Item Env:BENCH_OUTPUT_ROOT -ErrorAction SilentlyContinue
}
