const path = require("path");

const { runAll } = require("./lib/runner");
const { readJson } = require("./lib/utils");

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const token = argv[i];
        if (token === "--config") {
            args.config = argv[++i];
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

async function main() {
    const args = parseArgs(process.argv);
    if (!args.config) {
        console.error("Usage: node bench_suite/run_eval.js --config <config.json>");
        process.exit(1);
    }

    const baseDir = process.env.BENCH_BASE_DIR
        ? path.resolve(process.env.BENCH_BASE_DIR)
        : process.cwd();
    const configPath = path.isAbsolute(args.config) ? args.config : path.resolve(baseDir, args.config);
    const rawConfig = readJson(configPath);
    const config = resolveModelConfig(rawConfig, baseDir);

    const { outputDir, summary } = await runAll(config, baseDir);
    console.log(`\n[DONE] Outputs written to: ${outputDir}`);
    console.log(`[DONE] Summary: ${JSON.stringify(summary.datasets, null, 2)}`);
}

main().catch(error => {
    console.error(`[FATAL] ${error.stack || error.message}`);
    process.exit(1);
});
