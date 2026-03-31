const fs = require("fs");
const path = require("path");

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function appendJsonl(filePath, record) {
    fs.appendFileSync(filePath, JSON.stringify(record) + "\n");
}

function resolveFrom(baseDir, targetPath) {
    if (!targetPath) return "";
    return path.isAbsolute(targetPath) ? targetPath : path.resolve(baseDir, targetPath);
}

function nowStamp() {
    const now = new Date();
    const pad = v => String(v).padStart(2, "0");
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/\b(a|an|the)\b/g, " ")
        .replace(/[.,!?;:'"`]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function safeDivide(a, b) {
    return b ? a / b : 0;
}

module.exports = {
    appendJsonl,
    ensureDir,
    normalizeText,
    nowStamp,
    readJson,
    resolveFrom,
    safeDivide,
    sleep,
    writeJson,
};
