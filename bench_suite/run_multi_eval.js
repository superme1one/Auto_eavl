const path = require("path");

const { buildAutoDiscoverRunConfigs, DEFAULT_SCAN_ROOTS } = require("./lib/discovery");
const { buildLeaderboardRow, LEADERBOARD_HEADER, resolveOutputRoot, runAll, writeCsv } = require("./lib/runner");
const { ensureDir, readJson, writeJson } = require("./lib/utils");

const BATCH_LEADERBOARD_HEADER = [
    "rank",
    "batch_order",
    "model_ref",
    "run_name",
    "status",
    "started_at",
    "duration_ms",
    "output_dir",
    "summary_file",
    "leaderboard_file",
    ...LEADERBOARD_HEADER.filter(key => key !== "run_name"),
    "error",
];

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const token = argv[i];
        if (token === "--config") {
            args.config = argv[++i];
        } else if (token === "--auto-discover") {
            args.autoDiscover = true;
        } else if (token === "--batch-name") {
            args.batchName = argv[++i];
        } else if (token === "--scan-root") {
            args.scanRoots = args.scanRoots || [];
            args.scanRoots.push(argv[++i]);
        } else if (token === "--dry-run") {
            args.dryRun = true;
        }
    }
    return args;
}

function isPlainObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(baseValue, overrideValue) {
    if (!isPlainObject(baseValue) || !isPlainObject(overrideValue)) {
        return overrideValue === undefined ? baseValue : overrideValue;
    }

    const result = { ...baseValue };
    for (const [key, value] of Object.entries(overrideValue)) {
        result[key] = deepMerge(baseValue[key], value);
    }
    return result;
}

function resolveModelConfig(config, baseDir) {
    if (!config.model_ref) {
        if (!config.model) {
            throw new Error("Config must provide either model_ref or model");
        }
        return config;
    }

    const registryPath = config.model_registry_path
        ? (path.isAbsolute(config.model_registry_path) ? config.model_registry_path : path.resolve(baseDir, config.model_registry_path))
        : path.resolve(baseDir, "bench_suite", "model_registry.json");
    const registry = readJson(registryPath);
    const registryModel = registry[config.model_ref];
    if (!registryModel) {
        throw new Error(`model_ref not found in registry: ${config.model_ref}`);
    }

    return {
        ...config,
        model: deepMerge(registryModel, config.model || {}),
    };
}

function sanitizeName(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function formatError(error) {
    if (!error) {
        return { message: "Unknown error", stack: "" };
    }
    return {
        message: error.message || String(error),
        stack: error.stack || String(error),
    };
}

function listEnabledDatasets(datasetsConfig) {
    if (!isPlainObject(datasetsConfig)) {
        return [];
    }
    return Object.entries(datasetsConfig)
        .filter(([, config]) => !!(config && config.enabled))
        .map(([name]) => name);
}

function buildRunConfigs(batchConfig) {
    if (Array.isArray(batchConfig.run_configs) && batchConfig.run_configs.length > 0) {
        return batchConfig.run_configs.map((config, index) => ({
            batch_order: config.batch_order || index + 1,
            ...config,
        }));
    }

    return batchConfig.model_refs.map((modelRef, index) => {
        const perModel = (batchConfig.per_model && batchConfig.per_model[modelRef]) || {};
        return {
            batch_order: index + 1,
            model_ref: modelRef,
            run_name: perModel.run_name || `${batchConfig.batch_name || "multi_eval"}_${sanitizeName(modelRef)}`,
            model_registry_path: batchConfig.model_registry_path,
            model: deepMerge(batchConfig.model || {}, perModel.model || {}),
            datasets: deepMerge(batchConfig.datasets || {}, perModel.datasets || {}),
        };
    });
}

function validateBatchConfig(batchConfig, runConfigs) {
    if (!Array.isArray(runConfigs) || runConfigs.length === 0) {
        throw new Error("No runnable models found for this batch task");
    }

    if (batchConfig.per_model !== undefined && !isPlainObject(batchConfig.per_model)) {
        throw new Error("Batch config field per_model must be an object when provided");
    }

    const duplicateRunNames = runConfigs
        .map(config => config.run_name)
        .filter((name, index, all) => all.indexOf(name) !== index);
    if (duplicateRunNames.length > 0) {
        throw new Error(`Duplicate run_name detected in batch config: ${Array.from(new Set(duplicateRunNames)).join(", ")}`);
    }
}

function compareBatchResults(left, right) {
    const leftSuccess = left.status === "success";
    const rightSuccess = right.status === "success";
    if (leftSuccess !== rightSuccess) {
        return leftSuccess ? -1 : 1;
    }

    if (leftSuccess && rightSuccess) {
        const leftAccuracy = Number(left.leaderboard?.weighted_accuracy ?? -1);
        const rightAccuracy = Number(right.leaderboard?.weighted_accuracy ?? -1);
        if (leftAccuracy !== rightAccuracy) {
            return rightAccuracy - leftAccuracy;
        }

        const leftLatency = Number(left.leaderboard?.avg_latency_ms ?? Number.MAX_SAFE_INTEGER);
        const rightLatency = Number(right.leaderboard?.avg_latency_ms ?? Number.MAX_SAFE_INTEGER);
        if (leftLatency !== rightLatency) {
            return leftLatency - rightLatency;
        }
    }

    return left.batch_order - right.batch_order;
}

function buildBatchRow(result, rankMap) {
    const baseRow = result.leaderboard || {};
    const rowObject = {
        rank: rankMap.get(result.run_name) || "",
        batch_order: result.batch_order,
        model_ref: result.model_ref,
        run_name: result.run_name,
        status: result.status,
        started_at: result.started_at || "",
        finished_at: result.finished_at || "",
        duration_ms: result.duration_ms ?? "",
        output_dir: result.output_dir || "",
        summary_file: result.summary_file || "",
        leaderboard_file: result.leaderboard_file || "",
        ...baseRow,
        error: result.error ? result.error.message : "",
    };
    return rowObject;
}

function buildBatchLeaderboardRows(results) {
    const sortedResults = [...results].sort(compareBatchResults);
    const rankMap = new Map();
    let currentRank = 1;
    for (const result of sortedResults) {
        if (result.status !== "success") {
            continue;
        }
        rankMap.set(result.run_name, currentRank++);
    }

    return sortedResults.map(result => {
        const rowObject = buildBatchRow(result, rankMap);
        return BATCH_LEADERBOARD_HEADER.map(key => rowObject[key] ?? "");
    });
}

function buildBatchSummary(batchName, configPath, batchOutputDir, startedAt, totalModels, results) {
    const completedModels = results.length;
    const failedModels = results.filter(result => result.status === "failed").length;
    const succeededModels = results.filter(result => result.status === "success").length;
    const nowIso = new Date().toISOString();

    return {
        batch_name: batchName,
        batch_status: completedModels === 0
            ? "running"
            : (completedModels < totalModels
                ? "running"
                : (failedModels > 0 ? "completed_with_failures" : "completed")),
        config_path: configPath,
        output_dir: batchOutputDir,
        started_at: startedAt,
        finished_at: completedModels === totalModels ? nowIso : null,
        last_updated_at: nowIso,
        duration_ms: Date.now() - Date.parse(startedAt),
        totals: {
            total_models: totalModels,
            completed_models: completedModels,
            pending_models: totalModels - completedModels,
            succeeded_models: succeededModels,
            failed_models: failedModels,
        },
        results,
    };
}

function writeBatchArtifacts(batchOutputDir, batchSummary) {
    const rows = buildBatchLeaderboardRows(batchSummary.results);
    writeJson(path.join(batchOutputDir, "batch_summary.json"), batchSummary);
    writeCsv(path.join(batchOutputDir, "batch_leaderboard.csv"), [BATCH_LEADERBOARD_HEADER, ...rows]);
}

function writeFailedRunSummary(outputDir, payload) {
    ensureDir(outputDir);
    const summaryPath = path.join(outputDir, "summary.json");
    writeJson(summaryPath, payload);
    return summaryPath;
}

async function main() {
    const args = parseArgs(process.argv);
    if (!args.config && !args.autoDiscover) {
        console.error("Usage: node bench_suite/run_multi_eval.js --config <config.json>");
        console.error("   or: node bench_suite/run_multi_eval.js --auto-discover [--batch-name <name>] [--scan-root <dir>] [--dry-run]");
        process.exit(1);
    }

    const baseDir = process.env.BENCH_BASE_DIR
        ? path.resolve(process.env.BENCH_BASE_DIR)
        : process.cwd();

    const batchConfig = args.autoDiscover
        ? buildAutoDiscoverRunConfigs(baseDir, {
            batchName: args.batchName,
            scanRoots: args.scanRoots,
        })
        : readJson(path.isAbsolute(args.config) ? args.config : path.resolve(baseDir, args.config));

    const configPath = args.autoDiscover
        ? `[auto-discover roots=${(args.scanRoots && args.scanRoots.length > 0 ? args.scanRoots : DEFAULT_SCAN_ROOTS).join(",")}]`
        : (path.isAbsolute(args.config) ? args.config : path.resolve(baseDir, args.config));

    const batchName = batchConfig.batch_name || (args.autoDiscover ? "auto_discover_all_models" : "multi_eval");
    const batchOutputDir = path.resolve(resolveOutputRoot(baseDir), batchName);
    ensureDir(batchOutputDir);

    const runConfigs = buildRunConfigs(batchConfig);
    validateBatchConfig(batchConfig, runConfigs);

    if (args.autoDiscover) {
        const discoveryPayload = {
            batch_name: batchName,
            mode: "auto_discover",
            scan_roots: batchConfig.scan_roots,
            discovered_models: batchConfig.discovered_models,
            total_models: runConfigs.length,
        };
        writeJson(path.join(batchOutputDir, "discovered_models.json"), discoveryPayload);
        console.log(`[AUTO DISCOVER] roots=${batchConfig.scan_roots.join(", ")}`);
        console.log(`[AUTO DISCOVER] models=${runConfigs.length}`);
        for (const runConfig of runConfigs) {
            console.log(`  - ${runConfig.model_ref} | path=${runConfig.model.path} | kind=${runConfig.discovered_kind || "auto"}`);
        }

        if (args.dryRun) {
            console.log(`[AUTO DISCOVER] Dry run only. Discovery written to: ${path.join(batchOutputDir, "discovered_models.json")}`);
            return;
        }
    }

    const startedAt = new Date().toISOString();
    const results = [];
    writeBatchArtifacts(
        batchOutputDir,
        buildBatchSummary(batchName, configPath, batchOutputDir, startedAt, runConfigs.length, results),
    );

    for (const runConfig of runConfigs) {
        const runStartedAtMs = Date.now();
        const runStartedAt = new Date(runStartedAtMs).toISOString();
        const enabledDatasets = listEnabledDatasets(runConfig.datasets);

        console.log(
            `\n=== Running ${runConfig.batch_order}/${runConfigs.length} | model_ref=${runConfig.model_ref} | run_name=${runConfig.run_name} ===`,
        );

        try {
            const resolvedConfig = runConfig.auto_discovered
                ? runConfig
                : resolveModelConfig(runConfig, baseDir);
            const { outputDir, summary } = await runAll(resolvedConfig, baseDir);
            results.push({
                batch_order: runConfig.batch_order,
                model_ref: runConfig.model_ref,
                run_name: runConfig.run_name,
                status: "success",
                started_at: runStartedAt,
                finished_at: summary.finished_at,
                duration_ms: Date.now() - runStartedAtMs,
                output_dir: outputDir,
                summary_file: path.join(outputDir, "summary.json"),
                leaderboard_file: path.join(outputDir, "leaderboard.csv"),
                enabled_datasets: enabledDatasets,
                discovered_from: runConfig.discovered_from || "",
                leaderboard: buildLeaderboardRow(summary),
                model: summary.model,
                datasets: summary.datasets,
            });
        } catch (error) {
            const formattedError = formatError(error);
            const finishedAt = new Date().toISOString();
            const failedOutputDir = path.resolve(resolveOutputRoot(baseDir), runConfig.run_name);
            const failedSummaryFile = writeFailedRunSummary(failedOutputDir, {
                run_name: runConfig.run_name,
                model_ref: runConfig.model_ref,
                status: "failed",
                started_at: runStartedAt,
                finished_at: finishedAt,
                duration_ms: Date.now() - runStartedAtMs,
                enabled_datasets: enabledDatasets,
                error: formattedError,
            });

            console.error(`[MODEL FAILED] model_ref=${runConfig.model_ref} | run_name=${runConfig.run_name} | ${formattedError.message}`);
            results.push({
                batch_order: runConfig.batch_order,
                model_ref: runConfig.model_ref,
                run_name: runConfig.run_name,
                status: "failed",
                started_at: runStartedAt,
                finished_at: finishedAt,
                duration_ms: Date.now() - runStartedAtMs,
                output_dir: failedOutputDir,
                summary_file: failedSummaryFile,
                leaderboard_file: "",
                enabled_datasets: enabledDatasets,
                discovered_from: runConfig.discovered_from || "",
                error: formattedError,
            });
        }

        writeBatchArtifacts(
            batchOutputDir,
            buildBatchSummary(batchName, configPath, batchOutputDir, startedAt, runConfigs.length, results),
        );
    }

    const batchSummary = buildBatchSummary(batchName, configPath, batchOutputDir, startedAt, runConfigs.length, results);
    writeBatchArtifacts(batchOutputDir, batchSummary);

    console.log(
        `\n[BATCH DONE] completed=${batchSummary.totals.completed_models}/${batchSummary.totals.total_models} | succeeded=${batchSummary.totals.succeeded_models} | failed=${batchSummary.totals.failed_models}`,
    );
    console.log(`[BATCH DONE] Summary written to: ${path.join(batchOutputDir, "batch_summary.json")}`);
    console.log(`[BATCH DONE] Leaderboard written to: ${path.join(batchOutputDir, "batch_leaderboard.csv")}`);

    if (batchSummary.totals.failed_models > 0) {
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error(`[FATAL] ${error.stack || error.message}`);
    process.exit(1);
});
