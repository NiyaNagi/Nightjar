/**
 * Color utility functions for UI theming
 */

/**
 * Generate a deterministic color from a publicKey or any string identifier.
 * Uses a simple hash function to produce a consistent HSL color that will
 * always be the same for the same input across all sessions and devices.
 * @param {string} identifier - The publicKey or unique identifier
 * @returns {string} - HSL color string (e.g., "hsl(180, 70%, 60%)")
 */
export function generateIdentityColor(identifier) {
    if (!identifier || typeof identifier !== 'string') {
        return 'hsl(240, 70%, 60%)'; // Default indigo
    }
    
    // Simple hash function (djb2 algorithm)
    let hash = 5381;
    for (let i = 0; i < identifier.length; i++) {
        hash = ((hash << 5) + hash) + identifier.charCodeAt(i);
        hash = hash >>> 0; // Convert to unsigned 32-bit integer (prevents negative values)
    }
    
    // Use modulo to get hue (0-360) - no need for Math.abs since hash is now unsigned
    const hue = hash % 360;
    
    // Use fixed saturation and lightness for vibrant, readable colors
    return `hsl(${hue}, 70%, 60%)`;
}

/**
 * Parse a hex color to RGB components
 * @param {string} hex - Hex color string (#RGB, #RRGGBB, or without #)
 * @returns {{ r: number, g: number, b: number } | null}
 */
export function hexToRgb(hex) {
    if (!hex) return null;
    
    // Remove # if present
    hex = hex.replace(/^#/, '');
    
    // Handle 3-digit hex
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    
    if (hex.length !== 6) return null;
    
    const num = parseInt(hex, 16);
    if (isNaN(num)) return null;
    
    return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255
    };
}

/**
 * Calculate relative luminance of a color (WCAG formula)
 * @param {string} color - Hex color string
 * @returns {number} - Luminance value 0-1
 */
export function getLuminance(color) {
    const rgb = hexToRgb(color);
    if (!rgb) return 0.5; // Default to middle if can't parse
    
    const [rs, gs, bs] = [rgb.r, rgb.g, rgb.b].map(c => {
        c = c / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculate contrast ratio between two colors (WCAG formula)
 * @param {string} color1 - First hex color
 * @param {string} color2 - Second hex color
 * @returns {number} - Contrast ratio (1:1 to 21:1)
 */
export function getContrastRatio(color1, color2) {
    const l1 = getLuminance(color1);
    const l2 = getLuminance(color2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Determine if a color is "light" (luminance > 0.5)
 * @param {string} color - Hex color string
 * @returns {boolean}
 */
export function isLightColor(color) {
    return getLuminance(color) > 0.4; // Use 0.4 threshold for better readability
}

/**
 * Get optimal text color for a given background
 * Returns white for dark backgrounds, dark gray for light backgrounds
 * @param {string} backgroundColor - Hex color of the background
 * @returns {string} - Hex color for text
 */
export function getTextColorForBackground(backgroundColor) {
    if (!backgroundColor) return null; // Let CSS handle it
    return isLightColor(backgroundColor) ? '#1f2937' : '#ffffff';
}

/**
 * Get optimal text color with a chip/pill background for maximum contrast
 * Returns an object with text color and a semi-transparent chip background
 * @param {string} backgroundColor - Hex color of the parent background
 * @returns {{ textColor: string, chipBg: string }}
 */
export function getChipStyleForBackground(backgroundColor) {
    if (!backgroundColor) {
        return { textColor: null, chipBg: null };
    }
    
    const isLight = isLightColor(backgroundColor);
    
    return {
        textColor: isLight ? '#1f2937' : '#ffffff',
        chipBg: isLight ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.5)'
    };
}

/**
 * Ensures color has good contrast with white text by adding a dark overlay
 * @param {string} color - The base color (hex, rgb, etc.)
 * @param {number} overlayOpacity - Opacity of the dark overlay (0-1), default 0.3
 * @returns {string} - CSS background style with layered colors
 */
export function ensureContrastWithWhite(color, overlayOpacity = 0.3) {
    if (!color) return 'transparent';
    
    // Return a CSS background with the color and a dark overlay
    return `linear-gradient(rgba(0, 0, 0, ${overlayOpacity}), rgba(0, 0, 0, ${overlayOpacity})), ${color}`;
}

/**
 * Creates a left-to-right gradient between two colors with dark overlay for contrast
 * @param {string} leftColor - Color on the left side
 * @param {string} rightColor - Color on the right side
 * @param {number} overlayOpacity - Opacity of the dark overlay (0-1), default 0.3
 * @returns {string} - CSS background gradient
 */
export function createColorGradient(leftColor, rightColor, overlayOpacity = 0.3) {
    if (!leftColor && !rightColor) return 'transparent';
    if (!leftColor) return ensureContrastWithWhite(rightColor, overlayOpacity);
    if (!rightColor) return ensureContrastWithWhite(leftColor, overlayOpacity);
    
    // Create gradient with overlay for contrast
    return `
        linear-gradient(rgba(0, 0, 0, ${overlayOpacity}), rgba(0, 0, 0, ${overlayOpacity})),
        linear-gradient(to right, ${leftColor}, ${rightColor})
    `;
}

/**
 * Get the dominant/primary color from a gradient or mixed color scenario
 * For folder+document colors, we use folder color as dominant
 * @param {string} folderColor - Folder's color
 * @param {string} documentColor - Document's color
 * @returns {string | null} - The dominant color
 */
export function getDominantColor(folderColor, documentColor) {
    return folderColor || documentColor || null;
}

