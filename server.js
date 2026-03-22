const express = require("express");
const https = require("https");
const { parseStringPromise } = require("xml2js");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, "public")));

// Proxy endpoint for FuelWatch RSS feed
app.get("/api/fuel", async (req, res) => {
  const { product, suburb, region, brand, day } = req.query;

  const params = new URLSearchParams();
  if (product) params.set("Product", product);
  if (suburb) params.set("Suburb", suburb);
  if (region) params.set("Region", region);
  if (brand) params.set("Brand", brand);
  if (day) params.set("Day", day);

  const url = `https://www.fuelwatch.wa.gov.au/fuelwatch/fuelWatchRSS?${params}`;

  try {
    const xml = await fetchXml(url);
    const parsed = await parseStringPromise(xml, { explicitArray: false });
    const channel = parsed.rss?.channel;

    if (!channel || !channel.item) {
      return res.json({ stations: [], title: channel?.title || "No results" });
    }

    const items = Array.isArray(channel.item) ? channel.item : [channel.item];

    const stations = items.map((item) => ({
      name: item["trading-name"] || "",
      brand: item.brand || "",
      price: parseFloat(item.price) || 0,
      address: item.address || "",
      suburb: item.location || "",
      phone: item.phone || "",
      latitude: parseFloat(item.latitude) || 0,
      longitude: parseFloat(item.longitude) || 0,
      date: item.date || "",
      features: item["site-features"] || "",
    }));

    stations.sort((a, b) => a.price - b.price);

    res.json({ stations, title: channel.title || "FuelWatch" });
  } catch (err) {
    console.error("FuelWatch fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch fuel prices" });
  }
});

function fetchXml(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10000 }, (response) => {
      let data = "";
      response.on("data", (chunk) => (data += chunk));
      response.on("end", () => resolve(data));
      response.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

app.listen(PORT, () => {
  console.log(`Fuel Price app running at http://localhost:${PORT}`);
});
