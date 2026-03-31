<#
.SYNOPSIS
Bench Suite environment check script.

.DESCRIPTION
Checks whether the local environment is ready to run bench_suite:
- Node.js and npm
- Python and optional .venv
- required Python packages
- dataset paths
- model paths
- llama.cpp CPU runtime
- ONNX standard directory health

.USAGE
Run from the project root:

powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\check_env.ps1

Check the exit code if you need CI-style pass/fail behavior:

powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\check_env.ps1
echo $LASTEXITCODE
#>

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspaceDir = Split-Path -Parent $scriptDir
$venvDir = Join-Path $workspaceDir ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$failures = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

function Test-Step {
    param(
        [string]$Name,
        [scriptblock]$Check
    )

    try {
        & $Check
        Write-Host "[OK]  $Name"
    }
    catch {
        $msg = "$Name :: $($_.Exception.Message)"
        $failures.Add($msg)
        Write-Host "[ERR] $msg" -ForegroundColor Red
    }
}

function Require-Path {
    param([string]$PathValue)
    if (-not (Test-Path $PathValue)) {
        throw "Missing path: $PathValue"
    }
}

function Warn-Step {
    param([string]$Message)
    $warnings.Add($Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Get-PreferredPython {
    if (Test-Path $venvPython) {
        return $venvPython
    }
    return "python"
}

function Show-OnnxFixHelp {
    $onnxSource = ".\models\qwen2.5-0.5B-Instructl_int8.onnx"
    $tokenizerSource = ".\models\Qwen2.5-0.5B-Instruct"
    $onnxTargetDir = ".\models\Qwen2.5-0.5B-Instruct-ONNX"

    Write-Host ""
    Write-Host "[HINT] ONNX standard directory is missing or incomplete." -ForegroundColor Yellow
    Write-Host "[HINT] Expected directory: $onnxTargetDir" -ForegroundColor Yellow
    Write-Host "[HINT] Required source files:" -ForegroundColor Yellow
    Write-Host "       $onnxSource" -ForegroundColor Yellow
    Write-Host "       $tokenizerSource" -ForegroundColor Yellow
    Write-Host "[HINT] To auto-fix it, run:" -ForegroundColor Yellow
    Write-Host "       powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\install.ps1" -ForegroundColor Yellow
}

Push-Location $workspaceDir
try {
    $pythonCmd = Get-PreferredPython

    Write-Host "== Bench Suite Environment Check =="
    Write-Host "Workspace: $workspaceDir"
    Write-Host "Python:    $pythonCmd"
    Write-Host ""

    Test-Step "Node.js available" {
        $null = Get-Command node -ErrorAction Stop
    }

    Test-Step "npm available" {
        $null = Get-Command npm -ErrorAction Stop
    }

    Test-Step "Python available" {
        if ($pythonCmd -eq "python") {
            $null = Get-Command python -ErrorAction Stop
        }
        else {
            Require-Path $pythonCmd
        }
    }

    if (Test-Path $venvDir) {
        Write-Host "[OK]  .venv exists"
    }
    else {
        Warn-Step ".venv not found. bench_suite can still use system Python, but running install.ps1 is recommended."
    }

    $pythonModules = @(
        "transformers",
        "torch",
        "onnx",
        "onnxruntime",
        "optimum.onnxruntime",
        "safetensors"
    )

    foreach ($module in $pythonModules) {
        Test-Step "Python module: $module" {
            & $pythonCmd -c "import importlib; importlib.import_module('$module'); print('ok')" | Out-Null
        }
    }

    $requiredPaths = @(
        ".\bench_suite",
        ".\bench_suite\configs",
        ".\bench_suite\backends",
        ".\bench_suite\lib",
        ".\data_sets",
        ".\models",
        ".\llama.cpp\build-cpu\bin\Release\llama-server.exe"
    )

    foreach ($pathValue in $requiredPaths) {
        Test-Step "Path exists: $pathValue" {
            Require-Path $pathValue
        }
    }

    $datasetPaths = @(
        ".\data_sets\GSM8k\test.jsonl",
        ".\data_sets\DROP\validation.jsonl",
        ".\data_sets\MMLU",
        ".\data_sets\TriviaQA\verified-web-dev.json"
    )

    foreach ($pathValue in $datasetPaths) {
        Test-Step "Dataset path: $pathValue" {
            Require-Path $pathValue
        }
    }

    Test-Step "Model registry exists" {
        Require-Path ".\bench_suite\model_registry.json"
    }

    if (Test-Path ".\bench_suite\model_registry.json") {
        $registry = Get-Content ".\bench_suite\model_registry.json" -Raw | ConvertFrom-Json
        foreach ($entry in $registry.PSObject.Properties) {
            $modelRef = $entry.Name
            $modelPath = Join-Path $workspaceDir $entry.Value.path
            Test-Step "Model path: $modelRef" {
                Require-Path $modelPath
            }
        }
    }

    $onnxDir = ".\models\Qwen2.5-0.5B-Instruct-ONNX"
    $onnxFiles = @(
        ".\models\Qwen2.5-0.5B-Instruct-ONNX\config.json",
        ".\models\Qwen2.5-0.5B-Instruct-ONNX\tokenizer.json",
        ".\models\Qwen2.5-0.5B-Instruct-ONNX\model_int8.onnx"
    )

    Test-Step "ONNX standard directory exists" {
        Require-Path $onnxDir
    }

    foreach ($pathValue in $onnxFiles) {
        Test-Step "ONNX file: $pathValue" {
            Require-Path $pathValue
        }
    }

    Write-Host ""
    if ($failures.Count -eq 0) {
        if ($warnings.Count -gt 0) {
            Write-Host "Environment check passed with warning(s)." -ForegroundColor Yellow
            $warnings | ForEach-Object { Write-Host " - $_" -ForegroundColor Yellow }
        }
        else {
        Write-Host "Environment check passed." -ForegroundColor Green
        }
        exit 0
    }

    Write-Host "Environment check failed with $($failures.Count) issue(s)." -ForegroundColor Red
    $failures | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }

    $onnxMissing = $failures | Where-Object { $_ -like "*ONNX*" -or $_ -like "*qwen_0_5b_onnx*" }
    if ($onnxMissing.Count -gt 0) {
        Show-OnnxFixHelp
    }

    exit 1
}
finally {
    Pop-Location
}
