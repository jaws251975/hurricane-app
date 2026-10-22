
'use strict';

const form = document.getElementById('image-search-form');
const input = document.getElementById('image-search-input');
const yearInput = document.getElementById('image-search-year');
const statusLine = document.getElementById('image-search-status');
const resultsGrid = document.getElementById('image-results');
const resultsTitle = document.getElementById('image-results-title');
const resultsCount = document.getElementById('image-results-count');

const ARCHIVES = [
  {
    basin: 'Atlantic',
    url: './data/hurdat2-1851-2025-092326.txt'
  },
  {
    basin: 'Eastern/Central Pacific',
    url: './data/hurdat2-nepac-1949-2025-092926.txt'
  }
];

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

function plainText(page) {
  const info = page.imageinfo?.[0] || {};

  return [
    page.title || '',
    metadata(info, 'ImageDescription'),
    metadata(info, 'ObjectName'),
    metadata(info, 'Categories')
  ].join(' ').toLowerCase();
}

/* Read the same HURDAT2 archives used by the history tracker. */
async function loadHistoricalStorms() {
  const allStorms = [];

  for (const archive of ARCHIVES) {
    const response = await fetch(archive.url);

    if (!response.ok) {
      throw new Error(
        'Could not load the ' + archive.basin +
        ' historical storm archive.'
      );
    }

    const text = await response.text();

    if (!/[A-Z]{2}\d{6},/.test(text)) {
      throw new Error(
        'The ' + archive.basin + ' archive could not be verified.'
      );
    }

    for (const line of text.split(/\r?\n/)) {
      const fields = line.split(',').map(value => value.trim());

      if (
        fields.length >= 3 &&
        /^[A-Z]{2}\d{6}$/.test(fields[0]) &&
        /^\d+$/.test(fields[2])
      ) {
        allStorms.push({
          id: fields[0],
          name: fields[1].toUpperCase(),
          year: fields[0].slice(4, 8),
          basin: archive.basin
        });
      }
    }
  }

  return allStorms;
}

function makeCard(page, storm) {
  const info = page.imageinfo?.[0] || {};
  const title = (page.title || 'Hurricane image').replace(/^File:/, '');
  const imageURL = info.thumburl || info.url;
  const sourceURL = info.descriptionurl;

  if (!imageURL || !sourceURL) return '';

  const creator =
    metadata(info, 'Artist') ||
    metadata(info, 'Credit') ||
    'Creator not listed';

  const license =
    metadata(info, 'LicenseShortName') ||
    metadata(info, 'UsageTerms') ||
    'Check the source page';

  return `
    <article class="image-result-card">
      <a class="image-result-photo"
         href="${escapeHTML(sourceURL)}"
         target="_blank" rel="noopener noreferrer">
        <img src="${escapeHTML(imageURL)}"
             alt="${escapeHTML(storm.name + ' ' + storm.year + ': ' + title)}"
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
    statusLine.textContent =
      'Enter a hurricane name and a four-digit year.';
    return;
  }

  statusLine.textContent = 'Checking historical storm records…';
  resultsGrid.replaceChildren();
  resultsCount.textContent = '';
  resultsTitle.textContent = 'Searching…';

  try {
    const storms = await loadHistoricalStorms();

    const matches = storms.filter(storm =>
      storm.name === name && storm.year === year
    );

    if (!matches.length) {
      resultsTitle.textContent = 'Storm not found';
      statusLine.textContent =
        'No exact name-and-year match was found in the available ' +
        'historical archives. Check the spelling and year.';
      return;
    }

    const storm = matches[0];

    resultsTitle.textContent =
      storm.name + ' ' + storm.year + ' — Image results';

    statusLine.textContent =
      'Verified in the ' + storm.basin +
      ' historical archive. Searching for matching storm imagery…';

    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch:
        '"' + storm.name + '" ' + storm.year + ' hurricane satellite',
      gsrnamespace: '6',
      gsrlimit: '40',
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiextmetadatafilter:
        'ImageDescription|ObjectName|Artist|Credit|LicenseShortName|UsageTerms',
      iiurlwidth: '900',
      format: 'json',
      origin: '*'
    });

    const response = await fetch(
      'https://commons.wikimedia.org/w/api.php?' + params
    );

    if (!response.ok) {
      throw new Error('The image archive request failed.');
    }

    const data = await response.json();

    const pages = Object.values(data.query?.pages || {});

    /* Require the storm name AND year in the available metadata.
       Exclude likely aftermath/damage photographs. */
    const excluded = /\b(damage|damaged|aftermath|cleanup|recovery|\
rescue|evacuation|flooded homes|flood damage|deaths|victims)\b/i;

    const verified = pages.filter(page => {
      const info = page.imageinfo?.[0];
      if (!info || !(info.thumburl || info.url)) return false;

      const text = plainText(page);

      const hasName = text.includes(storm.name.toLowerCase());
      const hasYear = text.includes(storm.year);

      const stormImagery =
        /\b(satellite|hurricane|tropical cyclone|storm cloud|\
infrared|weather satellite|storm system|eye of the storm|goes)\b/i
          .test(text);

      return hasName && hasYear && stormImagery && !excluded.test(text);
    });

    /* Only show one or two results. */
    const selected = verified.slice(0, 2);
    const cards = selected.map(page => makeCard(page, storm)).join('');

    if (!cards) {
      resultsTitle.textContent =
        storm.name + ' ' + storm.year + ' — No verified images';

      statusLine.textContent =
        'The archive did not return images whose available descriptions ' +
        'confirmed both this storm and year. Try again later or check ' +
        'the historical record. No unverified photos were shown.';

      return;
    }

    resultsGrid.innerHTML = cards;
    resultsCount.textContent =
      selected.length + (selected.length === 1 ? ' image' : ' images');

    statusLine.textContent =
      'Historical record verified. Showing up to two relevant images. ' +
      'Open each source to confirm its details and license.';

  } catch (error) {
    console.error(error);
    resultsTitle.textContent = 'Image search unavailable';
    statusLine.textContent =
      'Could not load the historical records or image archive. ' +
      'Check your connection and try again.';
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  searchImages();
});
