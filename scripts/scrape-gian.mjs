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
const WEB_RESULT_LIMIT = 5;
const WEB_FETCH_LIMIT = 2;
const CONTACT_OVERRIDES = {
  'hrmn-99-apple-variety-for-low-altitude': {
    emails: ['sharmaharimanfarm@gmail.com'],
    phones: ['+91 70185 20244', '+91 94188 67209', '+91 98172 84251'],
    addresses: ['Village Paniala, PO Kothi, Ghumarwin, District Bilaspur, Himachal Pradesh 174021'],
    website_url: 'https://harimansharmaapplenursery.com/contact/',
    contact_source_urls: [
      'https://harimansharmaapplenursery.com/contact/',
      'https://harimansharmaapplenursery.com/about-eng/',
    ],
    contact_search_notes: 'Verified from Hariman Sharma Apple Nursery public pages.',
  },
  'mitticool-clay-creation': {
    emails: ['info@mitticool.com'],
    phones: ['+91 98251 77249'],
    addresses: ['R.K. Nagar, Panchasar Road, Wankaner, Gujarat 363622'],
    website_url: 'https://mitticool.com/',
    contact_source_urls: [
      'https://techxlab.org/solutions/mitticool-refrigerator/',
      'https://mitticool.com/',
    ],
    contact_search_notes: 'Verified from public Mitticool / Technology Exchange Lab listings.',
  },
  'foldable-cylinder-carrier': {
    emails: ['comradesabzar@gmail.com'],
    addresses: ['Kreeri, Dooru, Anantnag, Jammu and Kashmir 192211'],
    contact_source_urls: [
      'https://gian.org/cylinder-carrier/',
    ],
    contact_search_notes: 'Verified from the public GIAN innovation profile page.',
  },
};

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

function decodeDuckDuckGoUrl(url) {
  try {
    const parsed = new URL(url);
    const uddg = parsed.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : url;
  } catch {
    return url;
  }
}

function normalizeVideoUrl(url) {
  const value = cleanText(url);
  if (!value) return '';
  const youtubeId = value.match(/youtube\.com\/shorts\/([^?&#/]+)/i)?.[1]
    || value.match(/youtube\.com\/watch\?v=([^?&#/]+)/i)?.[1]
    || value.match(/youtu\.be\/([^?&#/]+)/i)?.[1]
    || value.match(/youtube\.com\/embed\/([^?&#/]+)/i)?.[1];
  if (youtubeId) return `https://www.youtube.com/embed/${youtubeId}`;
  const vimeoId = value.match(/vimeo\.com\/(?:video\/)?(\d+)/i)?.[1];
  if (vimeoId) return `https://player.vimeo.com/video/${vimeoId}`;
  const loomId = value.match(/loom\.com\/(?:share|embed)\/([^?&#/]+)/i)?.[1];
  if (loomId) return `https://www.loom.com/embed/${loomId}`;
  return value;
}

function extractEmails(text) {
  return dedupe((String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((item) => item.toLowerCase()))
    .filter((email) => !/@gian\.org$/i.test(email));
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+91 ${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return cleanText(value);
}

function extractPhones(text) {
  return dedupe((String(text || '').match(/(?:\+?91[\s-]*)?[6-9]\d{2}[\s-]*\d{3}[\s-]*\d{4}/g) || []).map(normalizePhone));
}

function extractAddressCandidate(text, location) {
  const locationTokens = cleanText(location).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const lines = String(text || '').split(/\n+/).map((line) => cleanText(line)).filter(Boolean);
  for (const line of lines) {
    const normalized = line.toLowerCase();
    const hasLocation = locationTokens.length ? locationTokens.some((token) => normalized.includes(token)) : false;
    if (
      hasLocation
      && (line.includes(',') || line.includes('-'))
      && line.length <= 120
      && !/@media|{|}|award|festival|sponsored|supported by|honey bee network|gian|var map|setview|l\.marker|bindpopup|https?:\/\/|www\.|google maps|leaflet/i.test(line)
    ) return line;
  }
  return null;
}

function applyContactOverride(innovation) {
  const override = CONTACT_OVERRIDES[innovation.innovation_slug];
  if (!override) return innovation;
  return {
    ...innovation,
    emails: dedupe([...(override.emails || []), ...(innovation.emails || [])]),
    phones: dedupe([...(override.phones || []).map(normalizePhone), ...(innovation.phones || [])]),
    addresses: dedupeLocations([...(override.addresses || []), ...(innovation.addresses || [])]),
    website_url: override.website_url || innovation.website_url || '',
    contact_source_urls: dedupe([...(innovation.contact_source_urls || []), ...(override.contact_source_urls || [])]),
    contact_search_notes: override.contact_search_notes || innovation.contact_search_notes,
  };
}

function shouldSkipWebSource(url) {
  return /duckduckgo\.com|facebook\.com|instagram\.com|linkedin\.com|x\.com|twitter\.com|youtube\.com|youtu\.be/i.test(url);
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
  ]).filter((url) => /^https?:\/\//i.test(url)).map(normalizeVideoUrl);

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
  const pageText = cleanText($('body').text());
  const directEmails = extractEmails(pageText);
  const directPhones = extractPhones(pageText);
  const directAddress = extractAddressCandidate($('body').text(), location);

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
    emails: directEmails,
    phones: directPhones,
    addresses: dedupeLocations([directAddress]),
    fallback_location: normalizeLocationValue(location),
    website_url: '',
    contact_source_urls: [listingItem.detail_url],
    contact_search_notes: directEmails.length || directPhones.length ? 'Found on GIAN detail page.' : 'No direct contact found on GIAN page.',
    listing_excerpt: listingItem.excerpt,
  };
}

async function searchPublicWebForContacts(innovation) {
  const queries = dedupe([
    `${innovation.innovator_name} ${innovation.innovation_title} ${innovation.location} contact`,
    `${innovation.innovator_name} ${innovation.location} email phone address`,
    `${innovation.innovation_title} ${innovation.innovator_name}`,
  ]);
  const sources = [];
  let emails = [...(innovation.emails || [])];
  let phones = [...(innovation.phones || [])];
  let addresses = [...(innovation.addresses || [])];
  let websiteUrl = innovation.website_url || '';

  for (const query of queries) {
    const html = await fetchText(`https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`);
    const $ = load(html);
    const snippetTexts = [];
    $('a').each((_, link) => {
      const href = cleanText($(link).attr('href'));
      const text = cleanText($(link).text());
      if (!href || !/^https?:\/\//i.test(href)) return;
      if (sources.length >= WEB_RESULT_LIMIT * 3) return;
      sources.push(href);
      snippetTexts.push(text, href);
    });
    const snippetBlob = snippetTexts.join('\n');
    emails = dedupe([...emails, ...extractEmails(snippetBlob)]);
    phones = dedupe([...phones, ...extractPhones(snippetBlob)]);
    addresses = dedupeLocations([...addresses, extractAddressCandidate(snippetBlob, innovation.location)]);
    if (!websiteUrl) {
      websiteUrl = sources.find((url) => !shouldSkipWebSource(url)) || '';
    }
    if (emails.length && phones.length && addresses.length) break;
  }

  const fetchableSources = dedupe(sources)
    .filter((url) => !shouldSkipWebSource(url))
    .filter((url) => !/\/multilingual_data\//i.test(url))
    .slice(0, WEB_FETCH_LIMIT);
  for (const sourceUrl of fetchableSources) {
    const html = await fetchText(sourceUrl);
    const $ = load(html);
    const bodyText = cleanText($('body').text());
    emails = dedupe([...emails, ...extractEmails(bodyText)]);
    phones = dedupe([...phones, ...extractPhones(bodyText)]);
    addresses = dedupeLocations([...addresses, extractAddressCandidate($('body').text(), innovation.location)]);
    if (!websiteUrl) websiteUrl = sourceUrl;
  }

  return {
    ...innovation,
    emails,
    phones,
    addresses: dedupeLocations([...addresses]),
    website_url: websiteUrl,
    contact_source_urls: dedupe([...(innovation.contact_source_urls || []), ...fetchableSources]),
    contact_search_notes: emails.length || phones.length
      ? 'Locally enriched from public web search and source pages.'
      : 'No reliable public contact found during local web enrichment.',
  };
}

async function mapLimit(items, batchSize, worker) {
  const results = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const batchResults = await Promise.all(batch.map((item) => worker(item)));
    results.push(...batchResults);
  }
  return results;
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

  const parsedInnovations = [];
  for (const item of uniqueListings) {
    const html = await fetchText(item.detail_url);
    parsedInnovations.push(parseDetailPage(item, html));
  }

  const innovations = await mapLimit(parsedInnovations, 3, async (innovation) => {
    try {
      return applyContactOverride(await searchPublicWebForContacts(innovation));
    } catch {
      return applyContactOverride(innovation);
    }
  });

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
