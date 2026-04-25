import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.resolve(repoRoot, '..', 'outputs');
const outputPath = path.join(outputDir, 'gian-scrape.json');
const BASE_URL = 'https://gian.org';
const LISTING_URL = `${BASE_URL}/multimedia-database/`;
const MAX_PAGES = 30;

function cleanText(value) {
  return String(value || '')
    .replace(/â€™/g, "'")
    .replace(/â€œ|â€/g, '"')
    .replace(/â€“/g, '-')
    .replace(/â€”/g, '-')
    .replace(/Â°/g, '°')
    .replace(/Â©/g, '©')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLocationValue(value) {
  return cleanText(value).replace(/\s*,\s*/g, ', ');
}

function dedupe(values) {
  return [...new Set((values || []).map((value) => cleanText(value)).filter(Boolean))];
}

function dedupeLocations(values) {
  const seen = new Set();
  const output = [];
  for (const value of values || []) {
    const normalized = normalizeLocationValue(value);
    const key = normalized.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function slugify(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '-');
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'GIAN Local Scraper/1.0',
    },
  });
  if (!response.ok) throw new Error(`Fetch failed for ${url}: ${response.status}`);
  return await response.text();
}

function extractSectionFragment(html, headingText, stopHeadings = []) {
  const headingPattern = new RegExp(`<h[1-6][^>]*>\\s*${escapeRegex(headingText)}\\s*<\\/h[1-6]>`, 'i');
  const startMatch = headingPattern.exec(html);
  if (!startMatch) return '';
  const startIndex = startMatch.index + startMatch[0].length;
  let endIndex = html.length;
  for (const stopHeading of stopHeadings) {
    const stopPattern = new RegExp(`<h[1-6][^>]*>\\s*${escapeRegex(stopHeading)}\\s*<\\/h[1-6]>`, 'i');
    const slice = html.slice(startIndex);
    const stopMatch = stopPattern.exec(slice);
    if (stopMatch) endIndex = Math.min(endIndex, startIndex + stopMatch.index);
  }
  return html.slice(startIndex, endIndex);
}

function deriveKeywordTags(...values) {
  const text = cleanText(values.join(' ')).toLowerCase();
  const dictionary = [
    'agriculture', 'horticulture', 'walnut', 'fruit', 'safety', 'tree', 'orchard', 'solar',
    'tool', 'machine', 'device', 'weaving', 'food', 'processing', 'health', 'water',
    'kiwi', 'polyhouse', 'snow', 'grafting', 'farmer', 'livelihood', 'bamboo',
  ];
  return dictionary.filter((tag) => text.includes(tag));
}

function parseListingPage(html) {
  const $ = load(html);
  return $('article.elementor-post').map((_, article) => {
    const root = $(article);
    const detailUrl = root.find('a.elementor-post__thumbnail__link').attr('href') || root.find('h3 a').attr('href') || '';
    const title = cleanText(root.find('h3').first().text());
    const excerpt = cleanText(root.find('.elementor-post__excerpt').text());
    const listingImageUrl = cleanText(root.find('img').first().attr('src'));
    return {
      detail_url: detailUrl,
      title,
      excerpt,
      listing_image_url: listingImageUrl || null,
    };
  }).get().filter((item) => item.detail_url && item.title);
}

function parseDetailPage(listingItem, html) {
  const $ = load(html);
  const title = cleanText($('h1').first().text()) || listingItem.title;
  const innovatorFragment = extractSectionFragment(html, 'Innovator Details', ['Innovation Details']);
  const innovationFragment = extractSectionFragment(html, 'Innovation Details', ['Have thoughts on this innovation or suggestions for improvement? Kindly Share your feedback !']);
  const $innovator = load(`<div>${innovatorFragment}</div>`);
  const $innovation = load(`<div>${innovationFragment}</div>`);

  const iconTexts = $innovator('ul.elementor-icon-list-items li .elementor-icon-list-text')
    .map((_, el) => cleanText($innovator(el).text()))
    .get()
    .filter(Boolean);

  const innovatorName = iconTexts[0] || cleanText($('meta[name="description"]').attr('content')?.split(' by ')[1]) || 'Unknown Innovator';
  const location = iconTexts[1] || '';
  const mediaLinks = dedupe([
    ...$innovator('a').map((_, el) => cleanText($innovator(el).attr('href'))).get(),
    ...$innovation('a').map((_, el) => cleanText($innovation(el).attr('href'))).get(),
  ]).filter((url) => /^https?:\/\//i.test(url));

  const innovatorImages = dedupe(
    $innovator('img').map((_, el) => cleanText($innovator(el).attr('src'))).get()
  );
  const innovationImages = dedupe([
    ...$innovation('img').map((_, el) => cleanText($innovation(el).attr('src'))).get(),
    ...$('meta[property="og:image"]').map((_, el) => cleanText($(el).attr('content'))).get(),
    listingItem.listing_image_url,
  ]).filter(Boolean);

  const innovatorBio = cleanText($innovator('div.elementor-widget-text-editor').text());
  const innovationDetails = cleanText(
    String($innovation('.elementor-widget-container').text() || '')
      .replace(/\/\/\s*Initialize the map[\s\S]*$/i, '')
  ) || listingItem.excerpt;
  const metaKeywords = cleanText($('meta[name="keywords"]').attr('content'));
  const tags = dedupe([
    ...metaKeywords.split(',').map((item) => cleanText(item)),
    ...deriveKeywordTags(title, innovatorBio, innovationDetails, location),
  ]);
  const coordinateMatch = html.match(/setView\(\[\s*([0-9.\-]+)\s*,\s*([0-9.\-]+)\s*\]/i)
    || html.match(/L\.marker\(\[\s*([0-9.\-]+)\s*,\s*([0-9.\-]+)\s*\]/i);
  const latitude = coordinateMatch ? Number(coordinateMatch[1]) : null;
  const longitude = coordinateMatch ? Number(coordinateMatch[2]) : null;

  const detailSlug = slugify(new URL(listingItem.detail_url).pathname.split('/').filter(Boolean).pop() || title);
  return {
    innovation_slug: detailSlug,
    detail_url: listingItem.detail_url,
    innovation_title: title,
    innovator_name: innovatorName,
    location,
    innovator_bio: innovatorBio,
    innovation_details: innovationDetails,
    innovator_images: innovatorImages,
    innovation_images: innovationImages,
    multimedia_links: mediaLinks,
    tags,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    listing_excerpt: listingItem.excerpt,
  };
}

async function scrapeAll() {
  const listings = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = page === 1 ? LISTING_URL : `${LISTING_URL}page/${page}/`;
    const html = await fetchText(url);
    const items = parseListingPage(html);
    if (!items.length) break;
    listings.push(...items);
  }

  const byUrl = new Map();
  listings.forEach((item) => {
    if (!byUrl.has(item.detail_url)) byUrl.set(item.detail_url, item);
  });
  const uniqueListings = [...byUrl.values()];

  const innovations = [];
  for (const item of uniqueListings) {
    const html = await fetchText(item.detail_url);
    innovations.push(parseDetailPage(item, html));
  }

  const payload = {
    scraped_at: new Date().toISOString(),
    total_listings: uniqueListings.length,
    innovations,
  };
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2));
  console.log(`Saved ${innovations.length} GIAN innovations to ${outputPath}`);
}

await scrapeAll();
