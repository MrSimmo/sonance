/* ============================================
   Sonance — Settings Screen
   Server info, playback state, logout with confirm
   ============================================ */

var SettingsScreen = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var log = SonanceUtils.log;
    var createSvg = SonanceUtils.createSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;

    var _container = null;
    var _confirmOverlay = null;

    // Accent colour presets (P14e)
    var ACCENT_PRESETS = [
        { name: 'Pink',   hex: '#e44d8a', rgb: '228, 77, 138' },
        { name: 'Red',    hex: '#ef4444', rgb: '239, 68, 68'  },
        { name: 'Orange', hex: '#f97316', rgb: '249, 115, 22' },
        { name: 'Amber',  hex: '#f59e0b', rgb: '245, 158, 11' },
        { name: 'Green',  hex: '#22c55e', rgb: '34, 197, 94'  },
        { name: 'Teal',   hex: '#14b8a6', rgb: '20, 184, 166' },
        { name: 'Blue',   hex: '#3b82f6', rgb: '59, 130, 246' },
        { name: 'Purple', hex: '#8b5cf6', rgb: '139, 92, 246' }
    ];

    function render(container) {
        _container = container;

        // P15c: two-column layout — scrollable settings on the left,
        // fixed About card pinned top-right.
        var layout = el('div', { className: 'settings-layout' });
        var leftCol = el('div', { className: 'settings-left', id: 'settings-left' });
        var rightCol = el('div', { className: 'settings-right' });

        var content = leftCol;

        // --- Server Information ---
        var serverSection = el('div', { className: 'settings-section' });
        serverSection.appendChild(el('div', { className: 'settings-section-title' }, 'Server'));

        var creds = AuthManager.getCredentials();
        var serverUrl = creds.serverUrl || 'Not connected';
        var username = creds.username || 'Unknown';

        // Connection status row (moved from sidebar in v1.1)
        var connRow = el('div', { className: 'settings-info-row' });
        connRow.appendChild(el('span', { className: 'settings-info-label' }, 'Status'));
        var connValue = el('span', { className: 'settings-info-value' });
        var connDot = el('span', { className: 'sidebar-status-dot' });
        connDot.style.display = 'inline-block';
        connDot.style.marginRight = '8px';
        connDot.style.verticalAlign = 'middle';
        connValue.appendChild(connDot);
        connValue.appendChild(document.createTextNode('Connected'));
        connRow.appendChild(connValue);
        serverSection.appendChild(connRow);

        // Server URL row
        _addInfoRow(serverSection, 'Server URL', serverUrl);
        _addInfoRow(serverSection, 'Username', username);
        _addInfoRow(serverSection, 'API Version', 'Subsonic 1.16.1');

        // Fetch library stats from API
        var api = App.getApi();
        var statsRow = el('div', { className: 'settings-info-row' });
        statsRow.appendChild(el('span', { className: 'settings-info-label' }, 'Library'));
        var statsValue = el('span', { className: 'settings-info-value', id: 'settings-stats' }, 'Loading...');
        statsRow.appendChild(statsValue);
        serverSection.appendChild(statsRow);

        if (api) {
            _fetchLibraryStats(api);
        }

        content.appendChild(serverSection);

        // --- Appearance (P14e) ---
        var appearanceSection = el('div', { className: 'settings-section', id: 'settings-appearance' });
        appearanceSection.appendChild(el('div', { className: 'settings-section-title' }, 'Appearance'));

        var pickerRow = el('div', { className: 'accent-picker-row' });
        pickerRow.appendChild(el('div', { className: 'accent-picker-label' }, 'Accent Colour'));

        var swatchRow = el('div', { className: 'accent-swatches' });
        var currentHex = (App.getAccentColor() || '#e44d8a').toLowerCase();

        ACCENT_PRESETS.forEach(function(preset, idx) {
            var swatch = el('button', {
                className: 'accent-swatch focusable',
                id: 'accent-swatch-' + idx,
                title: preset.name
            });
            swatch.style.backgroundColor = preset.hex;
            swatch.setAttribute('aria-label', preset.name);
            swatch.setAttribute('data-hex', preset.hex);
            swatch.setAttribute('data-rgb', preset.rgb);
            if (preset.hex.toLowerCase() === currentHex) {
                swatch.classList.add('selected');
            }
            swatch.addEventListener('click', function() {
                _selectAccent(preset.hex, preset.rgb);
            });
            swatchRow.appendChild(swatch);
        });

        pickerRow.appendChild(swatchRow);

        var resetBtn = el('button', {
            className: 'accent-reset focusable',
            id: 'accent-reset'
        }, 'Reset to default');
        resetBtn.addEventListener('click', function() {
            _resetAccent();
        });
        pickerRow.appendChild(resetBtn);

        appearanceSection.appendChild(pickerRow);
        content.appendChild(appearanceSection);

        // --- Playback (P15b) ---
        var playbackSection = el('div', { className: 'settings-section' });
        playbackSection.appendChild(el('div', { className: 'settings-section-title' }, 'Playback'));

        var autoNpRow = el('div', {
            className: 'settings-toggle-row focusable',
            id: 'settings-auto-np-row'
        });
        autoNpRow.appendChild(el('span', { className: 'settings-toggle-label' }, 'Auto Now Playing'));
        var autoNpValue = el('span', {
            className: 'settings-toggle-value',
            id: 'settings-auto-np-value'
        }, SonanceSettings.autoNowPlaying ? 'On' : 'Off');
        autoNpRow.appendChild(autoNpValue);
        autoNpRow.addEventListener('click', function() {
            _toggleAutoNowPlaying();
        });
        playbackSection.appendChild(autoNpRow);

        playbackSection.appendChild(el('div', {
            className: 'settings-toggle-hint'
        }, 'Automatically open the Now Playing screen when you start a song.'));

        content.appendChild(playbackSection);

        // --- Account ---
        var accountSection = el('div', { className: 'settings-section' });
        accountSection.appendChild(el('div', { className: 'settings-section-title' }, 'Account'));

        var logoutBtn = el('button', {
            className: 'settings-logout-btn focusable',
            id: 'settings-logout-btn'
        }, 'Logout');
        logoutBtn.addEventListener('click', function() {
            _showLogoutConfirm();
        });
        accountSection.appendChild(logoutBtn);

        accountSection.appendChild(el('div', {
            className: 'settings-logout-hint'
        }, 'This will clear your saved credentials and return to the login screen.'));

        content.appendChild(accountSection);

        // --- About (right column, pinned top-right) ---
        var aboutBox = el('div', { className: 'settings-about' });
        aboutBox.appendChild(el('div', { className: 'settings-about-title' }, 'Sonance'));
        aboutBox.appendChild(el('div', { className: 'settings-about-subtitle' }, 'By Simmo'));

        aboutBox.appendChild(el('div', { className: 'settings-about-row' }, 'Version 1.0.0'));

        var platformValue = Player.IS_TIZEN ? 'Tizen 5.0' : 'Browser';
        aboutBox.appendChild(el('div', { className: 'settings-about-row' }, 'Platform: ' + platformValue));

        rightCol.appendChild(aboutBox);

        layout.appendChild(leftCol);
        layout.appendChild(rightCol);
        container.appendChild(layout);
        log('Settings', 'Settings screen rendered');
    }

    function _scrollFocusedIntoView(element) {
        if (!element) return;
        var container = document.getElementById('settings-left');
        if (!container) return;
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

    function _updateSelectedSwatch(hex) {
        var normalized = (hex || '').toLowerCase();
        var swatches = document.querySelectorAll('.accent-swatch');
        for (var i = 0; i < swatches.length; i++) {
            var sw = swatches[i];
            var swHex = (sw.getAttribute('data-hex') || '').toLowerCase();
            if (swHex === normalized) {
                sw.classList.add('selected');
            } else {
                sw.classList.remove('selected');
            }
        }
    }

    function _selectAccent(hex, rgb) {
        App.saveAccentColor(hex, rgb);
        _updateSelectedSwatch(hex);
        App.showToast('Accent colour updated');
        log('Settings', 'Accent set to ' + hex);
    }

    function _resetAccent() {
        App.resetAccentColor();
        _updateSelectedSwatch(App.DEFAULT_ACCENT_HEX);
        App.showToast('Accent colour reset');
        log('Settings', 'Accent reset to default');
    }

    function _toggleAutoNowPlaying() {
        SonanceSettings.autoNowPlaying = !SonanceSettings.autoNowPlaying;
        localStorage.setItem('sonance-auto-now-playing', SonanceSettings.autoNowPlaying.toString());
        var valEl = document.getElementById('settings-auto-np-value');
        if (valEl) {
            valEl.textContent = SonanceSettings.autoNowPlaying ? 'On' : 'Off';
        }
        log('Settings', 'Auto Now Playing: ' + SonanceSettings.autoNowPlaying);
    }

    function _addInfoRow(parent, label, value) {
        var row = el('div', { className: 'settings-info-row' });
        row.appendChild(el('span', { className: 'settings-info-label' }, label));
        row.appendChild(el('span', { className: 'settings-info-value' }, value));
        parent.appendChild(row);
    }

    function _fetchLibraryStats(api) {
        // Fetch album count, artist count, and use getRandomSongs count as a rough song indicator
        var albumP = api.getAlbumList2('newest', 1);
        var artistP = api.getArtists();

        Promise.all([albumP, artistP]).then(function(results) {
            var statsEl = document.getElementById('settings-stats');
            if (!statsEl) return;

            var artistCount = (results[1] && results[1].length) || 0;
            var parts = [];
            parts.push(artistCount + ' artists');
            statsEl.textContent = parts.join(' \u00B7 ');
        }).catch(function() {
            var statsEl = document.getElementById('settings-stats');
            if (statsEl) statsEl.textContent = 'Unable to load';
        });
    }

    function _showLogoutConfirm() {
        if (_confirmOverlay) return; // Already showing

        _confirmOverlay = el('div', { className: 'settings-confirm-overlay', id: 'logout-confirm' });

        var dialog = el('div', { className: 'settings-confirm-dialog' });
        dialog.appendChild(el('div', { className: 'settings-confirm-title' }, 'Log Out?'));
        dialog.appendChild(el('div', { className: 'settings-confirm-message' },
            'Are you sure you want to log out? You will need to re-enter your server credentials.'));

        var buttons = el('div', { className: 'settings-confirm-buttons' });

        var cancelBtn = el('button', { className: 'settings-confirm-cancel focusable', id: 'confirm-cancel' }, 'Cancel');
        cancelBtn.addEventListener('click', function() {
            _hideLogoutConfirm();
        });
        buttons.appendChild(cancelBtn);

        var logoutBtn = el('button', { className: 'settings-confirm-logout focusable', id: 'confirm-logout' }, 'Log Out');
        logoutBtn.addEventListener('click', function() {
            _hideLogoutConfirm();
            log('Settings', 'Logout confirmed');
            Player.pause();
            AuthManager.logout();
            App.showLogin();
        });
        buttons.appendChild(logoutBtn);

        dialog.appendChild(buttons);
        _confirmOverlay.appendChild(dialog);
        document.body.appendChild(_confirmOverlay);

        // Register confirm dialog focus zone
        FocusManager.registerZone('confirm-dialog', {
            selector: '#logout-confirm .focusable',
            columns: 2,
            onActivate: function(idx, element) {
                element.click();
            },
            neighbors: {} // No zone transitions — modal is isolated
        });
        FocusManager.setActiveZone('confirm-dialog', 0);

        log('Settings', 'Logout confirm dialog shown');
    }

    function _hideLogoutConfirm() {
        if (_confirmOverlay && _confirmOverlay.parentNode) {
            _confirmOverlay.parentNode.removeChild(_confirmOverlay);
        }
        _confirmOverlay = null;
        FocusManager.unregisterZone('confirm-dialog');
        FocusManager.setActiveZone('content', 0);
    }

    function activate(params) {
        // Content (top) zone: horizontal row of 8 accent swatches.
        // Registered as 'content' so sidebar → right lands here, matching the
        // visual top of the settings screen.
        FocusManager.registerZone('content', {
            selector: '#settings-appearance .accent-swatch.focusable',
            columns: 8,
            onActivate: function(index, element) {
                if (element && element.click) {
                    element.click();
                }
            },
            onFocus: function(idx, element) { _scrollFocusedIntoView(element); },
            neighbors: {
                left: 'sidebar',
                down: 'settings-actions'
            }
        });

        // Actions zone: reset link + toggle rows + logout button (below swatches)
        FocusManager.registerZone('settings-actions', {
            selector: '#content-area .focusable:not(.accent-swatch)',
            columns: 1,
            onActivate: function(index, element) {
                if (element && element.click) {
                    element.click();
                }
            },
            onKey: function(direction) {
                // Left/Right on the Auto Now Playing row toggles its value
                // instead of transitioning zones.
                if (direction !== 'left' && direction !== 'right') return false;
                var focused = FocusManager.getCurrentFocused();
                if (focused && focused.id === 'settings-auto-np-row') {
                    _toggleAutoNowPlaying();
                    return true;
                }
                return false;
            },
            onFocus: function(idx, element) { _scrollFocusedIntoView(element); },
            neighbors: {
                left: 'sidebar',
                up: 'content',
                down: 'nowplaying-bar'
            }
        });

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
                up: 'settings-actions',
                left: 'sidebar'
            }
        });
    }

    function deactivate() {
        _hideLogoutConfirm();
        _container = null;
    }

    return {
        render: render,
        activate: activate,
        deactivate: deactivate
    };
})();
