
'use strict';

const form = document.getElementById('image-search-form');
const input = document.getElementById('image-search-input');
const yearInput = document.getElementById('image-search-year');
const statusLine = document.getElementById('image-search-status');
const resultsGrid = document.getElementById('image-results');
const resultsTitle = document.getElementById('image-results-title');
const resultsCount = document.getElementById('image-results-count');

const ARCHIVES = [
  './data/hurdat2-1851-2025-092326.txt',
  './data/hurdat2-nepac-1949-2025-092926.txt'
];

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}

function getMeta(info, key) {
  const raw = info?.extmetadata?.[key]?.value || '';
  const el = document.createElement('div');
  el.innerHTML = raw;
  return el.textContent.trim();
}

function getDescription(page) {
  const info = page.imageinfo?.[0] || {};
  return [
    page.title || '',
    getMeta(info, 'ImageDescription'),
    getMeta(info, 'ObjectName'),
    getMeta(info, 'Categories')
  ].join(' ').toLowerCase();
}

async function verifyStorm(name, year) {
  for (const url of ARCHIVES) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;

      const content = await response.text();

      for (const line of content.split(/\r?\n/)) {
        const fields = line.split(',').map(v => v.trim());

        if (
          fields.length >= 3 &&
          /^[A-Z]{2}\d{6}$/.test(fields[0]) &&
          fields[1].toUpperCase() === name &&
          fields[0].slice(4, 8) === year
        ) {
          return {
            name,
            year,
            basin: url.includes('nepac') ? 'Pacific' : 'Atlantic'
          };
        }
      }
    } catch (error) {
      console.warn('Could not read archive:', url, error);
    }
  }

  return null;
}

function makeCard(page, storm) {
  const info = page.imageinfo?.[0] || {};
  const imageURL = info.thumburl || info.url;
  const sourceURL = info.descriptionurl;

  if (!imageURL || !sourceURL) return '';

  const title = (page.title || 'Storm image').replace(/^File:/, '');
  const creator =
    getMeta(info, 'Artist') ||
    getMeta(info, 'Credit') ||
    'Creator not listed';
  const license =
    getMeta(info, 'LicenseShortName') ||
    getMeta(info, 'UsageTerms') ||
    'Check source page';

  return `
    <article class="image-result-card">
      <a class="image-result-photo"
         href="${escapeHTML(sourceURL)}"
         target="_blank" rel="noopener noreferrer">
        <img src="${escapeHTML(imageURL)}"
             alt="${escapeHTML(storm.name + ' ' + storm.year + ' - ' + title)}"
             loading="lazy">
      </a>
      <div class="image-result-info">
        <p class="image-card-tag">
          ${escapeHTML(storm.name)} · ${escapeHTML(storm.year)}
        </p>
        <h3>${escapeHTML(title)}</h3>
        <p><span>CREATOR</span> ${escapeHTML(creator)}</p>
        <p><span>LICENSE</span> ${escapeHTML(license)}</p>
        <a class="image-source-link"
           href="${escapeHTML(sourceURL)}"
           target="_blank" rel="noopener noreferrer">
          View original &amp; license ↗
        </a>
      </div>
    </article>
  `;
}

async function searchImages() {
  const name = input.value.trim()
    .replace(/^hurricane\s+/i, '')
    .toUpperCase();
  const year = yearInput.value.trim();

  if (!name || !/^\d{4}$/.test(year)) {
    statusLine.textContent = 'Enter a storm name and four-digit year.';
    return;
  }

  resultsGrid.replaceChildren();
  resultsCount.textContent = '';
  resultsTitle.textContent = 'Searching…';
  statusLine.textContent = 'Checking historical storm records…';

  try {
    const storm = await verifyStorm(name, year);

    if (!storm) {
      resultsTitle.textContent = 'Storm not found';
      statusLine.textContent =
        'No matching storm was found in the available historical archives. Check the name and year, or check that the data files are available.';
      return;
    }

    resultsTitle.textContent = `${storm.name} ${storm.year} — Photos`;
    statusLine.textContent =
      `Storm record verified in the ${storm.basin} archive. Searching Wikimedia Commons…`;

    const queries = [
      `${storm.name} hurricane ${storm.year}`,
      `${storm.name} ${storm.year} satellite storm`
    ];

    const found = new Map();

    for (const query of queries) {
      const params = new URLSearchParams({
        action: 'query',
        generator: 'search',
        gsrsearch: query,
        gsrnamespace: '6',
        gsrlimit: '30',
        prop: 'imageinfo',
        iiprop: 'url|extmetadata',
        iiurlwidth: '900',
        format: 'json',
        origin: '*'
      });

      const response = await fetch(
        'https://commons.wikimedia.org/w/api.php?' + params
      );

      if (!response.ok) {
        throw new Error('Wikimedia Commons returned an error.');
      }

      const data = await response.json();
      const pages = Object.values(data.query?.pages || {});

      for (const page of pages) {
        if (page.imageinfo?.[0] && !found.has(page.pageid)) {
          found.set(page.pageid, page);
        }
      }

      if (found.size >= 2) break;
    }

    const pages = [...found.values()];

    // Prefer matching storm name/year and storm-related imagery.
    const relevant = pages.filter(page => {
      const info = page.imageinfo?.[0];
      if (!info || !(info.thumburl || info.url)) return false;

      const description = getDescription(page);
      const hasName = description.includes(name.toLowerCase());
      const hasYear = description.includes(year);
      const stormRelated =
        /\b(hurricane|cyclone|storm|satellite|weather|tropical|goes|noaa|cloud)\b/i
          .test(description);

      return hasName && hasYear && stormRelated;
    });

    // If metadata is sparse, show Commons results for the exact search
    // instead of leaving the page blank. Source links remain available.
    const selected = (relevant.length ? relevant : pages).slice(0, 2);
    const cards = selected.map(page => makeCard(page, storm)).join('');

    if (!cards) {
      resultsTitle.textContent = 'No photos returned';
      statusLine.textContent =
        'The image archive returned no usable photos for this search. Try again or try a different storm name.';
      return;
    }

    resultsGrid.innerHTML = cards;
    resultsCount.textContent =
      `${selected.length} ${selected.length === 1 ? 'image' : 'images'}`;

    statusLine.textContent = relevant.length
      ? 'Showing matching storm images. Open a source link to review its description and license.'
      : 'No exact metadata matches were found, so these are the closest image-search results. Check each source page to confirm the storm and year.';

  } catch (error) {
    console.error('Storm image search failed:', error);
    resultsTitle.textContent = 'Search unavailable';
    statusLine.textContent =
      'A historical data file or image service could not be reached. Check your connection and try again.';
  }
}

if (form && input && yearInput && statusLine &&
    resultsGrid && resultsTitle && resultsCount) {
  form.addEventListener('submit', event => {
    event.preventDefault();
    searchImages();
  });
} else {
  console.error(
    'Image search could not start: a required HTML element is missing. Check images.html IDs.'
  );
}
