/**
 * Diagnostics and Issue Reporting Utilities
 */

let logBuffer = [];
const MAX_LOGS = 1000;

// Capture console logs
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = function(...args) {
    logBuffer.push({ level: 'log', timestamp: new Date().toISOString(), args: args.map(String) });
    if (logBuffer.length > MAX_LOGS) logBuffer.shift();
    originalConsoleLog.apply(console, args);
};

console.error = function(...args) {
    logBuffer.push({ level: 'error', timestamp: new Date().toISOString(), args: args.map(String) });
    if (logBuffer.length > MAX_LOGS) logBuffer.shift();
    originalConsoleError.apply(console, args);
};

console.warn = function(...args) {
    logBuffer.push({ level: 'warn', timestamp: new Date().toISOString(), args: args.map(String) });
    if (logBuffer.length > MAX_LOGS) logBuffer.shift();
    originalConsoleWarn.apply(console, args);
};

/**
 * Get browser console logs
 */
export function getBrowserLogs() {
    return logBuffer;
}

/**
 * Get system information
 */
export function getSystemInfo() {
    const info = {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        screenResolution: `${window.screen.width}x${window.screen.height}`,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        online: navigator.onLine,
        cookiesEnabled: navigator.cookieEnabled,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        memory: performance.memory ? {
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            usedJSHeapSize: performance.memory.usedJSHeapSize
        } : 'N/A',
        url: window.location.href,
        timestamp: new Date().toISOString()
    };
    return info;
}

/**
 * Collect all diagnostic data and copy to clipboard
 */
export async function generateDiagnosticReport() {
    const isElectron = window.electronAPI;
    
    const report = {
        timestamp: new Date().toISOString(),
        system: getSystemInfo(),
        browserLogs: getBrowserLogs(),
        electronData: null,
        sidecarLogs: null,
        p2pStatus: null,
        workspaceInfo: null
    };

    // Get Electron-specific data if available
    if (isElectron) {
        try {
            const electronData = await window.electronAPI.getDiagnosticData();
            report.electronData = electronData.app;
            report.system = { ...report.system, ...electronData.system };
            report.sidecarLogs = electronData.sidecarLogs;
            report.p2pStatus = electronData.p2p;
            report.identity = electronData.identity;
            report.tor = electronData.tor;
        } catch (err) {
            report.electronData = { error: err.message };
        }
    }

    return report;
}

/**
 * Format diagnostic report as text
 */
export function formatDiagnosticReport(report) {
    const lines = [];
    
    lines.push('='.repeat(80));
    lines.push('NIGHTJAR DIAGNOSTIC REPORT');
    lines.push('='.repeat(80));
    lines.push('');
    lines.push(`Generated: ${report.timestamp}`);
    lines.push('');
    
    // System Info
    lines.push('-'.repeat(80));
    lines.push('SYSTEM INFORMATION');
    lines.push('-'.repeat(80));
    Object.entries(report.system).forEach(([key, value]) => {
        if (typeof value === 'object') {
            lines.push(`${key}:`);
            Object.entries(value).forEach(([k, v]) => {
                lines.push(`  ${k}: ${v}`);
            });
        } else {
            lines.push(`${key}: ${value}`);
        }
    });
    lines.push('');
    
    // Electron Data
    if (report.electronData) {
        lines.push('-'.repeat(80));
        lines.push('ELECTRON ENVIRONMENT');
        lines.push('-'.repeat(80));
        lines.push(JSON.stringify(report.electronData, null, 2));
        lines.push('');
    }
    
    // Sidecar Logs
    if (report.sidecarLogs && report.sidecarLogs.length > 0) {
        lines.push('-'.repeat(80));
        lines.push('SIDECAR LOGS (Last 500)');
        lines.push('-'.repeat(80));
        report.sidecarLogs.slice(-500).forEach(log => {
            lines.push(`[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`);
        });
        lines.push('');
    }
    
    // Browser Logs
    lines.push('-'.repeat(80));
    lines.push('BROWSER CONSOLE LOGS (Last 500)');
    lines.push('-'.repeat(80));
    report.browserLogs.slice(-500).forEach(log => {
        const level = log.level.toUpperCase().padEnd(5);
        lines.push(`[${log.timestamp}] [${level}] ${log.args.join(' ')}`);
    });
    lines.push('');
    
    // P2P Status
    if (report.p2pStatus) {
        lines.push('-'.repeat(80));
        lines.push('P2P STATUS');
        lines.push('-'.repeat(80));
        lines.push(JSON.stringify(report.p2pStatus, null, 2));
        lines.push('');
    }
    
    // Workspace Info
    if (report.workspaceInfo) {
        lines.push('-'.repeat(80));
        lines.push('WORKSPACE INFORMATION');
        lines.push('-'.repeat(80));
        lines.push(JSON.stringify(report.workspaceInfo, null, 2));
        lines.push('');
    }
    
    lines.push('='.repeat(80));
    lines.push('END OF DIAGNOSTIC REPORT');
    lines.push('='.repeat(80));
    
    return lines.join('\n');
}

/**
 * Copy diagnostic report to clipboard
 */
export async function copyDiagnosticReportToClipboard() {
    try {
        const report = await generateDiagnosticReport();
        const formatted = formatDiagnosticReport(report);
        
        await navigator.clipboard.writeText(formatted);
        return { success: true, size: formatted.length };
    } catch (err) {
        console.error('Failed to copy diagnostic report:', err);
        return { success: false, error: err.message };
    }
}
