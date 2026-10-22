
'use strict';

const form = document.getElementById('image-search-form');
const input = document.getElementById('image-search-input');
const statusLine = document.getElementById('image-search-status');
const resultsGrid = document.getElementById('image-results');
const resultsTitle = document.getElementById('image-results-title');
const resultsCount = document.getElementById('image-results-count');

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function metadata(info, key) {
  const raw = info?.extmetadata?.[key]?.value || '';
  const element = document.createElement('div');
  element.innerHTML = raw;
  return element.textContent.trim();
}

function makeCard(page) {
  const info = page.imageinfo?.[0] || {};
  const title = (page.title || 'Hurricane image').replace(/^File:/, '');
  const imageURL = info.thumburl || info.url;
  const sourceURL = info.descriptionurl || 'https://commons.wikimedia.org/';

  if (!imageURL) return '';

  const creator = metadata(info, 'Artist') ||
    metadata(info, 'Credit') || 'Creator not listed';
  const license = metadata(info, 'LicenseShortName') ||
    'Check the source page';

  return `
    <article class="image-result-card">
      <a class="image-result-photo"
         href="${escapeHTML(sourceURL)}"
         target="_blank" rel="noopener noreferrer">
        <img src="${escapeHTML(imageURL)}"
             alt="${escapeHTML(title)}"
             loading="lazy">
      </a>
      <div class="image-result-info">
        <h3>${escapeHTML(title)}</h3>
        <p><span>CREATOR</span>${escapeHTML(creator)}</p>
        <p><span>LICENSE</span>${escapeHTML(license)}</p>
        <a class="image-source-link"
           href="${escapeHTML(sourceURL)}"
           target="_blank" rel="noopener noreferrer">
          View original &amp; license ↗
        </a>
      </div>
    </article>
  `;
}

async function searchImages(term) {
  const query = term.trim();
  if (!query) return;

  statusLine.textContent = 'Searching the image archive…';
  resultsGrid.replaceChildren();
  resultsCount.textContent = '';
  resultsTitle.textContent = 'Results for "' + query + '"';

  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query + ' hurricane',
    gsrnamespace: '6',
    gsrlimit: '30',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '640',
    format: 'json',
    origin: '*'
  });

  try {
    const response = await fetch(
      'https://commons.wikimedia.org/w/api.php?' + params
    );

    if (!response.ok) throw new Error('Image archive unavailable');

    const data = await response.json();
    const pages = Object.values(data.query?.pages || {})
      .filter(page => page.imageinfo?.[0]?.thumburl ||
                      page.imageinfo?.[0]?.url);

    if (!pages.length) {
      statusLine.textContent =
        'No images found. Try another spelling or include the year.';
      return;
    }

    resultsGrid.innerHTML = pages.map(makeCard).join('');
    resultsCount.textContent = pages.length + ' images';
    statusLine.textContent =
      'Results loaded. Open a source page to check image details and reuse permissions.';
  } catch (error) {
    console.error(error);
    statusLine.textContent =
      'Could not load images. Check your connection and try again.';
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  searchImages(input.value);
});
