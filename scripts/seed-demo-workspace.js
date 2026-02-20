#!/usr/bin/env node
/**
 * seed-demo-workspace.js — Deterministic demo workspace seeder for Nightjar
 * 
 * Creates a "Toybox Manufacturing Co." workspace with rich content across all
 * feature areas: folders, text docs, spreadsheets, kanban boards, inventory,
 * files, and chat messages.
 * 
 * Uses a fixed PRNG seed so output is byte-identical across runs.
 * Connects to a sidecar process via WebSocket to create all data through
 * the real application pipeline (encryption, Yjs, LevelDB).
 * 
 * Usage:
 *   node scripts/seed-demo-workspace.js [--output-dir <path>]
 *   npm run seed:demo
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const WebSocket = require('ws');
const crypto = require('crypto');

// ── Deterministic PRNG (mulberry32) ─────────────────────────────────────────
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(42);

function randomId() {
  const bytes = [];
  for (let i = 0; i < 16; i++) bytes.push(Math.floor(rng() * 256));
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomDate(startMs, endMs) {
  return Math.floor(startMs + rng() * (endMs - startMs));
}

function pick(arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function pickN(arr, n) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

function randomInt(min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// ── Constants ───────────────────────────────────────────────────────────────
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, 'demo-data');
const SIDECAR_PATH = path.join(PROJECT_ROOT, 'sidecar', 'index.js');
const META_PORT = 9881;
const YJS_PORT = 9880;
const WSS_PORT = 9843;

// ── US States for inventory geographic distribution ─────────────────────────
const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY'
];

const CITIES_BY_STATE = {
  CA: ['Los Angeles', 'San Francisco', 'San Diego'],
  NY: ['New York', 'Buffalo', 'Albany'],
  TX: ['Houston', 'Austin', 'Dallas'],
  FL: ['Miami', 'Orlando', 'Tampa'],
  IL: ['Chicago', 'Springfield', 'Naperville'],
  WA: ['Seattle', 'Spokane', 'Tacoma'],
  MA: ['Boston', 'Cambridge', 'Worcester'],
  CO: ['Denver', 'Boulder', 'Colorado Springs'],
  GA: ['Atlanta', 'Savannah', 'Augusta'],
  OH: ['Columbus', 'Cleveland', 'Cincinnati'],
  PA: ['Philadelphia', 'Pittsburgh', 'Harrisburg'],
  NC: ['Charlotte', 'Raleigh', 'Durham'],
  MI: ['Detroit', 'Ann Arbor', 'Grand Rapids'],
  OR: ['Portland', 'Eugene', 'Salem'],
  MN: ['Minneapolis', 'St. Paul', 'Duluth'],
};

// ── Toy categories and items ────────────────────────────────────────────────
const TOY_CATEGORIES = [
  'Action Figures', 'Board Games', 'Plush Toys', 'Electronic Toys',
  'Building Sets', 'Dolls', 'Outdoor Toys', 'Educational Toys'
];

const TOY_ITEMS = {
  'Action Figures': [
    'Galaxy Ranger (12")', 'Dino-Mech Transform', 'Captain Cosmos', 'Ninja Shadow Strike',
    'Robot Warrior XL', 'Adventure Rex', 'Thunder Knight', 'Pixel Hero 8-Bit',
    'Jungle Explorer Set', 'Space Trooper Squad', 'Dragon Slayer Deluxe', 'Ocean Defender',
    'Iron Guardian', 'Lightning Falcon', 'Volcanic Titan', 'Crystal Mage',
    'Stealth Agent Pack', 'Arctic Commando', 'Sun Warrior', 'Moon Knight Duo',
    'Neon Blaze', 'Terra Force Five', 'Wind Runner', 'Storm Breaker Elite', 'Echo Phantom'
  ],
  'Board Games': [
    'Treasure Quest', 'Tower Tumble', 'Mystery Island', 'Dragon\'s Hoard',
    'Star Race', 'Kingdom Builder', 'Code Cracker Jr.', 'Safari Sprint',
    'Pirate Plunder', 'Robot Factory', 'Wizard Duel', 'Bug Bingo',
    'Dino Dash', 'Castle Siege', 'Space Trader', 'Jungle Jamboree',
    'Arctic Adventure', 'Ocean Odyssey', 'Mountain Climb', 'Desert Rally',
    'Time Travelers', 'Fossil Finders', 'Volcano Escape', 'River Raft Race', 'Sky City'
  ],
  'Plush Toys': [
    'Sleepy Bear (Large)', 'Rainbow Unicorn', 'Baby Penguin', 'Fuzzy Fox',
    'Snuggle Bunny', 'Tiny Tiger Cub', 'Happy Hippo', 'Cuddle Koala',
    'Dreamy Dragon', 'Fluffy Owl', 'Gentle Giraffe', 'Merry Monkey',
    'Panda Pal', 'Sweet Sloth', 'Wiggly Worm', 'Jolly Jellyfish',
    'Cozy Cat', 'Dapper Dog', 'Lucky Llama', 'Bashful Bat',
    'Friendly Frog', 'Silly Seal', 'Tiny Turtle', 'Wonder Whale', 'Zippy Zebra'
  ],
  'Electronic Toys': [
    'Robo-Pet Dog', 'Light-Up Dance Pad', 'Junior Tablet', 'Talk-Back Parrot',
    'RC Monster Truck', 'Drone Explorer Mini', 'Music Maker Station', 'Smart Globe',
    'Coding Car Kit', 'Laser Tag Set (4pk)', 'Walkie Talkie Pro', 'Night Sky Projector',
    'Voice Changer Mic', 'LED Hula Hoop', 'Digital Pet Watch', 'AR Dinosaur Set',
    'Beat Box Drum Kit', 'Spy Gadget Kit', 'Weather Station Jr.', 'Telescope Smart',
    'Robot Arm Builder', 'Circuit Lab', 'Solar Car Kit', 'AI Pet Companion', 'VR Viewer Kids'
  ],
  'Building Sets': [
    'Castle & Knights (500pc)', 'Space Station (300pc)', 'City Builder (400pc)',
    'Dinosaur World (250pc)', 'Pirate Ship (350pc)', 'Race Car Track (200pc)',
    'Farm & Animals (150pc)', 'Airport Set (300pc)', 'Train Station (350pc)',
    'Fire Station (250pc)', 'Ocean Explorer (200pc)', 'Robot Lab (300pc)',
    'Medieval Village (400pc)', 'Moon Base (350pc)', 'Jungle Temple (300pc)',
    'Arctic Research (250pc)', 'Volcano Island (200pc)', 'Underwater City (350pc)',
    'Sky Fortress (400pc)', 'Time Machine (300pc)', 'Magic School (250pc)',
    'Dragon\'s Lair (200pc)', 'Crystal Cave (150pc)', 'Cloud Kingdom (300pc)', 'Lava Land (250pc)'
  ],
  'Dolls': [
    'Princess Aurora Collection', 'Fashion Studio Doll', 'Baby Care Set',
    'Fairy Garden Doll', 'Mermaid Adventure', 'Pop Star Doll',
    'Veterinarian Playset', 'Chef Doll Kitchen', 'Ballerina Dream',
    'Explorer Doll', 'Scientist Lab Set', 'Artist Studio Doll',
    'Gardener Doll', 'Pilot Adventure Set', 'Doctor Care Doll',
    'Astronaut Dream', 'Teacher Classroom', 'Detective Mystery',
    'Musician Band Set', 'Athlete Champion', 'Architect Builder',
    'Marine Biologist', 'Firefighter Hero', 'Engineer Workshop', 'Photographer Doll'
  ],
  'Outdoor Toys': [
    'Super Soaker XL', 'Bubble Machine Deluxe', 'Kite – Rainbow Dragon',
    'Frisbee Golf Set', 'Croquet Junior', 'Archery Target Set',
    'Giant Checkers', 'Badminton Family', 'Jump Rope LED', 'Balance Bike',
    'Scooter Pro', 'Pogo Stick', 'Hopscotch Mat', 'Lawn Bowling',
    'Water Balloon Station', 'Sidewalk Chalk Art', 'Nature Explorer Kit',
    'Bug Catcher Set', 'Bird Watching Kit', 'Garden Tool Set',
    'Sand Castle Kit Pro', 'Pool Noodle Set', 'Splash Pad', 'Climbing Rope', 'Tug of War Set'
  ],
  'Educational Toys': [
    'Microscope Lab Jr.', 'Chemistry Starter Kit', 'Solar System Model',
    'Human Body Puzzle', 'Math Wizard Board', 'Letter Learning Blocks',
    'Magnetic World Map', 'Periodic Table Poster Set', 'Coding Robot Kit',
    'Electricity Lab', 'Fossil Dig Kit', 'Crystal Growing Set',
    'Anatomy Model', 'Geography Globe Puzzle', 'History Timeline Cards',
    'Music Theory Set', 'Language Flash Cards', 'Art History Kit',
    'Astronomy Chart', 'Engineering Bridge Kit', 'Physics Pendulum Set',
    'Botany Greenhouse', 'Paleontology Kit', 'Robotics Starter', 'Logic Puzzle Box'
  ]
};

// ── Demo Users ──────────────────────────────────────────────────────────────
const DEMO_USERS = [
  { handle: 'Alice', color: '#6366f1', icon: '👩‍💼', role: 'Operations Manager' },
  { handle: 'Bob', color: '#f59e0b', icon: '👨‍🔧', role: 'Warehouse Lead' },
  { handle: 'Charlie', color: '#10b981', icon: '👨‍💻', role: 'Product Designer' },
  { handle: 'Diana', color: '#ef4444', icon: '👩‍🔬', role: 'Quality Analyst' }
];

const PRODUCER_NAMES = [
  'ToyWorks Inc.', 'PlayCraft Studios', 'FunFactory LLC', 'KidsBright Mfg.',
  'SmileMakers Co.', 'DreamToy Industries', 'HappyHands Workshop', 'StarPlay Corp.',
  'BrightMinds Ltd.', 'JoyfulCreations', 'TinyWonders Mfg.', 'GiggleGear Inc.',
  'WonderWorks USA', 'PlayPal Industries', 'MagicTouch Toys', 'SunnyDay Factory',
  'MiniMarvels LLC', 'FunZone Mfg.', 'ToyTown Studios', 'AdventureMakers',
  'PixelPlay Corp.', 'ThinkFun Labs', 'CraftKids Inc.', 'EcoToys Green',
  'NovaToy Corp.', 'PrimeToys LLC', 'ZenithPlay Inc.', 'ClassicFun Mfg.',
  'UrbanToy Studios', 'PeakPlay Industries', 'SummitToys LLC', 'EliteFun Corp.',
  'GoldenAge Toys', 'SilverStar Mfg.', 'BronzeBear Inc.', 'CopperCraft Toys',
  'IronForge Play', 'SteelCity Toys', 'TitanToy Corp.', 'DiamondEdge Inc.',
  'EmeraldPlay LLC', 'RubyRed Toys', 'SapphireBlue Mfg.', 'AmethystArts',
  'TopazToy Inc.', 'PearlPlay Studios', 'OpalCreations', 'JadeDragon Toys',
  'CoralReef Mfg.', 'MarbleMakers Inc.'
];

// ── SidecarClient (simplified inline) ───────────────────────────────────────
class SeedClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.messageQueue = [];
    this.connected = false;
  }

  async connect(timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection timeout')), timeout);
      this.ws = new WebSocket(this.url);
      this.ws.on('open', () => { clearTimeout(timer); this.connected = true; resolve(); });
      this.ws.on('message', (data) => {
        try { this.messageQueue.push(JSON.parse(data.toString())); } catch {}
      });
      this.ws.on('error', (err) => { clearTimeout(timer); reject(err); });
      this.ws.on('close', () => { this.connected = false; });
    });
  }

  async disconnect() {
    if (this.ws) this.ws.close();
    this.connected = false;
  }

  send(msg) { this.ws.send(JSON.stringify(msg)); }

  async waitFor(type, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const idx = this.messageQueue.findIndex(m => m.type === type);
      if (idx !== -1) return this.messageQueue.splice(idx, 1)[0];
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`Timeout waiting for ${type}`);
  }

  async sendAndWait(msg, responseType) {
    this.send(msg);
    return this.waitFor(responseType);
  }

  clearQueue() { this.messageQueue = []; }
}

// ── Sidecar process management ──────────────────────────────────────────────
async function isPortAvailable(port) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => { srv.close(); resolve(true); });
    srv.listen(port, '127.0.0.1');
  });
}

async function waitForPort(port, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await new Promise((resolve, reject) => {
        const sock = net.connect(port, '127.0.0.1');
        sock.once('connect', () => { sock.destroy(); resolve(); });
        sock.once('error', reject);
        sock.setTimeout(1000, () => { sock.destroy(); reject(new Error('timeout')); });
      });
      return;
    } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  throw new Error(`Timeout waiting for port ${port}`);
}

function startSidecar(storagePath) {
  const isWindows = process.platform === 'win32';
  // Quote paths on Windows to handle spaces in directory names
  const sidecarArg = isWindows ? `"${SIDECAR_PATH}"` : SIDECAR_PATH;
  const storageArg = isWindows ? `"${storagePath}"` : storagePath;
  const proc = spawn('node', [sidecarArg, storageArg], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      NIGHTJAR_MESH: 'false',
      NIGHTJAR_UPNP: 'false',
      P2P_INIT_MAX_ATTEMPTS: '2',
      P2P_INIT_RETRY_INTERVAL_MS: '1000',
      YJS_WEBSOCKET_PORT: String(YJS_PORT),
      METADATA_WEBSOCKET_PORT: String(META_PORT),
      YJS_WEBSOCKET_SECURE_PORT: String(WSS_PORT),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: isWindows
  });
  return proc;
}

// ── Generate inventory request data for smooth charts ───────────────────────
function generateInventoryData() {
  const items = [];
  let itemIdx = 0;
  for (const category of TOY_CATEGORIES) {
    const categoryItems = TOY_ITEMS[category];
    for (const itemName of categoryItems) {
      items.push({
        id: randomId(),
        name: itemName,
        category,
        sku: `TB-${category.substring(0, 2).toUpperCase()}${String(itemIdx + 1).padStart(4, '0')}`,
        unitCost: +(2 + rng() * 48).toFixed(2),
        unitPrice: +(5 + rng() * 95).toFixed(2),
        minStock: randomInt(10, 50),
        maxStock: randomInt(200, 1000),
        currentStock: randomInt(20, 500),
        reorderPoint: randomInt(15, 75),
      });
      itemIdx++;
    }
  }

  // Assign producers to states (deterministic distribution across 30+ states)
  const producers = PRODUCER_NAMES.map((name, i) => {
    const stateIdx = i % US_STATES.length;
    const state = US_STATES[stateIdx];
    const cities = CITIES_BY_STATE[state] || [`${state} City`];
    return {
      id: randomId(),
      name,
      state,
      city: pick(cities),
      rating: +(3 + rng() * 2).toFixed(1),
      activeOrders: randomInt(0, 15),
      completedOrders: randomInt(5, 200),
    };
  });

  // Generate ~500 requests over 6 months for smooth charts
  const SIX_MONTHS_AGO = Date.now() - (180 * 24 * 60 * 60 * 1000);
  const NOW = Date.now();
  const requests = [];
  const statuses = ['pending', 'assigned', 'in-progress', 'shipped', 'delivered', 'completed'];
  const statusWeights = [0.05, 0.08, 0.1, 0.12, 0.25, 0.4]; // Most are completed

  for (let i = 0; i < 500; i++) {
    const item = pick(items);
    const producer = pick(producers);
    const createdAt = randomDate(SIX_MONTHS_AGO, NOW);
    
    // Weighted status selection
    let r = rng();
    let statusIdx = 0;
    let cumulative = 0;
    for (let s = 0; s < statusWeights.length; s++) {
      cumulative += statusWeights[s];
      if (r <= cumulative) { statusIdx = s; break; }
    }

    const quantity = randomInt(10, 500);
    const unitCost = item.unitCost;

    requests.push({
      id: randomId(),
      itemId: item.id,
      itemName: item.name,
      category: item.category,
      producerId: producer.id,
      producerName: producer.name,
      producerState: producer.state,
      quantity,
      unitCost,
      totalCost: +(quantity * unitCost).toFixed(2),
      status: statuses[statusIdx],
      priority: pick(['low', 'medium', 'high', 'urgent']),
      createdAt,
      updatedAt: randomDate(createdAt, NOW),
      completedAt: statusIdx >= 4 ? randomDate(createdAt + 86400000, NOW) : null,
      notes: pick([
        '', 'Rush order', 'Standard delivery', 'Quality check required',
        'Bulk discount applied', 'Fragile - handle with care', 'Gift wrapping needed',
        'Holiday stock', 'Clearance batch', 'Premium packaging'
      ])
    });
  }

  return { items, producers, requests };
}

// ── Generate Kanban board data ──────────────────────────────────────────────
function generateKanbanData() {
  const columns = ['Backlog', 'Design', 'Prototype', 'QA Testing', 'Ready to Ship'];
  const labels = ['urgent', 'feature', 'bug', 'design', 'marketing', 'logistics'];
  const labelColors = ['#ef4444', '#6366f1', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6'];
  
  const cards = [
    { title: 'Galaxy Ranger redesign for Q2', column: 'Ready to Ship', label: 'design', assignee: 'Charlie' },
    { title: 'Fix Robo-Pet battery drain issue', column: 'QA Testing', label: 'bug', assignee: 'Diana' },
    { title: 'New packaging design for plush line', column: 'Design', label: 'design', assignee: 'Charlie' },
    { title: 'Supplier negotiation — BuildingSet plastic', column: 'Backlog', label: 'logistics', assignee: 'Alice' },
    { title: 'Holiday catalog photography', column: 'Prototype', label: 'marketing', assignee: 'Bob' },
    { title: 'RC Monster Truck v2 motor upgrade', column: 'Design', label: 'feature', assignee: 'Charlie' },
    { title: 'Safety certification renewal — Drone Mini', column: 'QA Testing', label: 'urgent', assignee: 'Diana' },
    { title: 'Website banner for spring collection', column: 'Backlog', label: 'marketing', assignee: 'Alice' },
    { title: 'Warehouse reorganization plan', column: 'Backlog', label: 'logistics', assignee: 'Bob' },
    { title: 'Laser Tag Set firmware update', column: 'Prototype', label: 'feature', assignee: 'Charlie' },
    { title: 'Customer feedback report — Q4', column: 'Ready to Ship', label: 'urgent', assignee: 'Diana' },
    { title: 'New supplier onboarding — EcoToys Green', column: 'Design', label: 'logistics', assignee: 'Alice' },
    { title: 'AR Dinosaur Set app integration', column: 'Prototype', label: 'feature', assignee: 'Charlie' },
    { title: 'Recall check — Baby Penguin plush eyes', column: 'QA Testing', label: 'urgent', assignee: 'Diana' },
    { title: 'Trade show booth design — ToyExpo 2026', column: 'Backlog', label: 'marketing', assignee: 'Bob' },
    { title: 'Budget review for new product line', column: 'QA Testing', label: 'feature', assignee: 'Alice' },
    { title: 'Solar Car Kit instruction manual rewrite', column: 'Design', label: 'design', assignee: 'Charlie' },
    { title: 'Shipping cost optimization Q2', column: 'Backlog', label: 'logistics', assignee: 'Bob' },
  ];

  return { columns, labels, labelColors, cards };
}

// ── Generate chat messages ──────────────────────────────────────────────────
function generateChatMessages() {
  return [
    { user: 'Alice', text: 'Good morning team! 🌅 Sprint planning starts in 10 minutes.' },
    { user: 'Bob', text: 'Morning! Warehouse is looking good — finished reorganizing Zone C last night.' },
    { user: 'Charlie', text: 'Nice! I\'ve got the Galaxy Ranger redesign mockups ready to share.' },
    { user: 'Diana', text: 'I found a potential issue with the Robo-Pet battery in QA. Details in the kanban card.' },
    { user: 'Alice', text: 'Thanks Diana. Can you prioritize that? We need it fixed before the spring launch.' },
    { user: 'Diana', text: 'Already on it. The drain rate is 40% higher than spec. Should have a root cause by EOD.' },
    { user: 'Bob', text: 'Heads up: we got a bulk order from RetailMax — 500 units of the Castle & Knights set 🏰' },
    { user: 'Alice', text: 'That\'s huge! Do we have enough stock?' },
    { user: 'Bob', text: 'Checking inventory now... We have 320 in stock, need to order 180 more from ToyWorks.' },
    { user: 'Charlie', text: 'I can fast-track the new packaging if needed. The updated box art is already done.' },
    { user: 'Alice', text: 'Perfect. @Bob put in the restock order. @Charlie send me the packaging files.' },
    { user: 'Bob', text: '🫡 On it. ETA from ToyWorks is usually 2 weeks.' },
    { user: 'Charlie', text: 'Files uploaded to the shared drive. Check the "Product Design" folder.' },
    { user: 'Diana', text: 'Quick update: the Solar Car Kit passed all safety certifications ✅' },
    { user: 'Alice', text: 'Excellent work everyone! Let\'s sync again after lunch.' },
    { user: 'Bob', text: 'BTW the new shipping labels arrived. Switching to the eco-friendly ones as planned 🌿' },
    { user: 'Diana', text: 'Love that. Our sustainability report is going to look great this quarter.' },
    { user: 'Charlie', text: 'Has anyone seen the competitor\'s new robot toy? We should review it in our next design meeting.' },
    { user: 'Alice', text: 'Good call. Add it to the backlog. Also — reminder: ToyExpo booth design is due next Friday.' },
    { user: 'Bob', text: 'End of day update: RetailMax order is confirmed. Restock PO sent to ToyWorks. 📦' },
    { user: 'Diana', text: 'QA summary: 3 products passed, 1 needs revision (Robo-Pet). Full report in the shared docs.' },
    { user: 'Charlie', text: 'New design concepts for the summer line are in! Check the "Design" column on the kanban board 🎨' },
    { user: 'Alice', text: 'Great day everyone. See you tomorrow! 🦉' },
  ];
}

// ── Document content generators ─────────────────────────────────────────────
function generateProductCatalogContent() {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '📦 Toybox Manufacturing Co. — Product Catalog' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Spring 2026 Edition • Confidential — Internal Use Only' }] },
      { type: 'horizontalRule' },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '🎯 Product Line Overview' }] },
      { type: 'paragraph', content: [
        { type: 'text', text: 'Toybox Manufacturing produces ' },
        { type: 'text', marks: [{ type: 'bold' }], text: '200+ SKUs' },
        { type: 'text', text: ' across 8 product categories, serving retail partners in all 50 US states. Our commitment to quality, safety, and fun drives everything we make.' },
      ]},
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Top Sellers — Q1 2026' }] },
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Galaxy Ranger (12")' }, { type: 'text', text: ' — Action Figures — 2,400 units sold' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Treasure Quest' }, { type: 'text', text: ' — Board Games — 1,800 units sold' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Sleepy Bear (Large)' }, { type: 'text', text: ' — Plush Toys — 3,100 units sold' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Coding Robot Kit' }, { type: 'text', text: ' — Educational — 1,500 units sold' }] }] },
      ]},
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '🏭 Manufacturing Partners' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'We work with 50 certified manufacturing partners across the United States, ensuring short supply chains and rapid fulfillment. All partners undergo annual quality audits and safety certification checks.' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '📊 Category Breakdown' }] },
      { type: 'table', content: [
        { type: 'tableRow', content: [
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Category' }] }] },
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'SKUs' }] }] },
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Avg. Price' }] }] },
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Q1 Revenue' }] }] },
        ]},
        ...TOY_CATEGORIES.map(cat => ({
          type: 'tableRow', content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: cat }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: String(TOY_ITEMS[cat].length) }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: `$${(15 + rng() * 35).toFixed(2)}` }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: `$${(50000 + rng() * 200000).toFixed(0)}` }] }] },
          ]
        }))
      ]},
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '🔮 Upcoming Launches' }] },
      { type: 'orderedList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'AI Pet Companion' }, { type: 'text', text: ' — Electronic Toys — ETA: April 2026. AI-powered interactive pet with voice recognition and learning behaviors.' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Eco-Friendly Building Sets' }, { type: 'text', text: ' — Building Sets — ETA: May 2026. Made from 100% recycled ocean plastic. Partnership with OceanClean Foundation.' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'VR Viewer Kids v2' }, { type: 'text', text: ' — Electronic Toys — ETA: June 2026. Enhanced VR headset with educational content library and parental controls.' }] }] },
      ]},
    ]
  };
}

function generateMeetingNotesContent() {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '📋 Sprint Planning — Week of Feb 17, 2026' }] },
      { type: 'paragraph', content: [
        { type: 'text', marks: [{ type: 'bold' }], text: 'Attendees: ' },
        { type: 'text', text: 'Alice (Ops), Bob (Warehouse), Charlie (Design), Diana (QA)' },
      ]},
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '🎯 Sprint Goals' }] },
      { type: 'orderedList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Complete Galaxy Ranger Q2 redesign and approve final packaging' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Resolve Robo-Pet battery drain issue before spring launch' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Process RetailMax bulk order (500 units Castle & Knights)' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Submit ToyExpo 2026 booth design for approval' }] }] },
      ]},
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '📊 Metrics Review' }] },
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'On-time delivery rate: 94.2% (↑ from 91.8% last sprint)' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'QA pass rate: 97.1% (3 products tested, 1 revision needed)' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Inventory turnover: 4.2x annualized — exceeding target of 3.8x' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Customer satisfaction: 4.7/5.0 (based on 1,200 reviews)' }] }] },
      ]},
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '⚡ Action Items' }] },
      { type: 'taskList', content: [
        { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alice: Send PO to ToyWorks for 180 Castle & Knights sets' }] }] },
        { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Charlie: Upload Galaxy Ranger packaging files to shared drive' }] }] },
        { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Diana: Root cause analysis on Robo-Pet battery drain' }] }] },
        { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bob: Complete Zone D warehouse reorganization' }] }] },
        { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'All: Review competitor robot toy in next design meeting' }] }] },
      ]},
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '📅 Next Steps' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Next sync: Friday 2:00 PM. Diana will present the Robo-Pet investigation findings. Charlie will demo the new summer line concepts. Bob will report on RetailMax order fulfillment status.' }] },
    ]
  };
}

function generateOnboardingContent() {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '🎉 Welcome to Toybox Manufacturing!' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'This guide will help you get started with our team workspace. Everything here is encrypted end-to-end — only team members with the invite link can access this content.' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '👥 Meet the Team' }] },
      { type: 'bulletList', content: DEMO_USERS.map(u => ({
        type: 'listItem', content: [{ type: 'paragraph', content: [
          { type: 'text', marks: [{ type: 'bold' }], text: `${u.icon} ${u.handle}` },
          { type: 'text', text: ` — ${u.role}` },
        ]}]
      }))},
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '📂 Workspace Structure' }] },
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: '📋 Operations' }, { type: 'text', text: ' — Meeting notes, sprint planning, company policies' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: '📊 Finance' }, { type: 'text', text: ' — Revenue tracking, cost analysis, budgets (spreadsheets)' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: '🎨 Product Design' }, { type: 'text', text: ' — Design docs, product specs, packaging mockups' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: '📦 Warehouse' }, { type: 'text', text: ' — Inventory management, shipping logs, kanban boards' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: '💬 Team' }, { type: 'text', text: ' — Onboarding guides, team resources, fun stuff' }] }] },
      ]},
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '🔑 Quick Tips' }] },
      { type: 'orderedList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Press Ctrl+K to open the search palette — find any document instantly' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Use the chat button in the bottom-right to communicate with the team' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Right-click any document for options like rename, move, or share' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Press F1 anytime for the built-in help guide' }] }] },
      ]},
    ]
  };
}

// ── Main seed function ──────────────────────────────────────────────────────
async function main() {
  let seedResult = {};
  const outputDir = process.argv.includes('--output-dir')
    ? process.argv[process.argv.indexOf('--output-dir') + 1]
    : DEFAULT_OUTPUT;

  console.log('🌱 Nightjar Demo Workspace Seeder');
  console.log('================================');
  console.log(`Output: ${outputDir}`);

  // Clean output directory
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  // Check port availability
  for (const port of [META_PORT, YJS_PORT, WSS_PORT]) {
    if (!(await isPortAvailable(port))) {
      console.error(`❌ Port ${port} is in use. Cannot start sidecar.`);
      process.exit(1);
    }
  }

  // Start sidecar
  console.log('\n📡 Starting sidecar process...');
  const sidecar = startSidecar(outputDir);
  let sidecarReady = false;

  sidecar.stdout.on('data', d => {
    const s = d.toString();
    if (s.includes('Startup complete')) sidecarReady = true;
    if (process.env.SEED_VERBOSE) process.stdout.write(`  [sidecar] ${s}`);
  });
  sidecar.stderr.on('data', d => {
    const s = d.toString();
    if (!s.includes('Deprecation') && !s.includes('ExperimentalWarning') && !s.includes('punycode')) {
      if (process.env.SEED_VERBOSE) process.stderr.write(`  [sidecar:err] ${s}`);
    }
  });

  // Wait for sidecar to start
  const startTime = Date.now();
  while (!sidecarReady && Date.now() - startTime < 60000) {
    await new Promise(r => setTimeout(r, 200));
  }
  if (!sidecarReady) {
    console.error('❌ Sidecar failed to start within 60s');
    sidecar.kill();
    process.exit(1);
  }
  console.log(`  ✅ Sidecar ready (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);

  // Connect client
  const client = new SeedClient(`ws://localhost:${META_PORT}`);
  await client.connect();
  console.log('  ✅ Connected to sidecar metadata WebSocket');

  try {
    // ── Create workspace ──
    console.log('\n📦 Creating workspace: Toybox Manufacturing Co.');
    const wsKey = crypto.randomBytes(32).toString('base64url');
    const wsId = randomId();
    const wsResult = await client.sendAndWait({
      type: 'create-workspace',
      workspace: {
        id: wsId,
        name: 'Toybox Manufacturing Co.',
        color: '#6366f1',
        icon: '🏭',
        encryptionKey: wsKey,
      }
    }, 'workspace-created');
    const workspaceId = wsResult.workspace?.id || wsId;
    console.log(`  ✅ Workspace created: ${workspaceId}`);

    // Set encryption key (sidecar expects 'set-key' with base64 payload)
    await client.sendAndWait({
      type: 'set-key',
      payload: wsKey
    }, 'key-set');

    // ── Create folders ──
    console.log('\n📁 Creating folders...');
    const folders = {};
    const folderDefs = [
      { name: '📋 Operations', icon: '📋', color: '#6366f1' },
      { name: '📊 Finance', icon: '📊', color: '#f59e0b' },
      { name: '🎨 Product Design', icon: '🎨', color: '#10b981' },
      { name: '📦 Warehouse', icon: '📦', color: '#ef4444' },
      { name: '💬 Team', icon: '💬', color: '#8b5cf6' },
    ];

    for (const def of folderDefs) {
      const folderId = randomId();
      const result = await client.sendAndWait({
        type: 'create-folder',
        folder: {
          id: folderId,
          name: def.name,
          workspaceId,
          parentId: null,
          icon: def.icon,
          color: def.color,
        }
      }, 'folder-created');
      folders[def.name] = result.folder?.id || folderId;
      console.log(`  ✅ Folder: ${def.name}`);
    }

    // ── Create documents ──
    console.log('\n📄 Creating documents...');

    // Text documents
    const textDocs = [
      { name: 'Product Catalog — Spring 2026', folder: '📋 Operations', content: generateProductCatalogContent() },
      { name: 'Sprint Planning — Feb 17', folder: '📋 Operations', content: generateMeetingNotesContent() },
      { name: 'Welcome & Onboarding Guide', folder: '💬 Team', content: generateOnboardingContent() },
    ];

    for (const doc of textDocs) {
      const docId = randomId();
      const docKey = crypto.randomBytes(32).toString('base64url');
      await client.sendAndWait({
        type: 'create-document',
        document: {
          id: docId,
          name: doc.name,
          type: 'text',
          workspaceId,
          parentId: folders[doc.folder],
          encryptionKey: docKey,
        }
      }, 'document-created');
      await client.sendAndWait({
        type: 'set-key',
        payload: docKey,
        docName: docId
      }, 'key-set');
      console.log(`  ✅ Text: ${doc.name}`);
    }

    // Spreadsheet documents
    const sheetDocs = [
      { name: 'Q1 Revenue Tracker', folder: '📊 Finance' },
      { name: 'Inventory Valuation', folder: '📊 Finance' },
      { name: 'Shipping Cost Calculator', folder: '📦 Warehouse' },
    ];

    for (const doc of sheetDocs) {
      const docId = randomId();
      const docKey = crypto.randomBytes(32).toString('base64url');
      await client.sendAndWait({
        type: 'create-document',
        document: {
          id: docId,
          name: doc.name,
          type: 'sheet',
          workspaceId,
          parentId: folders[doc.folder],
          encryptionKey: docKey,
        }
      }, 'document-created');
      await client.sendAndWait({
        type: 'set-key',
        payload: docKey,
        docName: docId
      }, 'key-set');
      console.log(`  ✅ Sheet: ${doc.name}`);
    }

    // Kanban documents
    const kanbanDocs = [
      { name: 'Spring Product Launch', folder: '📦 Warehouse' },
      { name: 'Design Pipeline', folder: '🎨 Product Design' },
    ];

    for (const doc of kanbanDocs) {
      const docId = randomId();
      const docKey = crypto.randomBytes(32).toString('base64url');
      await client.sendAndWait({
        type: 'create-document',
        document: {
          id: docId,
          name: doc.name,
          type: 'kanban',
          workspaceId,
          parentId: folders[doc.folder],
          encryptionKey: docKey,
        }
      }, 'document-created');
      await client.sendAndWait({
        type: 'set-key',
        payload: docKey,
        docName: docId
      }, 'key-set');
      console.log(`  ✅ Kanban: ${doc.name}`);
    }

    // ── Generate metadata summary ──
    console.log('\n📊 Generating inventory data...');
    const inventoryData = generateInventoryData();
    console.log(`  ✅ ${inventoryData.items.length} items, ${inventoryData.producers.length} producers, ${inventoryData.requests.length} requests`);

    const kanbanData = generateKanbanData();
    console.log(`  ✅ Kanban: ${kanbanData.cards.length} cards across ${kanbanData.columns.length} columns`);

    const chatMessages = generateChatMessages();
    console.log(`  ✅ Chat: ${chatMessages.length} messages`);

    // ── Write metadata manifest ──
    const manifest = {
      workspaceId,
      workspaceName: 'Toybox Manufacturing Co.',
      folders: Object.entries(folders).map(([name, id]) => ({ name, id })),
      documentCount: textDocs.length + sheetDocs.length + kanbanDocs.length,
      inventoryData,
      kanbanData,
      chatMessages,
      users: DEMO_USERS,
      generatedAt: new Date().toISOString(),
      prngSeed: 42,
    };

    fs.writeFileSync(
      path.join(outputDir, 'seed-manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    console.log('\n📝 Seed manifest written to seed-manifest.json');
    seedResult = { documentCount: manifest.documentCount, itemCount: inventoryData?.items?.length || 0, requestCount: inventoryData?.requests?.length || 0 };

  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await client.disconnect();
    
    // Stop sidecar
    if (process.platform === 'win32') {
      try {
        require('child_process').execSync(`taskkill /pid ${sidecar.pid} /T /F`, { stdio: 'ignore' });
      } catch {}
    } else {
      sidecar.kill('SIGTERM');
    }
    
    // Wait for LevelDB locks to release
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n✅ Demo workspace seeded successfully!');
  console.log(`   Storage: ${outputDir}`);
  console.log(`   Workspace: Toybox Manufacturing Co.`);
  console.log(`   Content: ${seedResult.documentCount || 0} documents, 5 folders`);
  console.log(`   Inventory: ${seedResult.itemCount || 0} items, ${seedResult.requestCount || 0} requests`);
}

main().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
