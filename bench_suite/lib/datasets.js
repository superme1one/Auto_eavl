const fs = require("fs");
const path = require("path");

const { normalizeText, safeDivide } = require("./utils");

const MMLU_SUBJECTS = [
    "abstract_algebra", "anatomy", "astronomy", "business_ethics", "clinical_knowledge",
    "college_biology", "college_chemistry", "college_computer_science", "college_mathematics",
    "college_medicine", "college_physics", "computer_security", "conceptual_physics",
    "econometrics", "electrical_engineering", "elementary_mathematics", "formal_logic",
    "global_facts", "high_school_biology", "high_school_chemistry", "high_school_computer_science",
    "high_school_european_history", "high_school_geography", "high_school_government_and_politics",
    "high_school_macroeconomics", "high_school_mathematics", "high_school_microeconomics",
    "high_school_physics", "high_school_psychology", "high_school_statistics", "high_school_us_history",
    "high_school_world_history", "human_aging", "human_sexuality", "international_law",
    "jurisprudence", "logical_fallacies", "machine_learning", "management", "marketing",
    "medical_genetics", "miscellaneous", "moral_disputes", "moral_scenarios", "nutrition",
    "philosophy", "prehistory", "professional_accounting", "professional_law",
    "professional_medicine", "professional_psychology", "public_relations", "security_studies",
    "sociology", "us_foreign_policy", "virology", "world_religions",
];

function readJsonl(filePath) {
    return fs.readFileSync(filePath, "utf-8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => JSON.parse(line));
}

function extractGsm8kGold(answerStr) {
    if (!answerStr) return NaN;
    const match = answerStr.match(/####\s*(-?[\d,.]+)/);
    return match ? parseFloat(match[1].replace(/,/g, "")) : NaN;
}

function extractGsm8kPred(rawOutput) {
    if (!rawOutput) return NaN;
    const clean = rawOutput.includes("</think>") ? rawOutput.split("</think>").pop().trim() : rawOutput;
    const patterns = [
        /####\s*(-?[\d,.]+)/,
        /Answer:\s*(-?[\d,.]+)/i,
        /\\boxed\{(-?[\d,.]+)\}/,
    ];
    for (const pattern of patterns) {
        const match = clean.match(pattern);
        if (match) return parseFloat(match[1].replace(/,/g, ""));
    }
    const nums = clean.match(/-?[\d,.]+/g);
    return nums && nums.length ? parseFloat(nums[nums.length - 1].replace(/,/g, "")) : NaN;
}

function extractAnswerText(rawOutput) {
    if (!rawOutput) return "";
    const clean = rawOutput.includes("</think>") ? rawOutput.split("</think>").pop().trim() : rawOutput.trim();
    const match = clean.match(/Answer:\s*(.*)/i);
    const line = match ? match[1] : clean.split("\n").filter(Boolean).pop();
    return String(line || "").replace(/^[\s"'`[\]()]+|[\s"'`[\]()]+$/g, "").trim();
}

function parseMmluCsvLine(line) {
    const parts = [];
    let current = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === "\"") {
            inQuote = !inQuote;
        } else if (char === "," && !inQuote) {
            parts.push(current.trim().replace(/^"|"$/g, ""));
            current = "";
        } else {
            current += char;
        }
    }
    parts.push(current.trim().replace(/^"|"$/g, ""));
    if (parts.length < 6) return null;
    return {
        question: parts[0],
        choices: parts.slice(1, 5),
        answer: parts[5].toUpperCase(),
    };
}

const datasets = {
    gsm8k: {
        load(configPath, options) {
            let rows = readJsonl(configPath);
            if (options.limit > 0) rows = rows.slice(0, options.limit);
            return rows.map((item, index) => ({
                id: index + 1,
                question: item.question,
                gold: extractGsm8kGold(item.answer),
                raw: item,
            }));
        },
        buildPrompt(sample) {
            return `You are a math expert.\n\nQuestion:\n${sample.question}\n\nInstructions:\n1. Think step-by-step to solve the problem.\n2. Be concise but show the calculation clearly.\n3. End the response with: "#### <final_number>".\n\nResponse:\n`;
        },
        evaluate(sample, output) {
            const pred = extractGsm8kPred(output);
            return {
                ok: !Number.isNaN(pred) && Math.abs(pred - sample.gold) < 1e-6,
                prediction: pred,
                gold: sample.gold,
            };
        },
    },
    drop: {
        load(configPath, options) {
            let rows = readJsonl(configPath);
            if (options.limit > 0) rows = rows.slice(0, options.limit);
            return rows.map((item, index) => ({
                id: index + 1,
                passage: item.passage,
                question: item.question,
                expectList: (item.answers_spans && item.answers_spans.spans) || [],
                isNumberType: Array.isArray(item.answers_spans && item.answers_spans.types)
                    && item.answers_spans.types.some(t => String(t).toLowerCase() === "number"),
                raw: item,
            }));
        },
        buildPrompt(sample) {
            const instructions = sample.isNumberType
                ? "1. Think step-by-step based on the passage.\n2. The answer must be a number.\n3. Output final answer as: Answer: <number>\n4. Use Arabic numerals only."
                : "1. Think step-by-step based on the passage.\n2. Extract the answer directly from the passage if possible.\n3. Output final answer as: Answer: <short phrase>.";
            return `You are an expert in reading comprehension and arithmetic.\n\nPassage:\n${sample.passage}\n\nQuestion:\n${sample.question}\n\nInstructions:\n${instructions}\n`;
        },
        evaluate(sample, output) {
            const answer = extractAnswerText(output);
            const normAns = normalizeText(answer);
            const ok = sample.expectList.some(exp => {
                const normExp = normalizeText(exp);
                if (!normAns || !normExp) return false;
                if (normAns.includes(normExp)) return true;
                const numAns = parseFloat(normAns);
                const numExp = parseFloat(normExp);
                return !Number.isNaN(numAns) && !Number.isNaN(numExp) && Math.abs(numAns - numExp) < 1e-6;
            });
            return {
                ok,
                prediction: answer,
                gold: sample.expectList,
            };
        },
    },
    mmlu: {
        load(configPath, options) {
            const rows = [];
            for (const subject of MMLU_SUBJECTS) {
                if (options.maxSamples > 0 && rows.length >= options.maxSamples) break;
                const csvPath = path.join(configPath, `${subject}_test.csv`);
                if (!fs.existsSync(csvPath)) continue;
                let lines = fs.readFileSync(csvPath, "utf-8").split(/\r?\n/).filter(Boolean);
                if (options.limitPerSubject > 0) lines = lines.slice(0, options.limitPerSubject);
                for (let i = 0; i < lines.length; i++) {
                    if (options.maxSamples > 0 && rows.length >= options.maxSamples) break;
                    const parsed = parseMmluCsvLine(lines[i]);
                    if (!parsed) continue;
                    rows.push({
                        id: `${subject}-${i + 1}`,
                        subject,
                        prompt: `${parsed.question}\nA) ${parsed.choices[0]}\nB) ${parsed.choices[1]}\nC) ${parsed.choices[2]}\nD) ${parsed.choices[3]}`,
                        gold: parsed.answer,
                        raw: parsed,
                    });
                }
            }
            return rows;
        },
        buildPrompt(sample) {
            return `You are an expert in ${sample.subject.replace(/_/g, " ")}.\n\nQuestion:\n${sample.prompt}\n\nInstructions:\n1. Think step by step.\n2. Be concise.\n3. End with exactly: Answer: X where X is A, B, C, or D.\n`;
        },
        evaluate(sample, output) {
            const patterns = [
                /Answer:\s*([A-D])/i,
                /The answer is\s*([A-D])/i,
                /^([A-D])$/m,
                /Option\s*([A-D])/i,
            ];
            let pred = "INVALID";
            for (const pattern of patterns) {
                const match = String(output || "").match(pattern);
                if (match) {
                    pred = match[1].toUpperCase();
                    break;
                }
            }
            return {
                ok: pred === sample.gold,
                prediction: pred,
                gold: sample.gold,
                subject: sample.subject,
            };
        },
        finalize(records) {
            const bySubject = {};
            for (const item of records) {
                if (!bySubject[item.subject]) {
                    bySubject[item.subject] = { total: 0, correct: 0 };
                }
                bySubject[item.subject].total += 1;
                if (item.ok) bySubject[item.subject].correct += 1;
            }
            const summary = {};
            for (const [subject, stats] of Object.entries(bySubject)) {
                summary[subject] = {
                    total: stats.total,
                    correct: stats.correct,
                    accuracy: Number((safeDivide(stats.correct, stats.total) * 100).toFixed(2)),
                };
            }
            return { subjects: summary };
        },
    },
    triviaqa: {
        load(configPath, options) {
            const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            let rows = raw.Data || raw;
            if (options.limit > 0) rows = rows.slice(0, options.limit);
            return rows.map((item, index) => ({
                id: index + 1,
                question: item.Question,
                aliases: (item.Answer && item.Answer.NormalizedAliases) || [],
                raw: item,
            }));
        },
        buildPrompt(sample) {
            return `You are a concise trivia expert.\n\nQuestion:\n${sample.question}\n\nInstructions:\n1. Think step-by-step to recall the correct fact.\n2. Output the final answer concisely.\n3. Start the final answer with: Answer: \n`;
        },
        evaluate(sample, output) {
            const answer = extractAnswerText(output);
            const normAns = normalizeText(answer);
            const ok = sample.aliases.some(alias => normAns.includes(normalizeText(alias)));
            return {
                ok,
                prediction: answer,
                gold: sample.aliases,
            };
        },
    },
};

module.exports = {
    datasets,
};
