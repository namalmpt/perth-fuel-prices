const express = require("express");
const https = require("https");
const http = require("http");
const cheerio = require("cheerio");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

// Canning Vale coordinates
const CANNING_VALE = { lat: -32.0564, lng: 115.9188 };

// Perth public golf courses
const COURSES = [
  {
    id: "whaleback",
    name: "Whaleback Golf Course",
    suburb: "Parkwood",
    platform: "miclub",
    slug: "whaleback",
    lat: -32.0454,
    lng: 115.9333,
    resourceId: "3000000",
    phone: "(08) 9332 7533",
  },
  {
    id: "collier-park",
    name: "Collier Park Golf Club",
    suburb: "Como",
    platform: "chronogolf",
    slug: "collier-park-golf-club",
    lat: -31.9847,
    lng: 115.8726,
    phone: "(08) 9484 1666",
    directUrl: "https://collierparkgolf.com.au/book-online/",
  },
  {
    id: "fremantle",
    name: "Fremantle Public Golf Course",
    suburb: "Fremantle",
    platform: "miclub",
    slug: "fremantlepublic",
    lat: -32.0411,
    lng: 115.7556,
    resourceId: "3000000",
    phone: "(08) 9335 8866",
  },
  {
    id: "point-walter",
    name: "Point Walter Golf Course",
    suburb: "Bicton",
    platform: "direct",
    slug: "pointwalter",
    lat: -32.0219,
    lng: 115.7819,
    phone: "(08) 9339 0255",
    directUrl: "https://www.melvillecity.com.au/things-to-do/point-walter-golf-course",
  },
  {
    id: "wembley",
    name: "Wembley Golf Course",
    suburb: "Wembley",
    platform: "direct",
    slug: "wembley",
    lat: -31.9025,
    lng: 115.7847,
    phone: "(08) 9387 7828",
    directUrl: "https://wembley.miclub.com.au/guests/bookings/ViewPublicCalendar.msp?booking_resource_id=3000000",
  },
  {
    id: "araluen",
    name: "Araluen Estate Golf Resort",
    suburb: "Roleystone",
    platform: "direct",
    slug: "araluenresort",
    lat: -32.1117,
    lng: 116.0728,
    phone: "(08) 9397 9000",
    directUrl: "https://araluenresort.quick18.com",
  },
  {
    id: "secret-harbour",
    name: "Secret Harbour Golf Links",
    suburb: "Secret Harbour",
    platform: "miclub",
    slug: "secretharbour",
    lat: -32.3822,
    lng: 115.7506,
    resourceId: "3000000",
    phone: "(08) 9524 7133",
  },
  {
    id: "hamersley",
    name: "Hamersley Golf Course",
    suburb: "Karrinyup",
    platform: "quick18",
    slug: "hamersley",
    lat: -31.8622,
    lng: 115.7811,
    phone: "(08) 9447 3484",
  },
  {
    id: "marangaroo",
    name: "Marangaroo Golf Course",
    suburb: "Marangaroo",
    platform: "miclub",
    slug: "marangaroo",
    lat: -31.8297,
    lng: 115.8344,
    resourceId: "3000000",
    phone: "(08) 9342 0222",
  },
  {
    id: "marri-park",
    name: "Marri Park Golf Course",
    suburb: "Casuarina",
    platform: "chronogolf",
    slug: "marri-park-golf-course",
    lat: -32.1181,
    lng: 115.8677,
    phone: "(08) 9523 5637",
    directUrl: "https://www.chronogolf.com/club/marri-park-golf-course",
  },
  // --- Semi-private / private courses with public access ---
  {
    id: "gosnells",
    name: "Gosnells Golf Club",
    suburb: "Gosnells",
    platform: "miclub",
    slug: "gosnells",
    lat: -32.0847,
    lng: 116.0036,
    resourceId: "3000000",
    phone: "(08) 9398 3737",
    access: "semi-private",
  },
  {
    id: "melville-glades",
    name: "Melville Glades Golf Club",
    suburb: "Leeming",
    platform: "miclub",
    slug: "melvilleglades",
    lat: -32.0703,
    lng: 115.8503,
    resourceId: "3000000",
    phone: "(08) 9332 7796",
    access: "semi-private",
  },
  {
    id: "glen-iris",
    name: "Glen Iris Golf Course",
    suburb: "Jandakot",
    platform: "direct",
    slug: "gleniris",
    lat: -32.0956,
    lng: 115.8531,
    phone: "(08) 9332 1937",
    directUrl: "https://www.gleniris.com.au",
    access: "public",
  },
  {
    id: "hartfield-park",
    name: "Hartfield Park Golf Course",
    suburb: "Forrestfield",
    platform: "direct",
    slug: "hartfieldpark",
    lat: -31.9903,
    lng: 116.0342,
    phone: "(08) 9359 3433",
    directUrl: "https://www.hartfieldparkgolf.com.au",
    access: "public",
  },
  {
    id: "embleton",
    name: "Embleton Golf Course",
    suburb: "Embleton",
    platform: "miclub",
    slug: "embleton",
    lat: -31.9022,
    lng: 115.9322,
    resourceId: "3000000",
    phone: "(08) 9271 5689",
    access: "public",
  },
  {
    id: "maylands",
    name: "Maylands Peninsula Golf Course",
    suburb: "Maylands",
    platform: "direct",
    slug: "maylands",
    lat: -31.9433,
    lng: 115.8967,
    phone: "(08) 9271 7878",
    directUrl: "https://www.bayswatergolf.com.au",
    access: "public",
  },
  {
    id: "nedlands",
    name: "Nedlands Golf Club",
    suburb: "Nedlands",
    platform: "miclub",
    slug: "nedlands",
    lat: -31.9658,
    lng: 115.8006,
    resourceId: "3000000",
    phone: "(08) 9386 8177",
    access: "semi-private",
  },
  {
    id: "wanneroo",
    name: "Wanneroo Golf Club",
    suburb: "Wanneroo",
    platform: "miclub",
    slug: "wanneroo",
    lat: -31.7494,
    lng: 115.8006,
    resourceId: "3000000",
    phone: "(08) 9405 2573",
    access: "semi-private",
  },
  {
    id: "links-kennedy-bay",
    name: "The Links Kennedy Bay",
    suburb: "Port Kennedy",
    platform: "miclub",
    slug: "linkskennedybay",
    lat: -32.3400,
    lng: 115.7700,
    resourceId: "3000000",
    phone: "(08) 9523 5400",
    access: "public",
  },
  {
    id: "rockingham",
    name: "Rockingham Golf Club",
    suburb: "Rockingham",
    platform: "miclub",
    slug: "rockingham",
    lat: -32.2778,
    lng: 115.7408,
    resourceId: "3000000",
    phone: "(08) 9527 1412",
    access: "semi-private",
  },
  {
    id: "joondalup",
    name: "Joondalup Resort",
    suburb: "Connolly",
    platform: "direct",
    slug: "joondalup",
    lat: -31.7364,
    lng: 115.7633,
    phone: "(08) 9400 8888",
    directUrl: "https://joondalup.miclub.com.au/guests/bookings/ViewPublicCalendar.msp?booking_resource_id=3000000",
    access: "semi-private",
  },
  {
    id: "the-vines",
    name: "The Vines Resort",
    suburb: "The Vines",
    platform: "direct",
    slug: "thevines",
    lat: -31.7519,
    lng: 116.0164,
    phone: "(08) 9297 3000",
    directUrl: "https://thevines.miclub.com.au/guests/bookings/ViewPublicCalendar.msp?booking_resource_id=3000000",
    access: "semi-private",
  },
  {
    id: "meadow-springs",
    name: "Meadow Springs Golf & Country Club",
    suburb: "Meadow Springs",
    platform: "miclub",
    slug: "meadowsprings",
    lat: -32.4833,
    lng: 115.7500,
    resourceId: "3000000",
    phone: "(08) 9581 6002",
    access: "semi-private",
  },
];

// Calculate distance between two coordinates (Haversine formula)
function calcDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Enrich courses with distance from Canning Vale
COURSES.forEach((c) => {
  c.distance = Math.round(calcDistanceKm(CANNING_VALE.lat, CANNING_VALE.lng, c.lat, c.lng) * 10) / 10;
});
COURSES.sort((a, b) => a.distance - b.distance);

// --- HTTP fetcher ---
function fetchPage(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(
      url,
      {
        timeout,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-AU,en;q=0.9",
        },
      },
      (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          let redirectUrl = response.headers.location;
          if (redirectUrl.startsWith("/")) {
            const u = new URL(url);
            redirectUrl = `${u.protocol}//${u.host}${redirectUrl}`;
          }
          return fetchPage(redirectUrl, timeout).then(resolve).catch(reject);
        }
        let data = "";
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => resolve(data));
        response.on("error", reject);
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

// --- Simple in-memory cache (5-minute TTL) ---
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// --- MiClub scraper (2-step: Calendar -> Timesheet) ---
async function scrapeMiclub(course, dateStr) {
  const cacheKey = `miclub:${course.slug}:${dateStr}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const baseUrl = `https://${course.slug}.miclub.com.au`;
  const bookingUrl = `${baseUrl}/guests/bookings/ViewPublicCalendar.msp?booking_resource_id=${course.resourceId}`;

  try {
    // Step 1: Fetch calendar page to get feeGroupIds
    const calUrl = `${baseUrl}/guests/bookings/ViewPublicCalendar.msp?booking_resource_id=${course.resourceId}&selectedDate=${dateStr}`;
    const calHtml = await fetchPage(calUrl);
    const $cal = cheerio.load(calHtml);

    // Extract feeGroupIds from data-feeid attributes and onclick handlers
    const feeGroupIds = [];
    const feeGroupNames = [];
    $cal("div.feeGroupRow, .feeGroupRow").each((_i, row) => {
      const $row = $cal(row);
      const gameName = $row.find("h3").first().text().trim();

      // Method 1: Extract from data-feeid attribute on cells
      const dateCell = $row.find("[data-date='0']").first();
      const feeid = dateCell.attr("data-feeid") || dateCell.data("feeid");

      if (feeid && !feeGroupIds.includes(String(feeid))) {
        feeGroupIds.push(String(feeid));
        feeGroupNames.push(gameName || "Golf");
        return;
      }

      // Method 2: Extract from onclick attribute
      const onclick = dateCell.attr("onclick") || "";
      const match = onclick.match(/redirectToTimesheet\s*\(\s*'?(\d+)'?/);
      if (match && !feeGroupIds.includes(match[1])) {
        feeGroupIds.push(match[1]);
        feeGroupNames.push(gameName || "Golf");
        return;
      }

      // Method 3: Extract from feeGroupRow class name (e.g. feeGroupId-1500344723)
      const rowClass = $row.attr("class") || "";
      const classMatch = rowClass.match(/feeGroupId-(\d+)/);
      if (classMatch && !feeGroupIds.includes(classMatch[1])) {
        feeGroupIds.push(classMatch[1]);
        feeGroupNames.push(gameName || "Golf");
      }
    });

    // Fallback: regex the entire HTML for redirectToTimesheet calls with the selected date
    if (feeGroupIds.length === 0) {
      const pattern = new RegExp(`redirectToTimesheet\\s*\\(\\s*'?(\\d+)'?\\s*,\\s*'?${dateStr.replace(/-/g, "[-/]")}'?`, "g");
      let m;
      while ((m = pattern.exec(calHtml)) !== null) {
        if (!feeGroupIds.includes(m[1])) {
          feeGroupIds.push(m[1]);
          feeGroupNames.push("Golf");
        }
      }
    }

    // Last resort: any redirectToTimesheet call
    if (feeGroupIds.length === 0) {
      const allCalls = calHtml.match(/redirectToTimesheet\s*\(\s*'?(\d+)'?/g);
      if (allCalls) {
        const seen = new Set();
        allCalls.forEach((call) => {
          const id = call.match(/(\d+)/);
          if (id && !seen.has(id[1])) {
            seen.add(id[1]);
            feeGroupIds.push(id[1]);
            feeGroupNames.push("Golf");
          }
        });
      }
    }

    const allSlots = [];

    // Step 2: Fetch timesheet for each feeGroupId
    for (let i = 0; i < feeGroupIds.length; i++) {
      const tsUrl = `${baseUrl}/guests/bookings/ViewPublicTimesheet.msp?bookingResourceId=${course.resourceId}&selectedDate=${dateStr}&feeGroupId=${feeGroupIds[i]}`;

      try {
        const tsHtml = await fetchPage(tsUrl);
        const $ = cheerio.load(tsHtml);

        // Extract price from fee dictionary in JavaScript
        let price = null;
        const priceMatch = tsHtml.match(/\$(\d+\.?\d{0,2})/);
        if (priceMatch) price = `$${priceMatch[1]}`;

        // Parse tee time rows using TeeTimeFinder-confirmed selectors
        $("div.row-time").each((_j, row) => {
          const $row = $(row);
          const timeText = $row.find("div.time-wrapper h3").text().trim();
          const layout = $row.find("div.time-wrapper h4").text().trim();
          const availableCount = $row.find("div.cell.cell-available").length;
          const totalCells = $row.find("div.cell").length;

          if (timeText && availableCount > 0) {
            allSlots.push({
              time: timeText,
              available: availableCount,
              total: totalCells || 4,
              price,
              gameType: feeGroupNames[i] || undefined,
              layout: layout || undefined,
            });
          }
        });
      } catch (_e) {
        // Skip this feeGroup if it fails
      }
    }

    // If no feeGroupIds found, try direct timesheet access
    if (feeGroupIds.length === 0) {
      try {
        const tsUrl = `${baseUrl}/guests/bookings/ViewPublicTimesheet.msp?bookingResourceId=${course.resourceId}&selectedDate=${dateStr}`;
        const tsHtml = await fetchPage(tsUrl);
        const $ = cheerio.load(tsHtml);

        let price = null;
        const priceMatch = tsHtml.match(/\$(\d+\.?\d{0,2})/);
        if (priceMatch) price = `$${priceMatch[1]}`;

        $("div.row-time").each((_j, row) => {
          const $row = $(row);
          const timeText = $row.find("div.time-wrapper h3").text().trim();
          const availableCount = $row.find("div.cell.cell-available").length;
          const totalCells = $row.find("div.cell").length;

          if (timeText && availableCount > 0) {
            allSlots.push({
              time: timeText,
              available: availableCount,
              total: totalCells || 4,
              price,
            });
          }
        });
      } catch (_e) {
        // Ignore
      }
    }

    const result = {
      course: course.name,
      courseId: course.id,
      suburb: course.suburb,
      distance: course.distance,
      date: dateStr,
      platform: "MiClub",
      bookingUrl,
      phone: course.phone,
      slots: allSlots,
      error: null,
    };

    setCache(cacheKey, result);
    return result;
  } catch (err) {
    return {
      course: course.name,
      courseId: course.id,
      suburb: course.suburb,
      distance: course.distance,
      date: dateStr,
      platform: "MiClub",
      bookingUrl,
      phone: course.phone,
      slots: [],
      error: err.message,
    };
  }
}

// --- Quick18 scraper (using TeeTimeFinder-confirmed selectors) ---
async function scrapeQuick18(course, dateStr) {
  const cacheKey = `quick18:${course.slug}:${dateStr}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // Quick18 date format: YYYYMMDD
  const teedate = dateStr.replace(/-/g, "");
  const url = `https://${course.slug}.quick18.com/teetimes/searchmatrix?teedate=${teedate}`;

  try {
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const slots = [];

    // Extract game types from header: th.matrixHdrSched
    const gameTypes = [];
    $("table.matrixTable thead tr th.matrixHdrSched").each((_i, th) => {
      gameTypes.push($(th).text().trim());
    });

    // Parse tee time rows: table.matrixTable tbody tr
    $("table.matrixTable tbody tr").each((_i, row) => {
      const $row = $(row);

      // Time is in td.mtrxTeeTimes
      const timeCell = $row.find("td.mtrxTeeTimes");
      let time = timeCell.text().trim().replace(/\s+/g, " ");
      if (!time.match(/\d{1,2}:\d{2}/)) return;

      // Players in td.matrixPlayers
      const playersText = $row.find("td.matrixPlayers").text().trim();
      // Extract max players from "1 to 4 players" -> 4
      const playerNums = playersText.match(/(\d+)/g);
      const maxPlayers = playerNums ? parseInt(playerNums[playerNums.length - 1]) : 1;

      // Check each schedule column for availability (has a.sexybutton.teebutton)
      const scheduleCells = $row.find("td.matrixsched");
      let hasAvailability = false;
      let price = null;

      scheduleCells.each((_j, cell) => {
        const $cell = $(cell);
        const bookBtn = $cell.find("a.sexybutton.teebutton, a.teebutton, a[href*='teetime']");
        if (bookBtn.length > 0) {
          hasAvailability = true;
          const priceMatch = $cell.text().match(/\$(\d+\.?\d{0,2})/);
          if (priceMatch && !price) price = `$${priceMatch[1]}`;
        }
      });

      if (hasAvailability) {
        slots.push({
          time,
          available: maxPlayers,
          total: 4,
          price,
        });
      }
    });

    const result = {
      course: course.name,
      courseId: course.id,
      suburb: course.suburb,
      distance: course.distance,
      date: dateStr,
      platform: "Quick18",
      bookingUrl: `https://${course.slug}.quick18.com`,
      phone: course.phone,
      slots,
      error: null,
    };

    setCache(cacheKey, result);
    return result;
  } catch (err) {
    return {
      course: course.name,
      courseId: course.id,
      suburb: course.suburb,
      distance: course.distance,
      date: dateStr,
      platform: "Quick18",
      bookingUrl: `https://${course.slug}.quick18.com`,
      phone: course.phone,
      slots: [],
      error: err.message,
    };
  }
}

// --- Chronogolf scraper (tries JSON API, falls back to direct link) ---
async function scrapeChronogolf(course, dateStr) {
  const cacheKey = `chrono:${course.slug}:${dateStr}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const bookingUrl = `https://www.chronogolf.com/club/${course.slug}#teetimes?date=${dateStr}&nb_holes=18`;

  try {
    // Try Chronogolf's internal API for tee times
    const apiUrl = `https://www.chronogolf.com/marketplace/clubs/${course.slug}/teetimes?date=${dateStr}&nb_holes=18`;
    const json = await fetchPage(apiUrl);
    const data = JSON.parse(json);
    const slots = [];

    if (Array.isArray(data)) {
      data.forEach((tt) => {
        if (tt.available_spots > 0 || tt.spots > 0) {
          const timeStr = tt.start_time || tt.time || "";
          const timeMatch = timeStr.match(/(\d{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?)/);
          slots.push({
            time: timeMatch ? timeMatch[1] : timeStr.slice(11, 16),
            available: tt.available_spots || tt.spots || 1,
            total: tt.max_spots || 4,
            price: tt.price ? `$${tt.price}` : tt.rate ? `$${tt.rate}` : null,
          });
        }
      });
    }

    const result = {
      course: course.name,
      courseId: course.id,
      suburb: course.suburb,
      distance: course.distance,
      date: dateStr,
      platform: "Chronogolf",
      bookingUrl,
      phone: course.phone,
      slots,
      error: null,
    };

    setCache(cacheKey, result);
    return result;
  } catch (_err) {
    // Chronogolf uses client-side rendering, can't reliably scrape
    // Return with link to book directly
    const result = {
      course: course.name,
      courseId: course.id,
      suburb: course.suburb,
      distance: course.distance,
      date: dateStr,
      platform: "Chronogolf",
      bookingUrl,
      phone: course.phone,
      slots: [],
      error: "Check site directly",
    };

    setCache(cacheKey, result);
    return result;
  }
}

// Dispatch to correct scraper
function scrapeCourse(course, dateStr) {
  switch (course.platform) {
    case "miclub":
      return scrapeMiclub(course, dateStr);
    case "quick18":
      return scrapeQuick18(course, dateStr);
    case "chronogolf":
      return scrapeChronogolf(course, dateStr);
    case "direct":
      return Promise.resolve({
        course: course.name,
        courseId: course.id,
        suburb: course.suburb,
        distance: course.distance,
        date: dateStr,
        platform: "Direct",
        bookingUrl: course.directUrl,
        phone: course.phone,
        slots: [],
        error: "Check site directly",
      });
    default:
      return Promise.resolve({
        course: course.name,
        courseId: course.id,
        suburb: course.suburb,
        distance: course.distance,
        date: dateStr,
        slots: [],
        error: "Unknown platform",
      });
  }
}

// --- API Routes ---
app.use(express.static(path.join(__dirname, "public", "golf")));

// Get course list with distances
app.get("/api/courses", (_req, res) => {
  res.json(
    COURSES.map((c) => ({
      id: c.id,
      name: c.name,
      suburb: c.suburb,
      distance: c.distance,
      platform: c.platform,
      access: c.access || "public",
      phone: c.phone,
      bookingUrl: c.directUrl
        || (c.platform === "miclub"
          ? `https://${c.slug}.miclub.com.au/guests/bookings/ViewPublicCalendar.msp?booking_resource_id=${c.resourceId}`
          : c.platform === "quick18"
          ? `https://${c.slug}.quick18.com`
          : `https://www.chronogolf.com/club/${c.slug}`),
    }))
  );
});

// Get tee times for a specific course and date
app.get("/api/teetimes/:courseId", async (req, res) => {
  const { courseId } = req.params;
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ error: "Date parameter required (YYYY-MM-DD)" });
  }

  const course = COURSES.find((c) => c.id === courseId);
  if (!course) {
    return res.status(404).json({ error: "Course not found" });
  }

  const result = await scrapeCourse(course, date);
  res.json(result);
});

// Get tee times for ALL courses on a specific date
app.get("/api/teetimes", async (req, res) => {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ error: "Date parameter required (YYYY-MM-DD)" });
  }

  // Fetch all courses in parallel with concurrency limit
  const batchSize = 4;
  const results = [];

  for (let i = 0; i < COURSES.length; i += batchSize) {
    const batch = COURSES.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((c) => scrapeCourse(c, date)));
    results.push(...batchResults);
  }

  // Sort by distance (already sorted but ensure)
  results.sort((a, b) => a.distance - b.distance);

  res.json({
    date,
    origin: "Canning Vale",
    courses: results,
  });
});

app.listen(PORT, "0.0.0.0", () => {
  const nets = require("os").networkInterfaces();
  const ips = Object.values(nets).flat().filter(i => i.family === "IPv4" && !i.internal).map(i => i.address);
  console.log(`Golf Tee Times app running at http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`  📱 Phone access: http://${ip}:${PORT}`));
  console.log(`Tracking ${COURSES.length} Perth courses, sorted by distance from Canning Vale`);
});
