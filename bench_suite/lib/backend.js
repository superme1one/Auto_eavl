const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const { getJson, postJson } = require("./http");
const { detectModelKind, pickModelFile } = require("./model");
const { resolveFrom, sleep } = require("./utils");

function hasNonAscii(value) {
    return /[^\x00-\x7F]/.test(String(value || ""));
}

class LocalBackend {
    constructor(options) {
        this.options = options;
        this.process = null;
        this.kind = null;
        this.baseUrl = null;
    }

    async start() {
        const modelKind = this.options.type === "auto"
            ? detectModelKind(this.options.modelPath)
            : this.options.type;

        this.kind = modelKind;
        this.baseUrl = `http://${this.options.host}:${this.options.port}`;

        if (modelKind === "gguf") {
            await this.startLlamaServer();
        } else if (modelKind === "onnx") {
            await this.startOnnxServer();
        } else if (modelKind === "safetensors") {
            await this.startHfServer();
        } else {
            throw new Error(`Unsupported backend type: ${modelKind}`);
        }

        await this.waitForHealth();
    }

    async startLlamaServer() {
        const llamaServerPath = resolveFrom(this.options.baseDir, this.options.llamaServerPath);
        if (!fs.existsSync(llamaServerPath)) {
            throw new Error(`llama-server.exe not found: ${llamaServerPath}`);
        }

        const modelFile = pickModelFile(this.options.modelPath, ".gguf");
        if (process.platform === "win32" && hasNonAscii(modelFile)) {
            throw new Error(
                `GGUF model path contains non-ASCII characters on Windows: ${modelFile}\n` +
                "Please run GGUF evaluation via bench_suite/run_gguf_eval.ps1 so the workspace is mapped to X:.",
            );
        }
        const args = [
            "-m", modelFile,
            "--host", this.options.host,
            "--port", String(this.options.port),
            "-c", String(this.options.ctxSize || 4096),
            "--threads", String(this.options.threads || 8),
        ];

        if (typeof this.options.gpuLayers === "number" && this.options.gpuLayers > 0) {
            args.push("-ngl", String(this.options.gpuLayers));
        }

        this.process = spawn(llamaServerPath, args, {
            cwd: path.dirname(llamaServerPath),
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });

        this.attachLogs("llama");
    }

    async startHfServer() {
        const pythonPath = this.options.pythonPath || "python";
        const serverScript = path.resolve(this.options.baseDir, "bench_suite", "backends", "hf_server.py");
        const modelRoot = fs.statSync(this.options.modelPath).isFile()
            ? path.dirname(this.options.modelPath)
            : this.options.modelPath;
        const args = [
            "-u",
            serverScript,
            "--model-path", modelRoot,
            "--host", this.options.host,
            "--port", String(this.options.port),
            "--device", this.options.device || "auto",
        ];
        if (this.options.trustRemoteCode) {
            args.push("--trust-remote-code");
        }

        this.process = spawn(pythonPath, args, {
            cwd: this.options.baseDir,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });

        this.attachLogs("hf");
    }

    async startOnnxServer() {
        const pythonPath = this.options.pythonPath || "python";
        const serverScript = path.resolve(this.options.baseDir, "bench_suite", "backends", "onnx_server.py");
        const modelStat = fs.statSync(this.options.modelPath);
        const modelRoot = modelStat.isFile()
            ? path.dirname(this.options.modelPath)
            : this.options.modelPath;
        const modelFile = modelStat.isFile()
            ? path.basename(this.options.modelPath)
            : pickModelFile(this.options.modelPath, ".onnx");
        const args = [
            "-u",
            serverScript,
            "--model-path", modelRoot,
            "--model-file", path.basename(modelFile),
            "--host", this.options.host,
            "--port", String(this.options.port),
            "--device", this.options.device || "auto",
        ];
        if (this.options.trustRemoteCode) {
            args.push("--trust-remote-code");
        }

        this.process = spawn(pythonPath, args, {
            cwd: this.options.baseDir,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });

        this.attachLogs("onnx");
    }

    attachLogs(prefix) {
        if (!this.process) return;
        this.process.stdout.on("data", chunk => {
            process.stdout.write(`[${prefix}] ${chunk}`);
        });
        this.process.stderr.on("data", chunk => {
            process.stderr.write(`[${prefix}:err] ${chunk}`);
        });
    }

    async waitForHealth() {
        let lastError = null;
        for (let i = 0; i < 120; i++) {
            try {
                await getJson(`${this.baseUrl}/health`, 2000);
                return;
            } catch (error) {
                lastError = error;
                if (this.process && this.process.exitCode !== null) {
                    const code = this.process.exitCode;
                    if (code === 3221225781) {
                        throw new Error("Backend exited early with code 3221225781 (0xC0000135). This usually means a missing DLL/runtime dependency.");
                    }
                    throw new Error(`Backend exited early with code ${code}`);
                }
                await sleep(1000);
            }
        }
        throw new Error(`Backend health check failed: ${lastError ? lastError.message : "unknown error"}`);
    }

    async generate(prompt, generation, timeoutMs) {
        if (this.kind === "gguf") {
            const data = await postJson(`${this.baseUrl}/completion`, {
                prompt,
                n_predict: generation.max_tokens,
                temperature: generation.temperature,
                top_p: generation.top_p,
                top_k: generation.top_k,
                stop: [],
            }, timeoutMs);
            return data.content || "";
        }

        const data = await postJson(`${this.baseUrl}/chat`, {
            prompt,
            max_tokens: generation.max_tokens,
            temperature: generation.temperature,
            top_p: generation.top_p,
            top_k: generation.top_k,
        }, timeoutMs);
        return data.response || "";
    }

    async stop() {
        if (!this.process || this.process.exitCode !== null) return;
        this.process.kill();
        await sleep(1000);
        if (this.process.exitCode === null) {
            this.process.kill("SIGKILL");
        }
    }
}

module.exports = {
    LocalBackend,
};
