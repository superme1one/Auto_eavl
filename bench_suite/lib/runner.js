const fs = require("fs");
const path = require("path");

const { LocalBackend } = require("./backend");
const { datasets } = require("./datasets");
const { appendJsonl, ensureDir, nowStamp, resolveFrom, safeDivide, sleep, writeJson } = require("./utils");

function csvEscape(value) {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, "\"\"")}"`;
    }
    return text;
}

function writeCsv(filePath, rows) {
    const content = rows.map(row => row.map(csvEscape).join(",")).join("\n") + "\n";
    fs.writeFileSync(filePath, content);
}

function appendCsvRow(filePath, header, row) {
    const exists = fs.existsSync(filePath);
    const lines = [];
    if (!exists) {
        lines.push(header.map(csvEscape).join(","));
    }
    lines.push(row.map(csvEscape).join(","));
    fs.appendFileSync(filePath, lines.join("\n") + "\n");
}

function resolveOutputRoot(baseDir) {
    const override = process.env.BENCH_OUTPUT_ROOT;
    if (!override) {
        return path.resolve(baseDir, "bench_suite", "outputs");
    }
    return path.isAbsolute(override) ? override : path.resolve(baseDir, override);
}

const LEADERBOARD_HEADER = [
    "run_name",
    "finished_at",
    "model_path",
    "backend_type",
    "total_questions",
    "total_correct",
    "weighted_accuracy",
    "avg_latency_ms",
    "gsm8k_accuracy",
    "gsm8k_correct",
    "gsm8k_total",
    "drop_accuracy",
    "drop_correct",
    "drop_total",
    "mmlu_accuracy",
    "mmlu_correct",
    "mmlu_total",
    "triviaqa_accuracy",
    "triviaqa_correct",
    "triviaqa_total",
];

function buildLeaderboardRow(summary) {
    const datasetEntries = Object.entries(summary.datasets);
    const totalQuestions = datasetEntries.reduce((acc, [, stats]) => acc + (stats.total || 0), 0);
    const totalCorrect = datasetEntries.reduce((acc, [, stats]) => acc + (stats.correct || 0), 0);
    const weightedAccuracy = Number((safeDivide(totalCorrect, totalQuestions) * 100).toFixed(2));
    const avgLatencyMs = Number((safeDivide(
        datasetEntries.reduce((acc, [, stats]) => acc + ((stats.avg_latency_ms || 0) * (stats.total || 0)), 0),
        totalQuestions,
    )).toFixed(2));

    const rowObject = {
        run_name: summary.run_name,
        finished_at: summary.finished_at,
        model_path: summary.model.path,
        backend_type: summary.model.backend_type,
        total_questions: totalQuestions,
        total_correct: totalCorrect,
        weighted_accuracy: weightedAccuracy,
        avg_latency_ms: avgLatencyMs,
    };

    for (const [name, stats] of datasetEntries) {
        rowObject[`${name}_accuracy`] = stats.accuracy ?? "";
        rowObject[`${name}_correct`] = stats.correct ?? "";
        rowObject[`${name}_total`] = stats.total ?? "";
    }

    return rowObject;
}

function writeLeaderboards(baseDir, outputDir, summary) {
    const rowObject = buildLeaderboardRow(summary);
    const header = LEADERBOARD_HEADER;
    const row = header.map(key => rowObject[key] ?? "");
    const outputRoot = resolveOutputRoot(baseDir);

    writeCsv(path.join(outputDir, "leaderboard.csv"), [header, row]);
    appendCsvRow(path.join(outputRoot, "leaderboard.csv"), header, row);
}

async function runSingleDataset(name, adapter, backend, generation, datasetConfig, outputDir) {
    const resultFile = path.join(outputDir, `${name}.jsonl`);
    fs.writeFileSync(resultFile, "");

    const samples = adapter.load(datasetConfig.path, datasetConfig);
    const records = [];
    let correct = 0;
    let valid = 0;
    let totalLatencyMs = 0;

    console.log(`\n[RUN] ${name} | samples=${samples.length}`);

    for (let i = 0; i < samples.length; i++) {
        const sample = samples[i];
        const prompt = adapter.buildPrompt(sample);
        const startedAt = Date.now();

        let output = "";
        let errorMsg = null;
        try {
            output = await backend.generate(prompt, generation, datasetConfig.timeoutMs);
        } catch (error) {
            errorMsg = error.message;
        }

        const latencyMs = Date.now() - startedAt;
        totalLatencyMs += latencyMs;

        let evalResult = { ok: false, prediction: "", gold: "" };
        if (!errorMsg) {
            evalResult = adapter.evaluate(sample, output);
            valid += 1;
            if (evalResult.ok) correct += 1;
        }

        const record = {
            id: sample.id,
            dataset: name,
            ...(sample.subject ? { subject: sample.subject } : {}),
            prompt: sample.question || sample.prompt || "",
            output,
            prediction: evalResult.prediction,
            gold: evalResult.gold,
            ok: evalResult.ok,
            latency_ms: latencyMs,
            ...(errorMsg ? { error: errorMsg } : {}),
        };
        records.push(record);
        appendJsonl(resultFile, record);

        const acc = (safeDivide(correct, i + 1) * 100).toFixed(2);
        console.log(`[${name}] ${i + 1}/${samples.length} | ${evalResult.ok ? "OK" : (errorMsg ? "ERR" : "FAIL")} | acc=${acc}% | latency=${(latencyMs / 1000).toFixed(2)}s`);

        if (i < samples.length - 1 && datasetConfig.cooldownMs > 0) {
            await sleep(datasetConfig.cooldownMs);
        }
    }

    const summary = {
        dataset: name,
        total: samples.length,
        valid,
        correct,
        accuracy: Number((safeDivide(correct, samples.length) * 100).toFixed(2)),
        avg_latency_ms: Number((safeDivide(totalLatencyMs, samples.length)).toFixed(2)),
    };

    if (typeof adapter.finalize === "function") {
        Object.assign(summary, adapter.finalize(records));
    }

    return summary;
}

async function runAll(config, baseDir) {
    const runName = config.run_name || `run_${nowStamp()}`;
    const outputDir = path.resolve(resolveOutputRoot(baseDir), runName);
    ensureDir(outputDir);

    const backendConfig = config.model.backend;
    const modelPath = resolveFrom(baseDir, config.model.path);
    const backend = new LocalBackend({
        baseDir,
        type: backendConfig.type || "auto",
        modelPath,
        host: backendConfig.host || "127.0.0.1",
        port: backendConfig.port || 18000,
        llamaServerPath: backendConfig.llama_server_path,
        pythonPath: backendConfig.python_path || "python",
        ctxSize: backendConfig.ctx_size || 4096,
        gpuLayers: backendConfig.gpu_layers,
        threads: backendConfig.threads || 8,
        device: backendConfig.device || "auto",
        trustRemoteCode: !!backendConfig.trust_remote_code,
    });

    const startedAt = new Date().toISOString();
    const generation = config.model.generation;
    const datasetSummaries = {};

    await backend.start();
    try {
        for (const [name, rawCfg] of Object.entries(config.datasets)) {
            if (!rawCfg || !rawCfg.enabled) continue;
            const adapter = datasets[name];
            if (!adapter) {
                throw new Error(`Dataset adapter not found: ${name}`);
            }

            const datasetConfig = {
                path: resolveFrom(baseDir, rawCfg.path),
                limit: rawCfg.limit || 0,
                limitPerSubject: rawCfg.limit_per_subject || 0,
                maxSamples: rawCfg.max_samples || 0,
                cooldownMs: rawCfg.cooldown_ms || 0,
                timeoutMs: rawCfg.timeout_ms || 300000,
            };
            datasetSummaries[name] = await runSingleDataset(name, adapter, backend, generation, datasetConfig, outputDir);
        }
    } finally {
        await backend.stop();
    }

    const summary = {
        run_name: runName,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        model: {
            path: modelPath,
            backend_type: backend.kind,
        },
        generation,
        datasets: datasetSummaries,
    };

    writeJson(path.join(outputDir, "summary.json"), summary);
    writeLeaderboards(baseDir, outputDir, summary);
    return { outputDir, summary };
}

module.exports = {
    buildLeaderboardRow,
    LEADERBOARD_HEADER,
    resolveOutputRoot,
    runAll,
    writeCsv,
};
