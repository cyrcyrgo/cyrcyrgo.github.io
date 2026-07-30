/**
 * LogiX API Connector — Pro v1.01
 * Connects to the LogiX API for code analysis.
 * Replaces the embedded analyzer with API-based communication.
 */

class LogiX {
    constructor() {
        this.mode = 'simple';
        this._analysisCount = 0;
        this._totalTime = 0;
        this._apiBase = this._resolveApiUrl();
        this._iframe = null;
        this._pending = null;
    }

    /**
     * Resolve API URL: relative path from py/pro/ to logix/api/
     */
    _resolveApiUrl() {
        // In production, resolves to ../../logix/api/
        return '../../logix/api/';
    }

    setMode(mode) {
        this.mode = mode;
    }

    getRuleCount() {
        return this.mode === 'advanced' ? 10000 : 500;
    }

    getStats() {
        return {
            count: this._analysisCount,
            totalTime: this._totalTime,
            avgTime: this._analysisCount > 0 ? (this._totalTime / this._analysisCount).toFixed(1) : 0,
            version: '3.0.0',
            ruleCount: this.getRuleCount()
        };
    }

    /**
     * Analyze code via LogiX API.
     * Uses iframe postMessage for cross-origin compatibility.
     */
    async analyze(code) {
        const start = performance.now();
        this._analysisCount++;

        try {
            const result = await this._callApi(code, this.mode);
            this._totalTime += performance.now() - start;
            return result.problems || [];
        } catch (e) {
            this._analysisCount--;
            // Fallback: return empty on API failure
            console.warn('LogiX API unavailable, skipping analysis:', e.message);
            return [];
        }
    }

    /**
     * Call the LogiX API via iframe postMessage.
     * @private
     */
    _callApi(code, mode) {
        return new Promise((resolve, reject) => {
            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'display:none;width:0;height:0;border:0;position:absolute;visibility:hidden;';
            iframe.src = this._apiBase;
            document.body.appendChild(iframe);

            const timer = setTimeout(() => {
                cleanup();
                reject(new Error('API timeout'));
            }, 15000);

            const handler = (event) => {
                try {
                    const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                    if (data && data.type === 'logix-analysis-result') {
                        clearTimeout(timer);
                        cleanup();
                        resolve(data.result);
                    }
                } catch (e) {
                    // Ignore non-JSON messages
                }
            };

            const cleanup = () => {
                window.removeEventListener('message', handler);
                iframe.remove();
            };

            window.addEventListener('message', handler);

            iframe.onload = () => {
                iframe.contentWindow.postMessage(JSON.stringify({
                    action: 'analyze',
                    code: code,
                    mode: mode
                }), '*');
            };

            iframe.onerror = () => {
                clearTimeout(timer);
                cleanup();
                reject(new Error('API load failed'));
            };
        });
    }
}

// Create global instance
window.logiX = new LogiX();