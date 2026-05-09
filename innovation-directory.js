const directoryState = {
  vendors: [],
  products: [],
  filteredVendors: [],
  currentPage: 1,
  pageSize: 12,
  hasSearched: false,
  geocodeCache: new Map(),
  map: null,
  mapReady: false,
  mapLoadPromise: null,
  markers: [],
  selectedVendorId: null,
};

const INDIA_CENTER = { lat: 22.9734, lng: 78.6569 };
const SEARCH_STATE_KEY = 'gian_directory_search_state_v1';
const SIX_M_OPTIONS = ['Manpower', 'Method', 'Material', 'Machine', 'Money', 'Market'];
const searchEls = {
  supplier: document.getElementById('search-supplier'),
  product: document.getElementById('search-product'),
  location: document.getElementById('search-location'),
  tags: document.getElementById('search-tags'),
  sixm: document.getElementById('search-sixm'),
  keyword: document.getElementById('search-keyword'),
};

const resultsEl = document.getElementById('vendor-results');
const statusEl = document.getElementById('directory-status');
const resultsSummaryEl = document.getElementById('results-summary');
const paginationEls = [
  document.getElementById('results-pagination-top'),
  document.getElementById('results-pagination-bottom'),
];

function uniqueSortedValues(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

function getSelectedValues(selectEl) {
  if (!selectEl) return [];
  return Array.from(selectEl.querySelectorAll('input[type="checkbox"]:checked'))
    .map((input) => String(input.value || '').trim())
    .filter(Boolean);
}

function setSelectedValues(selectEl, values) {
  if (!selectEl) return;
  const wanted = new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean));
  Array.from(selectEl.querySelectorAll('input[type="checkbox"]')).forEach((input) => {
    input.checked = wanted.has(input.value);
  });
}

function populateSelectOptions(selectEl, values, placeholder) {
  if (!selectEl) return;
  const previousValue = selectEl.value;
  selectEl.innerHTML = '';
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = placeholder;
  selectEl.appendChild(defaultOption);
  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    selectEl.appendChild(option);
  });
  selectEl.value = values.includes(previousValue) ? previousValue : '';
}

function collectLocationOptions(vendors) {
  return uniqueSortedValues(vendors.flatMap((vendor) => {
    const primary = String(vendor.final_contact_address || '').trim();
    const summary = String(vendor.location_text || '').split('|').map((item) => item.trim()).filter(Boolean);
    return [primary, ...summary, ...(vendor.service_locations || [])];
  }));
}

function parseDelimitedValues(value) {
  return String(value || '').split(/[,|]/).map((item) => item.trim()).filter(Boolean);
}

function getEffectiveProductTags(product) {
  const reviewed = Array.isArray(product?.reviewed_tags) ? product.reviewed_tags.filter(Boolean) : [];
  return reviewed.length ? reviewed : (Array.isArray(product?.tags) ? product.tags.filter(Boolean) : []);
}

function deriveSixMFromProduct(product) {
  const text = [
    product?.product_name,
    product?.product_description,
    product?.product_location_text,
    ...(Array.isArray(product?.tags) ? product.tags : []),
    ...(Array.isArray(product?.reviewed_tags) ? product.reviewed_tags : []),
    ...(Array.isArray(product?.product_specifications) ? product.product_specifications.flatMap((spec) => [spec?.key, spec?.value]) : []),
  ].join(' ').toLowerCase();
  const categories = [];
  if (/(training|trainings|capacity|skill|employment|livelihood|women|children|artisan|farmer producer)/i.test(text)) categories.push('Manpower');
  if (/(method|process|technique|practice|variety|grafting|cultivation|design|model|system|manual|protocol)/i.test(text)) categories.push('Method');
  if (/(clay|bamboo|wood|cow dung|fabric|fiber|material|natural cooler|weft)/i.test(text)) categories.push('Material');
  if (/(machine|device|tool|equipment|holder|carrier|cooler|sprayer|tractor|climber|chakki|polyhouse|automated)/i.test(text)) categories.push('Machine');
  if (/(finance|financial|credit|loan|fund|investment|cost saving|income support)/i.test(text)) categories.push('Money');
  if (/(market|marketing|buyer|sales|sold|export|retail|portal|business|commerciali[sz]ation)/i.test(text)) categories.push('Market');
  return uniqueSortedValues(categories);
}

function getEffectiveProductSixM(product) {
  const reviewed = Array.isArray(product?.six_m_categories) ? product.six_m_categories.filter(Boolean) : [];
  return reviewed.length ? reviewed : deriveSixMFromProduct(product);
}

function collectTagOptions() {
  return uniqueSortedValues([
    ...directoryState.vendors.flatMap((vendor) => vendor.tags || []),
    ...directoryState.products.flatMap((product) => [
      ...getEffectiveProductTags(product),
      ...(product.product_categories || []),
      ...(product.product_subcategories || []),
    ]),
  ]);
}

function populateFilterOptions() {
  populateSelectOptions(
    searchEls.supplier,
    uniqueSortedValues(directoryState.vendors.map((vendor) => vendor.vendor_name)),
    'All innovators'
  );
  populateSelectOptions(
    searchEls.product,
    uniqueSortedValues(directoryState.products.map((product) => product.product_name)),
    'All innovations'
  );
  populateSelectOptions(
    searchEls.location,
    collectLocationOptions(directoryState.vendors),
    'All locations'
  );
  populateSelectOptions(
    searchEls.tags,
    collectTagOptions(),
    'All tags'
  );
  const previousSixM = getSelectedValues(searchEls.sixm);
  searchEls.sixm.innerHTML = SIX_M_OPTIONS.map((value) => `
    <label class="checkbox-item">
      <input type="checkbox" value="${esc(value)}" />
      <span>${esc(value)}</span>
    </label>
  `).join('');
  setSelectedValues(searchEls.sixm, previousSixM);
}

function esc(value) {
  return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function persistSearchState() {
  const snapshot = {
    search: {
      supplier: searchEls.supplier.value,
      product: searchEls.product.value,
      location: searchEls.location.value,
      tags: searchEls.tags.value,
      sixm: getSelectedValues(searchEls.sixm),
      keyword: searchEls.keyword.value,
    },
    currentPage: directoryState.currentPage,
    hasSearched: directoryState.hasSearched,
    selectedVendorId: directoryState.selectedVendorId,
  };
  try {
    window.sessionStorage.setItem(SEARCH_STATE_KEY, JSON.stringify(snapshot));
  } catch {}
}

function restoreSearchState() {
  try {
    const raw = window.sessionStorage.getItem(SEARCH_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function applySearchSnapshot(snapshot) {
  if (!snapshot?.search) return;
  searchEls.supplier.value = String(snapshot.search.supplier || '');
  searchEls.product.value = String(snapshot.search.product || '');
  searchEls.location.value = String(snapshot.search.location || '');
  searchEls.tags.value = String(snapshot.search.tags || '');
  setSelectedValues(searchEls.sixm, Array.isArray(snapshot.search.sixm) ? snapshot.search.sixm : []);
  searchEls.keyword.value = String(snapshot.search.keyword || '');
  directoryState.currentPage = Number(snapshot.currentPage || 1);
  directoryState.selectedVendorId = snapshot.selectedVendorId || null;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function tokenize(value) {
  return normalizeText(value).split(/[^a-z0-9]+/).filter(Boolean);
}

function buildVendorIndex(vendor) {
  const products = vendor.products || [];
  const productNames = products.map((product) => normalizeText(product.product_name)).join(' ');
  const productDescriptions = products.map((product) => normalizeText(product.product_description)).join(' ');
  const productTags = products.flatMap((product) => [
    ...getEffectiveProductTags(product),
    ...(product.product_categories || []),
    ...(product.product_subcategories || []),
    ...(product.product_specifications || []).flatMap((spec) => [spec?.key, spec?.value]),
  ]).map(normalizeText).join(' ');
  const sixm = uniqueSortedValues(products.flatMap((product) => getEffectiveProductSixM(product))).map(normalizeText);
  const locations = [
    vendor.location_text,
    vendor.city,
    vendor.state,
    vendor.country,
    vendor.final_contact_address,
    ...(vendor.service_locations || []),
    ...products.map((product) => product.product_location_text),
  ].map(normalizeText).join(' ');
  const contacts = [
    vendor.portal_contact_name,
    vendor.portal_email,
    vendor.portal_phone,
    vendor.website_email,
    vendor.website_phone,
    vendor.final_contact_email,
    vendor.final_contact_phone,
    vendor.website_address,
  ].map(normalizeText).join(' ');
  const keyword = [
    vendor.vendor_name,
    vendor.about_vendor,
    productNames,
    productDescriptions,
    productTags,
    locations,
    contacts,
    vendor.contact_notes,
    vendor.website_status,
    vendor.search_text,
  ].map(normalizeText).join(' ');
  return {
    supplier: normalizeText(vendor.vendor_name),
    products: productNames,
    location: locations,
    tags: productTags,
    sixm,
    keyword,
  };
}

function getCoverageSummary(vendor) {
  const serviceLocations = Array.isArray(vendor.service_locations) ? vendor.service_locations.filter(Boolean) : [];
  if (serviceLocations.length) return serviceLocations.join(', ');
  const region = [vendor.city, vendor.state, vendor.country].filter(Boolean).join(', ');
  return region || vendor.final_contact_address || vendor.location_text || 'Location not listed';
}

function getPrimaryLocationLabel(vendor) {
  const finalAddress = String(vendor.final_contact_address || '').trim();
  if (finalAddress) return finalAddress;
  const locationText = String(vendor.location_text || '').split('|')[0]?.trim();
  if (locationText) return locationText;
  return [vendor.city, vendor.state, vendor.country].filter(Boolean).join(', ');
}

function tokensMatchAll(haystack, tokens) {
  return tokens.every((token) => haystack.includes(token));
}

function scoreAgainstTokens(haystack, tokens, weight) {
  if (!tokens.length) return 0;
  let score = 0;
  for (const token of tokens) {
    if (!haystack.includes(token)) return null;
    score += haystack === token ? weight * 3 : haystack.startsWith(token) ? weight * 2 : weight;
  }
  return score;
}

function scoreVendor(vendor, filters) {
  const index = vendor._searchIndex || (vendor._searchIndex = buildVendorIndex(vendor));
  let score = 0;

  const supplierScore = scoreAgainstTokens(index.supplier, filters.supplierTokens, 22);
  if (supplierScore === null) return null;
  score += supplierScore;

  const productScore = scoreAgainstTokens(index.products, filters.productTokens, 18);
  if (productScore === null) return null;
  score += productScore;

  const locationScore = scoreAgainstTokens(index.location, filters.locationTokens, 14);
  if (locationScore === null) return null;
  score += locationScore;

  const tagScore = scoreAgainstTokens(index.tags, filters.tagTokens, 12);
  if (tagScore === null) return null;
  score += tagScore;

  if (filters.sixmValues.length) {
    const vendorSixM = new Set(index.sixm || []);
    const matchedSixMCount = filters.sixmValues.filter((value) => vendorSixM.has(value)).length;
    if (!matchedSixMCount) return null;
    score += matchedSixMCount * 18;
  }

  if (filters.keywordTokens.length) {
    if (!tokensMatchAll(index.keyword, filters.keywordTokens)) return null;
    score += filters.keywordTokens.reduce((total, token) => total + (index.supplier.includes(token) ? 20 : 8), 0);
  }

  if (filters.keywordPhrase && index.keyword.includes(filters.keywordPhrase)) score += 35;
  if (filters.supplierPhrase && index.supplier.includes(filters.supplierPhrase)) score += 25;
  if (filters.productPhrase && index.products.includes(filters.productPhrase)) score += 20;
  if ((vendor.products_count || vendor.products?.length || 0) > 0) score += 3;
  if (vendor.final_contact_address) score += 2;
  if (vendor.latitude && vendor.longitude) score += 4;

  return score;
}

function getFilters() {
  const supplier = normalizeText(searchEls.supplier.value);
  const product = normalizeText(searchEls.product.value);
  const location = normalizeText(searchEls.location.value);
  const tags = normalizeText(searchEls.tags.value);
  const sixm = getSelectedValues(searchEls.sixm).map(normalizeText).filter(Boolean);
  const keyword = normalizeText(searchEls.keyword.value);
  return {
    supplierPhrase: supplier,
    productPhrase: product,
    locationPhrase: location,
    tagPhrase: tags,
    sixmValues: sixm,
    keywordPhrase: keyword,
    supplierTokens: tokenize(supplier),
    productTokens: tokenize(product),
    locationTokens: tokenize(location),
    tagTokens: tokenize(tags),
    keywordTokens: tokenize(keyword),
  };
}

function hasAnyFilter(filters) {
  return Boolean(
    filters.supplierTokens.length ||
    filters.productTokens.length ||
    filters.locationTokens.length ||
    filters.tagTokens.length ||
    filters.sixmValues.length ||
    filters.keywordTokens.length
  );
}

function setCounts() {
  document.getElementById('vendor-total-count').textContent = String(directoryState.vendors.length);
  document.getElementById('product-total-count').textContent = String(directoryState.products.length);
  document.getElementById('filtered-vendor-count').textContent = String(directoryState.filteredVendors.length);
}

function getPageCount() {
  return Math.max(1, Math.ceil(directoryState.filteredVendors.length / directoryState.pageSize));
}

function getPageResults() {
  const start = (directoryState.currentPage - 1) * directoryState.pageSize;
  return directoryState.filteredVendors.slice(start, start + directoryState.pageSize);
}

function setSelectedVendor(vendorId) {
  directoryState.selectedVendorId = vendorId || null;
  document.querySelectorAll('[data-vendor-card]').forEach((card) => {
    card.classList.toggle('active', card.dataset.vendorCard === vendorId);
  });
}

function focusVendor(vendorId, options = {}) {
  if (!vendorId) return;
  const shouldScroll = Boolean(options.scroll);
  setSelectedVendor(vendorId);
  persistSearchState();
  if (!shouldScroll) return;
  const escapedId = window.CSS?.escape ? window.CSS.escape(vendorId) : vendorId.replace(/"/g, '\\"');
  const card = document.querySelector(`[data-vendor-card="${escapedId}"]`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function ensureMapCss() {
  if (document.getElementById('mappls-web-sdk-css')) return;
  const link = document.createElement('link');
  link.id = 'mappls-web-sdk-css';
  link.rel = 'stylesheet';
  link.href = 'https://apis.mappls.com/vector_map/assets/v3.5/mappls-glob.css';
  document.head.appendChild(link);
}

async function loadMapSdk() {
  const key = String(window.APP_CONFIG?.MAPMYINDIA_MAP_KEY || '').trim();
  if (!key) {
    document.getElementById('results-map').innerHTML = '<div class="vendor-map-placeholder">Add `MAPMYINDIA_MAP_KEY` in `config.js` to enable the map.</div>';
    return false;
  }
  if (window.mappls?.Map) return true;
  ensureMapCss();
  const urls = [
    `https://sdk.mappls.com/map/sdk/web?v=3.0&access_token=${encodeURIComponent(key)}`,
    `https://sdk.mappls.com/map/sdk/web?v=3.0&layer=vector&access_token=${encodeURIComponent(key)}`,
    `https://apis.mappls.com/advancedmaps/api/${encodeURIComponent(key)}/map_sdk?layer=vector&v=3.0`,
  ];
  for (const src of urls) {
    try {
      await new Promise((resolve, reject) => {
        document.querySelectorAll('script[data-mappls-sdk="true"]').forEach((node) => node.remove());
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.defer = true;
        script.dataset.mapplsSdk = 'true';
        script.onload = () => window.mappls?.Map ? resolve() : reject(new Error('Mappls SDK unavailable'));
        script.onerror = reject;
        document.head.appendChild(script);
      });
      return true;
    } catch {}
  }
  document.getElementById('results-map').innerHTML = '<div class="vendor-map-placeholder">The MapmyIndia SDK could not be loaded for this page.</div>';
  return false;
}

async function ensureMap() {
  if (directoryState.mapReady) return true;
  if (directoryState.mapLoadPromise) return await directoryState.mapLoadPromise;
  const loaded = await loadMapSdk();
  if (!loaded || !window.mappls?.Map) return false;
  directoryState.mapLoadPromise = new Promise((resolve) => {
    directoryState.map = new window.mappls.Map('results-map', {
      center: INDIA_CENTER,
      zoom: 4.8,
      zoomControl: true,
      geolocation: false,
      location: false,
    });
    let settled = false;
    const markReady = () => {
      if (settled) return;
      settled = true;
      directoryState.mapReady = true;
      resolve(true);
    };
    directoryState.map?.on?.('load', markReady);
    directoryState.map?.addListener?.('load', markReady);
    window.setTimeout(markReady, 1500);
  });
  return await directoryState.mapLoadPromise;
}

async function geocodeVendor(vendor) {
  const cacheKey = vendor.portal_vendor_id;
  if (directoryState.geocodeCache.has(cacheKey)) return directoryState.geocodeCache.get(cacheKey);
  const lat = Number(vendor.latitude);
  const lng = Number(vendor.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && (Math.abs(lat) > 0.0001 || Math.abs(lng) > 0.0001)) {
    const point = { lat: Number(vendor.latitude), lng: Number(vendor.longitude) };
    directoryState.geocodeCache.set(cacheKey, point);
    return point;
  }
  const query = [vendor.location_text, vendor.city, vendor.state, vendor.country, vendor.final_contact_address].filter(Boolean).join(', ');
  if (!query) return null;
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`, {
      headers: { Accept: 'application/json' },
    });
    const data = await response.json();
    const match = Array.isArray(data) ? data[0] : null;
    if (!match) return null;
    const point = { lat: Number(match.lat), lng: Number(match.lon) };
    directoryState.geocodeCache.set(cacheKey, point);
    return point;
  } catch {
    return null;
  }
}

function clearMapMarkers() {
  directoryState.markers.forEach((marker) => marker?.remove?.());
  directoryState.markers = [];
}

function groupMapPoints(entries) {
  const groups = new Map();
  entries.forEach((entry) => {
    const locationKey = normalizeText(getPrimaryLocationLabel(entry.vendor));
    const key = locationKey || `${entry.point.lat.toFixed(4)}|${entry.point.lng.toFixed(4)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  return Array.from(groups.values());
}

function buildPopupHtml(entries) {
  return `<div class="vendor-map-popup">${entries.map(({ vendor }) => `<div><strong>${esc(vendor.vendor_name)}</strong><br/>${esc(vendor.location_text || 'Location not listed')}<br/><a href="./vendor-detail.html?vendor=${encodeURIComponent(vendor.portal_vendor_id)}">View Details</a> | <a href="${esc(vendor.portal_vendor_link || '#')}" target="_blank" rel="noreferrer">View on GIAN</a></div>`).join('<hr style="border:none;border-top:1px solid #dbe5eb;margin:.55rem 0;" />')}</div>`;
}

function createRingPoints(point, count) {
  if (count <= 1) return [point];
  const radius = Math.min(0.14, 0.02 + (count * 0.004));
  return Array.from({ length: count }, (_, index) => {
    const angle = (Math.PI * 2 * index) / count;
    const latOffset = Math.sin(angle) * radius;
    const lngOffset = Math.cos(angle) * radius / Math.max(Math.cos((point.lat * Math.PI) / 180), 0.35);
    return {
      lat: point.lat + latOffset,
      lng: point.lng + lngOffset,
    };
  });
}

function buildMarkerHtml(isRingMarker) {
  const size = isRingMarker ? 18 : 20;
  const halo = isRingMarker ? 5 : 7;
  const border = isRingMarker ? 3 : 3;
  return `<div style="position:relative;width:${size}px;height:${size}px;border-radius:999px;background:#f28c28;border:${border}px solid #fff;box-shadow:0 0 0 ${halo}px rgba(242,140,40,.18),0 8px 18px rgba(176,92,16,.28);"></div>`;
}

async function renderMapMarkers(vendors) {
  const ready = await ensureMap();
  if (!ready) return;
  clearMapMarkers();
  const points = [];
  for (const vendor of vendors) {
    const point = await geocodeVendor(vendor);
    if (point) points.push({ vendor, point });
  }
  if (!points.length) {
    directoryState.map?.setCenter?.(INDIA_CENTER);
    directoryState.map?.setZoom?.(4.8);
    return;
  }
  const groupedPoints = groupMapPoints(points);
  groupedPoints.forEach((entries) => {
    const basePoint = entries.length === 1
      ? entries[0].point
      : {
          lat: entries.reduce((sum, entry) => sum + Number(entry.point.lat || 0), 0) / entries.length,
          lng: entries.reduce((sum, entry) => sum + Number(entry.point.lng || 0), 0) / entries.length,
        };
    const ringPoints = createRingPoints(basePoint, entries.length);
    entries.forEach((entry, index) => {
      const isRingMarker = entries.length > 1;
      const markerSize = isRingMarker ? 18 : 20;
      const marker = new window.mappls.Marker({
        map: directoryState.map,
        position: ringPoints[index],
        html: buildMarkerHtml(isRingMarker),
        width: markerSize,
        height: markerSize,
        popupHtml: buildPopupHtml([entry]),
        fitbounds: false,
      });
      marker.on?.('click', () => focusVendor(entry.vendor.portal_vendor_id));
      marker.addListener?.('click', () => focusVendor(entry.vendor.portal_vendor_id));
      directoryState.markers.push(marker);
    });
  });
  const indiaPoints = points.filter(({ point }) => point.lat >= 6 && point.lat <= 38 && point.lng >= 68 && point.lng <= 98);
  const first = indiaPoints[0]?.point || points[0]?.point;
  if (first) {
    directoryState.map?.setCenter?.(first);
    directoryState.map?.setZoom?.(5.5);
  }
}

function renderPagination(totalPages, totalMatches) {
  paginationEls.forEach((container) => {
    if (!container) return;
    container.innerHTML = '';
    if (!directoryState.hasSearched || !totalMatches) return;
    container.insertAdjacentHTML('beforeend', `<div class="vendor-page-summary">Showing ${getPageResults().length} of ${totalMatches} results</div>`);
    const prevDisabled = directoryState.currentPage === 1 ? 'disabled' : '';
    container.insertAdjacentHTML('beforeend', `<button class="btn btn-small btn-pagination" data-page-nav="prev" ${prevDisabled}>Prev</button>`);
    const start = Math.max(1, directoryState.currentPage - 2);
    const end = Math.min(totalPages, start + 4);
    for (let page = start; page <= end; page += 1) {
      container.insertAdjacentHTML('beforeend', `<button class="btn btn-small btn-pagination ${page === directoryState.currentPage ? 'active' : ''}" data-page-number="${page}">${page}</button>`);
    }
    const nextDisabled = directoryState.currentPage === totalPages ? 'disabled' : '';
    container.insertAdjacentHTML('beforeend', `<button class="btn btn-small btn-pagination" data-page-nav="next" ${nextDisabled}>Next</button>`);
  });
}

function buildInnovationPreview(vendor) {
  const products = (vendor.products || []).slice(0, 3);
  if (!products.length) {
    return '<p><strong>Innovations:</strong> No innovations listed</p>';
  }
  return `<div class="innovation-links-list">${products.map((product) => `<div><strong>${esc(product.product_name)}</strong><br/><small>${esc(product.product_location_text || 'Location not listed')}</small></div>`).join('')}</div>`;
}

function buildResultVideo(vendor) {
  const videoUrl = (vendor.products || []).flatMap((product) => product.product_video_urls || []).find((url) => /youtube\.com\/embed|player\.vimeo\.com|loom\.com\/embed/i.test(String(url || '')));
  if (!videoUrl) return '';
  return `<div class="innovation-result-video"><iframe class="innovation-video-frame" src="${esc(videoUrl)}" title="${esc(`${vendor.vendor_name} video`)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy" referrerpolicy="origin"></iframe></div>`;
}

async function renderResults() {
  const totalMatches = directoryState.filteredVendors.length;
  const totalPages = getPageCount();
  const pageVendors = getPageResults();
  const mapVendors = directoryState.hasSearched ? directoryState.filteredVendors : [];
  setCounts();
  resultsEl.innerHTML = '';
  renderPagination(totalPages, totalMatches);

  if (!directoryState.hasSearched) {
    resultsSummaryEl.textContent = 'Choose an innovation, innovator, location, or keyword to search the directory.';
    resultsEl.innerHTML = '<div class="vendor-empty-state">The GIAN directory is loaded and ready. Start with a filter on the left, then run the search to see matching innovators and innovations.</div>';
    await renderMapMarkers([]);
    return;
  }

  if (!totalMatches) {
    resultsSummaryEl.textContent = 'No innovators matched the current filters.';
    resultsEl.innerHTML = '<div class="vendor-empty-state">No innovators match this combination yet. Try a shorter keyword, a broader location, or remove one filter at a time.</div>';
    await renderMapMarkers([]);
    return;
  }

  resultsSummaryEl.textContent = `${totalMatches} innovator result${totalMatches === 1 ? '' : 's'} found. Page ${directoryState.currentPage} of ${totalPages}.`;

  pageVendors.forEach((vendor) => {
    const contactLine = [vendor.final_contact_email || vendor.portal_email || 'No email', vendor.final_contact_phone || vendor.portal_phone || 'No phone'].join(' | ');
    const noteLine = vendor.contact_notes || vendor.website_status || 'GIAN details only';
    const coverageSummary = getCoverageSummary(vendor);
    const tagPreview = uniqueSortedValues((vendor.products || []).flatMap((product) => getEffectiveProductTags(product))).slice(0, 6);
    const sixmPreview = uniqueSortedValues((vendor.products || []).flatMap((product) => getEffectiveProductSixM(product))).slice(0, 6);
    const addressLine = vendor.final_contact_address && normalizeText(vendor.final_contact_address) !== normalizeText(coverageSummary)
      ? `<p><strong>Address:</strong> ${esc(vendor.final_contact_address)}</p>`
      : '';
    resultsEl.insertAdjacentHTML('beforeend', `<article class="vendor-result-card" data-vendor-card="${esc(vendor.portal_vendor_id)}"><div class="vendor-result-top"><div><h4>${esc(vendor.vendor_name)}</h4><p>${esc(coverageSummary)}</p></div><span class="admin-badge approved">${esc(String(vendor.products_count || vendor.products?.length || 0))} innovations</span></div><p>${esc(vendor.about_vendor || 'No description available.')}</p>${buildResultVideo(vendor)}<p><strong>Locations:</strong> ${esc((vendor.service_locations || []).join(', ') || getPrimaryLocationLabel(vendor) || 'Not listed')}</p><p><strong>Tags:</strong> ${esc(tagPreview.join(', ') || 'Not listed')}</p><p><strong>6M:</strong> ${esc(sixmPreview.join(', ') || 'Not classified')}</p><p><strong>Contact:</strong> ${esc(contactLine)}</p>${addressLine}<p><strong>Enrichment:</strong> ${esc(noteLine)}</p><div><strong>Innovation Preview</strong>${buildInnovationPreview(vendor)}</div><div class="btn-group"><a class="btn btn-small" href="./vendor-detail.html?vendor=${encodeURIComponent(vendor.portal_vendor_id)}">View Details</a><a class="btn btn-warning btn-small" href="${esc(vendor.portal_vendor_link || '#')}" target="_blank" rel="noreferrer">View on GIAN</a></div></article>`);
  });

  const selectedVendor = directoryState.selectedVendorId && mapVendors.some((vendor) => vendor.portal_vendor_id === directoryState.selectedVendorId)
    ? directoryState.selectedVendorId
    : mapVendors[0]?.portal_vendor_id || null;
  setSelectedVendor(selectedVendor);
  persistSearchState();
  await renderMapMarkers(mapVendors);
}

function applyFilters() {
  const filters = getFilters();
  if (!hasAnyFilter(filters)) {
    directoryState.hasSearched = false;
    directoryState.filteredVendors = [];
    directoryState.currentPage = 1;
    statusEl.textContent = `Loaded ${directoryState.vendors.length} innovators and ${directoryState.products.length} innovations from the synced GIAN directory.`;
    renderResults();
    return;
  }
  const scored = directoryState.vendors
    .map((vendor) => ({ vendor, score: scoreVendor(vendor, filters) }))
    .filter((entry) => entry.score !== null)
    .sort((left, right) => right.score - left.score || left.vendor.vendor_name.localeCompare(right.vendor.vendor_name))
    .map((entry) => entry.vendor);
  directoryState.hasSearched = true;
  directoryState.filteredVendors = scored;
  directoryState.currentPage = 1;
  persistSearchState();
  renderResults();
}

function clearFilters() {
  [searchEls.supplier, searchEls.product, searchEls.location, searchEls.tags, searchEls.keyword].forEach((input) => {
    if (input) input.value = '';
  });
  setSelectedValues(searchEls.sixm, []);
  directoryState.selectedVendorId = null;
  try { window.sessionStorage.removeItem(SEARCH_STATE_KEY); } catch {}
  applyFilters();
}

async function initializeDirectory() {
  statusEl.textContent = 'Loading GIAN directory from Supabase...';
  try {
    const { vendors, products } = await InnovationStore.loadDirectory();
    directoryState.vendors = vendors;
    directoryState.products = products;
    directoryState.filteredVendors = [];
    populateFilterOptions();
    statusEl.textContent = `Loaded ${vendors.length} innovators and ${products.length} innovations from the synced GIAN directory.`;
    const snapshot = restoreSearchState();
    if (snapshot?.hasSearched) {
      applySearchSnapshot(snapshot);
      const filters = getFilters();
      const scored = directoryState.vendors
        .map((vendor) => ({ vendor, score: scoreVendor(vendor, filters) }))
        .filter((entry) => entry.score !== null)
        .sort((left, right) => right.score - left.score || left.vendor.vendor_name.localeCompare(right.vendor.vendor_name))
        .map((entry) => entry.vendor);
      directoryState.hasSearched = true;
      directoryState.filteredVendors = scored;
      directoryState.currentPage = Math.min(Math.max(1, directoryState.currentPage), Math.max(1, Math.ceil(scored.length / directoryState.pageSize)));
    }
    await renderResults();
  } catch (error) {
    statusEl.textContent = error.message || 'GIAN directory could not be loaded.';
    resultsEl.innerHTML = `<article class="admin-card"><p>${esc(statusEl.textContent)}</p></article>`;
  }
}

document.getElementById('run-search').addEventListener('click', applyFilters);
document.getElementById('clear-search').addEventListener('click', clearFilters);
[
  searchEls.supplier,
  searchEls.product,
  searchEls.location,
  searchEls.tags,
  searchEls.keyword,
].forEach((input) => {
  input.addEventListener('keypress', (event) => { if (event.key === 'Enter') applyFilters(); });
  input.addEventListener('input', persistSearchState);
  input.addEventListener('change', persistSearchState);
});
if (searchEls.sixm) searchEls.sixm.addEventListener('change', persistSearchState);
resultsEl.addEventListener('click', (event) => {
  if (event.target.closest('a')) return;
  const target = event.target.closest('[data-vendor-card]');
  if (target) {
    setSelectedVendor(target.dataset.vendorCard);
    persistSearchState();
  }
});
paginationEls.forEach((container) => container?.addEventListener('click', (event) => {
  const pageButton = event.target.closest('[data-page-number]');
  if (pageButton) {
    directoryState.currentPage = Number(pageButton.dataset.pageNumber);
    persistSearchState();
    renderResults();
    return;
  }
  const navButton = event.target.closest('[data-page-nav]');
  if (!navButton) return;
  const direction = navButton.dataset.pageNav;
  if (direction === 'prev' && directoryState.currentPage > 1) directoryState.currentPage -= 1;
  if (direction === 'next' && directoryState.currentPage < getPageCount()) directoryState.currentPage += 1;
  persistSearchState();
  renderResults();
}));

initializeDirectory();
