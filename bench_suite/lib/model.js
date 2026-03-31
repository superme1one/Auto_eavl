const fs = require("fs");
const path = require("path");

function hasAnyFile(dirPath, names) {
    return names.some(name => fs.existsSync(path.join(dirPath, name)));
}

function detectModelKind(modelPath) {
    if (!fs.existsSync(modelPath)) {
        throw new Error(`Model path does not exist: ${modelPath}`);
    }

    const stat = fs.statSync(modelPath);
    if (stat.isFile()) {
        const ext = path.extname(modelPath).toLowerCase();
        if (ext === ".gguf") return "gguf";
        if (ext === ".onnx") return "onnx";
        if (ext === ".safetensors" || ext === ".safetensor") return "safetensors";
        throw new Error(`Unsupported model file extension: ${ext}`);
    }

    const entries = fs.readdirSync(modelPath);
    if (entries.some(name => name.toLowerCase().endsWith(".gguf"))) return "gguf";
    if (entries.some(name => name.toLowerCase().endsWith(".onnx"))) return "onnx";
    if (entries.some(name => name.toLowerCase().endsWith(".safetensors") || name.toLowerCase().endsWith(".safetensor"))) return "safetensors";
    if (hasAnyFile(modelPath, ["model.safetensors", "pytorch_model.bin", "config.json"])) {
        return "safetensors";
    }

    throw new Error(`Cannot detect model type from directory: ${modelPath}`);
}

function pickModelFile(modelPath, expectedExt) {
    const stat = fs.statSync(modelPath);
    if (stat.isFile()) return modelPath;
    const matches = fs.readdirSync(modelPath)
        .filter(name => name.toLowerCase().endsWith(expectedExt))
        .map(name => path.join(modelPath, name));
    if (!matches.length) {
        throw new Error(`No ${expectedExt} model found in ${modelPath}`);
    }
    return matches[0];
}

module.exports = {
    detectModelKind,
    pickModelFile,
};
