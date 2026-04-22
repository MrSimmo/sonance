/* ============================================
   Sonance — Artist Detail Screen
   Split-pane: fixed left (photo/name/buttons)
                scrollable right (discography,
                biography, similar artists)
   ============================================ */

var ArtistScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var log = SonanceUtils.log;
    var createSvg = SonanceUtils.createSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;

    var MAX_PLAY_ALL_ALBUMS = 10;

    var _container = null;
    var _artistId = null;
    var _artistData = null;
    var _artistInfo = null;
    var _active = false;
    var _loadingPlayAll = false;

    // =========================================
    //  Manual scroll-into-view (Chromium 63 safe)
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

    // =========================================
    //  Render (loading skeleton)
    // =========================================

    function render(container) {
        _container = container;

        var wrapper = el('div', { className: 'artist-detail' });

        // Back row skeleton
        var backRow = el('div', { className: 'artist-detail-back' });
        backRow.appendChild(el('div', { className: 'skeleton', style: {
            width: '80px', height: '28px', borderRadius: '8px', marginBottom: '12px'
        }}));
        wrapper.appendChild(backRow);

        // Body
        var body = el('div', { className: 'artist-detail-body' });

        // Left skeleton
        var left = el('div', { className: 'artist-detail-left' });
        left.appendChild(el('div', { className: 'skeleton', style: {
            width: '200px', height: '200px', borderRadius: '50%', marginBottom: '20px'
        }}));
        left.appendChild(el('div', { className: 'skeleton', style: {
            width: '180px', height: '26px', borderRadius: '6px', marginBottom: '8px'
        }}));
        left.appendChild(el('div', { className: 'skeleton', style: {
            width: '120px', height: '16px', borderRadius: '6px', marginBottom: '24px'
        }}));
        body.appendChild(left);

        // Right skeleton
        var right = el('div', { className: 'artist-detail-right' });
        right.appendChild(el('div', { className: 'skeleton', style: {
            width: '120px', height: '14px', borderRadius: '6px', marginBottom: '16px'
        }}));
        for (var i = 0; i < 6; i++) {
            right.appendChild(el('div', { className: 'skeleton', style: {
                width: '100%', height: '80px', borderRadius: '8px', marginBottom: '12px'
            }}));
        }
        body.appendChild(right);

        wrapper.appendChild(body);
        container.appendChild(wrapper);
        log('Artist', 'Artist detail rendered (loading)');
    }

    // =========================================
    //  Activate
    // =========================================

    function activate(params) {
        _active = true;
        _artistId = params && params.id;

        var contentArea = document.getElementById('content-area');
        if (contentArea) contentArea.classList.add('album-active');

        if (!_artistId) {
            log('Artist', 'No artist ID provided');
            _renderError('No artist specified.');
            return;
        }

        var api = App.getApi();
        if (!api) {
            _renderError('Not connected to server.');
            return;
        }

        Promise.all([
            api.getArtist(_artistId),
            api.getArtistInfo2(_artistId).catch(function(err) {
                log('Artist', 'getArtistInfo2 failed: ' + err.message);
                return null;
            })
        ]).then(function(results) {
            if (!_active) return;
            var artist = results[0];
            var info = results[1];
            if (!artist) {
                _renderError('Artist not found.');
                return;
            }
            _artistData = artist;
            _artistInfo = info;
            _renderArtist(artist, info, api);
            _registerFocusZones();
            log('Artist', 'Artist loaded: ' + (artist.name || 'Unknown') +
                ' (' + ((artist.album && artist.album.length) || 0) + ' albums)');
        }).catch(function(err) {
            log('Artist', 'Error loading artist: ' + err.message);
            _renderError('Unable to load artist.');
        });
    }

    // =========================================
    //  Render Artist Detail
    // =========================================

    function _renderArtist(artist, info, api) {
        if (!_container) return;
        _container.textContent = '';

        var wrapper = el('div', { className: 'artist-detail' });

        // --- BACK ROW ---
        var backRow = el('div', { className: 'artist-detail-back' });
        var backBtn = el('button', { className: 'artist-back-btn focusable' });
        backBtn.appendChild(document.createTextNode('← Back'));
        backBtn.addEventListener('click', function() { App.goBack(); });
        backRow.appendChild(backBtn);
        wrapper.appendChild(backRow);

        // --- BODY ---
        var body = el('div', { className: 'artist-detail-body' });

        // --- LEFT PANEL ---
        var leftPanel = el('div', { className: 'artist-detail-left' });

        // Artist photo (200px circle)
        leftPanel.appendChild(_renderArtistPhoto(artist, info, api));

        // Name
        leftPanel.appendChild(el('div', { className: 'artist-detail-name' },
            artist.name || 'Unknown Artist'));

        // Album count
        var albumCount = (artist.album && artist.album.length) || artist.albumCount || 0;
        leftPanel.appendChild(el('div', { className: 'artist-detail-count' },
            albumCount + ' album' + (albumCount !== 1 ? 's' : '')));

        // Play All
        var playBtn = el('button', {
            className: 'artist-play-btn focusable',
            id: 'artist-play-all-btn'
        });
        var playIcon = createSvg(SVG_PATHS.play);
        playIcon.style.width = '16px';
        playIcon.style.height = '16px';
        playIcon.style.fill = 'white';
        playIcon.style.flexShrink = '0';
        playBtn.appendChild(playIcon);
        playBtn.appendChild(document.createTextNode(' Play All'));
        playBtn.addEventListener('click', function() {
            _playAllAlbums(artist, api, false);
        });
        leftPanel.appendChild(playBtn);

        // Shuffle All
        var shuffleBtn = el('button', {
            className: 'artist-shuffle-btn focusable',
            id: 'artist-shuffle-all-btn'
        });
        var shuffleIcon = createSvg(SVG_PATHS.shuffle);
        shuffleIcon.style.width = '16px';
        shuffleIcon.style.height = '16px';
        shuffleIcon.style.fill = 'currentColor';
        shuffleIcon.style.flexShrink = '0';
        shuffleBtn.appendChild(shuffleIcon);
        shuffleBtn.appendChild(document.createTextNode(' Shuffle All'));
        shuffleBtn.addEventListener('click', function() {
            _playAllAlbums(artist, api, true);
        });
        leftPanel.appendChild(shuffleBtn);

        body.appendChild(leftPanel);

        // --- RIGHT PANEL ---
        var rightPanel = el('div', { className: 'artist-detail-right' });

        // Discography
        rightPanel.appendChild(_renderDiscography(artist, api));

        // Biography (only if available)
        var bioSection = _renderBiography(info);
        if (bioSection) rightPanel.appendChild(bioSection);

        // Similar Artists (only if available)
        var similarSection = _renderSimilarArtists(info, api);
        if (similarSection) rightPanel.appendChild(similarSection);

        body.appendChild(rightPanel);
        wrapper.appendChild(body);

        _container.appendChild(wrapper);
    }

    // --- Artist photo (200px circle) ---
    function _renderArtistPhoto(artist, info, api) {
        var photo = el('div', { className: 'artist-detail-photo' });

        var imageUrl = null;
        if (info) {
            imageUrl = info.largeImageUrl || info.mediumImageUrl || info.smallImageUrl || null;
        }

        if (imageUrl) {
            var img = document.createElement('img');
            img.setAttribute('alt', (artist.name || 'Artist') + ' photo');
            img.setAttribute('loading', 'lazy');
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '50%';
            img.style.display = 'block';
            img.onerror = function() {
                if (img.parentNode) img.parentNode.removeChild(img);
                photo.appendChild(SonanceComponents.renderArtistAvatar(artist, 200, api));
            };
            img.src = imageUrl;
            photo.appendChild(img);
        } else {
            // Fallback to Subsonic cover-art avatar (same as Library artists tab)
            photo.appendChild(SonanceComponents.renderArtistAvatar(artist, 200, api));
        }

        return photo;
    }

    // --- Discography section ---
    function _renderDiscography(artist, api) {
        var section = el('div', { className: 'artist-section' });
        section.appendChild(el('div', { className: 'artist-section-label' }, 'DISCOGRAPHY'));

        var albums = (artist.album || []);

        if (albums.length === 0) {
            section.appendChild(el('div', { className: 'artist-section-empty' },
                'No albums available.'));
            return section;
        }

        var list = el('div', { className: 'artist-albums-list', id: 'artist-albums-list' });

        albums.forEach(function(album) {
            var row = el('div', {
                className: 'artist-album-row focusable',
                'data-album-id': album.id
            });

            // Album art (80px)
            var artWrap = el('div', { className: 'artist-album-art' });
            artWrap.appendChild(SonanceComponents.renderAlbumArt(album, 80, api));
            row.appendChild(artWrap);

            // Info
            var info = el('div', { className: 'artist-album-info' });
            info.appendChild(el('div', { className: 'artist-album-title' },
                album.name || album.title || 'Unknown Album'));

            var metaParts = [];
            if (album.year) metaParts.push(String(album.year));
            var songCount = album.songCount || 0;
            if (songCount) metaParts.push(songCount + ' track' + (songCount !== 1 ? 's' : ''));
            info.appendChild(el('div', { className: 'artist-album-meta' },
                metaParts.join(' · ')));

            row.appendChild(info);

            row.addEventListener('click', function() {
                App.navigateTo('album', { id: album.id, title: album.name || album.title });
            });

            list.appendChild(row);
        });

        section.appendChild(list);
        return section;
    }

    // --- Biography section ---
    function _renderBiography(info) {
        if (!info) return null;
        var bio = info.biography;
        if (!bio || typeof bio !== 'string') return null;
        // Strip any HTML tags the Subsonic server may include
        bio = bio.replace(/<[^>]*>/g, '').trim();
        if (!bio) return null;

        var section = el('div', { className: 'artist-section artist-section-bio' });
        section.appendChild(el('div', { className: 'artist-section-label' }, 'BIOGRAPHY'));

        var text = bio;
        if (text.length > 500) {
            text = text.slice(0, 500).replace(/\s+\S*$/, '') + '…';
        }
        section.appendChild(el('div', { className: 'artist-bio-text' }, text));
        return section;
    }

    // --- Similar Artists section ---
    function _renderSimilarArtists(info, api) {
        if (!info) return null;
        var similar = info.similarArtist || [];
        if (!similar.length) return null;

        var section = el('div', { className: 'artist-section artist-section-similar' });
        section.appendChild(el('div', { className: 'artist-section-label' }, 'SIMILAR ARTISTS'));

        var row = el('div', { className: 'artist-similar-row', id: 'artist-similar-row' });

        similar.forEach(function(sim) {
            // Some entries from Last.fm may have no id (unknown to the library) — skip those.
            if (!sim || !sim.id) return;

            var card = el('div', {
                className: 'artist-similar-card focusable',
                'data-artist-id': sim.id
            });

            var avatarWrap = el('div', { className: 'artist-similar-avatar' });
            avatarWrap.appendChild(SonanceComponents.renderArtistAvatar(sim, 80, api));
            card.appendChild(avatarWrap);

            card.appendChild(el('div', { className: 'artist-similar-name' },
                sim.name || 'Unknown'));

            card.addEventListener('click', function() {
                App.navigateTo('artist', { id: sim.id });
            });

            row.appendChild(card);
        });

        if (!row.childNodes.length) return null;

        section.appendChild(row);
        return section;
    }

    // =========================================
    //  Play All / Shuffle All
    // =========================================

    function _setPlayAllLoading(isLoading) {
        var playBtn = document.getElementById('artist-play-all-btn');
        var shuffleBtn = document.getElementById('artist-shuffle-all-btn');
        if (isLoading) {
            if (playBtn) { playBtn.textContent = 'Loading...'; playBtn.disabled = true; }
            if (shuffleBtn) { shuffleBtn.textContent = 'Loading...'; shuffleBtn.disabled = true; }
        } else {
            // Restore labels by re-rendering the left panel buttons in place
            if (playBtn) {
                playBtn.disabled = false;
                playBtn.textContent = '';
                var pi = createSvg(SVG_PATHS.play);
                pi.style.width = '16px'; pi.style.height = '16px';
                pi.style.fill = 'white'; pi.style.flexShrink = '0';
                playBtn.appendChild(pi);
                playBtn.appendChild(document.createTextNode(' Play All'));
            }
            if (shuffleBtn) {
                shuffleBtn.disabled = false;
                shuffleBtn.textContent = '';
                var si = createSvg(SVG_PATHS.shuffle);
                si.style.width = '16px'; si.style.height = '16px';
                si.style.fill = 'currentColor'; si.style.flexShrink = '0';
                shuffleBtn.appendChild(si);
                shuffleBtn.appendChild(document.createTextNode(' Shuffle All'));
            }
        }
    }

    function _playAllAlbums(artist, api, shuffle) {
        if (_loadingPlayAll) return;
        var albums = (artist.album || []);
        if (albums.length === 0) {
            App.showToast('No albums to play');
            return;
        }

        var totalAlbums = albums.length;
        var toFetch = albums.slice(0, MAX_PLAY_ALL_ALBUMS);
        if (totalAlbums > MAX_PLAY_ALL_ALBUMS) {
            App.showToast('Playing first ' + MAX_PLAY_ALL_ALBUMS + ' albums');
        }

        _loadingPlayAll = true;
        _setPlayAllLoading(true);

        var promises = toFetch.map(function(album) {
            return api.getAlbum(album.id).catch(function(err) {
                log('Artist', 'getAlbum failed for ' + album.id + ': ' + err.message);
                return null;
            });
        });

        Promise.all(promises).then(function(fullAlbums) {
            _loadingPlayAll = false;
            _setPlayAllLoading(false);

            var allTracks = [];
            fullAlbums.forEach(function(a) {
                if (a && a.song && a.song.length) {
                    for (var i = 0; i < a.song.length; i++) {
                        allTracks.push(a.song[i]);
                    }
                }
            });

            if (allTracks.length === 0) {
                App.showToast('No tracks available');
                return;
            }

            if (shuffle) {
                Player.shuffleQueue(allTracks);
                log('Artist', 'Shuffle All: queued ' + allTracks.length + ' tracks');
            } else {
                Player.playAlbum(allTracks, 0);
                log('Artist', 'Play All: queued ' + allTracks.length + ' tracks');
            }
        }).catch(function(err) {
            _loadingPlayAll = false;
            _setPlayAllLoading(false);
            log('Artist', 'Play All failed: ' + err.message);
            App.showToast('Unable to load tracks');
        });
    }

    // =========================================
    //  Focus Zones
    // =========================================

    function _registerFocusZones() {
        var albumElements = document.querySelectorAll('#artist-albums-list .focusable');
        var similarElements = document.querySelectorAll('#artist-similar-row .focusable');
        var hasAlbums = albumElements.length > 0;
        var hasSimilar = similarElements.length > 0;

        // Left panel: back, play all, shuffle all (vertical list)
        FocusManager.registerZone('content', {
            selector: '.artist-detail-back .focusable, .artist-detail-left .focusable',
            columns: 1,
            onActivate: function(idx, element) { element.click(); },
            neighbors: {
                left: 'sidebar',
                right: hasAlbums ? 'artist-albums' : (hasSimilar ? 'artist-similar' : null),
                down: hasAlbums ? 'artist-albums' : (hasSimilar ? 'artist-similar' : 'nowplaying-bar')
            }
        });

        // Discography (vertical list)
        if (hasAlbums) {
            FocusManager.registerZone('artist-albums', {
                selector: '#artist-albums-list .focusable',
                columns: 1,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) {
                    var container = document.querySelector('.artist-detail-right');
                    _scrollToFocused(container, element);
                },
                neighbors: {
                    left: 'content',
                    up: 'content',
                    down: hasSimilar ? 'artist-similar' : 'nowplaying-bar'
                }
            });
        }

        // Similar Artists (horizontal row)
        if (hasSimilar) {
            FocusManager.registerZone('artist-similar', {
                selector: '#artist-similar-row .focusable',
                columns: similarElements.length,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) {
                    var container = document.querySelector('.artist-detail-right');
                    _scrollToFocused(container, element);
                },
                neighbors: {
                    left: hasAlbums ? null : 'content',
                    up: hasAlbums ? 'artist-albums' : 'content',
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
                up: hasSimilar ? 'artist-similar' : (hasAlbums ? 'artist-albums' : 'content'),
                left: 'sidebar'
            }
        });

        App.hideColourHints();

        // Initial focus: back button
        FocusManager.setActiveZone('content', 0);
    }

    // =========================================
    //  Error State
    // =========================================

    function _renderError(message) {
        if (!_container) return;
        _container.textContent = '';
        var wrapper = el('div', { className: 'artist-detail' });

        var backRow = el('div', { className: 'artist-detail-back' });
        var backBtn = el('button', { className: 'artist-back-btn focusable' });
        backBtn.appendChild(document.createTextNode('← Back'));
        backBtn.addEventListener('click', function() { App.goBack(); });
        backRow.appendChild(backBtn);
        wrapper.appendChild(backRow);

        var errorDiv = el('div', { className: 'artist-detail-error' });
        errorDiv.appendChild(el('div', { className: 'home-empty' }, message || 'Unable to load artist.'));
        wrapper.appendChild(errorDiv);

        _container.appendChild(wrapper);

        FocusManager.registerZone('content', {
            selector: '.artist-detail-back .focusable',
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

        var contentArea = document.getElementById('content-area');
        if (contentArea) contentArea.classList.remove('album-active');

        _container = null;
        _artistId = null;
        _artistData = null;
        _artistInfo = null;
        _loadingPlayAll = false;
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate
    };
})();
