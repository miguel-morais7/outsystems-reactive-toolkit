/**
 * pageScript/producers.js — Producer reference discovery.
 *
 * Depends on: (none)
 *
 * Provides:
 *   - _osProducersScan()
 */

/* ------------------------------------------------------------------ */
/*  SCAN PRODUCERS — discover producer references from referencesHealth.js */
/* ------------------------------------------------------------------ */
function _osProducersScan() {
  return new Promise((resolve) => {
    const SCAN_TIMEOUT_MS = 10000;

    // 1. Find all *.referencesHealth.js resource entries
    const scripts = performance.getEntriesByType("resource");
    const resourceMap = new Map();

    scripts.forEach((entry) => {
      if (
        entry.initiatorType === "script" &&
        entry.name.includes("referencesHealth.js")
      ) {
        const matches = entry.name.match(/([^\/]+)\.referencesHealth\.js/);
        if (matches && matches[1]) {
          const moduleName = matches[1];
          resourceMap.set(moduleName, entry.name);
        }
      }
    });

    if (resourceMap.size === 0) {
      resolve({ ok: true, producerModules: [], producers: [] });
      return;
    }

    // 2. Fetch each referencesHealth.js file and parse producer references
    const allProducers = [];
    let remaining = resourceMap.size;
    let resolved = false;

    function finalize() {
      if (resolved) return;
      resolved = true;
      const producerModuleList = [...new Set(allProducers.map((p) => p.module))].sort();
      allProducers.sort((a, b) =>
        a.module === b.module
          ? a.producer.localeCompare(b.producer)
          : a.module.localeCompare(b.module)
      );
      resolve({ ok: true, producerModules: producerModuleList, producers: allProducers });
    }

    // Safety timeout
    setTimeout(() => {
      if (!resolved) {
        console.warn("[OS Producers] Scan timed out after " + SCAN_TIMEOUT_MS + "ms. Returning partial results.");
        finalize();
      }
    }, SCAN_TIMEOUT_MS);

    resourceMap.forEach((url, moduleName) => {
      fetch(url)
        .then((response) => response.text())
        .then((content) => {
          const definePattern = /define\s*\(\s*["']([^"']+\.referencesHealth\$([^"']+))["']\s*,\s*\[[^\]]*\]\s*,\s*function\s*\([^)]*\)\s*\{([^}]*)\}/g;
          let match;

          while ((match = definePattern.exec(content)) !== null) {
            const producerName = match[2];
            const functionBody = match[3];

            let status = "Unknown";
            const statusMatch = functionBody.match(/\/\/\s*Reference to producer ['"]([^'"]+)['"] is (\w+)\./);
            if (statusMatch) {
              status = statusMatch[2];
            }

            allProducers.push({
              module: moduleName,
              producer: producerName,
              status: status,
            });
          }

          remaining--;
          if (remaining === 0) finalize();
        })
        .catch((err) => {
          console.warn("[OS Producers] Failed to fetch " + url + ": " + err.message);
          remaining--;
          if (remaining === 0) finalize();
        });
    });
  });
}
