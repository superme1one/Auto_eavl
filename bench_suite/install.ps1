<#
.SYNOPSIS
Bench Suite unified install script.

.DESCRIPTION
This script prepares a local Python virtual environment, installs the Python
dependencies required by bench_suite, checks optional Node.js dependencies,
and prepares the local ONNX model directory when the source ONNX file and
tokenizer files are available.

.USAGE
Run from the project root:

powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\install.ps1

Recommended next step:

powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\check_env.ps1
#>

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspaceDir = Split-Path -Parent $scriptDir
$venvDir = Join-Path $workspaceDir ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$venvPip = Join-Path $venvDir "Scripts\pip.exe"

function Run-Step {
    param(
        [string]$Name,
        [scriptblock]$Action
    )

    Write-Host "[STEP] $Name"
    & $Action
}

function Get-InstallableNodeProjects {
    $candidates = @(
        $workspaceDir,
        (Join-Path $workspaceDir "bench_suite")
    )

    $results = @()
    foreach ($dir in $candidates) {
        $packageJson = Join-Path $dir "package.json"
        if (Test-Path $packageJson) {
            $results += $dir
        }
    }
    return $results
}

function Show-OnnxFixHelp {
    param(
        [string]$OnnxSource,
        [string]$TokenizerSource,
        [string]$OnnxTargetDir
    )

    Write-Host "[INFO] ONNX standard directory was not prepared." -ForegroundColor Yellow
    Write-Host "[INFO] Expected target directory: $OnnxTargetDir" -ForegroundColor Yellow
    Write-Host "[INFO] To repair it, make sure these paths exist:" -ForegroundColor Yellow
    Write-Host "       $OnnxSource" -ForegroundColor Yellow
    Write-Host "       $TokenizerSource" -ForegroundColor Yellow
    Write-Host "[INFO] Then rerun:" -ForegroundColor Yellow
    Write-Host "       powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\install.ps1" -ForegroundColor Yellow
}

Push-Location $workspaceDir
try {
    Run-Step "Check system Python" {
        $null = Get-Command python -ErrorAction Stop
        python --version
    }

    Run-Step "Check Node.js" {
        $null = Get-Command node -ErrorAction Stop
        node --version
    }

    Run-Step "Check npm" {
        $null = Get-Command npm -ErrorAction Stop
        npm --version
    }

    if (-not (Test-Path $venvPython)) {
        Run-Step "Create .venv" {
            python -m venv $venvDir
        }
    }
    else {
        Write-Host "[STEP] Create .venv"
        Write-Host "[SKIP] .venv already exists at $venvDir"
    }

    Run-Step "Upgrade pip in .venv" {
        & $venvPython -m pip install --upgrade pip
    }

    Run-Step "Install Python packages into .venv" {
        & $venvPython -m pip install transformers torch safetensors onnx onnxruntime optimum "optimum[onnxruntime]"
    }

    $nodeProjects = Get-InstallableNodeProjects
    if ($nodeProjects.Count -gt 0) {
        foreach ($projectDir in $nodeProjects) {
            Run-Step "Install Node.js dependencies in $projectDir" {
                Push-Location $projectDir
                try {
                    npm install
                }
                finally {
                    Pop-Location
                }
            }
        }
    }
    else {
        Write-Host "[STEP] Install Node.js dependencies"
        Write-Host "[SKIP] No package.json found in project root or bench_suite."
    }

    $onnxSource = ".\models\qwen2.5-0.5B-Instructl_int8.onnx"
    $tokenizerSource = ".\models\Qwen2.5-0.5B-Instruct"
    $onnxTargetDir = ".\models\Qwen2.5-0.5B-Instruct-ONNX"

    if ((Test-Path $onnxSource) -and (Test-Path $tokenizerSource)) {
        Run-Step "Prepare ONNX model directory" {
            New-Item -ItemType Directory -Force -Path $onnxTargetDir | Out-Null
            Copy-Item "$tokenizerSource\config.json" $onnxTargetDir -Force
            Copy-Item "$tokenizerSource\generation_config.json" $onnxTargetDir -Force
            Copy-Item "$tokenizerSource\tokenizer.json" $onnxTargetDir -Force
            Copy-Item "$tokenizerSource\tokenizer_config.json" $onnxTargetDir -Force
            Copy-Item "$tokenizerSource\merges.txt" $onnxTargetDir -Force
            Copy-Item "$tokenizerSource\vocab.json" $onnxTargetDir -Force

            $targetOnnx = "$onnxTargetDir\model_int8.onnx"
            if (Test-Path $targetOnnx) {
                Remove-Item $targetOnnx -Force
            }
            cmd /c "mklink /H `"$targetOnnx`" `"$onnxSource`"" | Out-Null
        }
    }
    else {
        Write-Host "[STEP] Prepare ONNX model directory"
        Show-OnnxFixHelp -OnnxSource $onnxSource -TokenizerSource $tokenizerSource -OnnxTargetDir $onnxTargetDir
    }

    Write-Host ""
    Write-Host "Install finished." -ForegroundColor Green
    Write-Host "Python venv: $venvDir"
    Write-Host "Next step:"
    Write-Host "powershell -NoProfile -ExecutionPolicy Bypass -File .\bench_suite\check_env.ps1"
}
finally {
    Pop-Location
}
