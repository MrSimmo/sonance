/* ============================================
   Sonance — Now Playing Screen
   Full-screen player with album art, progress,
   transport controls, volume, and synced lyrics (P14b).
   ============================================ */

var NowPlayingScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var log = SonanceUtils.log;
    var warn = SonanceUtils.warn;
    var createSvg = SonanceUtils.createSvg;
    var createStarSvg = SonanceUtils.createStarSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;
    var formatDuration = SonanceUtils.formatDuration;
    var parseLyricsResponse = SonanceUtils.parseLyricsResponse;

    var _container = null;
    var _active = false;

    // DOM references for live updates
    var _artImg = null;
    var _titleEl = null;
    var _subtitleEl = null;
    var _progressFill = null;
    var _progressScrubber = null;
    var _timeCurrent = null;
    var _timeTotal = null;
    var _playBtn = null;
    var _shuffleBtn = null;
    var _repeatBtn = null;
    var _starBtn = null;
    var _lyricsBtn = null;
    var _bgEl = null;
    var _progressBar = null;

    // Layout + lyrics
    var _layoutEl = null;
    var _lyricsPanel = null;
    var _lyricsWrapper = null;
    var _lyricsLinesEl = null;

    // Lyrics state
    var _lyricsCache = {};        // songId → parsed lyrics | null
    var _pendingFetches = {};     // songId → true while a request is in flight
    var _currentLyrics = null;    // parsed structured lyrics for current track (or null)
    var _lyricsVisible = false;

    // Remove all children of a node (safer than innerHTML = '')
    function _clearNode(node) {
        if (!node) return;
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    // =========================================
    //  LyricsScroller
    // =========================================

    var LyricsScroller = {
        _wrapper: null,
        _container: null,
        _lines: [],
        _lineElements: [],
        _activeIndex: -1,
        _synced: false,
        _currentOffset: 0,

        init: function(wrapper, container, lyricsData) {
            this._wrapper = wrapper;
            this._container = container;
            this._lines = (lyricsData && lyricsData.line) ? lyricsData.line : [];
            this._synced = !!(lyricsData && lyricsData.synced);
            this._activeIndex = -1;
            this._currentOffset = 0;
            this._render();
        },

        _render: function() {
            _clearNode(this._container);
            this._lineElements = [];
            if (!this._lines.length) {
                var empty = document.createElement('div');
                empty.className = 'np-lyrics-empty';
                empty.textContent = 'No lyrics available';
                this._container.appendChild(empty);
                return;
            }
            var frag = document.createDocumentFragment();
            var initialClass = this._synced ? 'lyrics-line lyrics-upcoming' : 'lyrics-line';
            for (var i = 0; i < this._lines.length; i++) {
                var line = this._lines[i];
                var lineEl = document.createElement('div');
                lineEl.className = initialClass;
                lineEl.textContent = (line && line.value) ? line.value : '';
                frag.appendChild(lineEl);
                this._lineElements.push(lineEl);
            }
            this._container.appendChild(frag);
            this._container.style.transition = 'none';
            this._container.style.transform = 'translateY(0)';
        },

        update: function(currentTimeMs) {
            if (!this._synced || !this._lines.length) return;

            var newIndex = -1;
            for (var i = this._lines.length - 1; i >= 0; i--) {
                var start = this._lines[i].start;
                if (typeof start === 'number' && start <= currentTimeMs) {
                    newIndex = i;
                    break;
                }
            }

            if (newIndex === this._activeIndex) return;
            this._activeIndex = newIndex;

            for (var j = 0; j < this._lineElements.length; j++) {
                var el2 = this._lineElements[j];
                if (j === newIndex) {
                    el2.className = 'lyrics-line lyrics-active';
                } else if (j < newIndex) {
                    el2.className = 'lyrics-line lyrics-past';
                } else {
                    el2.className = 'lyrics-line lyrics-upcoming';
                }
            }

            this._scrollToActive();
        },

        _scrollToActive: function() {
            if (this._activeIndex < 0) return;
            var lineEl = this._lineElements[this._activeIndex];
            if (!lineEl || !this._wrapper) return;
            var lineTop = lineEl.offsetTop;
            var lineH = lineEl.offsetHeight;
            var wrapperH = this._wrapper.clientHeight;
            var targetScroll = lineTop - (wrapperH * 0.33) + (lineH / 2);
            targetScroll = Math.max(0, targetScroll);
            this._currentOffset = targetScroll;
            this._container.style.transition = 'transform 0.3s ease';
            this._container.style.transform = 'translateY(' + (-targetScroll) + 'px)';
        },

        jumpTo: function(currentTimeMs) {
            if (!this._container) return;
            this._container.style.transition = 'none';
            this._activeIndex = -1;
            this.update(currentTimeMs);
            var self = this;
            setTimeout(function() {
                if (self._container) {
                    self._container.style.transition = 'transform 0.3s ease';
                }
            }, 50);
        },

        scrollBy: function(deltaPx) {
            if (!this._container) return;
            var current = this._currentOffset || 0;
            current += deltaPx;
            var contentH = this._container.scrollHeight || 0;
            var wrapperH = this._wrapper ? this._wrapper.clientHeight : 0;
            var maxScroll = Math.max(0, contentH - wrapperH);
            if (current < 0) current = 0;
            if (current > maxScroll) current = maxScroll;
            this._currentOffset = current;
            this._container.style.transition = 'transform 0.3s ease';
            this._container.style.transform = 'translateY(' + (-current) + 'px)';
        },

        reset: function() {
            this._activeIndex = -1;
            this._currentOffset = 0;
            if (this._container) {
                this._container.style.transition = 'none';
                this._container.style.transform = 'translateY(0)';
            }
            for (var k = 0; k < this._lineElements.length; k++) {
                var classBase = this._synced ? 'lyrics-line lyrics-upcoming' : 'lyrics-line';
                this._lineElements[k].className = classBase;
            }
        },

        destroy: function() {
            _clearNode(this._container);
            this._wrapper = null;
            this._container = null;
            this._lineElements = [];
            this._lines = [];
            this._activeIndex = -1;
            this._currentOffset = 0;
            this._synced = false;
        }
    };

    // =========================================
    //  Render
    // =========================================

    function render(container) {
        _container = container;

        var wrapper = el('div', { className: 'np-screen' });

        // Blurred album art background (P5.3)
        _bgEl = el('div', { className: 'np-bg-image' });
        wrapper.appendChild(_bgEl);

        // Dark overlay for text readability
        wrapper.appendChild(el('div', { className: 'np-bg-overlay' }));

        // Two-column layout (P14b): .np-left + .np-lyrics-panel
        _layoutEl = el('div', { className: 'np-layout' });

        var left = el('div', { className: 'np-left' });

        // Album art (280px)
        var artWrap = el('div', { className: 'np-screen-art' });
        _artImg = el('div', { className: 'np-screen-art-inner' });
        artWrap.appendChild(_artImg);
        left.appendChild(artWrap);

        // Track title
        _titleEl = el('div', { className: 'np-screen-title' }, 'No track playing');
        left.appendChild(_titleEl);

        // Artist — Album
        _subtitleEl = el('div', { className: 'np-screen-subtitle' }, 'Select a song to begin');
        left.appendChild(_subtitleEl);

        // Progress bar
        var progressWrap = el('div', { className: 'np-screen-progress-wrap' });

        _progressBar = el('div', { className: 'np-screen-progress focusable', id: 'np-progress-bar' });
        var progressTrack = el('div', { className: 'np-screen-progress-track' });
        _progressFill = el('div', { className: 'np-screen-progress-fill' });
        _progressScrubber = el('div', { className: 'np-screen-progress-scrubber' });
        progressTrack.appendChild(_progressFill);
        progressTrack.appendChild(_progressScrubber);
        _progressBar.appendChild(progressTrack);

        _progressBar.addEventListener('click', function(e) {
            var rect = _progressBar.getBoundingClientRect();
            var pct = ((e.clientX - rect.left) / rect.width) * 100;
            pct = Math.max(0, Math.min(100, pct));
            Player.seekPercent(pct);
        });

        progressWrap.appendChild(_progressBar);

        var timeRow = el('div', { className: 'np-screen-time-row' });
        _timeCurrent = el('div', { className: 'np-screen-time' }, '0:00');
        _timeTotal = el('div', { className: 'np-screen-time' }, '0:00');
        timeRow.appendChild(_timeCurrent);
        timeRow.appendChild(_timeTotal);
        progressWrap.appendChild(timeRow);

        left.appendChild(progressWrap);

        // Transport controls
        var controls = el('div', { className: 'np-screen-controls' });

        _shuffleBtn = el('button', { className: 'np-ctrl-btn np-ctrl-toggle focusable', id: 'np-shuffle' });
        var shuffleSvg = createSvg(SVG_PATHS.shuffle);
        shuffleSvg.style.width = '22px';
        shuffleSvg.style.height = '22px';
        shuffleSvg.style.fill = 'currentColor';
        _shuffleBtn.appendChild(shuffleSvg);
        _shuffleBtn.addEventListener('click', function() { Player.toggleShuffle(); });
        controls.appendChild(_shuffleBtn);

        var prevBtn = el('button', { className: 'np-ctrl-btn focusable', id: 'np-prev' });
        var prevSvg = createSvg(SVG_PATHS.skipPrev);
        prevSvg.style.width = '28px';
        prevSvg.style.height = '28px';
        prevSvg.style.fill = 'currentColor';
        prevBtn.appendChild(prevSvg);
        prevBtn.addEventListener('click', function() { Player.previous(); });
        controls.appendChild(prevBtn);

        _playBtn = el('button', { className: 'np-ctrl-play focusable', id: 'np-play' });
        var playIcon = createSvg(SVG_PATHS.play);
        playIcon.style.width = '22px';
        playIcon.style.height = '22px';
        _playBtn.appendChild(playIcon);
        _playBtn.addEventListener('click', function() { Player.togglePlayPause(); });
        controls.appendChild(_playBtn);

        var nextBtn = el('button', { className: 'np-ctrl-btn focusable', id: 'np-next' });
        var nextSvg = createSvg(SVG_PATHS.skipNext);
        nextSvg.style.width = '28px';
        nextSvg.style.height = '28px';
        nextSvg.style.fill = 'currentColor';
        nextBtn.appendChild(nextSvg);
        nextBtn.addEventListener('click', function() { Player.next(); });
        controls.appendChild(nextBtn);

        _repeatBtn = el('button', { className: 'np-ctrl-btn np-ctrl-toggle focusable', id: 'np-repeat' });
        var repeatSvg = createSvg('M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z');
        repeatSvg.style.width = '22px';
        repeatSvg.style.height = '22px';
        repeatSvg.style.fill = 'currentColor';
        _repeatBtn.appendChild(repeatSvg);
        _repeatBtn.addEventListener('click', function() { Player.toggleRepeat(); });
        controls.appendChild(_repeatBtn);

        _starBtn = el('button', { className: 'np-ctrl-btn np-ctrl-star focusable', id: 'np-star' });
        _starBtn.addEventListener('click', function() {
            var track = Player.getState().currentTrack;
            var api = AuthManager.getApi();
            if (!track || !api) return;
            var nowStarred = StarredCache.toggleSong(track.id, api);
            _updateStar(nowStarred);
            App.showToast(nowStarred ? 'Added to favourites' : 'Removed from favourites');
        });
        controls.appendChild(_starBtn);

        // Lyrics button (P14b) — last in the row
        _lyricsBtn = el('button', {
            className: 'np-ctrl-btn np-ctrl-lyrics focusable is-unavailable',
            id: 'np-lyrics'
        });
        var lyricsSvg = createSvg('M3 5h14M3 9h10M3 13h12M3 17h8');
        lyricsSvg.style.width = '24px';
        lyricsSvg.style.height = '24px';
        var lyricsPath = lyricsSvg.querySelector('path');
        if (lyricsPath) {
            lyricsPath.setAttribute('stroke', 'currentColor');
            lyricsPath.setAttribute('stroke-width', '2');
            lyricsPath.setAttribute('stroke-linecap', 'round');
            lyricsPath.setAttribute('fill', 'none');
        }
        lyricsSvg.setAttribute('fill', 'none');
        _lyricsBtn.appendChild(lyricsSvg);
        _lyricsBtn.addEventListener('click', _toggleLyrics);
        controls.appendChild(_lyricsBtn);

        left.appendChild(controls);

        _layoutEl.appendChild(left);

        // Lyrics panel (P14b)
        _lyricsPanel = el('div', { className: 'np-lyrics-panel' });
        _lyricsWrapper = el('div', { className: 'np-lyrics-scroll-wrapper' });
        _lyricsLinesEl = el('div', { className: 'np-lyrics-lines' });
        _lyricsWrapper.appendChild(_lyricsLinesEl);
        _lyricsPanel.appendChild(_lyricsWrapper);
        _layoutEl.appendChild(_lyricsPanel);

        wrapper.appendChild(_layoutEl);
        container.appendChild(wrapper);
        log('NowPlaying', 'Now Playing screen rendered');
    }

    // =========================================
    //  Activate
    // =========================================

    function activate(params) {
        _active = true;

        var pState = Player.getState();
        if (pState.currentTrack) {
            _updateTrack(pState.currentTrack);
            _ensureLyricsForTrack(pState.currentTrack);
        }
        _updateProgress(pState.currentTime, pState.duration);
        _updatePlayIcon(pState.isPlaying);
        _updateShuffle(pState.shuffle);
        _updateRepeat(pState.repeat);
        _updateStar(pState.currentTrack && StarredCache.isSongStarred(pState.currentTrack.id));

        Player.on('trackchange', _onTrackChange);
        Player.on('progress', _onProgress);
        Player.on('play', _onPlay);
        Player.on('pause', _onPause);
        Player.on('shufflechange', _onShuffleChange);
        Player.on('repeatchange', _onRepeatChange);
        Player.on('seeked', _onSeeked);

        _registerFocusZones();
        FocusManager.setActiveZone('content', 2); // Focus play button
    }

    function _registerFocusZones() {
        var lyricsAvailable = !!(_currentLyrics && _currentLyrics.line && _currentLyrics.line.length);
        var cols = lyricsAvailable ? 7 : 6;

        FocusManager.registerZone('np-controls', {
            selector: '.np-screen-controls .focusable:not(.is-unavailable)',
            columns: cols,
            onActivate: function(idx, element) { element.click(); },
            neighbors: {
                up: 'np-progress',
                left: 'sidebar'
            }
        });

        FocusManager.registerZone('np-progress', {
            selector: '#np-progress-bar',
            columns: 1,
            onActivate: function() {},
            onFocus: function() {},
            onKey: function(direction) {
                if (direction === 'left' || direction === 'right') {
                    var delta = (direction === 'right') ? 10 : -10;
                    var pState = Player.getState();
                    Player.seekTo(Math.max(0, pState.currentTime + delta));
                    return true;
                }
                return false;
            },
            neighbors: {
                down: 'np-controls',
                left: 'sidebar',
                up: 'sidebar'
            }
        });

        FocusManager.registerZone('content', {
            selector: '.np-screen-controls .focusable:not(.is-unavailable)',
            columns: cols,
            onActivate: function(idx, element) { element.click(); },
            neighbors: {
                left: 'sidebar',
                up: 'np-progress'
            }
        });
    }

    // =========================================
    //  Event Handlers
    // =========================================

    function _onTrackChange(track) {
        if (!_active) return;
        _updateTrack(track);
        _updateStar(track && StarredCache.isSongStarred(track.id));
        _ensureLyricsForTrack(track);
    }

    function _onProgress(data) {
        if (!_active) return;
        _updateProgress(data.currentTime, data.duration);
        if (_lyricsVisible && _currentLyrics && _currentLyrics.synced) {
            LyricsScroller.update(data.currentTime * 1000);
        }
    }

    function _onSeeked(currentTime) {
        if (!_active) return;
        if (_lyricsVisible && _currentLyrics && _currentLyrics.synced) {
            LyricsScroller.jumpTo(currentTime * 1000);
        }
    }

    function _onPlay() {
        if (!_active) return;
        _updatePlayIcon(true);
    }

    function _onPause() {
        if (!_active) return;
        _updatePlayIcon(false);
    }

    function _onShuffleChange(val) {
        if (!_active) return;
        _updateShuffle(val);
    }

    function _onRepeatChange(val) {
        if (!_active) return;
        _updateRepeat(val);
    }

    // =========================================
    //  Lyrics
    // =========================================

    function _ensureLyricsForTrack(track) {
        if (!track || !track.id) {
            _currentLyrics = null;
            _updateLyricsUI();
            return;
        }
        var songId = track.id;

        if (_lyricsCache.hasOwnProperty(songId)) {
            _currentLyrics = _lyricsCache[songId];
            _updateLyricsUI();
            return;
        }

        if (_pendingFetches[songId]) {
            _currentLyrics = null;
            _updateLyricsUI();
            return;
        }

        _currentLyrics = null;
        _updateLyricsUI();

        var api = AuthManager.getApi();
        if (!api) return;
        _pendingFetches[songId] = true;
        api.getLyricsBySongId(songId).then(function(response) {
            delete _pendingFetches[songId];
            var parsed = parseLyricsResponse(response);
            _lyricsCache[songId] = parsed;
            var ps = Player.getState();
            if (ps.currentTrack && ps.currentTrack.id === songId) {
                _currentLyrics = parsed;
                _updateLyricsUI();
            }
        }).catch(function(err) {
            delete _pendingFetches[songId];
            _lyricsCache[songId] = null;
            warn('NowPlaying', 'Lyrics fetch failed for ' + songId + ': ' + err.message);
            var ps = Player.getState();
            if (ps.currentTrack && ps.currentTrack.id === songId) {
                _currentLyrics = null;
                _updateLyricsUI();
            }
        });
    }

    function _updateLyricsUI() {
        if (!_lyricsBtn) return;

        var available = !!(_currentLyrics && _currentLyrics.line && _currentLyrics.line.length);

        if (available) {
            _lyricsBtn.classList.remove('is-unavailable');
        } else {
            _lyricsBtn.classList.add('is-unavailable');
            if (_lyricsVisible) {
                _closeLyrics();
            }
        }

        if (_lyricsVisible && available) {
            LyricsScroller.init(_lyricsWrapper, _lyricsLinesEl, _currentLyrics);
            var ps = Player.getState();
            if (_currentLyrics.synced) {
                LyricsScroller.update((ps.currentTime || 0) * 1000);
            }
        }

        if (_active) _registerFocusZones();
    }

    function _toggleLyrics() {
        if (_lyricsVisible) {
            _closeLyrics();
        } else {
            _openLyrics();
        }
    }

    function _openLyrics() {
        if (!_currentLyrics || !_currentLyrics.line || !_currentLyrics.line.length) return;
        _lyricsVisible = true;
        _layoutEl.classList.add('lyrics-active');
        _lyricsBtn.classList.add('is-active');
        LyricsScroller.init(_lyricsWrapper, _lyricsLinesEl, _currentLyrics);
        var ps = Player.getState();
        if (_currentLyrics.synced) {
            setTimeout(function() {
                LyricsScroller.update((ps.currentTime || 0) * 1000);
            }, 50);
        }
    }

    function _closeLyrics() {
        _lyricsVisible = false;
        if (_layoutEl) _layoutEl.classList.remove('lyrics-active');
        if (_lyricsBtn) _lyricsBtn.classList.remove('is-active');
        LyricsScroller.reset();
    }

    // =========================================
    //  UI Update Functions
    // =========================================

    function _updateTrack(track) {
        if (!track) return;

        if (_titleEl) _titleEl.textContent = track.title || 'Unknown';
        if (_subtitleEl) {
            var parts = [];
            if (track.artist) parts.push(track.artist);
            if (track.album) parts.push(track.album);
            _subtitleEl.textContent = parts.join(' — ') || 'Unknown';
        }

        if (_artImg) {
            _clearNode(_artImg);
            var api = AuthManager.getApi();
            if (api && (track.coverArt || track.albumId)) {
                var img = document.createElement('img');
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '16px';
                img.onerror = function() {
                    if (img.parentNode) img.parentNode.removeChild(img);
                    var ph = SonanceComponents.renderAlbumArt(track, 280, null);
                    _artImg.appendChild(ph);
                };
                img.src = api.getCoverArtUrl(track.coverArt || track.albumId, 560);
                _artImg.appendChild(img);
            } else {
                var ph = SonanceComponents.renderAlbumArt(track, 280, null);
                _artImg.appendChild(ph);
            }
        }

        if (_bgEl) {
            var api2 = AuthManager.getApi();
            if (api2 && (track.coverArt || track.albumId)) {
                _bgEl.style.backgroundImage = 'url(' + api2.getCoverArtUrl(track.coverArt || track.albumId, 600) + ')';
            } else {
                var colors = SonanceComponents.hashColor(track.album || track.title || 'unknown');
                _bgEl.style.backgroundImage = 'none';
                _bgEl.style.background = 'radial-gradient(ellipse at center, ' +
                    colors.base + ' 0%, ' + colors.dark + ' 50%, var(--bg-primary) 100%)';
            }
        }
    }

    function _updateProgress(currentTime, duration) {
        var pct = (duration > 0) ? (currentTime / duration) * 100 : 0;

        if (_progressFill) _progressFill.style.width = pct + '%';
        if (_progressScrubber) _progressScrubber.style.left = pct + '%';
        if (_timeCurrent) _timeCurrent.textContent = formatDuration(currentTime);
        if (_timeTotal) _timeTotal.textContent = formatDuration(duration);
    }

    function _updatePlayIcon(isPlaying) {
        if (!_playBtn) return;
        _clearNode(_playBtn);
        var icon = createSvg(isPlaying ? SVG_PATHS.pause : SVG_PATHS.play);
        icon.style.width = '22px';
        icon.style.height = '22px';
        _playBtn.appendChild(icon);
    }

    function _updateShuffle(active) {
        if (!_shuffleBtn) return;
        if (active) {
            _shuffleBtn.classList.add('active');
        } else {
            _shuffleBtn.classList.remove('active');
        }
    }

    function _updateStar(starred) {
        if (!_starBtn) return;
        _clearNode(_starBtn);
        var icon = createStarSvg(!!starred);
        icon.style.width = '20px';
        icon.style.height = '20px';
        _starBtn.appendChild(icon);
        if (starred) {
            _starBtn.classList.add('is-starred');
        } else {
            _starBtn.classList.remove('is-starred');
        }
    }

    function _updateRepeat(mode) {
        if (!_repeatBtn) return;
        _clearNode(_repeatBtn);

        var svgPath = 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z';
        var repeatSvg = createSvg(svgPath);
        repeatSvg.style.width = '22px';
        repeatSvg.style.height = '22px';
        repeatSvg.style.fill = 'currentColor';
        _repeatBtn.appendChild(repeatSvg);

        if (mode === 'none') {
            _repeatBtn.classList.remove('active');
        } else {
            _repeatBtn.classList.add('active');
        }

        if (mode === 'one') {
            var badge = el('span', { className: 'np-repeat-badge' }, '1');
            _repeatBtn.appendChild(badge);
        }
    }

    // =========================================
    //  Deactivate
    // =========================================

    function deactivate() {
        _active = false;

        Player.off('trackchange', _onTrackChange);
        Player.off('progress', _onProgress);
        Player.off('play', _onPlay);
        Player.off('pause', _onPause);
        Player.off('shufflechange', _onShuffleChange);
        Player.off('repeatchange', _onRepeatChange);
        Player.off('seeked', _onSeeked);

        if (_layoutEl) _layoutEl.classList.remove('lyrics-active');
        _lyricsVisible = false;
        LyricsScroller.destroy();

        _container = null;
        _artImg = null;
        _titleEl = null;
        _subtitleEl = null;
        _progressFill = null;
        _progressScrubber = null;
        _timeCurrent = null;
        _timeTotal = null;
        _playBtn = null;
        _shuffleBtn = null;
        _repeatBtn = null;
        _starBtn = null;
        _lyricsBtn = null;
        _bgEl = null;
        _progressBar = null;
        _layoutEl = null;
        _lyricsPanel = null;
        _lyricsWrapper = null;
        _lyricsLinesEl = null;
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate
    };
})();
