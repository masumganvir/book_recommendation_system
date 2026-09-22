/**
 * BookVerse Recommender System - Interactive Frontend Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  initMobileMenu();
  initImageFallback();
  initBookModal();
  initTopBooksFilter();
  initRecommendationEngine();
});

/* ==========================================================================
   1. Mobile Menu Toggle
   ========================================================================== */
function initMobileMenu() {
  const menuToggle = document.getElementById('menuToggle');
  const navLinks = document.getElementById('navLinks');

  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      const isOpen = navLinks.classList.contains('open');
      menuToggle.setAttribute('aria-expanded', isOpen);
      menuToggle.innerHTML = isOpen ? '&#10005;' : '&#9776;';
    });
  }
}

/* ==========================================================================
   2. Image Fallback Handler (Amazon CDNs & Mixed Content)
   ========================================================================== */
function initImageFallback() {
  const fallbackSrc = '/static/images/book-placeholder.svg';

  document.querySelectorAll('img').forEach((img) => {
    // If image url is http, upgrade to https
    if (img.src && img.src.startsWith('http://images.amazon.com')) {
      img.src = img.src.replace('http://', 'https://');
    }

    img.addEventListener('error', function () {
      if (this.src !== window.location.origin + fallbackSrc) {
        this.src = fallbackSrc;
      }
    });
  });
}

/* ==========================================================================
   3. Top 50 Books Filter & Sort
   ========================================================================== */
function initTopBooksFilter() {
  const searchInput = document.getElementById('popularSearchInput');
  const sortSelect = document.getElementById('popularSortSelect');
  const booksGrid = document.getElementById('popularBooksGrid');
  const countDisplay = document.getElementById('popularCountDisplay');

  if (!booksGrid) return;

  const cards = Array.from(booksGrid.querySelectorAll('.book-card'));

  function filterAndSort() {
    const query = (searchInput ? searchInput.value.toLowerCase().trim() : '');
    const sortBy = (sortSelect ? sortSelect.value : 'default');

    let visibleCards = cards.filter((card) => {
      const title = card.getAttribute('data-title') || '';
      const author = card.getAttribute('data-author') || '';
      const matches = title.toLowerCase().includes(query) || author.toLowerCase().includes(query);
      return matches;
    });

    // Sorting
    visibleCards.sort((a, b) => {
      if (sortBy === 'rating-desc') {
        return parseFloat(b.dataset.rating || 0) - parseFloat(a.dataset.rating || 0);
      } else if (sortBy === 'votes-desc') {
        return parseInt(b.dataset.votes || 0) - parseInt(a.dataset.votes || 0);
      } else if (sortBy === 'title-asc') {
        return (a.dataset.title || '').localeCompare(b.dataset.title || '');
      }
      return parseInt(a.dataset.rank || 0) - parseInt(b.dataset.rank || 0);
    });

    // Render cards
    cards.forEach((c) => (c.style.display = 'none'));
    visibleCards.forEach((c) => {
      c.style.display = 'flex';
      booksGrid.appendChild(c);
    });

    if (countDisplay) {
      countDisplay.textContent = `Showing ${visibleCards.length} of ${cards.length} books`;
    }

    // Empty state
    let emptyNotice = document.getElementById('noResultsNotice');
    if (visibleCards.length === 0) {
      if (!emptyNotice) {
        emptyNotice = document.createElement('div');
        emptyNotice.id = 'noResultsNotice';
        emptyNotice.className = 'alert-box';
        emptyNotice.style.gridColumn = '1 / -1';
        emptyNotice.innerHTML = `<div><strong>No books found matching "${escapeHtml(query)}"</strong><p style="margin-top:0.25rem; font-size:0.88rem; color:var(--text-muted)">Try searching with a different keyword or author name.</p></div>`;
        booksGrid.appendChild(emptyNotice);
      }
      emptyNotice.style.display = 'flex';
    } else if (emptyNotice) {
      emptyNotice.style.display = 'none';
    }
  }

  if (searchInput) {
    searchInput.addEventListener('input', debounce(filterAndSort, 150));
  }
  if (sortSelect) {
    sortSelect.addEventListener('change', filterAndSort);
  }
}

/* ==========================================================================
   4. Recommendation Engine with Autocomplete & Dynamic AJAX
   ========================================================================== */
function initRecommendationEngine() {
  const searchInput = document.getElementById('recSearchInput');
  const searchBtn = document.getElementById('recSubmitBtn');
  const dropdown = document.getElementById('autocompleteDropdown');
  const resultsContainer = document.getElementById('recommendResults');
  const skeletonContainer = document.getElementById('skeletonContainer');
  const queryBanner = document.getElementById('queryBanner');
  const quickChips = document.querySelectorAll('.chip-btn');

  if (!searchInput) return;

  let currentFocus = -1;
  let cachedTitles = [];

  // Fetch titles list for client autocomplete
  fetch('/api/titles')
    .then((res) => res.json())
    .then((data) => {
      if (Array.isArray(data)) {
        cachedTitles = data;
      }
    })
    .catch((err) => console.warn('Could not preload book titles:', err));

  // Quick Chips
  quickChips.forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      const title = chip.getAttribute('data-title');
      if (title) {
        searchInput.value = title;
        fetchRecommendations(title);
      }
    });
  });

  // Autocomplete Input Listener
  searchInput.addEventListener('input', () => {
    const val = searchInput.value.trim().toLowerCase();
    closeDropdown();
    if (!val || val.length < 2) return;

    // Filter matching titles
    const matches = cachedTitles
      .filter((t) => t.toLowerCase().includes(val))
      .slice(0, 7);

    if (matches.length > 0) {
      renderDropdown(matches, val);
    }
  });

  // Keyboard navigation for dropdown
  searchInput.addEventListener('keydown', (e) => {
    const items = dropdown ? dropdown.querySelectorAll('.autocomplete-item') : [];
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      currentFocus++;
      addActive(items);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      currentFocus--;
      addActive(items);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (currentFocus > -1 && items[currentFocus]) {
        e.preventDefault();
        items[currentFocus].click();
      } else {
        // Normal form submit or search
        e.preventDefault();
        fetchRecommendations(searchInput.value.trim());
      }
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  });

  if (searchBtn) {
    searchBtn.addEventListener('click', (e) => {
      e.preventDefault();
      fetchRecommendations(searchInput.value.trim());
    });
  }

  function renderDropdown(items, query) {
    if (!dropdown) return;
    dropdown.innerHTML = '';
    currentFocus = -1;

    items.forEach((itemText) => {
      const div = document.createElement('div');
      div.className = 'autocomplete-item';

      // Highlight match
      const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
      const highlighted = itemText.replace(regex, '<span style="color:var(--accent-cyan); text-decoration:underline;">$1</span>');

      div.innerHTML = `
        <span class="autocomplete-item-text">${highlighted}</span>
        <span class="autocomplete-item-badge">Available</span>
      `;

      div.addEventListener('click', () => {
        searchInput.value = itemText;
        closeDropdown();
        fetchRecommendations(itemText);
      });

      dropdown.appendChild(div);
    });

    dropdown.classList.add('open');
  }

  function addActive(items) {
    if (!items) return false;
    removeActive(items);
    if (currentFocus >= items.length) currentFocus = 0;
    if (currentFocus < 0) currentFocus = items.length - 1;
    items[currentFocus].classList.add('highlighted');
    items[currentFocus].scrollIntoView({ block: 'nearest' });
  }

  function removeActive(items) {
    items.forEach((it) => it.classList.remove('highlighted'));
  }

  function closeDropdown() {
    if (dropdown) {
      dropdown.classList.remove('open');
      dropdown.innerHTML = '';
    }
    currentFocus = -1;
  }

  document.addEventListener('click', (e) => {
    if (e.target !== searchInput && (!dropdown || !dropdown.contains(e.target))) {
      closeDropdown();
    }
  });

  // Dynamic AJAX Fetch Recommendations
  function fetchRecommendations(title) {
    if (!title) return;
    closeDropdown();

    // Show skeletons, hide old results
    if (skeletonContainer) skeletonContainer.style.display = 'grid';
    if (resultsContainer) resultsContainer.style.display = 'none';
    if (queryBanner) queryBanner.style.display = 'none';

    fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book_title: title }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (skeletonContainer) skeletonContainer.style.display = 'none';

        if (data.success) {
          renderSuccessResults(data);
        } else {
          renderErrorResults(data);
        }
      })
      .catch((err) => {
        console.error('Fetch error:', err);
        if (skeletonContainer) skeletonContainer.style.display = 'none';
        renderErrorResults({
          message: 'Unable to communicate with the server. Please check your network connection.',
          suggestions: [],
        });
      });
  }

  function renderSuccessResults(data) {
    if (!resultsContainer) return;

    // Render Query Banner
    if (queryBanner && data.searched_book) {
      const b = data.searched_book;
      queryBanner.innerHTML = `
        <div class="queried-book-banner">
          <img class="queried-cover" src="${b.image}" onerror="this.src='/static/images/book-placeholder.svg';" alt="${escapeHtml(b.title)}">
          <div class="queried-details">
            <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--accent-purple); font-weight:700;">Base Reference Book</div>
            <h3 class="queried-title">${escapeHtml(b.title)}</h3>
            <p class="queried-author">By ${escapeHtml(b.author)}</p>
          </div>
        </div>
      `;
      queryBanner.style.display = 'block';
    }

    // Render Recommendations
    resultsContainer.innerHTML = `
      <div class="results-header">
        <h2 class="results-title">
          <span>AI Recommendations</span>
          <span style="font-size:0.8rem; background:rgba(99,102,241,0.2); color:#a5b4fc; padding:2px 8px; border-radius:999px;">${data.recommendations.length} Matches</span>
        </h2>
      </div>
      <div class="books-grid" id="recCardsGrid"></div>
    `;

    const grid = resultsContainer.querySelector('#recCardsGrid');

    data.recommendations.forEach((rec, idx) => {
      const card = document.createElement('div');
      card.className = 'book-card';
      card.setAttribute('data-title', rec.title);
      card.setAttribute('data-author', rec.author);
      card.setAttribute('data-image', rec.image);
      card.setAttribute('data-match', rec.similarity_percent + '%');

      card.innerHTML = `
        <div class="card-cover-wrapper">
          <img class="card-cover-img" src="${rec.image}" onerror="this.src='/static/images/book-placeholder.svg';" alt="${escapeHtml(rec.title)}">
          <span class="card-rank-badge">#${idx + 1} Rec</span>
          <span class="card-match-badge">${rec.similarity_percent}% Match</span>
        </div>
        <div class="card-body">
          <h3 class="book-title" title="${escapeHtml(rec.title)}">${escapeHtml(rec.title)}</h3>
          <p class="book-author">${escapeHtml(rec.author)}</p>
          <div class="card-metrics">
            <span class="metric-rating">&#9733; High Similarity</span>
            <span class="metric-votes">${rec.year ? 'Year: ' + escapeHtml(rec.year) : ''}</span>
          </div>
          <button class="card-action-btn" onclick="triggerExplore('${escapeHtml(rec.title)}')">
            <span>Recommend Like This</span> &#8594;
          </button>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (!e.target.closest('.card-action-btn')) {
          openBookModal({
            title: rec.title,
            author: rec.author,
            image: rec.image,
            year: rec.year || 'N/A',
            publisher: rec.publisher || 'N/A',
            match: rec.similarity_percent + '% Similarity Match',
          });
        }
      });

      grid.appendChild(card);
    });

    resultsContainer.style.display = 'block';
    resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderErrorResults(data) {
    if (!resultsContainer) return;

    let suggestionsHtml = '';
    if (data.suggestions && data.suggestions.length > 0) {
      suggestionsHtml = `
        <div style="margin-top:1rem;">
          <div style="font-size:0.85rem; color:#cbd5e1; margin-bottom:0.5rem; font-weight:600;">Did you mean one of these available books?</div>
          <div class="alert-suggestions">
            ${data.suggestions
              .map(
                (s) =>
                  `<button class="chip-btn" onclick="triggerExplore('${escapeHtml(s)}')">${escapeHtml(s)}</button>`
              )
              .join('')}
          </div>
        </div>
      `;
    }

    resultsContainer.innerHTML = `
      <div class="alert-box" style="margin-top: 2rem;">
        <span style="font-size: 1.6rem;">&#9888;</span>
        <div style="flex:1;">
          <strong style="font-size:1.05rem; display:block; margin-bottom:0.3rem;">${escapeHtml(data.message || 'Book not found')}</strong>
          <p style="font-size:0.9rem; color:var(--text-muted);">
            Our collaborative filtering algorithm trains on user voting clusters. Books require a threshold of verified community ratings to build cosine similarity vectors.
          </p>
          ${suggestionsHtml}
        </div>
      </div>
    `;

    resultsContainer.style.display = 'block';
  }
}

// Global hook for card button clicks
window.triggerExplore = function (title) {
  const searchInput = document.getElementById('recSearchInput');
  if (searchInput) {
    searchInput.value = title;
    const searchBtn = document.getElementById('recSubmitBtn');
    if (searchBtn) searchBtn.click();
  } else {
    // If on home page, redirect to recommend page with query
    window.location.href = `/recommend?book=${encodeURIComponent(title)}`;
  }
};

/* ==========================================================================
   5. Interactive Book Detail Modal
   ========================================================================== */
function initBookModal() {
  const modal = document.getElementById('bookDetailModal');
  const closeBtn = document.getElementById('modalCloseBtn');
  const actionBtn = document.getElementById('modalActionBtn');

  if (!modal) return;

  // Delegate click for static cards on index.html
  document.querySelectorAll('.book-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-action-btn')) return;

      const title = card.getAttribute('data-title');
      const author = card.getAttribute('data-author');
      const image = card.getAttribute('data-image');
      const votes = card.getAttribute('data-votes');
      const rating = card.getAttribute('data-rating');
      const rank = card.getAttribute('data-rank');

      openBookModal({
        title,
        author,
        image,
        votes: votes ? `${votes} community votes` : null,
        rating: rating ? `${rating} / 10` : null,
        rank: rank ? `#${rank} in Top 50` : null,
      });
    });
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', closeModal);
  }

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) {
      closeModal();
    }
  });

  function closeModal() {
    modal.classList.remove('open');
  }
}

function openBookModal(data) {
  const modal = document.getElementById('bookDetailModal');
  if (!modal) return;

  const cover = document.getElementById('modalCover');
  const title = document.getElementById('modalTitle');
  const author = document.getElementById('modalAuthor');
  const statsBox = document.getElementById('modalStats');
  const actionBtn = document.getElementById('modalActionBtn');

  if (cover) cover.src = data.image || '/static/images/book-placeholder.svg';
  if (title) title.textContent = data.title || 'Unknown Title';
  if (author) author.textContent = data.author ? `By ${data.author}` : '';

  if (statsBox) {
    statsBox.innerHTML = '';
    const addStat = (label, val) => {
      if (!val) return;
      const box = document.createElement('div');
      box.className = 'modal-stat-box';
      box.innerHTML = `
        <div class="modal-stat-label">${escapeHtml(label)}</div>
        <div class="modal-stat-val">${escapeHtml(val)}</div>
      `;
      statsBox.appendChild(box);
    };

    if (data.rating) addStat('Average Rating', data.rating);
    if (data.votes) addStat('Total Reviews', data.votes);
    if (data.rank) addStat('Popularity Rank', data.rank);
    if (data.match) addStat('Similarity Metric', data.match);
    if (data.year) addStat('Publication Year', data.year);
    if (data.publisher) addStat('Publisher', data.publisher);
  }

  if (actionBtn) {
    actionBtn.onclick = () => {
      window.location.href = `/recommend?book=${encodeURIComponent(data.title)}`;
    };
  }

  modal.classList.add('open');
}

/* ==========================================================================
   Utility Helpers
   ========================================================================== */
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
