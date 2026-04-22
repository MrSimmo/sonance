/* ============================================
   Sonance — Queue Screen
   Split layout: now playing card + up next list
   ============================================ */

var QueueScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var log = SonanceUtils.log;
    var createSvg = SonanceUtils.createSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;
    var formatDuration = SonanceUtils.formatDuration;

    var _container = null;
    var _active = false;

    // DOM references
    var _npArt = null;
    var _npTitle = null;
    var _npArtist = null;
    var _npProgressFill = null;
    var _npTimeCurrent = null;
    var _npTimeTotal = null;
    var _queueList = null;

    // =========================================
    //  Scroll Helper (Chromium 63 safe)
    // =========================================

    function _scrollToFocused(element) {
        var container = document.querySelector('.queue-right');
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

        var wrapper = el('div', { className: 'queue-screen' });

        // LEFT PANEL (320px) — Now Playing card
        var leftPanel = el('div', { className: 'queue-left' });
        leftPanel.appendChild(el('div', { className: 'queue-section-heading' }, 'Now Playing'));

        var card = el('div', { className: 'queue-np-card focusable', id: 'queue-np-card' });
        card.addEventListener('click', function() {
            if (Player.getState().currentTrack) {
                App.navigateTo('nowplaying');
            }
        });

        _npArt = el('div', { className: 'queue-np-art' });
        card.appendChild(_npArt);

        _npTitle = el('div', { className: 'queue-np-title' }, 'No track playing');
        card.appendChild(_npTitle);

        _npArtist = el('div', { className: 'queue-np-artist' }, 'Select a song to begin');
        card.appendChild(_npArtist);

        // Mini progress bar in card
        var progressWrap = el('div', { className: 'queue-np-progress-wrap' });
        var progressBar = el('div', { className: 'queue-np-progress' });
        _npProgressFill = el('div', { className: 'queue-np-progress-fill' });
        progressBar.appendChild(_npProgressFill);
        progressWrap.appendChild(progressBar);

        var timeRow = el('div', { className: 'queue-np-time-row' });
        _npTimeCurrent = el('span', { className: 'queue-np-time' }, '0:00');
        _npTimeTotal = el('span', { className: 'queue-np-time' }, '0:00');
        timeRow.appendChild(_npTimeCurrent);
        timeRow.appendChild(_npTimeTotal);
        progressWrap.appendChild(timeRow);

        card.appendChild(progressWrap);
        leftPanel.appendChild(card);
        wrapper.appendChild(leftPanel);

        // RIGHT PANEL — Up Next list
        var rightPanel = el('div', { className: 'queue-right' });
        rightPanel.appendChild(el('div', { className: 'queue-section-heading' }, 'Up Next'));

        _queueList = el('div', { className: 'queue-list', id: 'queue-list' });
        rightPanel.appendChild(_queueList);
        wrapper.appendChild(rightPanel);

        container.appendChild(wrapper);
        log('Queue', 'Queue screen rendered');
    }

    // =========================================
    //  Activate
    // =========================================

    function activate(params) {
        _active = true;

        var pState = Player.getState();
        _updateNowPlaying(pState.currentTrack);
        _updateProgress(pState.currentTime, pState.duration);
        _renderQueueList(pState);

        // Subscribe to events
        Player.on('trackchange', _onTrackChange);
        Player.on('progress', _onProgress);
        Player.on('queuechange', _onQueueChange);

        _registerFocusZones();
    }

    // =========================================
    //  Event Handlers
    // =========================================

    function _onTrackChange(track) {
        if (!_active) return;
        _updateNowPlaying(track);
        _renderQueueList(Player.getState());
        _registerFocusZones();
    }

    function _onProgress(data) {
        if (!_active) return;
        _updateProgress(data.currentTime, data.duration);
    }

    function _onQueueChange() {
        if (!_active) return;
        _renderQueueList(Player.getState());
        _registerFocusZones();
    }

    // =========================================
    //  UI Updates
    // =========================================

    function _updateNowPlaying(track) {
        if (!track) {
            if (_npTitle) _npTitle.textContent = 'No track playing';
            if (_npArtist) _npArtist.textContent = 'Select a song to begin';
            if (_npArt) _npArt.textContent = '';
            return;
        }

        if (_npTitle) _npTitle.textContent = track.title || 'Unknown';
        if (_npArtist) _npArtist.textContent = track.artist || 'Unknown Artist';

        if (_npArt) {
            _npArt.textContent = '';
            var api = AuthManager.getApi();
            if (api) {
                var artEl = SonanceComponents.renderAlbumArt(track, 280, api);
                _npArt.appendChild(artEl);
            }
        }
    }

    function _updateProgress(currentTime, duration) {
        var pct = (duration > 0) ? (currentTime / duration) * 100 : 0;
        if (_npProgressFill) _npProgressFill.style.width = pct + '%';
        if (_npTimeCurrent) _npTimeCurrent.textContent = formatDuration(currentTime);
        if (_npTimeTotal) _npTimeTotal.textContent = formatDuration(duration);
    }

    function _renderQueueList(pState) {
        if (!_queueList) return;
        _queueList.textContent = '';

        var queue = pState.queue;
        var currentIdx = pState.queueIndex;

        // Show tracks after current
        var upNext = [];
        for (var i = currentIdx + 1; i < queue.length; i++) {
            upNext.push({ track: queue[i], queueIdx: i });
        }
        // If repeat all, also show tracks before current
        if (pState.repeat === 'all' && currentIdx > 0) {
            for (var j = 0; j < currentIdx; j++) {
                upNext.push({ track: queue[j], queueIdx: j });
            }
        }

        if (upNext.length === 0) {
            var emptyEl = el('div', { className: 'queue-empty' }, 'Queue is empty');
            _queueList.appendChild(emptyEl);
            return;
        }

        var api = AuthManager.getApi();

        upNext.forEach(function(item, displayIdx) {
            var track = item.track;
            var queueIdx = item.queueIdx;

            var row = el('div', {
                className: 'queue-row focusable',
                'data-queue-idx': String(queueIdx)
            });

            // Index number
            row.appendChild(el('div', { className: 'queue-row-num' }, String(displayIdx + 1)));

            // Album art thumbnail (44px)
            var thumb = el('div', { className: 'queue-row-thumb' });
            if (api && (track.coverArt || track.albumId)) {
                var img = document.createElement('img');
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '4px';
                img.onerror = function() {
                    if (img.parentNode) img.parentNode.removeChild(img);
                };
                img.src = api.getCoverArtUrl(track.coverArt || track.albumId, 88);
                thumb.appendChild(img);
            }
            row.appendChild(thumb);

            // Track info
            var info = el('div', { className: 'queue-row-info' });
            info.appendChild(el('div', { className: 'queue-row-title' }, track.title || 'Unknown'));
            info.appendChild(el('div', { className: 'queue-row-artist' }, track.artist || 'Unknown'));
            row.appendChild(info);

            // Duration
            row.appendChild(el('div', { className: 'queue-row-duration' }, formatDuration(track.duration)));

            // Click to jump to this track
            row.addEventListener('click', function() {
                Player.jumpToQueueIndex(queueIdx);
            });

            _queueList.appendChild(row);
        });
    }

    // =========================================
    //  Focus Zones
    // =========================================

    function _registerFocusZones() {
        var queueRows = document.querySelectorAll('#queue-list .focusable');
        var hasQueue = queueRows.length > 0;

        FocusManager.registerZone('content', {
            selector: '#queue-np-card',
            columns: 1,
            onActivate: function(idx, element) { element.click(); },
            neighbors: {
                left: 'sidebar',
                right: hasQueue ? 'queue-list' : null,
                down: 'nowplaying-bar'
            }
        });

        if (hasQueue) {
            FocusManager.registerZone('queue-list', {
                selector: '#queue-list .focusable',
                columns: 1,
                onActivate: function(idx, element) { element.click(); },
                onFocus: function(idx, element) { _scrollToFocused(element); },
                onColourButton: function(colour, idx, element) {
                    if (colour === 'red') {
                        var queueIdx = element.getAttribute('data-queue-idx');
                        if (queueIdx !== null) {
                            Player.removeFromQueue(parseInt(queueIdx, 10));
                            App.showToast('Removed from queue');
                        }
                    }
                },
                neighbors: {
                    left: 'content',
                    down: 'nowplaying-bar'
                }
            });
        }

        // Show colour button hints on queue screen
        if (hasQueue) {
            App.showColourHints([
                { colour: 'red', label: 'Remove' }
            ]);
        }

        FocusManager.setActiveZone(hasQueue ? 'queue-list' : 'content', 0);
    }

    // =========================================
    //  Deactivate
    // =========================================

    function deactivate() {
        _active = false;

        Player.off('trackchange', _onTrackChange);
        Player.off('progress', _onProgress);
        Player.off('queuechange', _onQueueChange);

        _container = null;
        _npArt = null;
        _npTitle = null;
        _npArtist = null;
        _npProgressFill = null;
        _npTimeCurrent = null;
        _npTimeTotal = null;
        _queueList = null;
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate
    };
})();
