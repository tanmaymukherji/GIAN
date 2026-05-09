function esc(value) {
  return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function renderSpecifications(specifications) {
  if (!Array.isArray(specifications) || !specifications.length) {
    return '<p><strong>Innovation Details:</strong> Not listed</p>';
  }
  return `<div><strong>Innovation Details</strong><div class="vendor-spec-list">${specifications.map((spec) => `<div class="vendor-spec-item"><strong>${esc(spec.key || 'Detail')}</strong>: ${esc(spec.value || 'Not listed')}</div>`).join('')}</div></div>`;
}

function getDisplayTags(product) {
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
  ].join(' ').toLowerCase();
  const categories = [];
  if (/(training|capacity|skill|employment|livelihood|women|children|artisan|farmer producer)/i.test(text)) categories.push('Manpower');
  if (/(method|process|technique|practice|variety|grafting|cultivation|design|model|system|manual|protocol)/i.test(text)) categories.push('Method');
  if (/(clay|bamboo|wood|cow dung|fabric|fiber|material|weft)/i.test(text)) categories.push('Material');
  if (/(machine|device|tool|equipment|holder|carrier|cooler|sprayer|tractor|climber|chakki|polyhouse|automated)/i.test(text)) categories.push('Machine');
  if (/(finance|financial|credit|loan|fund|investment|cost saving|income support)/i.test(text)) categories.push('Money');
  if (/(market|marketing|buyer|sales|sold|export|retail|portal|business|commerciali[sz]ation)/i.test(text)) categories.push('Market');
  return [...new Set(categories)];
}

function getDisplaySixM(product) {
  const reviewed = Array.isArray(product?.six_m_categories) ? product.six_m_categories.filter(Boolean) : [];
  return reviewed.length ? reviewed : deriveSixMFromProduct(product);
}

function renderChipList(title, values) {
  const items = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!items.length) return '';
  return `<div class="vendor-inline-list"><strong>${esc(title)}</strong><div class="innovation-chip-row">${items.map((item) => `<span class="innovation-chip">${esc(item)}</span>`).join('')}</div></div>`;
}

function renderMedia(product) {
  const images = Array.isArray(product.product_gallery_urls) ? product.product_gallery_urls.filter(Boolean) : [];
  const videos = Array.isArray(product.product_video_urls) ? product.product_video_urls.filter(Boolean) : [];
  return `<section class="section"><h3>Media Gallery</h3>${images.length ? `<div class="innovation-media-grid innovation-media-grid-images">${images.map((url) => `<a class="innovation-media-card" href="${esc(url)}" target="_blank" rel="noreferrer"><img class="innovation-gallery-image" src="${esc(url)}" alt="${esc(product.product_name)}" loading="lazy" referrerpolicy="no-referrer" /></a>`).join('')}</div>` : '<p>No images available.</p>'}${videos.length ? `<div class="innovation-media-block"><h4>Videos and Multimedia</h4><div class="innovation-media-grid innovation-media-grid-videos">${videos.map((url, index) => url.includes('youtube.com/embed') || url.includes('player.vimeo.com') || url.includes('loom.com/embed') ? `<article class="innovation-video-card"><iframe class="innovation-video-frame" src="${esc(url)}" title="${esc(`${product.product_name} media ${index + 1}`)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy" referrerpolicy="origin"></iframe></article>` : `<article class="innovation-video-card"><a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(url)}</a></article>`).join('')}</div></div>` : ''}</section>`;
}

async function initProductDetail() {
  const params = new URLSearchParams(window.location.search);
  const productId = params.get('product');
  const root = document.getElementById('product-detail-root');
  if (!productId) {
    root.innerHTML = '<section class="section"><p>Innovation id is missing.</p></section>';
    return;
  }

  try {
    const { vendors, products } = await InnovationStore.loadDirectory();
    const product = products.find((item) => item.portal_product_id === productId);
    if (!product) {
      root.innerHTML = '<section class="section"><p>Innovation not found in the synced Supabase directory.</p></section>';
      return;
    }
    const vendor = vendors.find((item) => item.portal_vendor_id === product.portal_vendor_id);
    document.getElementById('detail-title').textContent = product.product_name;
    document.getElementById('detail-subtitle').textContent = vendor?.vendor_name || 'GIAN innovation detail';
    document.getElementById('back-to-vendor').href = vendor ? `./vendor-detail.html?vendor=${encodeURIComponent(vendor.portal_vendor_id)}` : './index.html?restore=1';
    root.innerHTML = `<section class="section"><div class="innovation-detail-hero">${product.product_image_url ? `<img class="innovation-detail-image" src="${esc(product.product_image_url)}" alt="${esc(product.product_name)}" referrerpolicy="no-referrer" />` : ''}<div class="innovation-detail-summary"><div class="vendor-result-top"><div><h3>${esc(product.product_name)}</h3><p>${esc(vendor?.vendor_name || 'Innovator not listed')}</p></div><span class="admin-badge approved">${esc(getDisplayTags(product).join(', ') || 'Innovation')}</span></div><p>${esc(product.product_description || 'No innovation description available.')}</p><div class="innovation-chip-row">${getDisplayTags(product).map((tag) => `<span class="innovation-chip innovation-chip-muted">${esc(tag)}</span>`).join('')}</div><div class="vendor-detail-grid"><div><h4>Innovation Summary</h4><p><strong>Innovator:</strong> ${esc(vendor?.vendor_name || 'Not listed')}</p><p><strong>Location:</strong> ${esc(product.product_location_text || vendor?.location_text || 'Not listed')}</p><p><strong>Tags:</strong> ${esc(getDisplayTags(product).join(', ') || 'Not listed')}</p><p><strong>View on GIAN:</strong> <a href="${esc(product.product_link || '#')}" target="_blank" rel="noreferrer">Open original GIAN page</a></p></div><div><h4>Contact</h4><p><strong>Email:</strong> ${esc(vendor?.final_contact_email || vendor?.portal_email || 'Not listed')}</p><p><strong>Phone:</strong> ${esc(vendor?.final_contact_phone || vendor?.portal_phone || 'Not listed')}</p><p><strong>Address:</strong> ${esc(vendor?.final_contact_address || 'Not listed')}</p><p><strong>Notes:</strong> ${esc(vendor?.contact_notes || vendor?.website_status || 'Not listed')}</p></div></div>${renderChipList('6M Classification', getDisplaySixM(product))}${product.admin_notes ? `<div class="vendor-inline-list"><strong>Admin Notes</strong><div>${esc(product.admin_notes).replaceAll('\n', '<br />')}</div></div>` : ''}${renderSpecifications(product.product_specifications)}</div></div></section>${renderMedia(product)}`;
  } catch (error) {
    root.innerHTML = `<section class="section"><p>${esc(error.message || 'Innovation detail could not be loaded.')}</p></section>`;
  }
}

initProductDetail();
