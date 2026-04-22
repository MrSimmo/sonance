/* ============================================
   Sonance — Search Screen
   On-screen keyboard + live search results
   ============================================ */

var SearchScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var log = SonanceUtils.log;
    var createSvg = SonanceUtils.createSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;
    var formatDuration = SonanceUtils.formatDuration;

    var _container = null;
    var _query = '';
    var _debounceTimer = null;
    var _searchInputDisplay = null;
    var _resultsContainer = null;
    var _currentResultSongs = null; // Song data for colour button support

    // =========================================
    //  Scroll Helper (Chromium 63 safe)
    // =========================================

    function _scrollToFocused(element) {
        var container = document.querySelector('.search-right');
        if (!container || !element) return;
        var elTop = element.offsetTop;
        var elBottom = elTop + element.offsetHeight;
        var viewTop = container.scrollTop;
        var viewBottom = viewTop + container.clientHeight;
        if (elBottom > viewBottom) {
            container.scrollTop = elBottom - container.clientHeight + 20;
        } else if (elTop < viewTop) {
            container.scrollTop = elTop - 20;
        }
    }

    // Keyboard characters: A-Z then 0-9
    var KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

    // =========================================
    //  Render
    // =========================================

    function render(container) {
        _container = container;
        _query = '';

        var wrapper = el('div', { className: 'search-screen' });

        // --- LEFT PANEL (380px) ---
        var leftPanel = el('div', { className: 'search-left' });

        // Heading
        leftPanel.appendChild(el('div', { className: 'search-heading' }, 'Search'));

        // Search input display bar
        var inputBar = el('div', { className: 'search-input-bar' });

        var searchIcon = createSvg(SVG_PATHS.search);
        searchIcon.style.width = '20px';
        searchIcon.style.height = '20px';
        searchIcon.style.fill = 'var(--text-muted)';
        searchIcon.style.flexShrink = '0';
        inputBar.appendChild(searchIcon);

        _searchInputDisplay = el('div', {
            className: 'search-input-text',
            id: 'search-input-text'
        }, 'Search artists, albums, songs...');
        inputBar.appendChild(_searchInputDisplay);

        // Clear button (hidden when query empty)
        var clearBtn = el('button', {
            className: 'search-clear-btn',
            id: 'search-clear-btn',
            style: { display: 'none' }
        }, '\u00D7');
        clearBtn.addEventListener('click', function() {
            _clearSearch();
        });
        inputBar.appendChild(clearBtn);

        leftPanel.appendChild(inputBar);

        // On-screen keyboard (9-column grid)
        var keyboard = el('div', { className: 'search-keyboard', id: 'search-keyboard' });

        // A-Z, 0-9 keys
        KEYS.forEach(function(key) {
            var btn = el('button', {
                className: 'kb-key focusable',
                'data-key': key
            }, key);
            btn.addEventListener('click', function() {
                _appendChar(key);
            });
            keyboard.appendChild(btn);
        });

        // SPACE key (spans 4 columns)
        var spaceBtn = el('button', {
            className: 'kb-space focusable',
            'data-key': 'SPACE'
        }, 'SPACE');
        spaceBtn.addEventListener('click', function() {
            _appendChar(' ');
        });
        keyboard.appendChild(spaceBtn);

        // Spacer (2 columns, non-focusable)
        keyboard.appendChild(el('div', { className: 'kb-spacer' }));

        // DEL key (spans 3 columns)
        var delBtn = el('button', {
            className: 'kb-del focusable',
            'data-key': 'DEL'
        }, '\u232B DEL');
        delBtn.addEventListener('click', function() {
            _deleteChar();
        });
        keyboard.appendChild(delBtn);

        leftPanel.appendChild(keyboard);
        wrapper.appendChild(leftPanel);

        // --- RIGHT PANEL (results) ---
        var rightPanel = el('div', { className: 'search-right' });
        _resultsContainer = el('div', {
            className: 'search-results-container',
            id: 'search-results'
        });
        rightPanel.appendChild(_resultsContainer);
        wrapper.appendChild(rightPanel);

        container.appendChild(wrapper);

        // Initial: show quick access
        _renderQuickAccess();

        log('Search', 'Search screen rendered');
    }

    // =========================================
    //  Activate
    // =========================================

    function activate(params) {
        _registerFocusZones();
    }

    // =========================================
    //  Input Management
    // =========================================

    function _appendChar(ch) {
        _query += ch;
        _updateInputDisplay();
        _triggerSearch();
    }

    function _deleteChar() {
        if (_query.length > 0) {
            _query = _query.slice(0, -1);
            _updateInputDisplay();
            _triggerSearch();
        }
    }

    function _clearSearch() {
        _query = '';
        _updateInputDisplay();
        if (_debounceTimer) {
            clearTimeout(_debounceTimer);
            _debounceTimer = null;
        }
        _renderQuickAccess();
        _registerResultsZone();
    }

    function _updateInputDisplay() {
        if (!_searchInputDisplay) return;

        var clearBtn = document.getElementById('search-clear-btn');

        if (_query.length > 0) {
            _searchInputDisplay.textContent = _query;
            _searchInputDisplay.classList.add('has-text');
            if (clearBtn) clearBtn.style.display = 'flex';
        } else {
            _searchInputDisplay.textContent = 'Search artists, albums, songs...';
            _searchInputDisplay.classList.remove('has-text');
            if (clearBtn) clearBtn.style.display = 'none';
        }
    }

    // =========================================
    //  Search Logic (debounced)
    // =========================================

    function _triggerSearch() {
        if (_debounceTimer) {
            clearTimeout(_debounceTimer);
        }

        if (_query.trim().length === 0) {
            _renderQuickAccess();
            _registerResultsZone();
            return;
        }

        _debounceTimer = setTimeout(function() {
            _performSearch(_query);
        }, 300);
    }

    function _performSearch(query) {
        var api = App.getApi();
        if (!api) return;

        _renderLoading();

        api.search3(query, {
            artistCount: 5,
            albumCount: 10,
            songCount: 10
        }).then(function(results) {
            // Ignore stale results if query changed
            if (_query !== query) return;
            _renderResults(results, api);
            _registerResultsZone();
        }).catch(function(err) {
            log('Search', 'Search error: ' + err.message);
            _renderEmpty('Search failed. Please try again.');
        });
    }

    // =========================================
    //  Quick Access (empty state)
    // =========================================

    // Curated palette for Quick Access cards (matches genre cards — P4.11)
    var QA_PALETTE = ['#6366f1', '#8b5cf6', '#e44d8a', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6'];

    function _renderQuickAccess() {
        if (!_resultsContainer) return;
        _resultsContainer.textContent = '';

        _resultsContainer.appendChild(el('div', { className: 'search-section-label' }, 'Quick Access'));

        var grid = el('div', { className: 'search-quickaccess-grid', id: 'search-quickaccess' });
        var categories = [
            { name: 'Rock', type: 'genre' },
            { name: 'Jazz', type: 'genre' },
            { name: 'Electronic', type: 'genre' },
            { name: 'Recently Added', type: 'newest' },
            { name: 'Most Played', type: 'frequent' },
            { name: 'Favourites', type: 'starred' }
        ];

        categories.forEach(function(cat, index) {
            var borderColor = QA_PALETTE[index % QA_PALETTE.length];
            var card = el('div', {
                className: 'quickaccess-card focusable',
                'data-category': cat.name,
                'data-type': cat.type
            });
            card.style.borderLeftColor = borderColor;
            card.appendChild(el('div', { className: 'quickaccess-card-name' }, cat.name));

            card.addEventListener('click', function() {
                _handleQuickAccess(cat);
            });

            grid.appendChild(card);
        });

        _resultsContainer.appendChild(grid);
    }

    function _handleQuickAccess(cat) {
        var api = App.getApi();
        if (!api) return;

        if (cat.type === 'genre') {
            _query = cat.name;
            _updateInputDisplay();
            _performSearch(cat.name);
        } else if (cat.type === 'newest') {
            _renderLoading();
            api.getAlbumList2('newest', 10).then(function(albums) {
                _renderAlbumResults(albums || [], api, 'Recently Added');
                _registerResultsZone();
            }).catch(function() { _renderEmpty('Unable to load.'); });
        } else if (cat.type === 'frequent') {
            _renderLoading();
            api.getAlbumList2('frequent', 10).then(function(albums) {
                if (!albums || albums.length === 0) {
                    // Navidrome may not have play stats — fall back to random
                    return api.getAlbumList2('random', 10).then(function(rand) {
                        _renderAlbumResults(rand || [], api, 'Most Played');
                        _registerResultsZone();
                    });
                }
                _renderAlbumResults(albums, api, 'Most Played');
                _registerResultsZone();
            }).catch(function() { _renderEmpty('Unable to load.'); });
        } else if (cat.type === 'starred') {
            _renderLoading();
            api.getStarred2().then(function(starred) {
                var albums = (starred && starred.album) || [];
                _renderAlbumResults(albums, api, 'Favourites');
                _registerResultsZone();
            }).catch(function() { _renderEmpty('Unable to load.'); });
        }
    }

    // =========================================
    //  Render: Album Results (for Quick Access)
    // =========================================

    function _renderAlbumResults(albums, api, label) {
        if (!_resultsContainer) return;
        _resultsContainer.textContent = '';

        _resultsContainer.appendChild(el('div', { className: 'search-section-label' }, label));

        if (albums.length === 0) {
            _resultsContainer.appendChild(el('div', { className: 'search-no-results' },
                'No albums found'));
            return;
        }

        var list = el('div', { className: 'search-results-list', id: 'search-results-list' });
        albums.forEach(function(album) {
            list.appendChild(_createAlbumResultItem(album, api));
        });
        _resultsContainer.appendChild(list);
    }

    // =========================================
    //  Render: Search Results
    // =========================================

    function _renderResults(results, api) {
        if (!_resultsContainer) return;
        _resultsContainer.textContent = '';
        _currentResultSongs = []; // Maps focusable index → song data (null for non-songs)

        var totalResults = results.artist.length + results.album.length + results.song.length;

        if (totalResults === 0) {
            _renderEmpty('No results for \u201C' + _query + '\u201D');
            return;
        }

        _resultsContainer.appendChild(el('div', { className: 'search-section-label' },
            'Results (' + totalResults + ')'));

        var list = el('div', { className: 'search-results-list', id: 'search-results-list' });

        // Artists
        results.artist.forEach(function(artist) {
            _currentResultSongs.push(null); // Not a song
            var item = el('div', {
                className: 'search-result-item focusable',
                'data-type': 'artist',
                'data-id': artist.id
            });
            item.appendChild(SonanceComponents.renderArtistAvatar(artist, 52, api));

            var info = el('div', { className: 'search-result-info' });
            info.appendChild(el('div', { className: 'search-result-title' },
                artist.name || 'Unknown'));
            var meta = 'Artist';
            if (artist.albumCount) meta += ' \u00B7 ' + artist.albumCount + ' albums';
            info.appendChild(el('div', { className: 'search-result-meta' }, meta));
            item.appendChild(info);

            item.addEventListener('click', function() {
                log('Search', 'Artist result clicked: ' + artist.name);
                App.navigateTo('artist', { id: artist.id });
            });

            list.appendChild(item);
        });

        // Albums
        results.album.forEach(function(album) {
            _currentResultSongs.push(null); // Not a song
            list.appendChild(_createAlbumResultItem(album, api));
        });

        // Songs
        results.song.forEach(function(song) {
            _currentResultSongs.push(song);
            var item = el('div', {
                className: 'search-result-item focusable',
                'data-type': 'song',
                'data-id': song.id
            });
            item.appendChild(SonanceComponents.renderAlbumArt(
                { coverArt: song.coverArt, name: song.album }, 52, api));

            var info = el('div', { className: 'search-result-info' });
            info.appendChild(el('div', { className: 'search-result-title' },
                song.title || 'Unknown'));
            var meta = 'Song';
            if (song.artist) meta += ' \u00B7 ' + song.artist;
            if (song.album) meta += ' \u00B7 ' + song.album;
            info.appendChild(el('div', { className: 'search-result-meta' }, meta));

            var dur = el('div', { className: 'search-result-duration' },
                formatDuration(song.duration));
            item.appendChild(info);
            item.appendChild(dur);

            item.addEventListener('click', function() {
                log('Search', 'Song result clicked: ' + song.title);
                if (song.albumId) {
                    App.navigateTo('album', { id: song.albumId, title: song.album });
                }
            });

            list.appendChild(item);
        });

        _resultsContainer.appendChild(list);
    }

    function _createAlbumResultItem(album, api) {
        var item = el('div', {
            className: 'search-result-item focusable',
            'data-type': 'album',
            'data-id': album.id
        });
        item.appendChild(SonanceComponents.renderAlbumArt(album, 52, api));

        var info = el('div', { className: 'search-result-info' });
        info.appendChild(el('div', { className: 'search-result-title' },
            album.name || album.title || 'Unknown'));
        var meta = 'Album';
        if (album.artist) meta += ' \u00B7 ' + album.artist;
        if (album.year) meta += ' \u00B7 ' + album.year;
        info.appendChild(el('div', { className: 'search-result-meta' }, meta));
        item.appendChild(info);

        item.addEventListener('click', function() {
            App.navigateTo('album', { id: album.id, title: album.name || album.title });
        });

        return item;
    }

    // =========================================
    //  Render: Loading + Empty states
    // =========================================

    function _renderLoading() {
        if (!_resultsContainer) return;
        _resultsContainer.textContent = '';
        var loading = el('div', { className: 'search-loading' });
        for (var i = 0; i < 5; i++) {
            loading.appendChild(el('div', { className: 'skeleton skeleton-result-row' }));
        }
        _resultsContainer.appendChild(loading);
    }

    function _renderEmpty(message) {
        if (!_resultsContainer) return;
        _resultsContainer.textContent = '';
        _resultsContainer.appendChild(el('div', { className: 'search-no-results' }, message));
    }

    // =========================================
    //  Focus Zones
    // =========================================

    function _registerFocusZones() {
        // Keyboard character keys (9 columns)
        FocusManager.registerZone('content', {
            selector: '#search-keyboard .kb-key',
            columns: 9,
            onActivate: function(idx, element) {
                element.click();
            },
            neighbors: {
                left: 'sidebar',
                right: 'search-results',
                down: 'search-special'
            }
        });

        // SPACE + DEL zone (2 items in a row)
        FocusManager.registerZone('search-special', {
            getElements: function() {
                var space = document.querySelector('#search-keyboard .kb-space');
                var del = document.querySelector('#search-keyboard .kb-del');
                var result = [];
                if (space) result.push(space);
                if (del) result.push(del);
                return result;
            },
            columns: 2,
            onActivate: function(idx, element) {
                element.click();
            },
            neighbors: {
                left: 'sidebar',
                right: 'search-results',
                up: 'content',
                down: 'nowplaying-bar'
            }
        });

        // Register results zone
        _registerResultsZone();

        // NP bar
        FocusManager.registerZone('nowplaying-bar', {
            selector: '.np-bar-btn',
            columns: 3,
            onActivate: function(index) {
                if (index === 0) Player.previous();
                else if (index === 1) Player.togglePlayPause();
                else if (index === 2) Player.next();
            },
            neighbors: {
                up: 'search-special',
                left: 'sidebar'
            }
        });

        // Set initial focus to keyboard
        FocusManager.setActiveZone('content', 0);
    }

    function _registerResultsZone() {
        // Check what's displayed on the right panel
        var resultItems = document.querySelectorAll('#search-results-list .focusable');
        var quickAccessItems = document.querySelectorAll('#search-quickaccess .focusable');

        if (resultItems.length > 0) {
            var hasSongs = _currentResultSongs && _currentResultSongs.some(function(s) { return s !== null; });
            FocusManager.registerZone('search-results', {
                selector: '#search-results-list .focusable',
                columns: 1,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) { _scrollToFocused(element); },
                onColourButton: hasSongs ? function(colour, idx) {
                    if (!_currentResultSongs) return;
                    var track = _currentResultSongs[idx];
                    if (!track) return; // Not a song (artist/album)
                    if (colour === 'yellow') {
                        Player.addToQueue(track);
                        App.showToast('Added to queue');
                    } else if (colour === 'blue') {
                        Player.addToQueueNext(track);
                        App.showToast('Playing next');
                    }
                } : null,
                neighbors: {
                    left: 'content',
                    down: 'nowplaying-bar'
                }
            });
            if (hasSongs) {
                App.showColourHints([
                    { colour: 'yellow', label: 'Add to queue' },
                    { colour: 'blue', label: 'Play next' }
                ]);
            }
        } else if (quickAccessItems.length > 0) {
            FocusManager.registerZone('search-results', {
                selector: '#search-quickaccess .focusable',
                columns: 2,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) { _scrollToFocused(element); },
                neighbors: {
                    left: 'content',
                    down: 'nowplaying-bar'
                }
            });
        } else {
            // No results — unregister so right-press does nothing
            FocusManager.unregisterZone('search-results');
        }
    }

    // =========================================
    //  Deactivate
    // =========================================

    function deactivate() {
        _container = null;
        _searchInputDisplay = null;
        _resultsContainer = null;
        _query = '';
        _currentResultSongs = null;
        if (_debounceTimer) {
            clearTimeout(_debounceTimer);
            _debounceTimer = null;
        }
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate
    };
})();
