/* ============================================
   Sonance — Playlists Screen
   3-column grid of playlists + playlist detail
   ============================================ */

var PlaylistsScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var log = SonanceUtils.log;
    var createSvg = SonanceUtils.createSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;
    var formatDuration = SonanceUtils.formatDuration;

    var _container = null;
    var _playlists = [];
    var _detailMode = false;
    var _currentPlaylist = null;
    var _currentPlaylistSongs = null; // Song data for colour button support

    // =========================================
    //  Scroll Helper (Chromium 63 safe)
    // =========================================

    function _scrollToFocused(element) {
        var container = document.querySelector('.playlists-screen');
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

    // =========================================
    //  Render
    // =========================================

    function render(container) {
        _container = container;

        var wrapper = el('div', { className: 'playlists-screen' });

        // Loading skeleton — 3-column grid
        var grid = el('div', { className: 'playlists-grid', id: 'playlists-grid' });
        for (var i = 0; i < 6; i++) {
            var skel = el('div', { className: 'skeleton' });
            skel.style.minHeight = '120px';
            skel.style.borderRadius = '14px';
            grid.appendChild(skel);
        }
        wrapper.appendChild(grid);

        container.appendChild(wrapper);
        log('Playlists', 'Playlists screen rendered (loading)');
    }

    // =========================================
    //  Activate
    // =========================================

    function activate(params) {
        _detailMode = false;
        _currentPlaylist = null;

        // If params contain a playlist ID, go directly to detail
        if (params && params.id) {
            _loadPlaylistDetail(params.id);
            return;
        }

        _loadPlaylists();
    }

    // =========================================
    //  Load Playlists Grid
    // =========================================

    function _loadPlaylists() {
        var api = App.getApi();
        if (!api) return;

        api.getPlaylists().then(function(playlists) {
            _playlists = playlists || [];
            _renderGrid(api);
            _registerGridZones();
            log('Playlists', 'Loaded ' + _playlists.length + ' playlists');
        }).catch(function(err) {
            log('Playlists', 'Error loading playlists: ' + err.message);
            _renderEmpty('Unable to load playlists. Check your connection.');
        });
    }

    function _renderGrid(api) {
        if (!_container) return;
        _container.textContent = '';

        var wrapper = el('div', { className: 'playlists-screen' });

        if (_playlists.length === 0) {
            _container.appendChild(wrapper);
            _renderEmpty('No playlists found. Create playlists in your Navidrome server.');
            return;
        }

        var grid = el('div', { className: 'playlists-grid', id: 'playlists-grid' });

        _playlists.forEach(function(playlist) {
            var colors = SonanceComponents.hashColor(playlist.name || '');
            var card = el('div', {
                className: 'playlist-card focusable',
                'data-playlist-id': playlist.id
            });
            card.style.background = 'linear-gradient(135deg, ' + colors.base + ' 0%, var(--bg-card) 100%)';

            card.appendChild(el('div', { className: 'playlist-card-name' }, playlist.name || 'Untitled'));
            card.appendChild(el('div', { className: 'playlist-card-count' },
                (playlist.songCount || 0) + ' tracks'));

            card.addEventListener('click', function() {
                _loadPlaylistDetail(playlist.id);
            });

            grid.appendChild(card);
        });

        wrapper.appendChild(grid);
        _container.appendChild(wrapper);
    }

    function _renderEmpty(message) {
        if (!_container) return;
        _container.textContent = '';

        var empty = el('div', { className: 'playlists-empty' });
        var iconSvg = createSvg(SVG_PATHS.playlist);
        iconSvg.setAttribute('class', 'playlists-empty-icon');
        empty.appendChild(iconSvg);
        empty.appendChild(el('div', { className: 'playlists-empty-text' }, message));
        _container.appendChild(empty);

        FocusManager.registerZone('content', {
            selector: '#content-area .focusable',
            columns: 1,
            onActivate: function() {},
            neighbors: { left: 'sidebar', down: 'nowplaying-bar' }
        });
    }

    // =========================================
    //  Playlist Detail
    // =========================================

    function _loadPlaylistDetail(playlistId) {
        var api = App.getApi();
        if (!api) return;

        _detailMode = true;

        api.getPlaylist(playlistId).then(function(playlist) {
            if (!playlist) {
                _renderEmpty('Playlist not found.');
                return;
            }
            _currentPlaylist = playlist;
            _renderDetail(playlist, api);
            _registerDetailZones();
            log('Playlists', 'Loaded playlist: ' + (playlist.name || playlistId) +
                ' (' + ((playlist.entry && playlist.entry.length) || 0) + ' tracks)');
        }).catch(function(err) {
            log('Playlists', 'Error loading playlist: ' + err.message);
            _renderEmpty('Unable to load playlist.');
        });
    }

    function _renderDetail(playlist, api) {
        if (!_container) return;
        _container.textContent = '';
        _currentPlaylistSongs = playlist.entry || [];

        var wrapper = el('div', { className: 'playlists-screen' });

        // Header: back button + playlist name
        var header = el('div', { className: 'playlist-detail-header' });

        var backBtn = el('button', { className: 'playlist-detail-back focusable' });
        backBtn.appendChild(document.createTextNode('\u2190 Playlists'));
        backBtn.addEventListener('click', function() {
            _detailMode = false;
            _currentPlaylist = null;
            _loadPlaylists();
        });
        header.appendChild(backBtn);

        var infoWrap = el('div', { className: 'playlist-detail-info' });
        infoWrap.appendChild(el('div', { className: 'playlist-detail-name' },
            playlist.name || 'Untitled'));

        var songs = playlist.entry || [];
        infoWrap.appendChild(el('div', { className: 'playlist-detail-count' },
            songs.length + ' tracks'));
        header.appendChild(infoWrap);
        wrapper.appendChild(header);

        // Song list (reuses song-row styles from Library)
        var songList = el('div', { className: 'library-song-list', id: 'playlist-songs' });

        if (songs.length === 0) {
            songList.appendChild(el('div', { className: 'home-empty' }, 'This playlist is empty.'));
        } else {
            songs.forEach(function(song, index) {
                var row = el('div', {
                    className: 'song-row focusable',
                    'data-song-id': song.id
                });

                row.appendChild(el('div', { className: 'song-row-number' }, String(index + 1)));

                var info = el('div', { className: 'song-row-info' });
                info.appendChild(el('div', { className: 'song-row-title' }, song.title || 'Unknown'));
                var meta = (song.artist || 'Unknown');
                if (song.album) meta += ' \u00B7 ' + song.album;
                info.appendChild(el('div', { className: 'song-row-meta' }, meta));
                row.appendChild(info);

                row.appendChild(el('div', { className: 'song-row-duration' },
                    formatDuration(song.duration)));

                row.addEventListener('click', function() {
                    Player.setQueue(songs, index);
                    log('Playlists', 'Play track ' + (index + 1) + ': ' + song.title);
                });

                songList.appendChild(row);
            });
        }

        wrapper.appendChild(songList);
        _container.appendChild(wrapper);
    }

    // =========================================
    //  Focus Zones
    // =========================================

    function _registerGridZones() {
        var cards = document.querySelectorAll('#playlists-grid .focusable');
        if (cards.length === 0) return;

        FocusManager.registerZone('content', {
            selector: '#playlists-grid .focusable',
            columns: 3,
            onActivate: function(idx, element) { element.click(); },
            onFocus: function(idx, element) { _scrollToFocused(element); },
            neighbors: {
                left: 'sidebar',
                down: 'nowplaying-bar'
            }
        });

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

        FocusManager.setActiveZone('content', 0);
    }

    function _registerDetailZones() {
        var songRows = document.querySelectorAll('#playlist-songs .focusable');
        var hasSongs = songRows.length > 0;

        FocusManager.registerZone('content', {
            selector: '.playlist-detail-back',
            columns: 1,
            onActivate: function(idx, element) { element.click(); },
            neighbors: {
                left: 'sidebar',
                down: hasSongs ? 'playlist-songs' : 'nowplaying-bar'
            }
        });

        if (hasSongs) {
            FocusManager.registerZone('playlist-songs', {
                selector: '#playlist-songs .focusable',
                columns: 1,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) { _scrollToFocused(element); },
                onColourButton: function(colour, idx) {
                    if (!_currentPlaylistSongs) return;
                    var track = _currentPlaylistSongs[idx];
                    if (!track) return;
                    if (colour === 'yellow') {
                        Player.addToQueue(track);
                        App.showToast('Added to queue');
                    } else if (colour === 'blue') {
                        Player.addToQueueNext(track);
                        App.showToast('Playing next');
                    }
                },
                neighbors: {
                    left: 'sidebar',
                    up: 'content',
                    down: 'nowplaying-bar'
                }
            });

            App.showColourHints([
                { colour: 'yellow', label: 'Add to queue' },
                { colour: 'blue', label: 'Play next' }
            ]);
        }

        FocusManager.registerZone('nowplaying-bar', {
            selector: '.np-bar-btn',
            columns: 3,
            onActivate: function(index) {
                if (index === 0) Player.previous();
                else if (index === 1) Player.togglePlayPause();
                else if (index === 2) Player.next();
            },
            neighbors: {
                up: hasSongs ? 'playlist-songs' : 'content',
                left: 'sidebar'
            }
        });

        FocusManager.setActiveZone('content', 0);
    }

    // =========================================
    //  Deactivate
    // =========================================

    function deactivate() {
        _container = null;
        _detailMode = false;
        _currentPlaylist = null;
        _currentPlaylistSongs = null;
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate
    };
})();
