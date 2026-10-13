/**
 * LogiX API SDK v1.0.0
 * 
 * Client-side SDK for integrating with the LogiX Code Analysis API.
 * Supports both direct embedding and iframe postMessage communication.
 * 
 * @example
 *   // Direct embedding (same origin)
 *   const logix = new LogiXSDK({ mode: 'advanced' });
 *   const result = await logix.analyze('print("hello")');
 *   console.log(result.problems);
 * 
 * @example  
 *   // Iframe integration (cross-origin)
 *   const logix = new LogiXSDK({
 *     apiUrl: 'https://example.com/logix/api/',
 *     mode: 'simple'
 *   });
 *   const result = await logix.analyze('print("hello")');
 *   console.log(result.problems);
 */

class LogiXSDK {
    /**
     * @param {Object} options
     * @param {string} [options.apiUrl] - URL to the LogiX API page (for iframe mode)
     * @param {string} [options.mode='simple'] - Analysis mode: 'simple' or 'advanced'
     * @param {number} [options.timeout=30000] - Timeout in ms for iframe mode
     */
    constructor(options = {}) {
        this.apiUrl = options.apiUrl || null;
        this.mode = options.mode || 'simple';
        this.timeout = options.timeout || 30000;
        this._iframe = null;
        this._ready = false;
    }

    /**
     * Analyze Python code and return problems.
     * 
     * @param {string} code - Python source code to analyze
     * @param {Object} [options]
     * @param {string} [options.mode] - Override analysis mode
     * @returns {Promise<Object>} Analysis result
     * @returns {boolean} result.success
     * @returns {Array} result.problems - Array of problem objects
     * @returns {number} result.total - Total problem count
     * @returns {Object} result.stats - Engine statistics
     */
    async analyze(code, options = {}) {
        const mode = options.mode || this.mode;

        if (this.apiUrl) {
            return this._analyzeViaIframe(code, mode);
        }
        return this._analyzeDirect(code, mode);
    }

    /**
     * Direct analysis using embedded LogiX engine.
     * @private
     */
    _analyzeDirect(code, mode) {
        if (typeof LogiX === 'undefined') {
            throw new Error('LogiX engine not loaded. Include analyzer.js before using SDK.');
        }

        const engine = new LogiX();
        engine.setMode(mode);
        const problems = engine.analyze(code);
        const stats = engine.getStats();

        const errors = problems.filter(p => p.severity === 'error').length;
        const warnings = problems.filter(p => p.severity === 'warning').length;
        const infos = problems.filter(p => p.severity === 'info').length;

        return Promise.resolve({
            success: true,
            timestamp: new Date().toISOString(),
            mode: mode,
            stats: {
                count: stats.count,
                version: stats.version,
                ruleCount: stats.ruleCount
            },
            total: problems.length,
            errors: errors,
            warnings: warnings,
            infos: infos,
            problems: problems
        });
    }

    /**
     * Analysis via iframe postMessage communication.
     * @private
     */
    async _analyzeViaIframe(code, mode) {
        return new Promise((resolve, reject) => {
            const iframe = this._createIframe();
            const timer = setTimeout(() => {
                reject(new Error('LogiX API request timed out after ' + this.timeout + 'ms'));
                this._cleanupIframe();
            }, this.timeout);

            const handler = (event) => {
                try {
                    const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                    if (data && data.type === 'logix-analysis-result') {
                        clearTimeout(timer);
                        window.removeEventListener('message', handler);
                        this._cleanupIframe();
                        resolve(data.result);
                    }
                } catch (e) {
                    // Ignore non-JSON messages
                }
            };

            window.addEventListener('message', handler);

            iframe.onload = () => {
                iframe.contentWindow.postMessage(JSON.stringify({
                    action: 'analyze',
                    code: code,
                    mode: mode
                }), '*');
            };

            iframe.src = this.apiUrl;
        });
    }

    /**
     * Create a hidden iframe for API communication.
     * @private
     */
    _createIframe() {
        this._cleanupIframe();
        this._iframe = document.createElement('iframe');
        this._iframe.style.cssText = 'display:none;width:0;height:0;border:0;position:absolute;visibility:hidden;';
        document.body.appendChild(this._iframe);
        return this._iframe;
    }

    /**
     * Remove the iframe.
     * @private
     */
    _cleanupIframe() {
        if (this._iframe) {
            this._iframe.remove();
            this._iframe = null;
        }
    }

    /**
     * Get the SDK version.
     * @returns {string}
     */
    static get version() {
        return '1.0.0';
    }
}

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LogiXSDK;
} else if (typeof define === 'function' && define.amd) {
    define('LogiXSDK', [], () => LogiXSDK);
} else {
    window.LogiXSDK = LogiXSDK;
}