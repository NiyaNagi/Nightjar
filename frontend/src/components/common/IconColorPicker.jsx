/**
 * IconColorPicker Component
 * 
 * A unified picker for selecting icons and colors.
 * Used for workspaces, folders, and documents.
 * Appears as a small icon button that opens a popover panel.
 */

import React, { useState, useRef, useEffect } from 'react';
import './IconColorPicker.css';

// Preset emoji icons organized by category
const PRESET_ICONS = {
  folders: ['📁', '📂', '🗂️', '📑', '📋', '📚', '📖', '🗃️'],
  documents: ['📄', '📝', '📃', '📜', '📰', '🗒️', '📓', '📔'],
  work: ['💼', '📊', '📈', '🎯', '💡', '⚙️', '🔧', '🛠️'],
  creative: ['🎨', '✨', '🌟', '💫', '🎭', '🎬', '🎵', '🎸'],
  nature: ['🌸', '🌺', '🌻', '🌹', '🍀', '🌲', '🌈', '☀️'],
  tech: ['💻', '📱', '🖥️', '⌨️', '🖱️', '🔌', '💾', '📡'],
  objects: ['🏠', '🚀', '🔮', '💎', '🎁', '🏆', '🎪', '🎡'],
  symbols: ['❤️', '💙', '💚', '💛', '🧡', '💜', '🖤', '🤍'],
};

// Preset colors with accessible names
const PRESET_COLORS = [
  { hex: '#ef4444', name: 'Red' },
  { hex: '#f97316', name: 'Orange' },
  { hex: '#f59e0b', name: 'Amber' },
  { hex: '#eab308', name: 'Yellow' },
  { hex: '#84cc16', name: 'Lime' },
  { hex: '#22c55e', name: 'Green' },
  { hex: '#10b981', name: 'Emerald' },
  { hex: '#14b8a6', name: 'Teal' },
  { hex: '#06b6d4', name: 'Cyan' },
  { hex: '#0ea5e9', name: 'Sky Blue' },
  { hex: '#3b82f6', name: 'Blue' },
  { hex: '#6366f1', name: 'Indigo' },
  { hex: '#8b5cf6', name: 'Violet' },
  { hex: '#a855f7', name: 'Purple' },
  { hex: '#d946ef', name: 'Fuchsia' },
  { hex: '#ec4899', name: 'Pink' },
  { hex: '#f43f5e', name: 'Rose' },
  { hex: '#64748b', name: 'Slate' },
  { hex: '#1e293b', name: 'Dark Blue' },
  { hex: '#374151', name: 'Gray' }
];

// For backward compatibility - flat list of hex values
const PRESET_COLOR_HEXES = PRESET_COLORS.map(c => c.hex);

// Flatten icons for display
const ALL_ICONS = Object.values(PRESET_ICONS).flat();

export default function IconColorPicker({
  icon = '📁',
  color = '#6366f1',
  onIconChange,
  onColorChange,
  size = 'medium', // 'small', 'medium', 'large'
  disabled = false,
  showColorPreview = true,
  compact = false, // For inline display without popover
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('icon'); // 'icon' or 'color'
  const [customColor, setCustomColor] = useState(color);
  const pickerRef = useRef(null);
  const triggerRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Handle keyboard
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      triggerRef.current?.focus();
    }
  };

  const handleIconSelect = (newIcon) => {
    onIconChange?.(newIcon);
  };

  const handleColorSelect = (newColor) => {
    onColorChange?.(newColor);
    setCustomColor(newColor);
  };

  const handleCustomColorChange = (e) => {
    const newColor = e.target.value;
    setCustomColor(newColor);
    onColorChange?.(newColor);
  };

  const sizeClasses = {
    small: 'icon-color-picker--small',
    medium: 'icon-color-picker--medium',
    large: 'icon-color-picker--large',
  };

  return (
    <div 
      className={`icon-color-picker ${sizeClasses[size]} ${compact ? 'icon-color-picker--compact' : ''}`} 
      ref={pickerRef}
      onKeyDown={handleKeyDown}
    >
      {!compact && (
        <button
          ref={triggerRef}
          type="button"
          className="icon-color-picker__trigger"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          style={{ 
            backgroundColor: showColorPreview ? color : undefined,
            borderColor: showColorPreview ? color : undefined,
          }}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          title="Change icon and color"
        >
          <span className="icon-color-picker__icon">{icon}</span>
        </button>
      )}

      {(isOpen || compact) && (
        <div className="icon-color-picker__panel" role="dialog" aria-label="Pick icon and color">
          {/* Tabs */}
          <div className="icon-color-picker__tabs">
            <button
              type="button"
              className={`icon-color-picker__tab ${activeTab === 'icon' ? 'icon-color-picker__tab--active' : ''}`}
              onClick={() => setActiveTab('icon')}
            >
              😊 Icon
            </button>
            <button
              type="button"
              className={`icon-color-picker__tab ${activeTab === 'color' ? 'icon-color-picker__tab--active' : ''}`}
              onClick={() => setActiveTab('color')}
            >
              🎨 Color
            </button>
          </div>

          {/* Icon picker content */}
          {activeTab === 'icon' && (
            <div className="icon-color-picker__content">
              <div className="icon-color-picker__grid">
                {ALL_ICONS.map((iconOption) => (
                  <button
                    key={iconOption}
                    type="button"
                    className={`icon-color-picker__option ${icon === iconOption ? 'icon-color-picker__option--selected' : ''}`}
                    onClick={() => handleIconSelect(iconOption)}
                    aria-label={`Select ${iconOption} icon`}
                    aria-pressed={icon === iconOption}
                  >
                    {iconOption}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Color picker content */}
          {activeTab === 'color' && (
            <div className="icon-color-picker__content">
              <div className="icon-color-picker__grid icon-color-picker__grid--colors">
                {PRESET_COLORS.map((colorOption) => (
                  <button
                    key={colorOption.hex}
                    type="button"
                    className={`icon-color-picker__color ${color === colorOption.hex ? 'icon-color-picker__color--selected' : ''}`}
                    style={{ backgroundColor: colorOption.hex }}
                    onClick={() => handleColorSelect(colorOption.hex)}
                    title={colorOption.name}
                    aria-label={`Select ${colorOption.name} color`}
                  />
                ))}
              </div>
              <div className="icon-color-picker__custom">
                <label className="icon-color-picker__custom-label">
                  Custom:
                  <input
                    type="color"
                    value={customColor}
                    onChange={handleCustomColorChange}
                    className="icon-color-picker__custom-input"
                  />
                  <input
                    type="text"
                    value={customColor}
                    onChange={(e) => {
                      if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) {
                        setCustomColor(e.target.value);
                        if (e.target.value.length === 7) {
                          onColorChange?.(e.target.value);
                        }
                      }
                    }}
                    className="icon-color-picker__hex-input"
                    maxLength={7}
                    placeholder="#6366f1"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Preview */}
          <div className="icon-color-picker__preview">
            <span 
              className="icon-color-picker__preview-badge"
              style={{ backgroundColor: color }}
            >
              {icon}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export { PRESET_ICONS, PRESET_COLORS, PRESET_COLOR_HEXES, ALL_ICONS };
