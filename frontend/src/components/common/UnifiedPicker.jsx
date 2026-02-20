/**
 * UnifiedPicker Component
 *
 * A comprehensive emoji + color picker that replaces all bespoke icon/color
 * pickers across the app. Features an inline mini-strip for quick picks and
 * a full popover with a Teams-like emoji browser and expanded color palette.
 *
 * Backward-compatible API with the old IconColorPicker.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import './UnifiedPicker.css';

// ---------------------------------------------------------------------------
// EMOJI DATA — ~210+ emojis across 10 categories, each with keywords
// ---------------------------------------------------------------------------
const EMOJI_DATA = {
  smileys: {
    label: '😊 Smileys',
    icon: '😊',
    emojis: [
      { emoji: '😀', keywords: ['grinning', 'happy', 'smile', 'face'] },
      { emoji: '😃', keywords: ['smiley', 'happy', 'joy'] },
      { emoji: '😄', keywords: ['laugh', 'happy', 'smile'] },
      { emoji: '😁', keywords: ['grin', 'beam', 'teeth'] },
      { emoji: '😆', keywords: ['laughing', 'squint', 'xd'] },
      { emoji: '😅', keywords: ['sweat', 'nervous', 'relief'] },
      { emoji: '🤣', keywords: ['rofl', 'rolling', 'lol'] },
      { emoji: '😂', keywords: ['tears', 'joy', 'crying laughing'] },
      { emoji: '🙂', keywords: ['slight smile', 'okay', 'fine'] },
      { emoji: '😊', keywords: ['blush', 'happy', 'warm'] },
      { emoji: '😇', keywords: ['angel', 'innocent', 'halo'] },
      { emoji: '🥰', keywords: ['love', 'hearts', 'adore'] },
      { emoji: '😍', keywords: ['heart eyes', 'love', 'crush'] },
      { emoji: '🤩', keywords: ['star struck', 'wow', 'amazing'] },
      { emoji: '😘', keywords: ['kiss', 'love', 'blow kiss'] },
      { emoji: '😜', keywords: ['wink', 'tongue', 'playful'] },
      { emoji: '🤔', keywords: ['thinking', 'hmm', 'consider'] },
      { emoji: '🤗', keywords: ['hug', 'embrace', 'warm'] },
      { emoji: '😎', keywords: ['cool', 'sunglasses', 'awesome'] },
      { emoji: '🥳', keywords: ['party', 'celebrate', 'birthday'] },
      { emoji: '😤', keywords: ['angry', 'huff', 'frustrated'] },
      { emoji: '😱', keywords: ['scream', 'shock', 'horror'] },
      { emoji: '🥺', keywords: ['pleading', 'puppy eyes', 'please'] },
      { emoji: '😴', keywords: ['sleep', 'zzz', 'tired'] },
    ],
  },
  people: {
    label: '👋 People',
    icon: '👋',
    emojis: [
      { emoji: '👋', keywords: ['wave', 'hello', 'hi', 'bye'] },
      { emoji: '🤚', keywords: ['raised hand', 'stop', 'halt'] },
      { emoji: '✋', keywords: ['hand', 'high five', 'stop'] },
      { emoji: '👌', keywords: ['ok', 'perfect', 'fine'] },
      { emoji: '✌️', keywords: ['peace', 'victory', 'two'] },
      { emoji: '🤞', keywords: ['fingers crossed', 'luck', 'hope'] },
      { emoji: '👍', keywords: ['thumbs up', 'yes', 'good', 'like'] },
      { emoji: '👎', keywords: ['thumbs down', 'no', 'bad', 'dislike'] },
      { emoji: '👏', keywords: ['clap', 'bravo', 'applause'] },
      { emoji: '🙌', keywords: ['raise', 'celebration', 'hooray'] },
      { emoji: '🤝', keywords: ['handshake', 'deal', 'agreement'] },
      { emoji: '💪', keywords: ['strong', 'muscle', 'flex', 'power'] },
      { emoji: '🙏', keywords: ['pray', 'please', 'thank you', 'hope'] },
      { emoji: '👀', keywords: ['eyes', 'look', 'see', 'watch'] },
      { emoji: '🧠', keywords: ['brain', 'smart', 'think', 'mind'] },
      { emoji: '👤', keywords: ['person', 'user', 'silhouette'] },
      { emoji: '👥', keywords: ['people', 'group', 'team'] },
      { emoji: '🧑‍💻', keywords: ['developer', 'coder', 'programmer', 'tech'] },
      { emoji: '🧑‍🎨', keywords: ['artist', 'creative', 'painter'] },
      { emoji: '🧑‍🔬', keywords: ['scientist', 'research', 'lab'] },
    ],
  },
  animals: {
    label: '🐾 Animals',
    icon: '🐾',
    emojis: [
      { emoji: '🐶', keywords: ['dog', 'puppy', 'pet'] },
      { emoji: '🐱', keywords: ['cat', 'kitten', 'pet'] },
      { emoji: '🐭', keywords: ['mouse', 'rodent', 'small'] },
      { emoji: '🐹', keywords: ['hamster', 'pet', 'cute'] },
      { emoji: '🐰', keywords: ['rabbit', 'bunny', 'easter'] },
      { emoji: '🦊', keywords: ['fox', 'clever', 'orange'] },
      { emoji: '🐻', keywords: ['bear', 'brown', 'teddy'] },
      { emoji: '🐼', keywords: ['panda', 'bamboo', 'cute'] },
      { emoji: '🐨', keywords: ['koala', 'australia', 'cute'] },
      { emoji: '🦁', keywords: ['lion', 'king', 'brave'] },
      { emoji: '🐮', keywords: ['cow', 'moo', 'farm'] },
      { emoji: '🐷', keywords: ['pig', 'oink', 'farm'] },
      { emoji: '🐸', keywords: ['frog', 'toad', 'green'] },
      { emoji: '🐵', keywords: ['monkey', 'ape', 'primate'] },
      { emoji: '🐔', keywords: ['chicken', 'hen', 'farm'] },
      { emoji: '🦄', keywords: ['unicorn', 'magic', 'fantasy'] },
      { emoji: '🐝', keywords: ['bee', 'honey', 'buzz'] },
      { emoji: '🦋', keywords: ['butterfly', 'insect', 'pretty'] },
      { emoji: '🐾', keywords: ['paw', 'prints', 'animal', 'pet'] },
      { emoji: '🐍', keywords: ['snake', 'reptile', 'python'] },
      { emoji: '🐙', keywords: ['octopus', 'tentacle', 'sea'] },
      { emoji: '🐬', keywords: ['dolphin', 'ocean', 'smart'] },
      { emoji: '🐳', keywords: ['whale', 'ocean', 'big'] },
      { emoji: '🦅', keywords: ['eagle', 'bird', 'nightjar', 'fly'] },
    ],
  },
  nature: {
    label: '🌸 Nature',
    icon: '🌸',
    emojis: [
      { emoji: '🌸', keywords: ['cherry blossom', 'flower', 'spring'] },
      { emoji: '🌺', keywords: ['hibiscus', 'flower', 'tropical'] },
      { emoji: '🌻', keywords: ['sunflower', 'yellow', 'happy'] },
      { emoji: '🌹', keywords: ['rose', 'flower', 'love', 'red'] },
      { emoji: '🌷', keywords: ['tulip', 'flower', 'spring'] },
      { emoji: '🌼', keywords: ['blossom', 'flower', 'daisy'] },
      { emoji: '🍀', keywords: ['clover', 'luck', 'four leaf'] },
      { emoji: '🌲', keywords: ['tree', 'evergreen', 'pine'] },
      { emoji: '🌴', keywords: ['palm', 'tree', 'tropical', 'beach'] },
      { emoji: '🌈', keywords: ['rainbow', 'colors', 'hope'] },
      { emoji: '☀️', keywords: ['sun', 'sunny', 'bright', 'warm'] },
      { emoji: '🌙', keywords: ['moon', 'night', 'crescent'] },
      { emoji: '⭐', keywords: ['star', 'favorite', 'shiny'] },
      { emoji: '🌟', keywords: ['glowing star', 'sparkle', 'shine'] },
      { emoji: '✨', keywords: ['sparkles', 'magic', 'new', 'clean'] },
      { emoji: '💫', keywords: ['dizzy', 'star', 'shooting'] },
      { emoji: '🔥', keywords: ['fire', 'hot', 'flame', 'lit'] },
      { emoji: '💧', keywords: ['water', 'drop', 'rain'] },
      { emoji: '🌊', keywords: ['wave', 'ocean', 'sea', 'water'] },
      { emoji: '❄️', keywords: ['snowflake', 'cold', 'winter', 'ice'] },
    ],
  },
  food: {
    label: '🍔 Food',
    icon: '🍔',
    emojis: [
      { emoji: '🍎', keywords: ['apple', 'red', 'fruit', 'healthy'] },
      { emoji: '🍊', keywords: ['orange', 'citrus', 'fruit'] },
      { emoji: '🍋', keywords: ['lemon', 'yellow', 'sour'] },
      { emoji: '🍇', keywords: ['grapes', 'purple', 'fruit'] },
      { emoji: '🍓', keywords: ['strawberry', 'red', 'berry'] },
      { emoji: '🍑', keywords: ['peach', 'fruit', 'pink'] },
      { emoji: '🍕', keywords: ['pizza', 'food', 'italian'] },
      { emoji: '🍔', keywords: ['hamburger', 'burger', 'food'] },
      { emoji: '🌮', keywords: ['taco', 'mexican', 'food'] },
      { emoji: '🍣', keywords: ['sushi', 'japanese', 'food'] },
      { emoji: '🍩', keywords: ['donut', 'doughnut', 'sweet'] },
      { emoji: '🍰', keywords: ['cake', 'dessert', 'birthday'] },
      { emoji: '🍫', keywords: ['chocolate', 'candy', 'sweet'] },
      { emoji: '☕', keywords: ['coffee', 'tea', 'hot', 'cafe'] },
      { emoji: '🍺', keywords: ['beer', 'drink', 'cheers'] },
      { emoji: '🥤', keywords: ['drink', 'soda', 'cup'] },
      { emoji: '🧁', keywords: ['cupcake', 'sweet', 'dessert'] },
      { emoji: '🥑', keywords: ['avocado', 'guacamole', 'healthy'] },
      { emoji: '🌶️', keywords: ['pepper', 'hot', 'spicy', 'chili'] },
      { emoji: '🍿', keywords: ['popcorn', 'movie', 'snack'] },
    ],
  },
  activities: {
    label: '🎮 Activities',
    icon: '🎮',
    emojis: [
      { emoji: '⚽', keywords: ['soccer', 'football', 'ball', 'sport'] },
      { emoji: '🏀', keywords: ['basketball', 'sport', 'ball'] },
      { emoji: '🏈', keywords: ['football', 'american', 'sport'] },
      { emoji: '⚾', keywords: ['baseball', 'sport', 'ball'] },
      { emoji: '🎾', keywords: ['tennis', 'sport', 'ball'] },
      { emoji: '🏐', keywords: ['volleyball', 'sport', 'ball'] },
      { emoji: '🎮', keywords: ['game', 'controller', 'video game', 'gaming'] },
      { emoji: '🎲', keywords: ['dice', 'game', 'random', 'luck'] },
      { emoji: '🎯', keywords: ['target', 'dart', 'goal', 'bullseye'] },
      { emoji: '🏆', keywords: ['trophy', 'winner', 'champion', 'award'] },
      { emoji: '🥇', keywords: ['gold', 'medal', 'first', 'winner'] },
      { emoji: '🎪', keywords: ['circus', 'tent', 'carnival'] },
      { emoji: '🎨', keywords: ['art', 'palette', 'paint', 'creative'] },
      { emoji: '🎭', keywords: ['theater', 'drama', 'masks', 'acting'] },
      { emoji: '🎬', keywords: ['movie', 'film', 'clapper', 'cinema'] },
      { emoji: '🎵', keywords: ['music', 'note', 'song', 'melody'] },
      { emoji: '🎸', keywords: ['guitar', 'rock', 'music', 'instrument'] },
      { emoji: '🎹', keywords: ['piano', 'keyboard', 'music', 'keys'] },
      { emoji: '🎤', keywords: ['microphone', 'sing', 'karaoke'] },
      { emoji: '🎧', keywords: ['headphones', 'music', 'listen', 'audio'] },
    ],
  },
  travel: {
    label: '✈️ Travel',
    icon: '✈️',
    emojis: [
      { emoji: '🚗', keywords: ['car', 'auto', 'drive', 'vehicle'] },
      { emoji: '🚕', keywords: ['taxi', 'cab', 'ride'] },
      { emoji: '🚌', keywords: ['bus', 'transit', 'public'] },
      { emoji: '🚀', keywords: ['rocket', 'space', 'launch', 'fast'] },
      { emoji: '✈️', keywords: ['airplane', 'plane', 'fly', 'travel'] },
      { emoji: '🚂', keywords: ['train', 'locomotive', 'rail'] },
      { emoji: '🚢', keywords: ['ship', 'boat', 'cruise', 'sail'] },
      { emoji: '🏠', keywords: ['house', 'home', 'building'] },
      { emoji: '🏢', keywords: ['office', 'building', 'work'] },
      { emoji: '🏫', keywords: ['school', 'education', 'building'] },
      { emoji: '🏥', keywords: ['hospital', 'medical', 'health'] },
      { emoji: '⛪', keywords: ['church', 'religion', 'building'] },
      { emoji: '🗽', keywords: ['statue of liberty', 'new york', 'landmark'] },
      { emoji: '🗼', keywords: ['tower', 'tokyo', 'landmark'] },
      { emoji: '🏰', keywords: ['castle', 'fairy tale', 'medieval'] },
      { emoji: '🌍', keywords: ['globe', 'earth', 'world', 'europe'] },
      { emoji: '🌎', keywords: ['globe', 'earth', 'americas'] },
      { emoji: '🗺️', keywords: ['map', 'world', 'geography'] },
      { emoji: '🏖️', keywords: ['beach', 'vacation', 'umbrella'] },
      { emoji: '🏔️', keywords: ['mountain', 'snow', 'peak'] },
    ],
  },
  objects: {
    label: '💡 Objects',
    icon: '💡',
    emojis: [
      { emoji: '💡', keywords: ['idea', 'light', 'bulb', 'bright'] },
      { emoji: '🔮', keywords: ['crystal ball', 'magic', 'fortune'] },
      { emoji: '💎', keywords: ['diamond', 'gem', 'jewel', 'precious'] },
      { emoji: '🔑', keywords: ['key', 'lock', 'access', 'secure'] },
      { emoji: '🔒', keywords: ['lock', 'secure', 'private', 'closed'] },
      { emoji: '🔓', keywords: ['unlock', 'open', 'access'] },
      { emoji: '📱', keywords: ['phone', 'mobile', 'cell', 'smartphone'] },
      { emoji: '💻', keywords: ['laptop', 'computer', 'pc', 'tech'] },
      { emoji: '🖥️', keywords: ['desktop', 'monitor', 'screen', 'computer'] },
      { emoji: '⌨️', keywords: ['keyboard', 'type', 'input'] },
      { emoji: '📷', keywords: ['camera', 'photo', 'picture'] },
      { emoji: '📚', keywords: ['books', 'library', 'read', 'study'] },
      { emoji: '📖', keywords: ['book', 'open', 'read'] },
      { emoji: '📝', keywords: ['memo', 'note', 'write', 'pencil'] },
      { emoji: '📋', keywords: ['clipboard', 'list', 'task'] },
      { emoji: '📁', keywords: ['folder', 'file', 'directory'] },
      { emoji: '📂', keywords: ['folder', 'open', 'file'] },
      { emoji: '📊', keywords: ['chart', 'graph', 'bar', 'data', 'stats'] },
      { emoji: '📈', keywords: ['chart', 'growth', 'up', 'trend'] },
      { emoji: '📅', keywords: ['calendar', 'date', 'schedule'] },
      { emoji: '💼', keywords: ['briefcase', 'work', 'business', 'job'] },
      { emoji: '🎁', keywords: ['gift', 'present', 'birthday', 'box'] },
      { emoji: '⚙️', keywords: ['gear', 'settings', 'config', 'cog'] },
      { emoji: '🔧', keywords: ['wrench', 'tool', 'fix', 'repair'] },
      { emoji: '🛠️', keywords: ['tools', 'hammer', 'wrench', 'build'] },
      { emoji: '💾', keywords: ['floppy', 'save', 'disk', 'storage'] },
      { emoji: '📡', keywords: ['satellite', 'antenna', 'signal'] },
      { emoji: '🔌', keywords: ['plug', 'electric', 'power', 'connect'] },
      { emoji: '🗃️', keywords: ['card box', 'file', 'archive', 'storage'] },
      { emoji: '🗂️', keywords: ['dividers', 'tabs', 'organize', 'index'] },
    ],
  },
  symbols: {
    label: '🔣 Symbols',
    icon: '🔣',
    emojis: [
      { emoji: '❤️', keywords: ['heart', 'love', 'red'] },
      { emoji: '🧡', keywords: ['heart', 'orange', 'love'] },
      { emoji: '💛', keywords: ['heart', 'yellow', 'love'] },
      { emoji: '💚', keywords: ['heart', 'green', 'love'] },
      { emoji: '💙', keywords: ['heart', 'blue', 'love'] },
      { emoji: '💜', keywords: ['heart', 'purple', 'love'] },
      { emoji: '🖤', keywords: ['heart', 'black', 'dark'] },
      { emoji: '🤍', keywords: ['heart', 'white', 'pure'] },
      { emoji: '💯', keywords: ['hundred', 'perfect', 'score', '100'] },
      { emoji: '✅', keywords: ['check', 'done', 'complete', 'yes'] },
      { emoji: '❌', keywords: ['cross', 'no', 'wrong', 'delete'] },
      { emoji: '❓', keywords: ['question', 'help', 'what'] },
      { emoji: '❗', keywords: ['exclamation', 'important', 'alert'] },
      { emoji: '⚠️', keywords: ['warning', 'caution', 'alert'] },
      { emoji: '🔴', keywords: ['red circle', 'dot', 'stop'] },
      { emoji: '🟢', keywords: ['green circle', 'dot', 'go'] },
      { emoji: '🔵', keywords: ['blue circle', 'dot'] },
      { emoji: '🟡', keywords: ['yellow circle', 'dot'] },
      { emoji: '⬆️', keywords: ['up', 'arrow', 'north'] },
      { emoji: '⬇️', keywords: ['down', 'arrow', 'south'] },
      { emoji: '➡️', keywords: ['right', 'arrow', 'east', 'next'] },
      { emoji: '⬅️', keywords: ['left', 'arrow', 'west', 'back'] },
      { emoji: '♻️', keywords: ['recycle', 'environment', 'green'] },
      { emoji: '🔗', keywords: ['link', 'chain', 'connect', 'url'] },
    ],
  },
  flags: {
    label: '🏁 Flags',
    icon: '🏁',
    emojis: [
      { emoji: '🏁', keywords: ['checkered', 'finish', 'race', 'flag'] },
      { emoji: '🚩', keywords: ['red flag', 'warning', 'triangular'] },
      { emoji: '🎌', keywords: ['crossed flags', 'japan', 'celebration'] },
      { emoji: '🏴', keywords: ['black flag', 'pirate'] },
      { emoji: '🏳️', keywords: ['white flag', 'surrender', 'peace'] },
      { emoji: '🏳️‍🌈', keywords: ['rainbow', 'pride', 'lgbtq'] },
      { emoji: '🇺🇸', keywords: ['usa', 'america', 'united states'] },
      { emoji: '🇬🇧', keywords: ['uk', 'britain', 'england'] },
      { emoji: '🇫🇷', keywords: ['france', 'french'] },
      { emoji: '🇩🇪', keywords: ['germany', 'german'] },
      { emoji: '🇮🇹', keywords: ['italy', 'italian'] },
      { emoji: '🇪🇸', keywords: ['spain', 'spanish'] },
      { emoji: '🇯🇵', keywords: ['japan', 'japanese'] },
      { emoji: '🇰🇷', keywords: ['korea', 'south korea', 'korean'] },
      { emoji: '🇨🇳', keywords: ['china', 'chinese'] },
      { emoji: '🇧🇷', keywords: ['brazil', 'brazilian'] },
      { emoji: '🇨🇦', keywords: ['canada', 'canadian'] },
      { emoji: '🇦🇺', keywords: ['australia', 'australian'] },
      { emoji: '🇮🇳', keywords: ['india', 'indian'] },
      { emoji: '🇲🇽', keywords: ['mexico', 'mexican'] },
    ],
  },
};

// ---------------------------------------------------------------------------
// EMOJI CATEGORIES — ordered array for iteration
// ---------------------------------------------------------------------------
const EMOJI_CATEGORIES = Object.keys(EMOJI_DATA);

// ---------------------------------------------------------------------------
// ALL_ICONS — flat array of every emoji string
// ---------------------------------------------------------------------------
const ALL_ICONS = EMOJI_CATEGORIES.flatMap((cat) =>
  EMOJI_DATA[cat].emojis.map((e) => e.emoji)
);

// ---------------------------------------------------------------------------
// Popular emojis for the mini-strip when there are no recents
// ---------------------------------------------------------------------------
const POPULAR_EMOJIS = [
  '📁', '📝', '🚀', '💡', '⭐', '🔥', '✨', '🎯', '💎', '📊',
  '🎨', '🏆', '📚', '⚙️', '💼', '🌟',
];

// ---------------------------------------------------------------------------
// COLOR PALETTE — 30 colors spanning the full spectrum
// ---------------------------------------------------------------------------
const PRESET_COLORS = [
  { hex: '#ef4444', name: 'Red' },
  { hex: '#f87171', name: 'Red Light' },
  { hex: '#f97316', name: 'Orange' },
  { hex: '#f59e0b', name: 'Amber' },
  { hex: '#eab308', name: 'Yellow' },
  { hex: '#fde047', name: 'Yellow Light' },
  { hex: '#84cc16', name: 'Lime' },
  { hex: '#22c55e', name: 'Green' },
  { hex: '#10b981', name: 'Emerald' },
  { hex: '#14b8a6', name: 'Teal' },
  { hex: '#06b6d4', name: 'Cyan' },
  { hex: '#0ea5e9', name: 'Sky' },
  { hex: '#3b82f6', name: 'Blue' },
  { hex: '#60a5fa', name: 'Blue Light' },
  { hex: '#6366f1', name: 'Indigo' },
  { hex: '#8b5cf6', name: 'Violet' },
  { hex: '#a855f7', name: 'Purple' },
  { hex: '#d946ef', name: 'Fuchsia' },
  { hex: '#ec4899', name: 'Pink' },
  { hex: '#f43f5e', name: 'Rose' },
  { hex: '#78716c', name: 'Warm Gray' },
  { hex: '#6b7280', name: 'Cool Gray' },
  { hex: '#64748b', name: 'Slate' },
  { hex: '#1e3a5f', name: 'Dark Blue' },
  { hex: '#92400e', name: 'Brown' },
  { hex: '#ff6f61', name: 'Coral' },
  { hex: '#6ee7b7', name: 'Mint' },
  { hex: '#c4b5fd', name: 'Lavender' },
  { hex: '#ffffff', name: 'White' },
  { hex: '#111111', name: 'Black' },
];

const PRESET_COLOR_HEXES = PRESET_COLORS.map((c) => c.hex);

// ---------------------------------------------------------------------------
// Backward-compat alias for the old PRESET_ICONS export
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// localStorage helpers for recent emojis
// ---------------------------------------------------------------------------
const LS_KEY = 'nightjar-recent-emojis';
const MAX_RECENT = 16;

function loadRecentEmojis() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.slice(0, MAX_RECENT);
    }
  } catch {
    // ignore corrupt data
  }
  return [];
}

function saveRecentEmojis(arr) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(arr.slice(0, MAX_RECENT)));
  } catch {
    // ignore quota errors
  }
}

function addRecentEmoji(emoji, prev) {
  const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, MAX_RECENT);
  saveRecentEmojis(next);
  return next;
}

// ---------------------------------------------------------------------------
// Debounce hook
// ---------------------------------------------------------------------------
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// COMPONENT
// ---------------------------------------------------------------------------
function UnifiedPicker({
  icon = '📁',
  color = '#6366f1',
  onIconChange,
  onColorChange,
  size = 'medium',
  disabled = false,
  compact = false,
  showStrip,             // deprecated — ignored (kept for backward compat)
  showColorPreview,      // deprecated — ignored
  mode = 'both',
}) {
  // ---- state ----
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [activeCategory, setActiveCategory] = useState(EMOJI_CATEGORIES[0]);
  const [recentEmojis, setRecentEmojis] = useState(loadRecentEmojis);
  const [customColor, setCustomColor] = useState(color || '#6366f1');
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

  // ---- refs ----
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const searchRef = useRef(null);
  const categoryTabsRef = useRef(null);

  // debounced search
  const debouncedSearch = useDebounce(searchText, 150);

  // sync customColor when prop changes externally
  useEffect(() => {
    setCustomColor(color || '#6366f1');
  }, [color]);

  // ---- position the portal popover near the trigger ----
  useEffect(() => {
    if (!isOpen || !triggerRef.current || compact) return;

    const updatePos = () => {
      const rect = triggerRef.current.getBoundingClientRect();
      const popW = 520;
      const gap = 8;
      let top = rect.bottom + gap;
      let left = rect.left;

      // Keep within viewport
      if (left + popW > window.innerWidth - gap) {
        left = window.innerWidth - popW - gap;
      }
      if (left < gap) left = gap;

      // Flip above if no room below (estimate 420px height)
      if (top + 420 > window.innerHeight - gap) {
        top = rect.top - 420 - gap;
        if (top < gap) top = gap;
      }

      setPopoverPos({ top, left });
    };

    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [isOpen, compact]);

  // ---- click-outside to close (checks both trigger and portal popover) ----
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      const inTrigger = triggerRef.current?.contains(e.target);
      const inPopover = popoverRef.current?.contains(e.target);
      if (!inTrigger && !inPopover) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // ---- escape key ----
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen]);

  // ---- focus search when popover opens ----
  useEffect(() => {
    if (isOpen && searchRef.current) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [isOpen]);

  // ---- handlers ----
  const handleIconSelect = useCallback(
    (emoji) => {
      setRecentEmojis((prev) => addRecentEmoji(emoji, prev));
      onIconChange?.(emoji);
    },
    [onIconChange]
  );

  const handleColorSelect = useCallback(
    (hex) => {
      setCustomColor(hex);
      onColorChange?.(hex);
    },
    [onColorChange]
  );

  const handleCustomNativeColor = useCallback(
    (e) => {
      const hex = e.target.value;
      setCustomColor(hex);
      onColorChange?.(hex);
    },
    [onColorChange]
  );

  const handleCustomHexInput = useCallback(
    (e) => {
      const val = e.target.value;
      if (/^#[0-9a-fA-F]{0,6}$/.test(val) || val === '') {
        setCustomColor(val || '#');
        if (val.length === 7) {
          onColorChange?.(val);
        }
      }
    },
    [onColorChange]
  );

  const togglePopover = useCallback(() => {
    if (!disabled) setIsOpen((o) => !o);
  }, [disabled]);

  // ---- memoised search results ----
  const filteredEmojis = useMemo(() => {
    if (!debouncedSearch) return null;
    const q = debouncedSearch.toLowerCase();
    const results = [];
    for (const catKey of EMOJI_CATEGORIES) {
      for (const entry of EMOJI_DATA[catKey].emojis) {
        if (
          entry.emoji.includes(q) ||
          entry.keywords.some((kw) => kw.includes(q))
        ) {
          results.push(entry);
        }
      }
    }
    return results;
  }, [debouncedSearch]);

  // ---- scroll active category tab into view ----
  useEffect(() => {
    if (!categoryTabsRef.current) return;
    const active = categoryTabsRef.current.querySelector(
      '.unified-picker__cat-tab--active'
    );
    if (active) {
      active.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
  }, [activeCategory]);

  // ---- emojis for active category ----
  const activeCategoryEmojis = useMemo(
    () => EMOJI_DATA[activeCategory]?.emojis || [],
    [activeCategory]
  );

  // ---- size modifier ----
  const sizeClass = `unified-picker--${size}`;

  // ---- mode helpers ----
  const showIcons = mode === 'both' || mode === 'icon';
  const showColors = mode === 'both' || mode === 'color';

  // ===========================================================================
  // POPOVER CONTENT (used by both portal and inline compact mode)
  // ===========================================================================
  const popoverContent = (
    <div
      ref={popoverRef}
      className={`unified-picker__popover ${compact ? 'unified-picker__popover--inline' : ''}`}
      style={!compact ? { top: popoverPos.top, left: popoverPos.left } : undefined}
      role="dialog"
      aria-label="Pick icon and color"
      data-testid="unified-picker-popover"
    >
      <div className="unified-picker__panes">
        {/* ====== EMOJI PANE (left, wider) ====== */}
        {showIcons && (
          <div className="unified-picker__emoji-pane">
            {/* header: search + category tabs */}
            <div className="unified-picker__emoji-header">
              {/* search */}
              <div className="unified-picker__search-wrap">
                <input
                  ref={searchRef}
                  type="text"
                  className="unified-picker__search"
                  placeholder="Search emoji…"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  aria-label="Search emoji"
                  data-testid="unified-picker-search"
                />
                {searchText && (
                  <button
                    type="button"
                    className="unified-picker__search-clear"
                    onClick={() => setSearchText('')}
                    aria-label="Clear search"
                    data-testid="unified-picker-search-clear"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* category tabs (hidden during search) */}
              {!debouncedSearch && (
                <div className="unified-picker__cat-tabs" ref={categoryTabsRef} data-testid="unified-picker-category-tabs">
                  {EMOJI_CATEGORIES.map((catKey) => (
                    <button
                      key={catKey}
                      type="button"
                      className={`unified-picker__cat-tab ${catKey === activeCategory ? 'unified-picker__cat-tab--active' : ''}`}
                      onClick={() => setActiveCategory(catKey)}
                      title={EMOJI_DATA[catKey].label}
                      data-testid={`unified-picker-cat-${catKey}`}
                    >
                      {EMOJI_DATA[catKey].icon}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* recently used (when NOT searching) */}
            {!debouncedSearch && recentEmojis.length > 0 && (
              <div className="unified-picker__recent" data-testid="unified-picker-recent">
                <div className="unified-picker__section-label">Recently Used</div>
                <div className="unified-picker__emoji-grid">
                  {recentEmojis.map((em, i) => (
                    <button
                      key={`recent-${em}-${i}`}
                      type="button"
                      className={`unified-picker__emoji-btn ${em === icon ? 'unified-picker__emoji-btn--selected' : ''}`}
                      onClick={() => handleIconSelect(em)}
                      title={em}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* emoji scroll area */}
            <div className="unified-picker__emoji-scroll" data-testid="unified-picker-emoji-scroll">
              {debouncedSearch ? (
                /* search results */
                filteredEmojis && filteredEmojis.length > 0 ? (
                  <div className="unified-picker__emoji-grid" data-testid="unified-picker-search-results">
                    {filteredEmojis.map((entry) => (
                      <button
                        key={entry.emoji}
                        type="button"
                        className={`unified-picker__emoji-btn ${entry.emoji === icon ? 'unified-picker__emoji-btn--selected' : ''}`}
                        onClick={() => handleIconSelect(entry.emoji)}
                        title={entry.keywords.join(', ')}
                      >
                        {entry.emoji}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="unified-picker__empty" data-testid="unified-picker-empty">No emoji found</div>
                )
              ) : (
                /* category grid */
                <div>
                  <div className="unified-picker__section-label">
                    {EMOJI_DATA[activeCategory].label}
                  </div>
                  <div className="unified-picker__emoji-grid" data-testid="unified-picker-category-grid">
                    {activeCategoryEmojis.map((entry) => (
                      <button
                        key={entry.emoji}
                        type="button"
                        className={`unified-picker__emoji-btn ${entry.emoji === icon ? 'unified-picker__emoji-btn--selected' : ''}`}
                        onClick={() => handleIconSelect(entry.emoji)}
                        title={entry.keywords.join(', ')}
                      >
                        {entry.emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ====== COLOR PANE (right, narrower) ====== */}
        {showColors && (
          <div className="unified-picker__color-pane">
            <div className="unified-picker__color-section" data-testid="unified-picker-color-section">
              <div className="unified-picker__section-label">Color</div>
              <div className="unified-picker__color-grid" data-testid="unified-picker-color-grid">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    className={`unified-picker__color-pill ${c.hex === color ? 'unified-picker__color-pill--selected' : ''} ${c.hex === '#ffffff' ? 'unified-picker__color-pill--white' : ''}`}
                    style={{ backgroundColor: c.hex }}
                    onClick={() => handleColorSelect(c.hex)}
                    title={c.name}
                    aria-label={`Select ${c.name} color`}
                  />
                ))}
              </div>

              {/* custom color */}
              <div className="unified-picker__custom-color" data-testid="unified-picker-custom-color">
                <span className="unified-picker__custom-label">Custom</span>
                <div className="unified-picker__custom-row">
                  <input
                    type="color"
                    className="unified-picker__native-color"
                    value={customColor && customColor.length === 7 ? customColor : '#6366f1'}
                    onChange={handleCustomNativeColor}
                    aria-label="Pick custom color"
                    data-testid="unified-picker-native-color"
                  />
                  <input
                    type="text"
                    className="unified-picker__hex-input"
                  value={customColor || '#'}
                    onChange={handleCustomHexInput}
                    maxLength={7}
                    placeholder="#6366f1"
                    aria-label="Hex color code"
                    data-testid="unified-picker-hex-input"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ===========================================================================
  // RENDER
  // ===========================================================================
  return (
    <div
      className={`unified-picker ${sizeClass} ${compact ? 'unified-picker--compact' : ''} ${disabled ? 'unified-picker--disabled' : ''}`}
      data-testid="unified-picker"
    >
      {/* ---- PREVIEW BUBBLE TRIGGER ---- */}
      {!compact && (
        <button
          ref={triggerRef}
          type="button"
          className="unified-picker__bubble"
          style={{ backgroundColor: color }}
          onClick={togglePopover}
          disabled={disabled}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          title="Change icon and color"
          data-testid="unified-picker-trigger"
        >
          <span className="unified-picker__bubble-icon">{icon}</span>
        </button>
      )}

      {/* ---- POPOVER ---- */}
      {(isOpen || compact) && (
        compact
          ? popoverContent
          : createPortal(popoverContent, document.body)
      )}
    </div>
  );
}

export default UnifiedPicker;

export {
  EMOJI_DATA,
  PRESET_COLORS,
  PRESET_COLOR_HEXES,
  ALL_ICONS,
  EMOJI_CATEGORIES,
  PRESET_ICONS,
  POPULAR_EMOJIS,
};
