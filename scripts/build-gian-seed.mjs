import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const inputPath = path.resolve(repoRoot, '..', 'outputs', 'gian-scrape.json');
const migrationPath = path.resolve(repoRoot, 'supabase', 'migrations', '20260425230000_refresh_gian_enriched_load_v2.sql');

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

function sqlString(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value ?? null))}::jsonb`;
}

function sqlTextArray(values) {
  const items = (values || []).map((value) => sqlString(value)).join(', ');
  return `ARRAY[${items}]::text[]`;
}

function buildVendorId(innovation) {
  return slugify(`${innovation.innovator_name}-${innovation.location || innovation.innovation_slug}`);
}

function buildSeed(data) {
  const innovations = Array.isArray(data?.innovations) ? data.innovations : [];
  const productRows = innovations.map((innovation) => {
    const vendorId = buildVendorId(innovation);
    const specs = [
      { key: 'Innovator Name', value: innovation.innovator_name || 'Not listed' },
      { key: 'Location', value: innovation.location || 'Not listed' },
      { key: 'Details of Innovation', value: innovation.innovation_details || innovation.listing_excerpt || 'Not listed' },
      { key: 'Multimedia Links', value: (innovation.multimedia_links || []).join(' | ') || 'Not listed' },
    ];
    return {
      portal_product_id: innovation.innovation_slug,
      portal_vendor_id: vendorId,
      vendor_name: innovation.innovator_name,
      product_name: innovation.innovation_title,
      product_description: innovation.innovation_details || innovation.listing_excerpt || null,
      product_link: innovation.detail_url,
      product_image_url: innovation.innovation_images?.[0] || null,
      product_gallery_urls: innovation.innovation_images || [],
      product_video_urls: (innovation.multimedia_links || []).map(normalizeVideoUrl).filter(Boolean),
      product_location_text: innovation.location || null,
      product_categories: [],
      product_subcategories: [],
      product_specifications: specs,
      tags: innovation.tags || [],
      search_text: dedupe([
        innovation.innovation_title,
        innovation.innovator_name,
        innovation.location,
        innovation.innovator_bio,
        innovation.innovation_details,
        ...(innovation.tags || []),
        ...(innovation.multimedia_links || []),
      ]).join(' '),
      raw_product: innovation,
    };
  });

  const vendorMap = new Map();
  for (const innovation of innovations) {
    const vendorId = buildVendorId(innovation);
    const existing = vendorMap.get(vendorId) || {
      portal_vendor_id: vendorId,
      vendor_name: innovation.innovator_name || 'Unknown Innovator',
      about_vendor: innovation.innovator_bio || innovation.listing_excerpt || null,
      website_details: innovation.detail_url,
      location_text: dedupeLocations([innovation.location]).join(' | ') || null,
      city: null,
      state: innovation.location || null,
      country: 'India',
      service_locations: dedupeLocations([innovation.location]),
      tags: [],
      portal_vendor_link: innovation.detail_url,
      portal_contact_name: innovation.innovator_name || 'Unknown Innovator',
      portal_email: innovation.emails?.[0] || null,
      portal_phone: innovation.phones?.[0] || null,
      website_email: innovation.emails?.[0] || null,
      website_phone: innovation.phones?.[0] || null,
      website_address: innovation.addresses?.[0] || null,
      final_contact_email: innovation.emails?.[0] || null,
      final_contact_phone: innovation.phones?.[0] || null,
      final_contact_address: innovation.addresses?.[0] || innovation.fallback_location || innovation.location || null,
      contact_source_url: innovation.contact_source_urls?.[0] || innovation.detail_url,
      website_status: innovation.emails?.length || innovation.phones?.length ? 'Imported with local web contact enrichment' : 'Imported from local GIAN scrape only',
      legacy_products_links: '',
      contact_notes: innovation.contact_search_notes || 'Imported from local GIAN scrape.',
      innovator_image_urls: innovation.innovator_images || [],
      innovator_media_urls: (innovation.multimedia_links || []).map(normalizeVideoUrl).filter(Boolean),
      latitude: Number.isFinite(Number(innovation.latitude)) ? Number(innovation.latitude) : null,
      longitude: Number.isFinite(Number(innovation.longitude)) ? Number(innovation.longitude) : null,
      products_count: 0,
      search_text: '',
      raw_vendor: {
        innovator_name: innovation.innovator_name,
        location: innovation.location,
        detail_url: innovation.detail_url,
        emails: innovation.emails || [],
        phones: innovation.phones || [],
        addresses: innovation.addresses || [],
        fallback_location: innovation.fallback_location || innovation.location || '',
        contact_source_urls: innovation.contact_source_urls || [],
      },
    };
    existing.tags = dedupe([...(existing.tags || []), ...(innovation.tags || [])]);
    existing.service_locations = dedupeLocations([...(existing.service_locations || []), innovation.location]);
    existing.innovator_image_urls = dedupe([...(existing.innovator_image_urls || []), ...(innovation.innovator_images || [])]);
    existing.innovator_media_urls = dedupe([...(existing.innovator_media_urls || []), ...(innovation.multimedia_links || []).map(normalizeVideoUrl)]);
    existing.legacy_products_links = dedupe([existing.legacy_products_links, innovation.detail_url]).filter(Boolean).join('\n');
    existing.website_details = innovation.website_url || existing.website_details;
    vendorMap.set(vendorId, existing);
  }

  const vendors = [...vendorMap.values()].map((vendor) => {
    const linkedProducts = productRows.filter((item) => item.portal_vendor_id === vendor.portal_vendor_id);
    return {
      ...vendor,
      products_count: linkedProducts.length,
      search_text: dedupe([
        vendor.vendor_name,
        vendor.about_vendor,
        vendor.location_text,
        ...(vendor.tags || []),
        ...linkedProducts.flatMap((item) => [item.product_name, item.product_description]),
      ]).join(' '),
    };
  });

  const lines = [];
  lines.push('delete from public.gian_innovations;');
  lines.push('delete from public.gian_innovators;');
  lines.push('');

  for (const vendor of vendors) {
    lines.push(
      `insert into public.gian_innovators (` +
      `portal_vendor_id, vendor_name, about_vendor, website_details, location_text, city, state, country, service_locations, tags, ` +
      `portal_vendor_link, portal_contact_name, portal_email, portal_phone, website_email, website_phone, website_address, ` +
      `final_contact_email, final_contact_phone, final_contact_address, contact_source_url, website_status, legacy_products_links, contact_notes, ` +
      `innovator_image_urls, innovator_media_urls, latitude, longitude, products_count, search_text, raw_vendor, synced_at, updated_at` +
      `) values (` +
      `${sqlString(vendor.portal_vendor_id)}, ${sqlString(vendor.vendor_name)}, ${sqlString(vendor.about_vendor)}, ${sqlString(vendor.website_details)}, ${sqlString(vendor.location_text)}, ` +
      `${sqlString(vendor.city)}, ${sqlString(vendor.state)}, ${sqlString(vendor.country)}, ${sqlTextArray(vendor.service_locations)}, ${sqlTextArray(vendor.tags)}, ` +
      `${sqlString(vendor.portal_vendor_link)}, ${sqlString(vendor.portal_contact_name)}, ${sqlString(vendor.portal_email)}, ${sqlString(vendor.portal_phone)}, ` +
      `${sqlString(vendor.website_email)}, ${sqlString(vendor.website_phone)}, ${sqlString(vendor.website_address)}, ${sqlString(vendor.final_contact_email)}, ` +
      `${sqlString(vendor.final_contact_phone)}, ${sqlString(vendor.final_contact_address)}, ${sqlString(vendor.contact_source_url)}, ${sqlString(vendor.website_status)}, ` +
      `${sqlString(vendor.legacy_products_links)}, ${sqlString(vendor.contact_notes)}, ${sqlJson(vendor.innovator_image_urls)}, ${sqlJson(vendor.innovator_media_urls)}, ` +
      `${vendor.latitude === null ? 'null' : String(vendor.latitude)}, ${vendor.longitude === null ? 'null' : String(vendor.longitude)}, ${Number(vendor.products_count || 0)}, ${sqlString(vendor.search_text)}, ${sqlJson(vendor.raw_vendor)}, now(), now());`
    );
  }

  lines.push('');

  for (const product of productRows) {
    lines.push(
      `insert into public.gian_innovations (` +
      `portal_product_id, portal_vendor_id, vendor_name, product_name, product_description, product_link, product_image_url, product_gallery_urls, ` +
      `product_video_urls, product_location_text, product_categories, product_subcategories, product_specifications, tags, search_text, raw_product, synced_at, updated_at` +
      `) values (` +
      `${sqlString(product.portal_product_id)}, ${sqlString(product.portal_vendor_id)}, ${sqlString(product.vendor_name)}, ${sqlString(product.product_name)}, ` +
      `${sqlString(product.product_description)}, ${sqlString(product.product_link)}, ${sqlString(product.product_image_url)}, ${sqlJson(product.product_gallery_urls)}, ` +
      `${sqlJson(product.product_video_urls)}, ${sqlString(product.product_location_text)}, ${sqlTextArray(product.product_categories)}, ${sqlTextArray(product.product_subcategories)}, ` +
      `${sqlJson(product.product_specifications)}, ${sqlTextArray(product.tags)}, ${sqlString(product.search_text)}, ${sqlJson(product.raw_product)}, now(), now());`
    );
  }

  lines.push('');
  lines.push(
    `insert into public.gian_sync_state (state_key, next_offset, last_total, last_started_at, last_finished_at, updated_at)` +
    ` values ('default', 0, ${innovations.length}, now(), now(), now())` +
    ` on conflict (state_key) do update set next_offset = excluded.next_offset, last_total = excluded.last_total, last_started_at = excluded.last_started_at, last_finished_at = excluded.last_finished_at, updated_at = excluded.updated_at;`
  );

  return lines.join('\n');
}

async function main() {
  const raw = await fs.readFile(inputPath, 'utf8');
  const data = JSON.parse(raw);
  const sql = buildSeed(data);
  await fs.writeFile(migrationPath, sql);
  console.log(`Wrote ${migrationPath}`);
}

await main();
