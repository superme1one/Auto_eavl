async function fetchWithTimeout(resource, options = {}) {
    const timeout = options.timeout || 300000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        return await fetch(resource, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function postJson(url, body, timeout) {
    const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        timeout,
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
    }
    return response.json();
}

async function getJson(url, timeout) {
    const response = await fetchWithTimeout(url, { timeout });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
}

module.exports = {
    fetchWithTimeout,
    getJson,
    postJson,
};
