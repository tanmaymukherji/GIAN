import { createClient } from "npm:@supabase/supabase-js@2";
import { load } from "npm:cheerio@1.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SELCO_VENDOR_SERVICE_ROLE_KEY") ?? "";
const cronToken = Deno.env.get("GIAN_DIRECTORY_SYNC_CRON_TOKEN") ?? "";
const gianBaseUrl = "https://gian.org";
const gianListingUrl = `${gianBaseUrl}/multimedia-database/`;
const MAX_CONTACT_ENRICHMENTS_PER_RUN = 6;
const STALE_RUN_MINUTES = 20;
let supabaseClient: ReturnType<typeof createClient> | null = null;

type ListingItem = {
  detailUrl: string;
  title: string;
  excerpt: string;
  listingImageUrl: string | null;
};

type ParsedInnovation = {
  detailUrl: string;
  innovationSlug: string;
  title: string;
  innovatorName: string;
  location: string;
  innovatorBio: string;
  innovationDetails: string;
  innovatorImages: string[];
  innovationImages: string[];
  mediaLinks: string[];
  tags: string[];
  emails: string[];
  phones: string[];
  addresses: string[];
  sourceText: string;
  sourceHtml: string;
  listingExcerpt: string;
};

type ContactEnrichment = {
  email: string | null;
  phone: string | null;
  address: string | null;
  sourceUrl: string | null;
  sourceLabel: string;
  notes: string;
};

function getSupabaseAdmin() {
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Function secrets are not configured.");
  if (supabaseClient) return supabaseClient;
  supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return supabaseClient;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

function requireString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: unknown) {
  return requireString(value).toLowerCase();
}

function safeUrl(value: string) {
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : new URL(value, gianBaseUrl).toString();
}

function dedupe(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function toNullableNumber(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function toUsableCoordinate(value: unknown) {
  const num = toNullableNumber(value);
  if (num === null) return null;
  return Math.abs(num) <= 0.0001 ? null : num;
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "-");
}

function cleanText(value: unknown) {
  return requireString(value).replace(/\s+/g, " ").trim();
}

function decodeHtml(value: unknown) {
  return cleanText(
    requireString(value)
      .replace(/&#160;|&nbsp;/gi, " ")
      .replace(/&#8211;/gi, " - ")
      .replace(/&#8217;/gi, "'")
      .replace(/&#8220;|&#8221;/gi, "\"")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string) {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function normalizeLocationValue(value: unknown) {
  return requireString(value)
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*\|\s*/g, " | ")
    .trim();
}

function dedupeLocations(values: unknown[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = normalizeLocationValue(value);
    const key = normalized.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function normalizePhone(value: string) {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+91 ${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return value.trim();
}

function extractEmails(text: string) {
  return dedupe((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((item) => item.toLowerCase()));
}

function extractPhones(text: string) {
  return dedupe((text.match(/(?:\+?91[\s-]*)?[6-9]\d{2}[\s-]*\d{3}[\s-]*\d{4}/g) || []).map(normalizePhone));
}

function extractAddressCandidate(text: string, location: string) {
  const lines = text.split(/\n+/).map((line) => cleanText(line)).filter(Boolean);
  const locationTokens = normalizeText(location).split(/[^a-z0-9]+/).filter(Boolean);
  for (const line of lines) {
    const normalized = normalizeText(line);
    const hasPin = /\b\d{6}\b/.test(line);
    const hasLocation = locationTokens.length ? locationTokens.some((token) => normalized.includes(token)) : false;
    if ((hasPin || hasLocation) && line.includes(",")) return line;
  }
  return null;
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "GIAN Directory Sync/1.0",
    },
  });
  if (!response.ok) throw new Error(`Fetch failed for ${url}: ${response.status}`);
  return await response.text();
}

function isContentMediaUrl(url: string) {
  if (!/^https?:\/\//i.test(url)) return false;
  if (/logo|icon|avatar|facebook|twitter|instagram|linkedin/i.test(url)) return false;
  return true;
}

function extractPageCount(html: string) {
  const $ = load(html);
  const numbers = $("a, span")
    .map((_, el) => Number.parseInt(cleanText($(el).text()), 10))
    .get()
    .filter((value) => Number.isFinite(value));
  return numbers.length ? Math.max(...numbers) : 1;
}

function parseListingPage(html: string) {
  const $ = load(html);
  const items = uniqueBy(
    $('a[href*="/multilingual_data/"]')
      .map((_, link) => {
        const anchor = $(link);
        const detailUrl = safeUrl(anchor.attr("href") || "");
        const article = anchor.closest("article, .elementor-post, .elementor-widget-container, .jeg_postblock_content");
        const title = cleanText(article.find("h1,h2,h3,h4").first().text()) || cleanText(anchor.text());
        const excerpt = cleanText(article.find("p").first().text());
        const listingImageUrl = safeUrl(article.find("img").first().attr("src") || anchor.find("img").first().attr("src") || "");
        return { detailUrl, title, excerpt, listingImageUrl: listingImageUrl || null };
      })
      .get()
      .filter((item) => item.detailUrl && item.title),
    (item) => item.detailUrl
  );
  return { items, pageCount: extractPageCount(html) };
}

async function scrapeListingPage(pageNumber: number) {
  const candidates = pageNumber === 1
    ? [gianListingUrl, `${gianListingUrl}?paged=1`]
    : [`${gianListingUrl}page/${pageNumber}/`, `${gianListingUrl}?paged=${pageNumber}`];
  for (const url of candidates) {
    try {
      const html = await fetchText(url);
      const parsed = parseListingPage(html);
      if (parsed.items.length) return parsed;
    } catch {
      continue;
    }
  }
  return { items: [] as ListingItem[], pageCount: pageNumber };
}

async function scrapeAllListings() {
  const firstPage = await scrapeListingPage(1);
  const pageCount = Math.max(1, firstPage.pageCount);
  const items = [...firstPage.items];
  let emptyPages = 0;
  for (let page = 2; page <= Math.max(pageCount, 8); page += 1) {
    const result = await scrapeListingPage(page);
    if (!result.items.length) {
      emptyPages += 1;
      if (page > pageCount && emptyPages >= 2) break;
      continue;
    }
    emptyPages = 0;
    items.push(...result.items);
  }
  return uniqueBy(items, (item) => item.detailUrl);
}

function collectSectionHtml(html: string, headingPattern: RegExp) {
  const $ = load(html);
  const heading = $("h1,h2,h3,h4,h5,h6")
    .filter((_, el) => headingPattern.test(cleanText($(el).text())))
    .first();
  if (!heading.length) return "";
  const nodes: string[] = [];
  let node = heading.get(0)?.nextSibling || null;
  while (node) {
    if (node.type === "tag" && /^h[1-6]$/i.test(node.name || "")) break;
    nodes.push($.html(node));
    node = node.nextSibling;
  }
  return nodes.join("");
}

function deriveKeywordTags(...values: string[]) {
  const text = normalizeText(values.join(" "));
  const dictionary = [
    "agriculture", "apple", "walnut", "horticulture", "irrigation", "solar", "harvesting",
    "machine", "device", "tool", "health", "food", "dairy", "weaving", "safety",
    "seed", "farmer", "orchard", "polyhouse", "variety", "climbing", "processing",
  ];
  return dictionary.filter((tag) => text.includes(tag));
}

function parseMediaLinks($section: ReturnType<typeof load>) {
  return dedupe($section("a")
    .map((_, el) => safeUrl($section(el).attr("href") || ""))
    .get()
    .filter((url) => url && /^https?:\/\//i.test(url)));
}

function parseImageUrls($section: ReturnType<typeof load>) {
  return dedupe($section("img")
    .map((_, el) => safeUrl($section(el).attr("src") || ""))
    .get()
    .filter((url) => isContentMediaUrl(url)));
}

function parseDetailsPage(listingItem: ListingItem, html: string): ParsedInnovation {
  const $ = load(html);
  const title = cleanText($("h1").first().text()) || cleanText($("h2").first().text()) || listingItem.title;
  const innovatorSectionHtml = collectSectionHtml(html, /innovator details/i);
  const innovationSectionHtml = collectSectionHtml(html, /innovation details/i);
  const innovatorSection = load(`<div>${innovatorSectionHtml}</div>`);
  const innovationSection = load(`<div>${innovationSectionHtml}</div>`);

  const innovatorListItems = innovatorSection("li").map((_, el) => cleanText(innovatorSection(el).text())).get().filter(Boolean);
  const innovatorLinks = parseMediaLinks(innovatorSection);
  const innovationLinks = parseMediaLinks(innovationSection);
  const innovatorImages = parseImageUrls(innovatorSection);
  const innovationImages = dedupe([
    ...parseImageUrls(innovationSection),
    ...$("main img, article img")
      .map((_, el) => safeUrl($(el).attr("src") || ""))
      .get()
      .filter((url) => isContentMediaUrl(url)),
  ]);

  const innovatorName = innovatorListItems.find((item) => !/^https?:\/\//i.test(item))
    || cleanText(listingItem.excerpt.match(/\bby\s+([^.,]+)/i)?.[1] || "")
    || "Unknown Innovator";
  const location = innovatorListItems.find((item) => item !== innovatorName && !/^https?:\/\//i.test(item))
    || "";
  const innovatorBio = cleanText(innovatorSection("body").text()) || cleanText(innovatorSection.root().text());
  const innovationDetails = cleanText(innovationSection("body").text()) || cleanText(innovationSection.root().text()) || listingItem.excerpt;
  const sourceText = cleanText($("main, article").first().text());
  const metaKeywords = cleanText($('meta[name="keywords"]').attr("content") || "");
  const emails = dedupe([
    ...extractEmails(sourceText),
    ...extractEmails(innovatorBio),
    ...extractEmails(innovationDetails),
  ]);
  const phones = dedupe([
    ...extractPhones(sourceText),
    ...extractPhones(innovatorBio),
    ...extractPhones(innovationDetails),
  ]);
  const addresses = dedupeLocations([
    extractAddressCandidate(sourceText, location),
    location,
  ]);
  const tags = dedupe([
    ...metaKeywords.split(",").map((item) => cleanText(item)),
    ...deriveKeywordTags(title, innovationDetails, innovatorBio),
  ]);

  return {
    detailUrl: listingItem.detailUrl,
    innovationSlug: slugify(new URL(listingItem.detailUrl).pathname.split("/").filter(Boolean).pop() || title),
    title,
    innovatorName,
    location,
    innovatorBio,
    innovationDetails,
    innovatorImages,
    innovationImages: innovationImages.length ? innovationImages : (listingItem.listingImageUrl ? [listingItem.listingImageUrl] : []),
    mediaLinks: dedupe([...innovatorLinks, ...innovationLinks]),
    tags,
    emails,
    phones,
    addresses,
    sourceText,
    sourceHtml: html,
    listingExcerpt: listingItem.excerpt,
  };
}

function decodeDuckDuckGoUrl(url: string) {
  try {
    const parsed = new URL(url);
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : url;
  } catch {
    return url;
  }
}

async function searchPublicWebForContacts(parsed: ParsedInnovation) {
  const queries = dedupe([
    `"${parsed.innovatorName}" "${parsed.title}" ${parsed.location} contact`,
    `"${parsed.innovatorName}" ${parsed.location} email phone`,
    `"${parsed.title}" "${parsed.innovatorName}" address`,
  ]);
  const candidates: string[] = [];
  const sources: string[] = [];

  for (const query of queries) {
    try {
      const html = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
      const $ = load(html);
      $(".result, .web-result").slice(0, 5).each((_, el) => {
        const title = cleanText($(el).find(".result__title, .result__a").text());
        const snippet = cleanText($(el).find(".result__snippet").text());
        const href = decodeDuckDuckGoUrl($(el).find("a").first().attr("href") || "");
        candidates.push(title, snippet, href);
        if (/^https?:\/\//i.test(href)) sources.push(href);
      });
    } catch {
      continue;
    }
  }

  const candidateText = candidates.join("\n");
  let emails = extractEmails(candidateText);
  let phones = extractPhones(candidateText);
  let address = extractAddressCandidate(candidateText, parsed.location);

  const fetchableSources = dedupe(sources).filter((url) => /^https?:\/\//i.test(url) && !/duckduckgo\.com/i.test(url)).slice(0, 2);
  for (const url of fetchableSources) {
    if (emails.length && phones.length && address) break;
    try {
      const html = await fetchText(url);
      const text = cleanText(load(html)("body").text());
      emails = dedupe([...emails, ...extractEmails(text)]);
      phones = dedupe([...phones, ...extractPhones(text)]);
      address = address || extractAddressCandidate(text, parsed.location);
    } catch {
      continue;
    }
  }

  return {
    email: emails[0] || null,
    phone: phones[0] || null,
    address: address || null,
    sourceUrl: fetchableSources[0] || null,
    sourceLabel: fetchableSources.length ? "Public web search" : "No public contact found",
    notes: fetchableSources.length
      ? `Contact enrichment searched public web results for ${parsed.innovatorName} and ${parsed.title}.`
      : "GIAN page did not expose direct contact details and public web enrichment found no reliable match.",
  } satisfies ContactEnrichment;
}

function buildGeocodeQueries(address: string, state: string, country: string, locationText: string) {
  const cleanedAddress = normalizeLocationValue(address);
  const cleanedState = normalizeLocationValue(state);
  const cleanedCountry = normalizeLocationValue(country);
  const primaryLocation = normalizeLocationValue(locationText.split("|")[0] || "");
  return dedupeLocations([
    [cleanedAddress, cleanedState, cleanedCountry].filter(Boolean).join(", "),
    [primaryLocation, cleanedState, cleanedCountry].filter(Boolean).join(", "),
    cleanedAddress,
    primaryLocation,
    [cleanedState, cleanedCountry].filter(Boolean).join(", "),
    cleanedCountry,
  ]);
}

async function geocodeAddressFallback(address: string, state: string, country: string, locationText: string) {
  const queries = buildGeocodeQueries(address, state, country, locationText);
  for (const query of queries) {
    if (!query) continue;
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": "GIAN Directory Sync/1.0",
        },
      });
      if (!response.ok) continue;
      const data = await response.json() as Array<Record<string, unknown>>;
      const match = Array.isArray(data) ? data[0] : null;
      const lat = toUsableCoordinate(match?.lat);
      const lng = toUsableCoordinate(match?.lon);
      if (lat !== null && lng !== null) return { latitude: lat, longitude: lng };
    } catch {
      continue;
    }
  }
  return { latitude: null, longitude: null };
}

async function hashToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validateSession(token: string) {
  const supabase = getSupabaseAdmin();
  const tokenHash = await hashToken(token);
  const { data, error } = await supabase.from("grameee_admin_sessions").select("id, username, expires_at").eq("token_hash", tokenHash).maybeSingle();
  if (error || !data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) {
    await supabase.from("grameee_admin_sessions").delete().eq("id", data.id);
    return null;
  }
  await supabase.from("grameee_admin_sessions").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return data;
}

async function verifyAdminPassword(username: string, password: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("grameee_admin_password_matches", { p_username: username, p_password: password });
  if (error) throw new Error(`Admin password verification failed: ${error.message}`);
  return Boolean(data);
}

async function handleLogin(password: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("grameee_admin_accounts").select("username, password_hash").eq("username", "admin").maybeSingle();
  if (error) return errorResponse(`Admin account lookup failed: ${error.message}`, 500);
  if (!data?.password_hash) return errorResponse("Admin account does not exist yet.", 401);
  const validPassword = await verifyAdminPassword("admin", password).catch(() => false);
  if (!validPassword) return errorResponse("Invalid admin password.", 401);

  const token = generateToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from("grameee_admin_sessions").delete().eq("username", "admin");
  const { error: sessionError } = await supabase.from("grameee_admin_sessions").insert({ username: "admin", token_hash: tokenHash, expires_at: expiresAt });
  if (sessionError) return errorResponse("Admin session could not be created.", 500);
  return jsonResponse({ token, username: "admin", expires_at: expiresAt });
}

async function handleVerify(token: string) {
  const session = await validateSession(token);
  return jsonResponse({ valid: Boolean(session), username: session?.username ?? null, expires_at: session?.expires_at ?? null });
}

async function handleLogout(token: string) {
  const supabase = getSupabaseAdmin();
  const tokenHash = await hashToken(token);
  await supabase.from("grameee_admin_sessions").delete().eq("token_hash", tokenHash);
  return jsonResponse({ ok: true });
}

async function mapLimit<T, R>(items: T[], batchSize: number, worker: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const batchResults = await Promise.all(batch.map((item) => worker(item)));
    results.push(...batchResults);
  }
  return results;
}

async function upsertInBatches(table: string, rows: Record<string, unknown>[], onConflict: string, batchSize: number) {
  const supabase = getSupabaseAdmin();
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    if (!batch.length) continue;
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
}

async function markStaleRunningSyncs() {
  const supabase = getSupabaseAdmin();
  const staleBefore = new Date(Date.now() - STALE_RUN_MINUTES * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("gian_sync_runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: `Marked failed automatically after exceeding ${STALE_RUN_MINUTES} minutes in running state.`,
      updated_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .lt("started_at", staleBefore);
  if (error) throw new Error(`Could not update stale GIAN sync runs: ${error.message}`);
}

async function handleListGianSyncRuns(token: string) {
  const supabase = getSupabaseAdmin();
  const session = await validateSession(token);
  if (!session) return errorResponse("Invalid admin session.", 401);
  await markStaleRunningSyncs();
  const { data, error } = await supabase.from("gian_sync_runs").select("*").order("created_at", { ascending: false }).limit(10);
  if (error) return errorResponse("GIAN sync runs could not be loaded.", 500);
  return jsonResponse({ items: data ?? [] });
}

function pickPrimaryAddress(parsed: ParsedInnovation, enriched: ContactEnrichment) {
  return normalizeLocationValue(enriched.address || parsed.addresses[0] || parsed.location);
}

function buildVendorId(parsed: ParsedInnovation) {
  return slugify(`${parsed.innovatorName || "innovator"}-${parsed.location || parsed.innovationSlug}`);
}

async function runGianSync(requestedBy: string) {
  const supabase = getSupabaseAdmin();
  await markStaleRunningSyncs();
  const { data: runData, error: runError } = await supabase.from("gian_sync_runs").insert({ status: "running", requested_by: requestedBy, started_at: new Date().toISOString() }).select("id").single();
  if (runError || !runData?.id) throw new Error("GIAN sync run could not be created.");
  const runId = String(runData.id);

  try {
    const listingItems = await scrapeAllListings();
    let enrichmentCount = 0;
    const parsedInnovations = await mapLimit(listingItems, 4, async (listingItem) => {
      const html = await fetchText(listingItem.detailUrl);
      const parsed = parseDetailsPage(listingItem, html);
      const shouldEnrich =
        (!parsed.emails.length || !parsed.phones.length)
        && enrichmentCount < MAX_CONTACT_ENRICHMENTS_PER_RUN;
      if (shouldEnrich) enrichmentCount += 1;
      const enriched = shouldEnrich ? await searchPublicWebForContacts(parsed) : {
        email: parsed.emails[0] || null,
        phone: parsed.phones[0] || null,
        address: parsed.addresses[0] || null,
        sourceUrl: parsed.detailUrl,
        sourceLabel: parsed.emails.length || parsed.phones.length ? "GIAN detail page" : "GIAN detail page only",
        notes: parsed.emails.length || parsed.phones.length
          ? "Contact details captured directly from GIAN where available."
          : "No direct contact found on GIAN for this record in this run. Public web enrichment is limited per sync to keep the job within edge runtime limits.",
      };
      return { parsed, enriched };
    });

    const productRows = parsedInnovations.map(({ parsed }) => {
      const vendorId = buildVendorId(parsed);
      const innovationTags = dedupe(parsed.tags);
      const productSpecifications = [
        { key: "Innovator Name", value: parsed.innovatorName || "Not listed" },
        { key: "Location", value: parsed.location || "Not listed" },
        { key: "Details of Innovation", value: parsed.innovationDetails || parsed.listingExcerpt || "Not listed" },
        { key: "Multimedia Links", value: parsed.mediaLinks.join(" | ") || "Not listed" },
      ];
      return {
        portal_product_id: parsed.innovationSlug,
        portal_vendor_id: vendorId,
        vendor_name: parsed.innovatorName || "Unknown Innovator",
        product_name: parsed.title,
        product_description: parsed.innovationDetails || parsed.listingExcerpt || null,
        product_link: parsed.detailUrl,
        product_image_url: parsed.innovationImages[0] || null,
        product_gallery_urls: parsed.innovationImages,
        product_video_urls: parsed.mediaLinks,
        product_location_text: parsed.location || null,
        product_categories: [],
        product_subcategories: [],
        product_specifications: productSpecifications,
        tags: innovationTags,
        search_text: dedupe([
          parsed.title,
          parsed.innovatorName,
          parsed.location,
          parsed.innovationDetails,
          parsed.innovatorBio,
          ...innovationTags,
          ...parsed.mediaLinks,
        ]).join(" "),
        raw_product: {
          detail_url: parsed.detailUrl,
          title: parsed.title,
          innovator_name: parsed.innovatorName,
          innovation_details: parsed.innovationDetails,
          source_text: parsed.sourceText,
        },
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });

    const rawVendorRows = uniqueBy(parsedInnovations.map(({ parsed, enriched }) => {
      const vendorId = buildVendorId(parsed);
      const linkedProducts = productRows.filter((item) => item.portal_vendor_id === vendorId);
      const finalAddress = pickPrimaryAddress(parsed, enriched);
      return {
        portal_vendor_id: vendorId,
        vendor_name: parsed.innovatorName || "Unknown Innovator",
        about_vendor: parsed.innovatorBio || parsed.listingExcerpt || null,
        website_details: enriched.sourceUrl || parsed.detailUrl,
        location_text: dedupeLocations([finalAddress, parsed.location]).join(" | ") || null,
        city: null,
        state: parsed.location || null,
        country: "India",
        service_locations: dedupeLocations([parsed.location]),
        tags: dedupe([...parsed.tags, ...linkedProducts.flatMap((item) => item.tags || [])]),
        portal_vendor_link: parsed.detailUrl,
        portal_contact_name: parsed.innovatorName || "Unknown Innovator",
        portal_email: parsed.emails[0] || null,
        portal_phone: parsed.phones[0] || null,
        website_email: enriched.email,
        website_phone: enriched.phone,
        website_address: enriched.address,
        final_contact_email: parsed.emails[0] || enriched.email,
        final_contact_phone: parsed.phones[0] || enriched.phone,
        final_contact_address: finalAddress || null,
        contact_source_url: enriched.sourceUrl || parsed.detailUrl,
        website_status: enriched.sourceLabel,
        legacy_products_links: linkedProducts.map((item) => item.product_link).filter(Boolean).join("\n"),
        contact_notes: enriched.notes,
        innovator_image_urls: parsed.innovatorImages,
        innovator_media_urls: parsed.mediaLinks,
        latitude: null,
        longitude: null,
        products_count: linkedProducts.length,
        search_text: dedupe([
          parsed.innovatorName,
          parsed.location,
          parsed.innovatorBio,
          parsed.innovationDetails,
          parsed.emails.join(" "),
          parsed.phones.join(" "),
          enriched.email || "",
          enriched.phone || "",
          enriched.address || "",
          ...parsed.tags,
          ...linkedProducts.flatMap((item) => [item.product_name, item.product_description || ""]),
        ]).join(" "),
        raw_vendor: {
          source_detail_url: parsed.detailUrl,
          innovator_name: parsed.innovatorName,
          innovator_bio: parsed.innovatorBio,
          parsed_location: parsed.location,
          parsed_addresses: parsed.addresses,
        },
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }), (row) => requireString(row.portal_vendor_id));

    const vendorRows = await mapLimit(rawVendorRows, 4, async (row) => {
      const geocoded = await geocodeAddressFallback(
        requireString(row.final_contact_address),
        requireString(row.state),
        requireString(row.country),
        requireString(row.location_text),
      );
      return {
        ...row,
        latitude: geocoded.latitude,
        longitude: geocoded.longitude,
      };
    });

    await upsertInBatches("gian_innovators", vendorRows, "portal_vendor_id", 50);
    await upsertInBatches("gian_innovations", productRows, "portal_product_id", 50);

    await supabase.from("gian_sync_runs").update({
      status: "success",
      finished_at: new Date().toISOString(),
      vendor_count: vendorRows.length,
      product_count: productRows.length,
      updated_at: new Date().toISOString(),
    }).eq("id", runId);

    return { vendorCount: vendorRows.length, productCount: productRows.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "GIAN directory sync failed.";
    await supabase.from("gian_sync_runs").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: message,
      updated_at: new Date().toISOString(),
    }).eq("id", runId);
    throw error;
  }
}

async function handleSyncGianDirectory(token: string) {
  const session = await validateSession(token);
  if (!session) return errorResponse("Invalid admin session.", 401);
  try {
    const result = await runGianSync(session.username);
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "GIAN directory sync failed.", 500);
  }
}

async function handleScheduledSync(receivedToken: string) {
  if (!cronToken || receivedToken !== cronToken) return errorResponse("Invalid sync token.", 401);
  try {
    const result = await runGianSync("scheduler");
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Scheduled sync failed.", 500);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return errorResponse("Method not allowed.", 405);
  if (!supabaseUrl || !serviceRoleKey) return errorResponse("Function secrets are not configured.", 500);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return errorResponse("Invalid JSON body.", 400); }

  const action = requireString(body.action);
  const token = requireString(body.token);
  const password = requireString(body.password);
  const receivedCronToken = requireString(body.cronToken);

  switch (action) {
    case "login":
      return await handleLogin(password);
    case "verify":
      return await handleVerify(token);
    case "logout":
      return await handleLogout(token);
    case "listGianSyncRuns":
      return await handleListGianSyncRuns(token);
    case "syncGianDirectory":
      return await handleSyncGianDirectory(token);
    case "scheduledSync":
      return await handleScheduledSync(receivedCronToken);
    default:
      return errorResponse("Unknown admin action.", 400);
  }
});
