/**
 * SheetSelectionToolbar Component
 * 
 * A floating toolbar that appears when cells are selected in a spreadsheet.
 * Provides quick access to formatting options and commenting.
 * 
 * Features:
 * - Collapsed chip state (semi-transparent) by default
 * - Expands on hover to reveal full toolbar
 * - Hides when modals are open or focus leaves the spreadsheet
 * - Bold, Italic, Underline, Strikethrough
 * - Text color
 * - Background color
 * - Text alignment
 * - Add comment on selection
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import './SelectionToolbar.css';

// Color presets for quick selection
const COLOR_PRESETS = [
    '#000000', '#434343', '#666666', '#999999', '#cccccc', '#ffffff',
    '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#0000ff',
    '#9900ff', '#ff00ff', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3',
    '#cfe2f3', '#d9d2e9', '#ead1dc', '#c9daf8',
];

// Check if any modal overlay is currently visible
const isModalOpen = () => {
    // Check for common modal overlay classes used in the app
    const modalSelectors = [
        '.kicked-modal-overlay',
        '.recovery-modal-overlay', 
        '.join-modal-overlay',
        '[role="dialog"]',
        '[role="alertdialog"]',
        '.modal-overlay',
    ];
    return modalSelectors.some(sel => document.querySelector(sel) !== null);
};

const SheetSelectionToolbar = ({ 
    selection,           // { row: [start, end], column: [start, end], sheetId }
    position,            // { x, y } screen coordinates
    workbookRef,         // Reference to Fortune Sheet workbook
    onAddComment,        // Callback to add comment on selection
    readOnly = false,
    containerRef,        // Reference to the sheet container for focus tracking
}) => {
    const [showColorPicker, setShowColorPicker] = useState(null); // 'text' | 'bg' | null
    const [showFormatMenu, setShowFormatMenu] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);          // Collapsed by default
    const [isHidden, setIsHidden] = useState(false);              // Hidden when modal open or focus lost
    const toolbarRef = useRef(null);
    const colorPickerRef = useRef(null);
    const hoverTimeoutRef = useRef(null);

    // Check for modal visibility on mount and periodically
    useEffect(() => {
        const checkModals = () => {
            setIsHidden(isModalOpen());
        };
        
        // Check immediately
        checkModals();
        
        // Use MutationObserver to detect modal changes
        const observer = new MutationObserver(checkModals);
        observer.observe(document.body, { 
            childList: true, 
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'role']
        });
        
        return () => observer.disconnect();
    }, []);

    // Track focus to hide toolbar when focus leaves spreadsheet
    useEffect(() => {
        const handleFocusOut = (e) => {
            // Small delay to allow focus to move to new element
            setTimeout(() => {
                const activeElement = document.activeElement;
                const container = containerRef?.current;
                const toolbar = toolbarRef.current;
                
                // Check if focus is within the sheet container or the toolbar itself
                const focusInContainer = container && container.contains(activeElement);
                const focusInToolbar = toolbar && toolbar.contains(activeElement);
                
                // Also check if focus is in a Fortune Sheet element
                const focusInSheet = activeElement?.closest('.fortune-sheet-container, .luckysheet-cell-input, .sheet-container');
                
                // Hide if focus is completely outside
                if (!focusInContainer && !focusInToolbar && !focusInSheet) {
                    setIsHidden(true);
                }
            }, 100);
        };
        
        document.addEventListener('focusout', handleFocusOut);
        return () => document.removeEventListener('focusout', handleFocusOut);
    }, [containerRef]);

    // Reset hidden state when selection changes
    useEffect(() => {
        if (selection && position) {
            setIsHidden(isModalOpen());
        }
    }, [selection, position]);

    // Handle mouse enter/leave for expansion
    const handleMouseEnter = useCallback(() => {
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
        }
        setIsExpanded(true);
    }, []);

    const handleMouseLeave = useCallback(() => {
        // Close color pickers when leaving
        setShowColorPicker(null);
        // Small delay before collapsing for better UX
        hoverTimeoutRef.current = setTimeout(() => {
            setIsExpanded(false);
        }, 150);
    }, []);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
            }
        };
    }, []);

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

    if (!selection || !position || isHidden) return null;

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

    // Calculate toolbar position (anchor at upper-right of selection)
    const getToolbarStyle = () => {
        const style = {
            position: 'fixed',
            zIndex: 1200,
        };
        
        // Position right at the upper-right corner of the cell
        // Anchor directly next to the cell for easy access
        style.left = position.x + 50; // Position at right edge of selection
        style.top = position.y + 2;   // Just inside the top of the cell
        
        // Adjust if too close to top
        if (position.y < 40) {
            style.top = position.y + 25;
        }
        
        // Adjust if too close to right edge
        const viewportWidth = window.innerWidth;
        if (style.left > viewportWidth - 120) {
            style.left = viewportWidth - 120;
        }
        
        return style;
    };

    return (
        <div 
            ref={toolbarRef}
            className={`selection-toolbar sheet-selection-toolbar ${isExpanded ? 'expanded' : 'collapsed'}`}
            style={getToolbarStyle()}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {/* Cell Reference Badge - Always visible, expands toolbar on hover */}
            <div className="toolbar-group chip-content">
                <span className="cell-ref-badge" title="Selected range - hover to format">
                    {getCellRef()}
                </span>
            </div>

            {/* Expanded content - only visible when expanded */}
            {isExpanded && (
                <>
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
                </>
            )}
        </div>
    );
};

export default SheetSelectionToolbar;
