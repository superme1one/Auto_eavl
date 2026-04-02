const fs = require("fs");
const path = require("path");

const { detectModelKind } = require("./model");

const DEFAULT_SCAN_ROOTS = ["models", "models_ascii"];

const DEFAULT_DATASETS = {
    gsm8k: {
        enabled: true,
        path: "data_sets/GSM8k/test.jsonl",
        limit: 100,
        cooldown_ms: 0,
        timeout_ms: 300000,
    },
    drop: {
        enabled: true,
        path: "data_sets/DROP/validation.jsonl",
        limit: 100,
        cooldown_ms: 0,
        timeout_ms: 300000,
    },
    mmlu: {
        enabled: true,
        path: "data_sets/MMLU",
        limit_per_subject: 2,
        max_samples: 100,
        cooldown_ms: 0,
        timeout_ms: 300000,
    },
    triviaqa: {
        enabled: true,
        path: "data_sets/TriviaQA/verified-web-dev.json",
        limit: 100,
        cooldown_ms: 0,
        timeout_ms: 120000,
    },
};

const DEFAULT_GENERATION = {
    max_tokens: 128,
    temperature: 0.0,
    top_p: 1.0,
    top_k: 1,
};

function sanitizeName(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function buildBackendDefaults(kind, port) {
    return {
        type: "auto",
        host: "127.0.0.1",
        port,
        llama_server_path: "llama.cpp/build-cpu/bin/Release/llama-server.exe",
        python_path: "python",
        ctx_size: kind === "onnx" ? 2048 : 4096,
        gpu_layers: 0,
        threads: 8,
        device: kind === "onnx" ? "cpu" : "auto",
        trust_remote_code: true,
    };
}

function isIgnoredEntry(name) {
    return name === ".gitkeep" || name.startsWith(".");
}

function tryDetectModel(modelPath) {
    try {
        const kind = detectModelKind(modelPath);
        return { ok: true, kind };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function discoverModelsInRoot(baseDir, rootName) {
    const rootPath = path.resolve(baseDir, rootName);
    if (!fs.existsSync(rootPath)) {
        return [];
    }

    return fs.readdirSync(rootPath, { withFileTypes: true })
        .filter(entry => !isIgnoredEntry(entry.name))
        .flatMap(entry => {
            const relativePath = path.join(rootName, entry.name);
            const absolutePath = path.resolve(baseDir, relativePath);
            const detected = tryDetectModel(absolutePath);
            if (!detected.ok) {
                return [];
            }

            const baseName = entry.isDirectory()
                ? entry.name
                : path.basename(entry.name, path.extname(entry.name));

            return [{
                source_root: rootName,
                source_priority: rootName === "models_ascii" ? 0 : 1,
                relative_path: relativePath.replace(/\\/g, "/"),
                absolute_path: absolutePath,
                base_name: baseName,
                kind: detected.kind,
            }];
        });
}

function buildDiscoveryKey(item) {
    return `${item.kind}:${sanitizeName(item.base_name)}`;
}

function discoverLocalModels(baseDir, scanRoots = DEFAULT_SCAN_ROOTS) {
    const discovered = scanRoots.flatMap(rootName => discoverModelsInRoot(baseDir, rootName));
    discovered.sort((left, right) => {
        if (left.source_priority !== right.source_priority) {
            return left.source_priority - right.source_priority;
        }
        return left.relative_path.localeCompare(right.relative_path);
    });

    const deduped = new Map();
    for (const item of discovered) {
        const key = buildDiscoveryKey(item);
        if (!deduped.has(key)) {
            deduped.set(key, item);
        }
    }

    return Array.from(deduped.values());
}

function buildAutoDiscoverRunConfigs(baseDir, options = {}) {
    const scanRoots = Array.isArray(options.scanRoots) && options.scanRoots.length > 0
        ? options.scanRoots
        : DEFAULT_SCAN_ROOTS;
    const batchName = options.batchName || "auto_discover_all_models";
    const models = discoverLocalModels(baseDir, scanRoots);
    const usedRefs = new Set();

    const runConfigs = models.map((model, index) => {
        const baseRef = `auto_${sanitizeName(model.base_name)}_${model.kind}`;
        let modelRef = baseRef;
        let suffix = 2;
        while (usedRefs.has(modelRef)) {
            modelRef = `${baseRef}_${suffix++}`;
        }
        usedRefs.add(modelRef);

        return {
            batch_order: index + 1,
            model_ref: modelRef,
            run_name: `${batchName}_${sanitizeName(model.base_name)}_${model.kind}`,
            model: {
                path: model.relative_path,
                backend: buildBackendDefaults(model.kind, 19000 + index),
                generation: { ...DEFAULT_GENERATION },
            },
            datasets: JSON.parse(JSON.stringify(DEFAULT_DATASETS)),
            auto_discovered: true,
            discovered_from: model.source_root,
            discovered_kind: model.kind,
        };
    });

    return {
        batch_name: batchName,
        mode: "auto_discover",
        dataset_policy: {
            description: "default auto-discover profile: 100 questions per dataset, about 400 questions total, with fast generation settings",
            gsm8k_limit: 100,
            drop_limit: 100,
            mmlu_max_samples: 100,
            triviaqa_limit: 100,
            cooldown_ms: 0,
            max_tokens: 128,
        },
        scan_roots: scanRoots,
        discovered_models: models.map(model => ({
            source_root: model.source_root,
            relative_path: model.relative_path,
            kind: model.kind,
        })),
        run_configs: runConfigs,
    };
}

module.exports = {
    DEFAULT_DATASETS,
    DEFAULT_SCAN_ROOTS,
    buildAutoDiscoverRunConfigs,
    discoverLocalModels,
};
