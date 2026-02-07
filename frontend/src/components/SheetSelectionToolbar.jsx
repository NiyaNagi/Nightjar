/**
 * SheetSelectionToolbar Component
 * 
 * A floating toolbar that appears when cells are selected in a spreadsheet.
 * Provides quick access to formatting options and commenting.
 * 
 * Features:
 * - Bold, Italic, Underline, Strikethrough
 * - Text color
 * - Background color
 * - Number format presets
 * - Text alignment
 * - Add comment on selection
 */

import React, { useState, useRef, useEffect } from 'react';
import './SelectionToolbar.css';

// Color presets for quick selection
const COLOR_PRESETS = [
    '#000000', '#434343', '#666666', '#999999', '#cccccc', '#ffffff',
    '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#0000ff',
    '#9900ff', '#ff00ff', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3',
    '#cfe2f3', '#d9d2e9', '#ead1dc', '#c9daf8',
];

// Number format presets
const NUMBER_FORMATS = [
    { label: 'Auto', format: 'auto' },
    { label: '123', format: 'number' },
    { label: '12.34', format: 'decimal' },
    { label: '$', format: 'currency' },
    { label: '%', format: 'percent' },
    { label: 'Date', format: 'date' },
];

const SheetSelectionToolbar = ({ 
    selection,           // { row: [start, end], column: [start, end], sheetId }
    position,            // { x, y } screen coordinates
    workbookRef,         // Reference to Fortune Sheet workbook
    onAddComment,        // Callback to add comment on selection
    readOnly = false,
}) => {
    const [showColorPicker, setShowColorPicker] = useState(null); // 'text' | 'bg' | null
    const [showFormatMenu, setShowFormatMenu] = useState(false);
    const toolbarRef = useRef(null);
    const colorPickerRef = useRef(null);

    // Close menus when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (colorPickerRef.current && !colorPickerRef.current.contains(e.target)) {
                setShowColorPicker(null);
            }
            if (showFormatMenu && toolbarRef.current && !toolbarRef.current.contains(e.target)) {
                setShowFormatMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showFormatMenu]);

    if (!selection || !position) return null;

    // Get cell range reference for display
    const getCellRef = () => {
        if (!selection.row || !selection.column) return '';
        const colToLetter = (col) => {
            let letter = '';
            let c = col;
            while (c >= 0) {
                letter = String.fromCharCode(65 + (c % 26)) + letter;
                c = Math.floor(c / 26) - 1;
            }
            return letter;
        };
        const startRef = `${colToLetter(selection.column[0])}${selection.row[0] + 1}`;
        const endRef = `${colToLetter(selection.column[1])}${selection.row[1] + 1}`;
        return startRef === endRef ? startRef : `${startRef}:${endRef}`;
    };

    // Apply formatting to selected cells
    const applyFormat = (attr, value) => {
        if (!workbookRef?.current || readOnly) return;
        
        // Validate selection has valid row/column
        if (!selection?.row || !selection?.column) {
            console.warn('[SheetToolbar] No valid selection for formatting');
            return;
        }
        
        const rowStart = selection.row[0];
        const rowEnd = selection.row[1] ?? rowStart;
        const colStart = selection.column[0];
        const colEnd = selection.column[1] ?? colStart;
        
        // Ensure we have valid numbers
        if (rowStart == null || colStart == null) {
            console.warn('[SheetToolbar] Invalid row/column in selection');
            return;
        }
        
        try {
            // Use setCellFormatByRange for range formatting (preferred)
            if (workbookRef.current.setCellFormatByRange) {
                workbookRef.current.setCellFormatByRange(attr, value, {
                    row: [rowStart, rowEnd],
                    column: [colStart, colEnd],
                });
            } else if (workbookRef.current.setCellFormat) {
                // Fall back to single cell format if range API not available
                // Apply to each cell in the selection
                for (let r = rowStart; r <= rowEnd; r++) {
                    for (let c = colStart; c <= colEnd; c++) {
                        workbookRef.current.setCellFormat(r, c, attr, value);
                    }
                }
            }
        } catch (e) {
            console.warn('[SheetToolbar] Format API error:', e.message);
        }
    };

    // Toggle bold
    const toggleBold = () => {
        applyFormat('bl', 1); // bl = bold in Fortune Sheet
    };

    // Toggle italic
    const toggleItalic = () => {
        applyFormat('it', 1); // it = italic
    };

    // Toggle underline
    const toggleUnderline = () => {
        applyFormat('un', 1); // un = underline (may vary)
    };

    // Toggle strikethrough
    const toggleStrikethrough = () => {
        applyFormat('cl', 1); // cl = cancelled line / strikethrough
    };

    // Set text color
    const setTextColor = (color) => {
        applyFormat('fc', color); // fc = font color
        setShowColorPicker(null);
    };

    // Set background color
    const setBgColor = (color) => {
        applyFormat('bg', color); // bg = background
        setShowColorPicker(null);
    };

    // Set text alignment
    const setAlignment = (align) => {
        // ht = horizontal text alignment: 0=left, 1=center, 2=right
        const htValue = align === 'left' ? 0 : align === 'center' ? 1 : 2;
        applyFormat('ht', htValue);
    };

    // Handle add comment
    const handleAddComment = () => {
        if (onAddComment) {
            onAddComment({
                type: 'cell',
                cellRef: getCellRef(),
                row: selection.row,
                column: selection.column,
                sheetId: selection.sheetId,
            });
        }
    };

    // Calculate toolbar position (adjust if near edges)
    const getToolbarStyle = () => {
        const style = {
            position: 'fixed',
            left: position.x,
            top: position.y - 50, // Position above selection
            zIndex: 1200,
        };
        
        // Adjust if too close to top
        if (position.y < 100) {
            style.top = position.y + 30;
        }
        
        return style;
    };

    return (
        <div 
            ref={toolbarRef}
            className="selection-toolbar sheet-selection-toolbar"
            style={getToolbarStyle()}
        >
            {/* Cell Reference Badge */}
            <div className="toolbar-group">
                <span className="cell-ref-badge" title="Selected range">
                    {getCellRef()}
                </span>
            </div>

            <div className="toolbar-divider"></div>

            {/* Text Formatting */}
            {!readOnly && (
                <>
                    <div className="toolbar-group">
                        <button
                            onClick={toggleBold}
                            className="toolbar-btn"
                            title="Bold"
                        >
                            <strong>B</strong>
                        </button>
                        <button
                            onClick={toggleItalic}
                            className="toolbar-btn"
                            title="Italic"
                        >
                            <em>I</em>
                        </button>
                        <button
                            onClick={toggleUnderline}
                            className="toolbar-btn"
                            title="Underline"
                        >
                            <span style={{ textDecoration: 'underline' }}>U</span>
                        </button>
                        <button
                            onClick={toggleStrikethrough}
                            className="toolbar-btn"
                            title="Strikethrough"
                        >
                            <span style={{ textDecoration: 'line-through' }}>S</span>
                        </button>
                    </div>

                    <div className="toolbar-divider"></div>

                    {/* Colors */}
                    <div className="toolbar-group">
                        <div className="color-btn-wrapper">
                            <button
                                onClick={() => setShowColorPicker(showColorPicker === 'text' ? null : 'text')}
                                className={`toolbar-btn ${showColorPicker === 'text' ? 'active' : ''}`}
                                title="Text Color"
                            >
                                <span className="color-icon text-color">A</span>
                            </button>
                            {showColorPicker === 'text' && (
                                <div ref={colorPickerRef} className="color-picker-dropdown">
                                    <div className="color-grid">
                                        {COLOR_PRESETS.map(color => (
                                            <button
                                                key={color}
                                                className="color-swatch"
                                                style={{ backgroundColor: color }}
                                                onClick={() => setTextColor(color)}
                                                title={color}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="color-btn-wrapper">
                            <button
                                onClick={() => setShowColorPicker(showColorPicker === 'bg' ? null : 'bg')}
                                className={`toolbar-btn ${showColorPicker === 'bg' ? 'active' : ''}`}
                                title="Background Color"
                            >
                                <span className="color-icon bg-color">🎨</span>
                            </button>
                            {showColorPicker === 'bg' && (
                                <div ref={colorPickerRef} className="color-picker-dropdown">
                                    <div className="color-grid">
                                        {COLOR_PRESETS.map(color => (
                                            <button
                                                key={color}
                                                className="color-swatch"
                                                style={{ backgroundColor: color }}
                                                onClick={() => setBgColor(color)}
                                                title={color}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="toolbar-divider"></div>

                    {/* Alignment */}
                    <div className="toolbar-group">
                        <button
                            onClick={() => setAlignment('left')}
                            className="toolbar-btn"
                            title="Align Left"
                        >
                            ⬅
                        </button>
                        <button
                            onClick={() => setAlignment('center')}
                            className="toolbar-btn"
                            title="Align Center"
                        >
                            ↔
                        </button>
                        <button
                            onClick={() => setAlignment('right')}
                            className="toolbar-btn"
                            title="Align Right"
                        >
                            ➡
                        </button>
                    </div>

                    <div className="toolbar-divider"></div>
                </>
            )}

            {/* Comment */}
            <div className="toolbar-group">
                <button
                    onClick={handleAddComment}
                    className="toolbar-btn comment-btn"
                    title="Add Comment"
                >
                    💬 Comment
                </button>
            </div>
        </div>
    );
};

export default SheetSelectionToolbar;
