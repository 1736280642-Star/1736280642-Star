const fs = require("node:fs");
const path = require("node:path");

// ==============================
// Config
// ==============================

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return fallback;
  }

  const value = process.argv[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a file path.`);
  }

  return path.resolve(process.cwd(), value);
}

const INPUT_FILE = readOption(
  "--input",
  path.resolve(__dirname, "codex.json")
);

const OUTPUT_FILE = readOption(
  "--output",
  path.resolve(__dirname, "codex-heatmap.svg")
);

// Exact token totals can reveal private work patterns. Public output therefore
// shows activity intensity only unless the owner explicitly opts in.
const SHOW_TOKEN_COUNTS = process.argv.includes(
  "--show-token-counts"
);

const DAYS = 365;

const CELL_SIZE = 11;
const CELL_GAP = 3;
const CELL_STEP = CELL_SIZE + CELL_GAP;

const LEFT_PADDING = 40;
const TOP_PADDING = 42;
const BOTTOM_PADDING = 48;

// ==============================
// Utils
// ==============================

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function startOfDay(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function formatTokens(value) {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return String(value);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function percentile(values, percentileValue) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);

  const index = Math.floor(
    (sorted.length - 1) * percentileValue
  );

  return sorted[index];
}

function calculateLevel(value, thresholds) {
  if (value <= 0) {
    return 0;
  }

  if (value <= thresholds.p25) {
    return 1;
  }

  if (value <= thresholds.p50) {
    return 2;
  }

  if (value <= thresholds.p75) {
    return 3;
  }

  return 4;
}

// ==============================
// Read ccusage JSON
// ==============================

function loadCodexUsage() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(
      `Cannot find codex.json:\n${INPUT_FILE}`
    );
  }

  console.log(`Reading: ${INPUT_FILE}`);

  let raw = fs.readFileSync(INPUT_FILE, "utf8");

  // Windows PowerShell redirect may occasionally produce BOM.
  raw = raw.replace(/^\uFEFF/, "");

  const json = JSON.parse(raw);

  let daily = null;

  if (Array.isArray(json.daily)) {
    daily = json.daily;
  } else if (Array.isArray(json.data)) {
    // Fallback in case ccusage changes output shape
    daily = json.data;
  }

  if (!daily) {
    throw new Error(
      `Cannot find daily[] in codex.json.\nFound keys: ${Object.keys(
        json
      ).join(", ")}`
    );
  }

  return daily;
}

// ==============================
// Normalize data
// ==============================

function normalizeUsage(daily) {
  const usage = new Map();

  for (const item of daily) {
    const date =
      item.date ??
      item.period ??
      item.day;

    if (
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
    ) {
      continue;
    }

    const tokens = Number(
      item.totalTokens ??
      item.total_tokens ??
      0
    );

    if (!Number.isFinite(tokens)) {
      continue;
    }

    // If duplicate date rows exist, merge them.
    usage.set(
      date,
      (usage.get(date) || 0) + tokens
    );
  }

  return usage;
}

// ==============================
// Statistics
// ==============================

function calculateStats(usage, firstDate, today) {
  let totalTokens = 0;
  let activeDays = 0;

  const values = [];

  for (
    let date = new Date(firstDate);
    date <= today;
    date = addDays(date, 1)
  ) {
    const key = formatDate(date);
    const value = usage.get(key) || 0;

    totalTokens += value;

    if (value > 0) {
      activeDays += 1;
      values.push(value);
    }
  }

  const thresholds = {
    p25: percentile(values, 0.25),
    p50: percentile(values, 0.50),
    p75: percentile(values, 0.75),
  };

  // Current streak
  let currentStreak = 0;

  let cursor = new Date(today);

  while (cursor >= firstDate) {
    const value =
      usage.get(formatDate(cursor)) || 0;

    if (value <= 0) {
      break;
    }

    currentStreak += 1;
    cursor = addDays(cursor, -1);
  }

  // Peak
  let peakTokens = 0;
  let peakDate = null;

  for (const [date, value] of usage.entries()) {
    if (
      date >= formatDate(firstDate) &&
      date <= formatDate(today) &&
      value > peakTokens
    ) {
      peakTokens = value;
      peakDate = date;
    }
  }

  return {
    totalTokens,
    activeDays,
    currentStreak,
    peakTokens,
    peakDate,
    thresholds,
  };
}

// ==============================
// Generate SVG
// ==============================

function generateSvg(usage) {
  const today = startOfDay(new Date());

  const firstVisibleDay = addDays(
    today,
    -(DAYS - 1)
  );

  // GitHub graph starts its columns on Sunday.
  const gridStart = addDays(
    firstVisibleDay,
    -firstVisibleDay.getDay()
  );

  const totalGridDays =
    Math.round(
      (today.getTime() - gridStart.getTime()) /
        86_400_000
    ) + 1;

  const weeks = Math.ceil(totalGridDays / 7);

  const graphWidth = weeks * CELL_STEP;

  const width =
    LEFT_PADDING +
    graphWidth +
    25;

  const graphHeight =
    7 * CELL_STEP;

  const height =
    TOP_PADDING +
    graphHeight +
    BOTTOM_PADDING;

  const stats = calculateStats(
    usage,
    firstVisibleDay,
    today
  );

  const rectangles = [];

  for (let i = 0; i < totalGridDays; i++) {
    const date = addDays(gridStart, i);

    if (
      date < firstVisibleDay ||
      date > today
    ) {
      continue;
    }

    const dateKey = formatDate(date);

    const tokens =
      usage.get(dateKey) || 0;

    const level = calculateLevel(
      tokens,
      stats.thresholds
    );

    const week = Math.floor(i / 7);
    const weekday = date.getDay();

    const x =
      LEFT_PADDING +
      week * CELL_STEP;

    const y =
      TOP_PADDING +
      weekday * CELL_STEP;

    const detail = SHOW_TOKEN_COUNTS
      ? `${tokens.toLocaleString("en-US")} tokens`
      : `activity level ${level}`;

    rectangles.push(`
      <rect
        x="${x}"
        y="${y}"
        width="${CELL_SIZE}"
        height="${CELL_SIZE}"
        rx="2"
        class="level-${level}"
      >
        <title>${escapeXml(dateKey)}: ${escapeXml(detail)}</title>
      </rect>
    `);
  }

  // ==============================
  // Month labels
  // ==============================

  const monthLabels = [];

  let previousMonth = null;
  let lastLabelX = -999;

  for (let i = 0; i < totalGridDays; i++) {
    const date = addDays(gridStart, i);

    if (
      date < firstVisibleDay ||
      date > today
    ) {
      continue;
    }

    const monthKey = `${date.getFullYear()}-${date.getMonth()}`;

    if (monthKey === previousMonth) {
      continue;
    }

    previousMonth = monthKey;

    const week = Math.floor(i / 7);

    const x =
      LEFT_PADDING +
      week * CELL_STEP;

    // Avoid labels overlapping when a tiny slice
    // of a month exists in the graph.
    if (x - lastLabelX < 28) {
      continue;
    }

    lastLabelX = x;

    const monthName =
      new Intl.DateTimeFormat("en-US", {
        month: "short",
      }).format(date);

    monthLabels.push(`
      <text
        x="${x}"
        y="29"
        class="month"
      >${monthName}</text>
    `);
  }

  // ==============================
  // Bottom stats
  // ==============================

  const statsY =
    TOP_PADDING +
    graphHeight +
    27;

  const activeText =
    `${stats.activeDays} active days`;

  const streakText =
    `${stats.currentStreak} day streak`;

  const statsText = SHOW_TOKEN_COUNTS
    ? `${formatTokens(stats.totalTokens)} tokens · ${activeText} · ${streakText}`
    : `${activeText} · ${streakText}`;

  // ==============================
  // SVG
  // ==============================

  return `
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="${width}"
  height="${height}"
  viewBox="0 0 ${width} ${height}"
  role="img"
  aria-label="Codex Token Activity"
>

  <style>

    svg {
      background: transparent;
    }

    text {
      font-family:
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        Helvetica,
        Arial,
        sans-serif;
    }

    .title {
      font-size: 14px;
      font-weight: 600;
      fill: #24292f;
    }

    .month,
    .weekday,
    .stats {
      font-size: 11px;
      fill: #57606a;
    }

    /*
     * Light theme
     */

    .level-0 {
      fill: #ebedf0;
    }

    .level-1 {
      fill: #c6d8e8;
    }

    .level-2 {
      fill: #8eb6d8;
    }

    .level-3 {
      fill: #5491c4;
    }

    .level-4 {
      fill: #2166a5;
    }

    /*
     * GitHub dark theme
     */

    @media (prefers-color-scheme: dark) {

      .title {
        fill: #f0f6fc;
      }

      .month,
      .weekday,
      .stats {
        fill: #8b949e;
      }

      .level-0 {
        fill: #21262d;
      }

      .level-1 {
        fill: #263b4d;
      }

      .level-2 {
        fill: #315976;
      }

      .level-3 {
        fill: #417da5;
      }

      .level-4 {
        fill: #58a6d8;
      }
    }

  </style>


  <!-- Title -->

  <text
    x="0"
    y="14"
    class="title"
  >
    Codex Token Activity
  </text>


  <!-- Months -->

  ${monthLabels.join("\n")}


  <!-- Weekday labels -->

  <text
    x="0"
    y="${TOP_PADDING + CELL_STEP + 9}"
    class="weekday"
  >
    Mon
  </text>

  <text
    x="0"
    y="${TOP_PADDING + CELL_STEP * 3 + 9}"
    class="weekday"
  >
    Wed
  </text>

  <text
    x="0"
    y="${TOP_PADDING + CELL_STEP * 5 + 9}"
    class="weekday"
  >
    Fri
  </text>


  <!-- Activity cells -->

  ${rectangles.join("\n")}


  <!-- Stats -->

  <text
    x="${LEFT_PADDING}"
    y="${statsY}"
    class="stats"
  >
    ${statsText}
  </text>

</svg>
`.trim();
}

// ==============================
// Main
// ==============================

function main() {
  console.log("");
  console.log("Codex Heatmap");
  console.log("-------------");

  const daily = loadCodexUsage();

  console.log(
    `Found ${daily.length} daily records`
  );

  const usage =
    normalizeUsage(daily);

  console.log(
    `Normalized ${usage.size} active dates`
  );

  console.log(
    SHOW_TOKEN_COUNTS
      ? "Public details: exact token counts enabled"
      : "Public details: exact token counts hidden"
  );

  const svg =
    generateSvg(usage);

  fs.writeFileSync(
    OUTPUT_FILE,
    svg,
    "utf8"
  );

  console.log("");
  console.log("✓ Heatmap generated");
  console.log(`✓ ${OUTPUT_FILE}`);
  console.log("");
}

try {
  main();
} catch (error) {
  console.error("");
  console.error(
    "Failed to generate Codex heatmap:"
  );

  console.error(
    error instanceof Error
      ? error.message
      : error
  );

  process.exit(1);
}
