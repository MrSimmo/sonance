/* ============================================
   Sonance — Album Detail Screen
   Split-pane: fixed left (art/metadata/buttons)
                scrollable right (tracklist)
   ============================================ */

var AlbumScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var log = SonanceUtils.log;
    var createSvg = SonanceUtils.createSvg;
    var createStarSvg = SonanceUtils.createStarSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;
    var formatDuration = SonanceUtils.formatDuration;

    var _container = null;
    var _albumData = null;
    var _albumId = null;
    var _active = false;

    // Refresh a single star button (album or track) to match current cache state.
    function _refreshStar(btn, filled) {
        if (!btn) return;
        btn.textContent = '';
        var icon = createStarSvg(filled);
        var size = btn.getAttribute('data-star-size') || '20';
        icon.style.width = size + 'px';
        icon.style.height = size + 'px';
        btn.appendChild(icon);
        if (filled) {
            btn.classList.add('is-starred');
        } else {
            btn.classList.remove('is-starred');
        }
    }

    // =========================================
    //  Manual scroll-into-view (Chromium 63 safe)
    // =========================================

    function _scrollToFocused(container, element) {
        if (!container || !element) return;
        var trackTop = element.offsetTop;
        var trackBottom = trackTop + element.offsetHeight;
        var viewTop = container.scrollTop;
        var viewBottom = viewTop + container.clientHeight;
        if (trackBottom > viewBottom) {
            container.scrollTop = trackBottom - container.clientHeight + 20;
        } else if (trackTop < viewTop) {
            container.scrollTop = trackTop - 20;
        }
    }

    // =========================================
    //  Render (loading skeleton)
    // =========================================

    function render(container) {
        _container = container;

        var wrapper = el('div', { className: 'album-detail' });

        // Back button skeleton
        var backRow = el('div', { className: 'album-detail-back' });
        backRow.appendChild(el('div', { className: 'skeleton', style: {
            width: '80px', height: '28px', borderRadius: '8px', marginBottom: '12px'
        }}));
        wrapper.appendChild(backRow);

        // Body
        var body = el('div', { className: 'album-detail-body' });

        // Left panel skeleton
        var left = el('div', { className: 'album-detail-left' });
        left.appendChild(el('div', { className: 'skeleton', style: {
            width: '180px', height: '180px', borderRadius: '10px', marginBottom: '20px'
        }}));
        left.appendChild(el('div', { className: 'skeleton', style: {
            width: '180px', height: '26px', borderRadius: '6px', marginBottom: '8px'
        }}));
        left.appendChild(el('div', { className: 'skeleton', style: {
            width: '140px', height: '18px', borderRadius: '6px', marginBottom: '8px'
        }}));
        left.appendChild(el('div', { className: 'skeleton', style: {
            width: '180px', height: '14px', borderRadius: '6px', marginBottom: '24px'
        }}));
        body.appendChild(left);

        // Right panel skeleton
        var right = el('div', { className: 'album-detail-right' });
        right.appendChild(el('div', { className: 'skeleton', style: {
            width: '120px', height: '14px', borderRadius: '6px', marginBottom: '16px'
        }}));
        for (var i = 0; i < 8; i++) {
            right.appendChild(el('div', { className: 'skeleton', style: {
                width: '100%', height: '48px', borderRadius: '8px', marginBottom: '4px'
            }}));
        }
        body.appendChild(right);

        wrapper.appendChild(body);
        container.appendChild(wrapper);
        log('Album', 'Album detail rendered (loading)');
    }

    // =========================================
    //  Activate (fetch data)
    // =========================================

    function _onTrackChange() {
        if (!_active || !_albumData) return;
        var api = App.getApi();
        if (api) {
            _renderAlbum(_albumData, api);
            _registerFocusZones();
        }
    }

    function activate(params) {
        _active = true;
        _albumId = params && params.id;

        // Add album-active class to content area to prevent outer scroll
        var contentArea = document.getElementById('content-area');
        if (contentArea) contentArea.classList.add('album-active');

        if (!_albumId) {
            log('Album', 'No album ID provided');
            _renderError('No album specified.');
            return;
        }

        var api = App.getApi();
        if (!api) {
            _renderError('Not connected to server.');
            return;
        }

        // Listen for track changes to update playing indicator
        Player.on('trackchange', _onTrackChange);

        api.getAlbum(_albumId).then(function(album) {
            if (!album) {
                _renderError('Album not found.');
                return;
            }
            _albumData = album;
            _renderAlbum(album, api);
            _registerFocusZones();
            log('Album', 'Album loaded: ' + (album.name || album.title) +
                ' (' + ((album.song && album.song.length) || 0) + ' tracks)');
        }).catch(function(err) {
            log('Album', 'Error loading album: ' + err.message);
            _renderError('Unable to load album.');
        });
    }

    // =========================================
    //  Render Album Detail (Split-Pane)
    // =========================================

    function _renderAlbum(album, api) {
        if (!_container) return;
        _container.textContent = '';

        var wrapper = el('div', { className: 'album-detail' });

        // --- BACK ROW (above split pane, does NOT scroll) ---
        var backRow = el('div', { className: 'album-detail-back' });
        var backBtn = el('button', { className: 'album-back-btn focusable' });
        backBtn.appendChild(document.createTextNode('\u2190 Back'));
        backBtn.addEventListener('click', function() {
            App.goBack();
        });
        backRow.appendChild(backBtn);
        wrapper.appendChild(backRow);

        // --- BODY (split pane) ---
        var body = el('div', { className: 'album-detail-body' });

        // --- LEFT PANEL (fixed, no scroll) ---
        var leftPanel = el('div', { className: 'album-detail-left' });

        // Album art (180px)
        var artWrap = el('div', { className: 'album-detail-art' });
        artWrap.appendChild(SonanceComponents.renderAlbumArt(album, 180, api));
        leftPanel.appendChild(artWrap);

        // Title + star (star is focusable)
        var titleRow = el('div', { className: 'album-detail-title-row' });
        titleRow.appendChild(el('div', { className: 'album-detail-title' },
            album.name || album.title || 'Unknown Album'));

        var albumStarBtn = el('button', {
            className: 'album-star-btn focusable',
            'data-star-size': '20',
            'aria-label': 'Toggle favourite'
        });
        var albumStarred = StarredCache.isAlbumStarred(album.id);
        _refreshStar(albumStarBtn, albumStarred);
        albumStarBtn.addEventListener('click', function() {
            var api = App.getApi();
            if (!api) return;
            var nowStarred = StarredCache.toggleAlbum(album.id, api);
            _refreshStar(albumStarBtn, nowStarred);
            App.showToast(nowStarred ? 'Added to favourites' : 'Removed from favourites');
        });
        titleRow.appendChild(albumStarBtn);
        leftPanel.appendChild(titleRow);

        // Artist (focusable when artistId is known — navigates to artist detail)
        var artistId = album.artistId || null;
        var artistEl;
        if (artistId) {
            artistEl = el('button', {
                className: 'album-detail-artist focusable',
                'data-artist-id': artistId
            }, album.artist || 'Unknown Artist');
            artistEl.addEventListener('click', function() {
                App.navigateTo('artist', { id: artistId });
            });
        } else {
            artistEl = el('div', { className: 'album-detail-artist' },
                album.artist || 'Unknown Artist');
        }
        leftPanel.appendChild(artistEl);

        // Metadata: year · track count · genre
        var metaParts = [];
        if (album.year) metaParts.push(String(album.year));
        var songCount = (album.song && album.song.length) || album.songCount || 0;
        metaParts.push(songCount + ' track' + (songCount !== 1 ? 's' : ''));
        if (album.genre) metaParts.push(album.genre);
        leftPanel.appendChild(el('div', { className: 'album-detail-meta' },
            metaParts.join(' \u00B7 ')));

        // Play button
        var playBtn = el('button', { className: 'album-play-btn focusable' });
        var playIcon = createSvg(SVG_PATHS.play);
        playIcon.style.width = '16px';
        playIcon.style.height = '16px';
        playIcon.style.fill = 'white';
        playIcon.style.flexShrink = '0';
        playBtn.appendChild(playIcon);
        playBtn.appendChild(document.createTextNode(' Play'));
        playBtn.addEventListener('click', function() {
            var tracks = album.song || [];
            if (tracks.length > 0) {
                Player.setQueue(tracks, 0);
                log('Album', 'Play: queued ' + tracks.length + ' tracks');
            }
        });
        leftPanel.appendChild(playBtn);

        // Shuffle button
        var shuffleBtn = el('button', { className: 'album-shuffle-btn focusable' });
        var shuffleIcon = createSvg(SVG_PATHS.shuffle);
        shuffleIcon.style.width = '16px';
        shuffleIcon.style.height = '16px';
        shuffleIcon.style.fill = 'currentColor';
        shuffleIcon.style.flexShrink = '0';
        shuffleBtn.appendChild(shuffleIcon);
        shuffleBtn.appendChild(document.createTextNode(' Shuffle'));
        shuffleBtn.addEventListener('click', function() {
            var tracks = album.song || [];
            if (tracks.length > 0) {
                Player.shuffleQueue(tracks);
                log('Album', 'Shuffle: queued ' + tracks.length + ' tracks (shuffled)');
            }
        });
        leftPanel.appendChild(shuffleBtn);

        body.appendChild(leftPanel);

        // --- RIGHT PANEL (scrollable tracklist) ---
        var rightPanel = el('div', { className: 'album-detail-right' });

        // TRACKLIST label
        rightPanel.appendChild(el('div', { className: 'album-tracklist-label' }, 'TRACKLIST'));

        // Total duration + track count summary
        var songs = album.song || [];
        var totalSeconds = 0;
        songs.forEach(function(s) { totalSeconds += (s.duration || 0); });
        if (totalSeconds > 0) {
            var totalMins = Math.floor(totalSeconds / 60);
            var durationText = songs.length + ' tracks \u00B7 ' + totalMins + ' min';
            rightPanel.appendChild(el('div', { className: 'album-tracklist-duration' }, durationText));
        }

        // Track list
        var trackList = el('div', { className: 'album-tracklist', id: 'album-tracklist' });
        var currentTrack = Player.getState().currentTrack;

        songs.forEach(function(song, index) {
            var isPlaying = currentTrack && currentTrack.id === song.id;

            var row = el('div', {
                className: 'track-row focusable' + (isPlaying ? ' track-playing' : ''),
                'data-track-index': String(index),
                'data-song-id': song.id
            });

            // Track number or equaliser bars
            if (isPlaying) {
                var eqWrap = el('div', { className: 'track-row-eq' });
                for (var b = 0; b < 4; b++) {
                    eqWrap.appendChild(el('div', { className: 'eq-bar' }));
                }
                row.appendChild(eqWrap);
            } else {
                row.appendChild(el('div', { className: 'track-row-number' },
                    String(song.track || (index + 1))));
            }

            // Title
            row.appendChild(el('div', {
                className: 'track-row-title' + (isPlaying ? ' track-title-playing' : '')
            }, song.title || 'Unknown'));

            // Track star (visual only — toggled via Green button)
            var trackStar = el('div', {
                className: 'track-row-star',
                'data-star-size': '14',
                'data-song-id': song.id
            });
            _refreshStar(trackStar, StarredCache.isSongStarred(song.id));
            row.appendChild(trackStar);

            // Duration
            row.appendChild(el('div', { className: 'track-row-duration' },
                formatDuration(song.duration)));

            // Click: play from this track
            row.addEventListener('click', function() {
                Player.setQueue(songs, index);
                log('Album', 'Play track ' + (index + 1) + ': ' + song.title);
                // Re-render to update equaliser bars
                _renderAlbum(album, api);
                _registerFocusZones();
                // Focus the clicked track
                FocusManager.setActiveZone('album-tracks', index);
            });

            trackList.appendChild(row);
        });

        rightPanel.appendChild(trackList);
        body.appendChild(rightPanel);
        wrapper.appendChild(body);

        _container.appendChild(wrapper);
    }

    // =========================================
    //  Focus Zones
    // =========================================

    function _registerFocusZones() {
        var trackElements = document.querySelectorAll('#album-tracklist .focusable');
        var hasTracks = trackElements.length > 0;

        // Left panel: back, play, shuffle (vertical list)
        // Back is in .album-detail-back, play/shuffle are in .album-detail-left
        FocusManager.registerZone('content', {
            selector: '.album-detail-back .focusable, .album-detail-left .focusable',
            columns: 1,
            onActivate: function(idx, element) { element.click(); },
            onColourButton: function(colour, idx, element) {
                // Only play/shuffle buttons trigger album-level queue actions
                if (!element) return;
                var isPlayBtn = element.classList.contains('album-play-btn');
                var isShuffleBtn = element.classList.contains('album-shuffle-btn');
                if ((isPlayBtn || isShuffleBtn) && _albumData && _albumData.song) {
                    var tracks = _albumData.song;
                    if (tracks.length === 0) return;
                    if (colour === 'yellow') {
                        tracks.forEach(function(t) { Player.addToQueue(t); });
                        App.showToast('Album added to queue');
                    } else if (colour === 'blue') {
                        for (var i = tracks.length - 1; i >= 0; i--) {
                            Player.addToQueueNext(tracks[i]);
                        }
                        App.showToast('Album playing next');
                    }
                }
            },
            neighbors: {
                left: 'sidebar',
                right: hasTracks ? 'album-tracks' : null,
                down: hasTracks ? 'album-tracks' : 'nowplaying-bar'
            }
        });

        // Track list with scroll-into-view
        if (hasTracks) {
            FocusManager.registerZone('album-tracks', {
                selector: '#album-tracklist .focusable',
                columns: 1,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) {
                    // Scroll focused track into view within the right panel
                    var container = document.querySelector('.album-detail-right');
                    _scrollToFocused(container, element);
                },
                onColourButton: function(colour, idx) {
                    if (!_albumData || !_albumData.song) return;
                    var track = _albumData.song[idx];
                    if (!track) return;
                    if (colour === 'yellow') {
                        Player.addToQueue(track);
                        App.showToast('Added to queue');
                    } else if (colour === 'blue') {
                        Player.addToQueueNext(track);
                        App.showToast('Playing next');
                    } else if (colour === 'green') {
                        var api = App.getApi();
                        if (!api) return;
                        var nowStarred = StarredCache.toggleSong(track.id, api);
                        // Update the star icon inline without a full re-render
                        var rowEl = document.querySelector(
                            '#album-tracklist .track-row[data-song-id="' + track.id + '"] .track-row-star');
                        _refreshStar(rowEl, nowStarred);
                        App.showToast(nowStarred ? 'Added to favourites' : 'Removed from favourites');
                    }
                },
                neighbors: {
                    left: 'content',
                    up: 'content',
                    down: 'nowplaying-bar'
                }
            });
        }

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
                up: hasTracks ? 'album-tracks' : 'content',
                left: 'sidebar'
            }
        });

        // Show colour button hints
        App.showColourHints([
            { colour: 'green', label: '★ Favourite' },
            { colour: 'yellow', label: 'Add to queue' },
            { colour: 'blue', label: 'Play next' }
        ]);

        // Set initial focus to back button
        FocusManager.setActiveZone('content', 0);
    }

    // =========================================
    //  Error State
    // =========================================

    function _renderError(message) {
        if (!_container) return;
        _container.textContent = '';
        var wrapper = el('div', { className: 'album-detail' });

        // Back button row
        var backRow = el('div', { className: 'album-detail-back' });
        var backBtn = el('button', { className: 'album-back-btn focusable' });
        backBtn.appendChild(document.createTextNode('\u2190 Back'));
        backBtn.addEventListener('click', function() { App.goBack(); });
        backRow.appendChild(backBtn);
        wrapper.appendChild(backRow);

        // Error message
        var errorDiv = el('div', { className: 'album-detail-error' });
        errorDiv.appendChild(el('div', { className: 'home-empty' }, message || 'Unable to load album.'));
        wrapper.appendChild(errorDiv);

        _container.appendChild(wrapper);

        FocusManager.registerZone('content', {
            selector: '.album-detail-back .focusable',
            columns: 1,
            onActivate: function(idx, element) { element.click(); },
            neighbors: { left: 'sidebar', down: 'nowplaying-bar' }
        });
        FocusManager.setActiveZone('content', 0);
    }

    // =========================================
    //  Deactivate
    // =========================================

    function deactivate() {
        _active = false;
        Player.off('trackchange', _onTrackChange);

        // Remove album-active class from content area
        var contentArea = document.getElementById('content-area');
        if (contentArea) contentArea.classList.remove('album-active');

        _container = null;
        _albumData = null;
        _albumId = null;
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate
    };
})();
