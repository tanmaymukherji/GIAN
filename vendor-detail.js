function esc(value) {
  return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function renderImageGrid(images, altText) {
  const items = Array.isArray(images) ? images.filter(Boolean) : [];
  if (!items.length) return '<p>No images available.</p>';
  return `<div class="innovation-person-grid">${items.map((url) => `<a class="innovation-media-card" href="${esc(url)}" target="_blank" rel="noreferrer"><img class="innovation-gallery-image" src="${esc(url)}" alt="${esc(altText)}" loading="lazy" referrerpolicy="no-referrer" /></a>`).join('')}</div>`;
}

function renderMediaEmbeds(urls, title) {
  const items = Array.isArray(urls) ? urls.filter(Boolean) : [];
  if (!items.length) return '';
  return `<div class="innovation-media-block"><h4>Videos and Multimedia</h4><div class="innovation-media-grid innovation-media-grid-videos">${items.map((url, index) => url.includes('youtube.com/embed') || url.includes('player.vimeo.com') || url.includes('loom.com/embed') ? `<article class="innovation-video-card"><iframe class="innovation-video-frame" src="${esc(url)}" title="${esc(`${title} media ${index + 1}`)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy" referrerpolicy="origin"></iframe></article>` : `<article class="innovation-video-card"><a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(url)}</a></article>`).join('')}</div></div>`;
}

function renderSpecifications(specifications) {
  if (!Array.isArray(specifications) || !specifications.length) {
    return '<p><strong>Innovation Details:</strong> Not listed</p>';
  }
  return `<div><strong>Structured Details</strong><div class="vendor-spec-list">${specifications.map((spec) => `<div class="vendor-spec-item"><strong>${esc(spec.key || 'Detail')}</strong>: ${esc(spec.value || 'Not listed')}</div>`).join('')}</div></div>`;
}

function getCoverageSummary(vendor) {
  const serviceLocations = Array.isArray(vendor.service_locations) ? vendor.service_locations.filter(Boolean) : [];
  if (serviceLocations.length) return serviceLocations.join(', ');
  const region = [vendor.city, vendor.state, vendor.country].filter(Boolean).join(', ');
  return region || vendor.final_contact_address || vendor.location_text || 'Innovator details from the synced GIAN directory';
}

async function initVendorDetail() {
  const params = new URLSearchParams(window.location.search);
  const vendorId = params.get('vendor');
  const root = document.getElementById('vendor-detail-root');
  if (!vendorId) {
    root.innerHTML = '<section class="section"><p>Innovator id is missing.</p></section>';
    return;
  }
  try {
    const { vendors } = await InnovationStore.loadDirectory();
    const vendor = vendors.find((item) => item.portal_vendor_id === vendorId);
    if (!vendor) {
      root.innerHTML = '<section class="section"><p>Innovator not found in the synced Supabase directory.</p></section>';
      return;
    }
    const coverageSummary = getCoverageSummary(vendor);
    document.getElementById('detail-title').textContent = vendor.vendor_name;
    document.getElementById('detail-subtitle').textContent = coverageSummary;
    root.innerHTML = `<section class="section"><div class="vendor-result-top"><div><h3>${esc(vendor.vendor_name)}</h3><p>${esc(coverageSummary)}</p></div><span class="admin-badge approved">${esc(String(vendor.products_count || vendor.products?.length || 0))} innovations</span></div><p>${esc(vendor.about_vendor || 'No innovator profile available.')}</p><div class="vendor-detail-grid"><div><h4>Contact</h4><p><strong>Name:</strong> ${esc(vendor.portal_contact_name || vendor.vendor_name || 'Not listed')}</p><p><strong>Email:</strong> ${esc(vendor.final_contact_email || vendor.portal_email || 'Not listed')}</p><p><strong>Phone:</strong> ${esc(vendor.final_contact_phone || vendor.portal_phone || 'Not listed')}</p><p><strong>Address:</strong> ${esc(vendor.final_contact_address || 'Not listed')}</p><p><strong>Notes:</strong> ${esc(vendor.contact_notes || vendor.website_status || 'Not listed')}</p></div><div><h4>Directory Meta</h4><p><strong>Locations:</strong> ${esc((vendor.service_locations || []).join(', ') || 'Not listed')}</p><p><strong>Tags:</strong> ${esc((vendor.tags || []).join(', ') || 'Not listed')}</p><p><strong>Source:</strong> <a href="${esc(vendor.portal_vendor_link || '#')}" target="_blank" rel="noreferrer">Open on GIAN</a></p><p><strong>Contact source:</strong> ${vendor.contact_source_url ? `<a href="${esc(vendor.contact_source_url)}" target="_blank" rel="noreferrer">${esc(vendor.contact_source_url)}</a>` : 'Not listed'}</p></div></div></section><section class="section"><h3>Innovator Images and Media</h3>${renderImageGrid(vendor.innovator_image_urls, vendor.vendor_name)}${renderMediaEmbeds(vendor.innovator_media_urls, vendor.vendor_name)}</section><section class="section"><h3>Innovations</h3><div class="vendor-products-grid">${(vendor.products || []).length ? (vendor.products || []).map((product) => `<article class="vendor-product-card"><div class="vendor-product-media">${product.product_image_url ? `<img class="vendor-product-image" src="${esc(product.product_image_url)}" alt="${esc(product.product_name)}" loading="lazy" referrerpolicy="no-referrer" />` : ''}<div><h4>${esc(product.product_name)}</h4><p>${esc(product.product_description || 'No innovation description available.')}</p>${renderSpecifications(product.product_specifications)}<p><strong>Tags:</strong> ${esc((product.tags || []).join(', ') || 'Not listed')}</p></div></div><div class="btn-group"><a class="btn btn-small" href="./product-detail.html?product=${encodeURIComponent(product.portal_product_id)}">View Details</a><a class="btn btn-warning btn-small" href="${esc(product.product_link || '#')}" target="_blank" rel="noreferrer">View on GIAN</a></div></article>`).join('') : '<p>No innovations were synced for this innovator.</p>'}</div></section>`;
  } catch (error) {
    root.innerHTML = `<section class="section"><p>${esc(error.message || 'Innovator detail could not be loaded.')}</p></section>`;
  }
}

initVendorDetail();
