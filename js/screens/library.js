/* ============================================
   Sonance — Library Screen
   Albums, Artists, Songs, Genres tabs
   ============================================ */

var LibraryScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var log = SonanceUtils.log;
    var formatDuration = SonanceUtils.formatDuration;

    var _container = null;
    var _contentContainer = null;
    var _activeTab = 'albums'; // persists across navigations
    var _genreMode = false;    // true when showing genre songs
    var _currentGenre = null;
    var _currentSongs = null;  // Track list for colour button support
    var _albumLoader = null;   // PaginatedLoader for albums tab

    // =========================================
    //  Scroll Helper (Chromium 63 safe)
    // =========================================

    function _scrollToFocused(container, element) {
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

    function _getScrollContainer() {
        return document.getElementById('library-content');
    }

    // =========================================
    //  Render
    // =========================================

    function render(container) {
        _container = container;

        var wrapper = el('div', { className: 'library-screen' });

        // Tab bar
        var tabBar = el('div', { className: 'library-tabs', id: 'library-tabs' });
        var tabs = [
            { key: 'albums', label: 'Albums' },
            { key: 'artists', label: 'Artists' },
            { key: 'songs', label: 'Songs' },
            { key: 'genres', label: 'Genres' }
        ];

        tabs.forEach(function(tab) {
            var btn = el('button', {
                className: 'library-tab focusable' + (tab.key === _activeTab ? ' active' : ''),
                'data-tab': tab.key
            }, tab.label);

            btn.addEventListener('click', function() {
                _switchTab(tab.key);
            });

            tabBar.appendChild(btn);
        });
        wrapper.appendChild(tabBar);

        // Content area for tab content
        _contentContainer = el('div', { className: 'library-content', id: 'library-content' });
        wrapper.appendChild(_contentContainer);

        container.appendChild(wrapper);
        log('Library', 'Library screen rendered');
    }

    // =========================================
    //  Activate
    // =========================================

    function activate(params) {
        if (params && params.tab) {
            _activeTab = params.tab;
        }
        // Reset genre mode on fresh activation (unless coming back with genre)
        if (params && params.genre) {
            _genreMode = true;
            _currentGenre = params.genre;
            var api = App.getApi();
            if (api) {
                _loadGenreSongs(api, params.genre);
            }
            return;
        }
        _genreMode = false;
        _currentGenre = null;
        _loadTabContent();
        _registerTabZone();
    }

    // =========================================
    //  Tab Management
    // =========================================

    function _registerTabZone() {
        FocusManager.registerZone('content', {
            selector: '#library-tabs .focusable',
            columns: 4,
            onActivate: function(idx, element) {
                var tab = element.getAttribute('data-tab');
                if (tab) _switchTab(tab);
            },
            neighbors: {
                left: 'sidebar',
                down: 'library-grid'
            }
        });
    }

    function _switchTab(tabKey) {
        _currentSongs = null; // Clear song list when switching tabs
        _albumLoader = null;  // Reset album pagination
        if (tabKey === _activeTab && _contentContainer && _contentContainer.children.length > 0) {
            // Only skip if we have rendered content (not skeleton)
            var hasContent = _contentContainer.querySelector('.library-grid, .library-song-list, .home-empty');
            if (hasContent) return;
        }

        _activeTab = tabKey;

        // Update tab visuals
        var tabBtns = document.querySelectorAll('#library-tabs .library-tab');
        for (var i = 0; i < tabBtns.length; i++) {
            if (tabBtns[i].getAttribute('data-tab') === tabKey) {
                tabBtns[i].classList.add('active');
            } else {
                tabBtns[i].classList.remove('active');
            }
        }

        // Unregister old grid zone (resets focus index)
        FocusManager.unregisterZone('library-grid');

        _loadTabContent();
    }

    // =========================================
    //  Loading State
    // =========================================

    function _showLoading() {
        if (!_contentContainer) return;
        _contentContainer.textContent = '';

        var loading = el('div', { className: 'library-loading' });

        if (_activeTab === 'songs') {
            // Song list skeletons
            for (var i = 0; i < 10; i++) {
                var row = el('div', { className: 'skeleton skeleton-song-row' });
                loading.appendChild(row);
            }
        } else {
            // Grid skeletons
            var cols = _activeTab === 'genres' ? 4 : 6;
            var grid = el('div', { className: 'library-grid' });
            grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
            for (var j = 0; j < cols * 2; j++) {
                var card = el('div', { className: 'skeleton skeleton-grid-card' });
                grid.appendChild(card);
            }
            loading.appendChild(grid);
        }

        _contentContainer.appendChild(loading);
    }

    // =========================================
    //  Tab Content Loaders
    // =========================================

    function _loadTabContent() {
        _showLoading();

        var api = App.getApi();
        if (!api) {
            _renderEmpty('Not connected to server');
            return;
        }

        switch (_activeTab) {
            case 'albums':
                _loadAlbums(api);
                break;
            case 'artists':
                _loadArtists(api);
                break;
            case 'songs':
                _loadSongs(api);
                break;
            case 'genres':
                _loadGenres(api);
                break;
        }
    }

    // --- Albums Tab (Paginated) ---

    function _loadAlbums(api) {
        _albumLoader = new SonanceUtils.PaginatedLoader(function(count, offset) {
            return api.getAlbumList2('alphabeticalByName', count, offset);
        }, 50);

        _albumLoader.loadNext(function(albums, hasMore) {
            if (!_contentContainer) return;
            _contentContainer.textContent = '';

            if (albums.length === 0) {
                _renderEmpty('No albums found');
                return;
            }

            var grid = el('div', { className: 'library-grid library-albums-grid', id: 'library-grid' });
            _contentContainer.appendChild(grid);

            _appendAlbumsToGrid(grid, albums, api);
            _updateLoadingIndicator(hasMore);

            // Register grid zone with pagination support
            var cols = _getGridColumnCount(grid);
            _registerAlbumsGridZone(cols || 8, api);
        });
    }

    function _appendAlbumsToGrid(grid, albums, api) {
        albums.forEach(function(album) {
            var card = el('div', {
                className: 'album-grid-card focusable',
                'data-album-id': album.id
            });

            card.appendChild(SonanceComponents.renderAlbumArt(album, 0, api));

            var info = el('div', { className: 'album-grid-info' });
            info.appendChild(el('div', { className: 'album-grid-title' }, album.name || 'Unknown'));
            var meta = album.artist || 'Unknown Artist';
            if (album.year) meta += ' \u00B7 ' + album.year;
            info.appendChild(el('div', { className: 'album-grid-meta' }, meta));
            card.appendChild(info);

            card.addEventListener('click', function() {
                App.navigateTo('album', { id: album.id, title: album.name || album.title });
            });

            grid.appendChild(card);
        });
    }

    function _updateLoadingIndicator(hasMore) {
        var existing = document.getElementById('library-loading-more');
        if (existing && existing.parentNode) {
            existing.parentNode.removeChild(existing);
        }

        if (hasMore && _contentContainer) {
            var indicator = el('div', {
                className: 'library-loading-more',
                id: 'library-loading-more'
            }, 'Loading...');
            _contentContainer.appendChild(indicator);
        }
    }

    function _registerAlbumsGridZone(cols, api) {
        FocusManager.registerZone('library-grid', {
            selector: '#library-grid .focusable',
            columns: cols,
            onActivate: function(idx, element) {
                element.click();
            },
            onFocus: function(idx, element) {
                // Scroll focused item into view
                _scrollToFocused(_getScrollContainer(), element);

                // Pagination: load more when near bottom
                if (_albumLoader && _albumLoader.hasMore && !_albumLoader.loading) {
                    var elements = document.querySelectorAll('#library-grid .focusable');
                    if (elements.length - idx <= 5) {
                        _albumLoader.loadNext(function(albums, hasMore) {
                            var grid = document.getElementById('library-grid');
                            if (grid) {
                                _appendAlbumsToGrid(grid, albums, api);
                            }
                            _updateLoadingIndicator(hasMore);
                            // Re-register zone so FocusManager picks up new elements
                            var newCols = grid ? _getGridColumnCount(grid) : cols;
                            _registerAlbumsGridZone(newCols || cols, api);
                        });
                    }
                }
            },
            neighbors: {
                left: 'sidebar',
                up: 'content',
                down: 'nowplaying-bar'
            }
        });

        // Update NP bar to point up to grid
        FocusManager.registerZone('nowplaying-bar', {
            selector: '.np-bar-btn',
            columns: 3,
            onActivate: function(index) {
                if (index === 0) Player.previous();
                else if (index === 1) Player.togglePlayPause();
                else if (index === 2) Player.next();
            },
            neighbors: {
                up: 'library-grid',
                left: 'sidebar'
            }
        });

        App.hideColourHints();
    }

    // --- Artists Tab ---

    function _loadArtists(api) {
        api.getArtists().then(function(artists) {
            _renderArtists(artists || [], api);
        }).catch(function(err) {
            log('Library', 'Error loading artists: ' + err.message);
            _renderEmpty('Unable to load artists');
        });
    }

    function _renderArtists(artists, api) {
        if (!_contentContainer) return;
        _contentContainer.textContent = '';

        if (artists.length === 0) {
            _renderEmpty('No artists found');
            return;
        }

        var grid = el('div', { className: 'library-grid library-artists-grid', id: 'library-grid' });

        artists.forEach(function(artist) {
            var card = el('div', {
                className: 'artist-grid-card focusable',
                'data-artist-id': artist.id
            });

            card.appendChild(SonanceComponents.renderArtistAvatar(artist, 100, api));
            card.appendChild(el('div', { className: 'artist-grid-name' }, artist.name || 'Unknown'));

            var countText = (artist.albumCount || 0) + ' album' + ((artist.albumCount || 0) !== 1 ? 's' : '');
            card.appendChild(el('div', { className: 'artist-grid-count' }, countText));

            card.addEventListener('click', function() {
                log('Library', 'Artist clicked: ' + artist.id);
                App.navigateTo('artist', { id: artist.id });
            });

            grid.appendChild(card);
        });

        _contentContainer.appendChild(grid);
        var artCols = _getGridColumnCount(grid);
        _registerGridZone(artCols || 6);
    }

    // --- Songs Tab ---

    function _loadSongs(api) {
        api.getRandomSongs(50).then(function(songs) {
            _renderSongs(songs || [], api);
        }).catch(function(err) {
            log('Library', 'Error loading songs: ' + err.message);
            _renderEmpty('Unable to load songs');
        });
    }

    function _renderSongs(songs, api) {
        if (!_contentContainer) return;
        _contentContainer.textContent = '';
        _currentSongs = songs;

        if (songs.length === 0) {
            _currentSongs = null;
            _renderEmpty('No songs found');
            return;
        }

        var list = el('div', { className: 'library-song-list', id: 'library-grid' });

        songs.forEach(function(song, index) {
            var row = el('div', {
                className: 'song-row focusable',
                'data-song-id': song.id
            });

            // Track number
            row.appendChild(el('div', { className: 'song-row-number' }, String(index + 1)));

            // Song info
            var info = el('div', { className: 'song-row-info' });
            info.appendChild(el('div', { className: 'song-row-title' }, song.title || 'Unknown'));

            var meta = song.artist || 'Unknown Artist';
            if (song.album) meta += ' \u00B7 ' + song.album;
            info.appendChild(el('div', { className: 'song-row-meta' }, meta));
            row.appendChild(info);

            // Duration
            row.appendChild(el('div', { className: 'song-row-duration' },
                formatDuration(song.duration)));

            row.addEventListener('click', function() {
                log('Library', 'Song clicked: ' + song.id + ' — ' + song.title);
            });

            list.appendChild(row);
        });

        _contentContainer.appendChild(list);
        _registerGridZone(1);
    }

    // --- Genres Tab ---

    function _loadGenres(api) {
        api.getGenres().then(function(genres) {
            _renderGenres(genres || []);
        }).catch(function(err) {
            log('Library', 'Error loading genres: ' + err.message);
            _renderEmpty('Unable to load genres');
        });
    }

    // Curated genre card palette (P4.11)
    var GENRE_PALETTE = ['#6366f1', '#8b5cf6', '#e44d8a', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6'];

    function _renderGenres(genres) {
        if (!_contentContainer) return;
        _contentContainer.textContent = '';

        if (genres.length === 0) {
            _renderEmpty('No genres found');
            return;
        }

        var grid = el('div', { className: 'library-grid library-genres-grid', id: 'library-grid' });

        genres.forEach(function(genre, index) {
            var name = genre.value || genre.name || 'Unknown';
            var borderColor = GENRE_PALETTE[index % GENRE_PALETTE.length];

            var card = el('div', {
                className: 'genre-card focusable',
                'data-genre': name
            });
            card.style.borderLeftColor = borderColor;

            card.appendChild(el('div', { className: 'genre-card-name' }, name));

            var countParts = [];
            if (genre.albumCount) countParts.push(genre.albumCount + ' albums');
            if (genre.songCount) countParts.push(genre.songCount + ' songs');
            if (countParts.length > 0) {
                card.appendChild(el('div', { className: 'genre-card-count' }, countParts.join(' \u00B7 ')));
            }

            card.addEventListener('click', function() {
                log('Library', 'Genre clicked: ' + name);
                var api = App.getApi();
                if (api) {
                    _genreMode = true;
                    _currentGenre = name;
                    _loadGenreSongs(api, name);
                }
            });

            grid.appendChild(card);
        });

        _contentContainer.appendChild(grid);
        _registerGridZone(4);
    }

    // =========================================
    //  Genre Song Browsing
    // =========================================

    function _loadGenreSongs(api, genreName) {
        if (!_contentContainer) return;

        // Unregister existing zones
        FocusManager.unregisterZone('library-grid');

        _contentContainer.textContent = '';

        // Header with back button
        var header = el('div', { className: 'genre-songs-header' });
        var backBtn = el('button', { className: 'genre-back-btn focusable' });
        backBtn.appendChild(document.createTextNode('\u2190 ' + genreName));
        backBtn.addEventListener('click', function() {
            _genreMode = false;
            _currentGenre = null;
            _activeTab = '';
            _switchTab('genres');
            _registerTabZone();
        });
        header.appendChild(backBtn);
        _contentContainer.appendChild(header);

        // Loading state
        var loadingWrap = el('div', { id: 'library-grid' });
        for (var i = 0; i < 10; i++) {
            loadingWrap.appendChild(el('div', { className: 'skeleton skeleton-song-row' }));
        }
        _contentContainer.appendChild(loadingWrap);

        api.getSongsByGenre(genreName, 50).then(function(songs) {
            _renderGenreSongs(songs || [], api, genreName);
        }).catch(function(err) {
            log('Library', 'Error loading genre songs: ' + err.message);
            var gridEl = document.getElementById('library-grid');
            if (gridEl) {
                gridEl.textContent = '';
                gridEl.appendChild(el('div', { className: 'home-empty' },
                    'Unable to load songs for ' + genreName));
            }
        });

        // Register back button as 'content' zone
        FocusManager.registerZone('content', {
            selector: '.genre-back-btn',
            columns: 1,
            onActivate: function(idx, element) { element.click(); },
            neighbors: {
                left: 'sidebar',
                down: 'library-grid'
            }
        });
        FocusManager.setActiveZone('content', 0);
    }

    function _renderGenreSongs(songs, api, genreName) {
        var gridEl = document.getElementById('library-grid');
        if (gridEl) gridEl.parentNode.removeChild(gridEl);

        if (!_contentContainer) return;
        _currentSongs = songs;

        if (songs.length === 0) {
            _contentContainer.appendChild(el('div', { className: 'home-empty library-empty' },
                'No songs found in ' + genreName));
            return;
        }

        var list = el('div', { className: 'library-song-list', id: 'library-grid' });

        songs.forEach(function(song, index) {
            var row = el('div', {
                className: 'song-row focusable',
                'data-song-id': song.id
            });

            row.appendChild(el('div', { className: 'song-row-number' }, String(index + 1)));

            var info = el('div', { className: 'song-row-info' });
            info.appendChild(el('div', { className: 'song-row-title' },
                song.title || 'Unknown'));
            var meta = song.artist || 'Unknown Artist';
            if (song.album) meta += ' \u00B7 ' + song.album;
            info.appendChild(el('div', { className: 'song-row-meta' }, meta));
            row.appendChild(info);

            row.appendChild(el('div', { className: 'song-row-duration' },
                formatDuration(song.duration)));

            row.addEventListener('click', function() {
                log('Library', 'Genre song clicked: ' + song.title);
                if (song.albumId) {
                    App.navigateTo('album', { id: song.albumId, title: song.album });
                }
            });

            list.appendChild(row);
        });

        _contentContainer.appendChild(list);

        _registerGridZone(1);

        FocusManager.registerZone('content', {
            selector: '.genre-back-btn',
            columns: 1,
            onActivate: function(idx, element) { element.click(); },
            neighbors: {
                left: 'sidebar',
                down: 'library-grid'
            }
        });
    }

    // =========================================
    //  Grid Column Count Helper (P8.1)
    // =========================================

    function _getGridColumnCount(gridEl) {
        if (!gridEl || !gridEl.children || gridEl.children.length === 0) return 0;
        var style = window.getComputedStyle(gridEl);
        var cols = style.getPropertyValue('grid-template-columns');
        if (cols) {
            return cols.split(/\s+/).length;
        }
        return 0;
    }

    // =========================================
    //  Focus Zone Registration (non-albums)
    // =========================================

    function _registerGridZone(cols) {
        var zoneConfig = {
            selector: '#library-grid .focusable',
            columns: cols,
            onActivate: function(idx, element) {
                element.click();
            },
            onFocus: function(idx, element) {
                _scrollToFocused(_getScrollContainer(), element);
            },
            neighbors: {
                left: 'sidebar',
                up: 'content',
                down: 'nowplaying-bar'
            }
        };

        // Add colour button support for song lists
        if (cols === 1 && _currentSongs && _currentSongs.length > 0) {
            zoneConfig.onColourButton = function(colour, idx) {
                var track = _currentSongs[idx];
                if (!track) return;
                if (colour === 'yellow') {
                    Player.addToQueue(track);
                    App.showToast('Added to queue');
                } else if (colour === 'blue') {
                    Player.addToQueueNext(track);
                    App.showToast('Playing next');
                }
            };
            App.showColourHints([
                { colour: 'yellow', label: 'Add to queue' },
                { colour: 'blue', label: 'Play next' }
            ]);
        } else {
            App.hideColourHints();
        }

        FocusManager.registerZone('library-grid', zoneConfig);

        // Update NP bar to point up to grid
        FocusManager.registerZone('nowplaying-bar', {
            selector: '.np-bar-btn',
            columns: 3,
            onActivate: function(index) {
                if (index === 0) Player.previous();
                else if (index === 1) Player.togglePlayPause();
                else if (index === 2) Player.next();
            },
            neighbors: {
                up: 'library-grid',
                left: 'sidebar'
            }
        });
    }

    // =========================================
    //  Empty State
    // =========================================

    function _renderEmpty(message) {
        if (!_contentContainer) return;
        _contentContainer.textContent = '';
        var empty = el('div', { className: 'home-empty library-empty' });
        empty.appendChild(el('div', null, message));
        _contentContainer.appendChild(empty);

        FocusManager.registerZone('nowplaying-bar', {
            selector: '.np-bar-btn',
            columns: 3,
            onActivate: function(index) {
                if (index === 0) Player.previous();
                else if (index === 1) Player.togglePlayPause();
                else if (index === 2) Player.next();
            },
            neighbors: {
                up: 'content',
                left: 'sidebar'
            }
        });
    }

    // =========================================
    //  Deactivate
    // =========================================

    function deactivate() {
        _container = null;
        _contentContainer = null;
        _genreMode = false;
        _currentGenre = null;
        _currentSongs = null;
        _albumLoader = null;
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate
    };
})();
