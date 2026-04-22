/* ============================================
   Sonance — App Shell, Router & Screen Manager
   ============================================ */

// =========================================
//  SonanceSettings — persisted user preferences
// =========================================
var SonanceSettings = {
    // Auto-open Now Playing screen when user starts playback. Default ON.
    autoNowPlaying: localStorage.getItem('sonance-auto-now-playing') !== 'false'
};

var App = (function() {
    'use strict';

    var el = SonanceUtils.el;
    var $ = SonanceUtils.$;
    var log = SonanceUtils.log;
    var createSvg = SonanceUtils.createSvg;
    var SVG_PATHS = SonanceUtils.SVG_PATHS;

    // S-wave logo SVG — enlarged paths (P4.3: fill 70-80% of viewBox)
    function _createLogoSvg() {
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        var paths = [
            { d: 'M15.5,4 A7,7 0 0,0 8.5,9', sw: '2.4', o: '0.95' },
            { d: 'M8.5,9 A7,7 0 0,1 15.5,14', sw: '2.4', o: '0.95' },
            { d: 'M15.5,14 A7,7 0 0,0 8.5,19', sw: '2.4', o: '0.2' },
            { d: 'M18,5 Q20.5,7.5 18,10', sw: '1.6', o: '0.5' },
            { d: 'M20,3.5 Q23.5,7.5 20,11.5', sw: '1.3', o: '0.3' },
            { d: 'M6,10 Q3.5,12 6,14', sw: '1.6', o: '0.5' },
            { d: 'M4,8.5 Q0.5,12 4,15.5', sw: '1.3', o: '0.3' }
        ];
        paths.forEach(function(p) {
            var path = document.createElementNS(ns, 'path');
            path.setAttribute('d', p.d);
            path.setAttribute('stroke', 'white');
            path.setAttribute('stroke-width', p.sw);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('opacity', p.o);
            svg.appendChild(path);
        });
        return svg;
    }

    // --- Toast system ---
    var _toastEl = null;
    var _toastTimer = null;

    function showToast(message, duration) {
        duration = duration || 2000;
        if (_toastEl && _toastEl.parentNode) {
            _toastEl.parentNode.removeChild(_toastEl);
        }
        if (_toastTimer) {
            clearTimeout(_toastTimer);
            _toastTimer = null;
        }
        _toastEl = el('div', { className: 'sonance-toast' }, message);
        document.body.appendChild(_toastEl);
        // Force reflow then show
        _toastEl.offsetHeight;
        _toastEl.classList.add('visible');
        _toastTimer = setTimeout(function() {
            if (_toastEl) _toastEl.classList.remove('visible');
            setTimeout(function() {
                if (_toastEl && _toastEl.parentNode) {
                    _toastEl.parentNode.removeChild(_toastEl);
                }
                _toastEl = null;
            }, 300);
        }, duration);
    }

    // --- Colour hint bar ---
    var _hintBar = null;

    function _buildColourHintBar() {
        _hintBar = el('div', { className: 'colour-hint-bar', id: 'colour-hint-bar' });
        return _hintBar;
    }

    function showColourHints(hints) {
        // hints: array of { colour: 'yellow'|'blue'|'red'|'green', label: 'Add to queue' }
        if (!_hintBar) return;
        _hintBar.textContent = '';
        if (!hints || hints.length === 0) {
            _hintBar.classList.remove('visible');
            return;
        }
        hints.forEach(function(hint) {
            var item = el('div', { className: 'colour-hint-item' });
            item.appendChild(el('span', { className: 'colour-hint-dot ' + hint.colour }));
            item.appendChild(el('span', { className: 'colour-hint-label' }, hint.label));
            _hintBar.appendChild(item);
        });
        _hintBar.classList.add('visible');
    }

    function hideColourHints() {
        if (!_hintBar) return;
        _hintBar.classList.remove('visible');
    }

    // --- State ---
    var _appContainer = null;
    var _contentArea = null;
    var _sidebarItems = [];     // DOM button elements
    var _currentScreen = null;  // screen name string
    var _historyStack = [];     // [{ screen, params }]

    // --- Screen Registry ---
    var _screens = {
        home: HomeScreen,
        library: LibraryScreen,
        search: SearchScreen,
        playlists: PlaylistsScreen,
        nowplaying: NowPlayingScreen,
        queue: QueueScreen,
        settings: SettingsScreen,
        album: AlbumScreen,
        artist: ArtistScreen
    };

    var _screenTitles = {
        home: 'Home',
        library: 'Library',
        search: 'Search',
        playlists: 'Playlists',
        nowplaying: 'Now Playing',
        queue: 'Queue',
        settings: 'Settings',
        album: 'Album',
        artist: 'Artist'
    };

    // Sidebar nav items in order — maps index to screen name
    var _navScreens = ['home', 'library', 'search', 'playlists', 'nowplaying', 'queue', 'settings'];

    var _navIcons = {
        home: SVG_PATHS.home,
        library: SVG_PATHS.grid,
        search: SVG_PATHS.search,
        playlists: SVG_PATHS.playlist,
        nowplaying: SVG_PATHS.nowPlaying,
        queue: SVG_PATHS.queue,
        settings: SVG_PATHS.settings
    };

    // =========================================
    //  Tizen Media Key Registration
    // =========================================

    function registerTizenKeys() {
        if (typeof tizen === 'undefined' || !tizen.tvinputdevice) {
            log('App', 'Not on Tizen — skipping key registration');
            return;
        }
        var keys = [
            'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
            'MediaFastForward', 'MediaRewind', 'MediaTrackPrevious', 'MediaTrackNext',
            'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue'
        ];
        keys.forEach(function(key) {
            try {
                tizen.tvinputdevice.registerKey(key);
            } catch (e) {
                console.warn('[Sonance][App] Failed to register key: ' + key, e);
            }
        });
        log('App', 'Registered ' + keys.length + ' media/colour keys');
    }

    // =========================================
    //  Accent Colour (P14e)
    // =========================================

    var DEFAULT_ACCENT_HEX = '#e44d8a';
    var DEFAULT_ACCENT_RGB = '228, 77, 138';

    function applyAccentColor(hex, rgb) {
        document.documentElement.style.setProperty('--accent', hex);
        document.documentElement.style.setProperty('--accent-rgb', rgb);
        document.documentElement.style.setProperty('--accent-glow', 'rgba(' + rgb + ', 0.35)');
        document.documentElement.style.setProperty('--accent-soft', 'rgba(' + rgb + ', 0.15)');
    }

    function resetAccentColor() {
        try {
            localStorage.removeItem('sonance-accent-color');
            localStorage.removeItem('sonance-accent-rgb');
        } catch (e) {}
        applyAccentColor(DEFAULT_ACCENT_HEX, DEFAULT_ACCENT_RGB);
    }

    function loadAccentColor() {
        try {
            var savedHex = localStorage.getItem('sonance-accent-color');
            var savedRgb = localStorage.getItem('sonance-accent-rgb');
            if (savedHex && savedRgb) {
                applyAccentColor(savedHex, savedRgb);
            }
        } catch (e) {
            log('App', 'Failed to load accent color: ' + e.message);
        }
    }

    function saveAccentColor(hex, rgb) {
        try {
            localStorage.setItem('sonance-accent-color', hex);
            localStorage.setItem('sonance-accent-rgb', rgb);
        } catch (e) {
            log('App', 'Failed to save accent color: ' + e.message);
        }
        applyAccentColor(hex, rgb);
    }

    function getAccentColor() {
        var v = getComputedStyle(document.documentElement).getPropertyValue('--accent');
        return (v && v.trim()) || DEFAULT_ACCENT_HEX;
    }

    function getAccentRgb() {
        var v = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb');
        return (v && v.trim()) || DEFAULT_ACCENT_RGB;
    }

    // Apply saved accent immediately so nothing paints with stale pink
    loadAccentColor();

    // =========================================
    //  Init
    // =========================================

    function init() {
        log('App', 'Sonance starting...');

        _appContainer = document.getElementById('app');

        // Re-apply saved accent (belt-and-braces in case <html> was replaced)
        loadAccentColor();

        // Initialize subsystems
        FocusManager.init();
        Player.init();

        // Check auth state
        if (AuthManager.isLoggedIn()) {
            log('App', 'Existing session found, validating...');
            _validateAndShowApp();
        } else {
            log('App', 'No session, showing login');
            _showLogin();
        }
    }

    // =========================================
    //  Login / Auth
    // =========================================

    function _showLogin() {
        _appContainer.textContent = '';
        _currentScreen = null;
        _historyStack = [];

        // Reset FocusManager — clear all zones
        FocusManager.clearContentZones();
        FocusManager.unregisterZone('sidebar');
        FocusManager.unregisterZone('nowplaying-bar');

        LoginScreen.render(_appContainer, function() {
            _showAppShell();
        });
        LoginScreen.activate();
    }

    function _validateAndShowApp() {
        var api = AuthManager.getApi();
        if (!api) {
            _showLogin();
            return;
        }

        api.ping().then(function() {
            log('App', 'Session valid');
            _showAppShell();
        }).catch(function(err) {
            log('App', 'Session validation failed: ' + err.message);
            _showLogin();
        });
    }

    // =========================================
    //  App Shell
    // =========================================

    function _showAppShell() {
        _appContainer.textContent = '';
        _historyStack = [];

        var layout = el('div', { className: 'app-layout' });

        // Sidebar
        layout.appendChild(_buildSidebar());

        // Main content area
        var main = el('div', { className: 'main-content' });

        _contentArea = el('div', { className: 'content-area', id: 'content-area' });
        main.appendChild(_contentArea);

        main.appendChild(_buildColourHintBar());
        main.appendChild(_buildNowPlayingBar());
        layout.appendChild(main);

        _appContainer.appendChild(layout);

        // Register persistent focus zones
        _registerSidebarZone();
        _registerNowPlayingBarZone();

        // Auto-open Now Playing when user initiates playback (P15b)
        Player.on('userplay', function() {
            if (SonanceSettings.autoNowPlaying && _currentScreen !== 'nowplaying') {
                navigateTo('nowplaying');
            }
        });

        // Navigate to home screen
        navigateTo('home');

        // Set initial focus to sidebar
        FocusManager.setActiveZone('sidebar', 0);

        // Register Samsung remote media/colour keys (no-op in browser)
        registerTizenKeys();

        // Load starred (favourites) cache in the background
        var api = AuthManager.getApi();
        if (api && typeof StarredCache !== 'undefined') {
            StarredCache.load(api).catch(function(err) {
                log('App', 'StarredCache load failed: ' + (err && err.message));
            });
        }

        log('App', 'App shell rendered');
    }

    // =========================================
    //  Sidebar Builder
    // =========================================

    function _buildSidebar() {
        var sidebar = el('div', { className: 'sidebar', id: 'sidebar' });

        // Logo
        var sidebarLogo = el('div', { className: 'sidebar-logo' });
        var logoIcon = el('div', { className: 'sidebar-logo-icon' });
        var logoSvg = _createLogoSvg();
        logoSvg.style.width = '20px';
        logoSvg.style.height = '20px';
        logoIcon.appendChild(logoSvg);
        sidebarLogo.appendChild(logoIcon);

        var logoText = el('div', { className: 'sidebar-logo-text' });
        logoText.appendChild(el('div', { className: 'sidebar-logo-title' }, 'Sonance'));
        logoText.appendChild(el('div', { className: 'sidebar-logo-subtitle' }, 'BY SIMMO'));
        sidebarLogo.appendChild(logoText);
        sidebar.appendChild(sidebarLogo);

        // Nav items
        var nav = el('div', { className: 'sidebar-nav' });
        _sidebarItems = [];

        _navScreens.forEach(function(screenName, i) {
            var label = _screenTitles[screenName];
            var btn = el('button', {
                className: 'sidebar-nav-item',
                'data-screen': screenName
            });

            var icon = createSvg(_navIcons[screenName]);
            icon.style.width = '22px';
            icon.style.height = '22px';
            icon.style.fill = 'currentColor';
            icon.style.flexShrink = '0';
            btn.appendChild(icon);
            btn.appendChild(document.createTextNode(label));

            // Mouse click handler for browser testing
            btn.addEventListener('click', function() {
                navigateTo(screenName);
                FocusManager.setActiveZone('sidebar', i);
            });

            _sidebarItems.push(btn);
            nav.appendChild(btn);
        });

        sidebar.appendChild(nav);

        return sidebar;
    }

    // =========================================
    //  Now Playing Bar (Live)
    // =========================================

    // References for live updates
    var _npBarArt = null;
    var _npBarTitle = null;
    var _npBarArtist = null;
    var _npBarMiniProgress = null;
    var _npBarPlayBtn = null;

    function _buildNowPlayingBar() {
        var npBar = el('div', { className: 'now-playing-bar', id: 'now-playing-bar' });

        // Mini progress line at top
        _npBarMiniProgress = el('div', { className: 'mini-progress', style: { width: '0%' } });
        npBar.appendChild(_npBarMiniProgress);

        // Left: album art + track info (clickable to open Now Playing screen)
        var npLeft = el('div', { className: 'now-playing-bar-left' });
        npLeft.style.cursor = 'pointer';
        npLeft.addEventListener('click', function() {
            if (Player.getState().currentTrack) {
                navigateTo('nowplaying');
            }
        });

        _npBarArt = el('div', { className: 'now-playing-bar-art' });
        npLeft.appendChild(_npBarArt);

        var npInfo = el('div', { className: 'now-playing-bar-info' });
        _npBarTitle = el('div', { className: 'now-playing-bar-title' }, 'No track playing');
        _npBarArtist = el('div', { className: 'now-playing-bar-artist' }, 'Select a song to begin');
        npInfo.appendChild(_npBarTitle);
        npInfo.appendChild(_npBarArtist);
        npLeft.appendChild(npInfo);
        npBar.appendChild(npLeft);

        // Centre: transport controls
        var npCenter = el('div', { className: 'now-playing-bar-center' });

        var prevBtn = el('button', { className: 'np-bar-btn' });
        var prevSvg = createSvg(SVG_PATHS.skipPrev);
        prevSvg.style.width = '20px';
        prevSvg.style.height = '20px';
        prevSvg.style.fill = 'currentColor';
        prevBtn.appendChild(prevSvg);
        prevBtn.addEventListener('click', function() { Player.previous(); });
        npCenter.appendChild(prevBtn);

        _npBarPlayBtn = el('button', { className: 'play-btn-main np-bar-btn' });
        var playSvg = createSvg(SVG_PATHS.play);
        playSvg.style.width = '18px';
        playSvg.style.height = '18px';
        _npBarPlayBtn.appendChild(playSvg);
        _npBarPlayBtn.addEventListener('click', function() { Player.togglePlayPause(); });
        npCenter.appendChild(_npBarPlayBtn);

        var nextBtn = el('button', { className: 'np-bar-btn' });
        var nextSvg = createSvg(SVG_PATHS.skipNext);
        nextSvg.style.width = '20px';
        nextSvg.style.height = '20px';
        nextSvg.style.fill = 'currentColor';
        nextBtn.appendChild(nextSvg);
        nextBtn.addEventListener('click', function() { Player.next(); });
        npCenter.appendChild(nextBtn);

        npBar.appendChild(npCenter);

        // Subscribe to player events
        _subscribeNowPlayingBar();

        return npBar;
    }

    function _subscribeNowPlayingBar() {
        Player.on('trackchange', function(track) {
            _updateNpBarTrack(track);
        });

        Player.on('progress', function(data) {
            if (_npBarMiniProgress && data.duration > 0) {
                var pct = (data.currentTime / data.duration) * 100;
                _npBarMiniProgress.style.width = pct + '%';
            }
        });

        Player.on('play', function() {
            _updateNpBarPlayIcon(true);
        });

        Player.on('pause', function() {
            _updateNpBarPlayIcon(false);
        });
    }

    function _updateNpBarTrack(track) {
        if (!track) return;
        if (_npBarTitle) _npBarTitle.textContent = track.title || 'Unknown';
        if (_npBarArtist) {
            var parts = [];
            if (track.artist) parts.push(track.artist);
            if (track.album) parts.push(track.album);
            _npBarArtist.textContent = parts.join(' \u2014 ') || 'Unknown';
        }

        // Update album art
        if (_npBarArt) {
            _npBarArt.textContent = '';
            var api = AuthManager.getApi();
            if (api && (track.coverArt || track.albumId)) {
                var img = document.createElement('img');
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.onerror = function() {
                    if (img.parentNode) img.parentNode.removeChild(img);
                };
                img.src = api.getCoverArtUrl(track.coverArt || track.albumId, 96);
                _npBarArt.appendChild(img);
            }
        }

        // Reset progress
        if (_npBarMiniProgress) _npBarMiniProgress.style.width = '0%';
    }

    function _updateNpBarPlayIcon(isPlaying) {
        if (!_npBarPlayBtn) return;
        _npBarPlayBtn.textContent = '';
        var icon = createSvg(isPlaying ? SVG_PATHS.pause : SVG_PATHS.play);
        icon.style.width = '18px';
        icon.style.height = '18px';
        _npBarPlayBtn.appendChild(icon);
    }

    // =========================================
    //  Focus Zone Registration
    // =========================================

    function _registerSidebarZone() {
        FocusManager.registerZone('sidebar', {
            selector: '.sidebar-nav-item',
            columns: 1,
            onActivate: function(index) {
                var screenName = _navScreens[index];
                navigateTo(screenName);
            },
            neighbors: {
                right: 'content',
                down: 'nowplaying-bar'
            }
        });
    }

    function _registerNowPlayingBarZone() {
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
    //  Screen Router
    // =========================================

    /**
     * Navigate to a screen by name.
     * Primary nav screens (in sidebar) replace the history stack.
     * Sub-screens (album, etc.) push to the stack.
     */
    function navigateTo(screenName, params) {
        var screen = _screens[screenName];
        if (!screen) {
            log('App', 'Unknown screen: ' + screenName);
            return;
        }

        _navigateToScreen(screenName, params);

        // History management
        var isPrimary = _navScreens.indexOf(screenName) >= 0;
        if (isPrimary) {
            // Primary nav: replace stack (sidebar navigation is flat)
            _historyStack = [{ screen: screenName, params: params }];
        } else {
            // Sub-screen: push to stack (drill-down)
            _historyStack.push({ screen: screenName, params: params });
        }
    }

    /**
     * Go back to the previous screen, or show exit dialogue if at root.
     */
    function goBack() {
        // If exit dialogue is open, dismiss it
        if (_exitDialogOpen) {
            _dismissExitDialog();
            return;
        }

        if (_historyStack.length > 1) {
            // Pop current, navigate to previous
            _historyStack.pop();
            var prev = _historyStack[_historyStack.length - 1];
            _navigateToScreen(prev.screen, prev.params);
            FocusManager.setActiveZone('sidebar');
        } else {
            // At root — show exit dialogue
            _showExitDialog();
        }
    }

    // --- Exit Dialogue (P5.2) ---
    var _exitDialogOpen = false;
    var _exitOverlay = null;
    var _exitPreviousZone = null;

    function _showExitDialog() {
        if (_exitDialogOpen) return;
        _exitDialogOpen = true;

        // Remember current zone to restore on cancel
        _exitPreviousZone = FocusManager.getActiveZone();

        // Build overlay
        _exitOverlay = el('div', { className: 'exit-overlay' });
        var card = el('div', { className: 'exit-card' });
        card.appendChild(el('div', { className: 'exit-card-title' }, 'Exit Sonance?'));
        card.appendChild(el('div', { className: 'exit-card-subtitle' }, 'Are you sure you want to exit?'));

        var buttons = el('div', { className: 'exit-card-buttons' });
        var cancelBtn = el('button', { className: 'exit-btn exit-btn-cancel focusable', id: 'exit-cancel' }, 'Cancel');
        var exitBtn = el('button', { className: 'exit-btn exit-btn-exit focusable', id: 'exit-confirm' }, 'Exit');
        buttons.appendChild(cancelBtn);
        buttons.appendChild(exitBtn);
        card.appendChild(buttons);
        _exitOverlay.appendChild(card);

        // Append to #app (so position: absolute works relative to app)
        _appContainer.appendChild(_exitOverlay);

        // Register isolated focus zone for the dialog
        FocusManager.registerZone('exit-dialog', {
            selector: '.exit-card-buttons .focusable',
            columns: 2,
            onActivate: function(idx) {
                if (idx === 0) {
                    // Cancel
                    _dismissExitDialog();
                } else {
                    // Exit
                    _exitApp();
                }
            },
            neighbors: {}
        });
        FocusManager.setActiveZone('exit-dialog', 0);
    }

    function _dismissExitDialog() {
        if (!_exitDialogOpen) return;
        _exitDialogOpen = false;

        if (_exitOverlay && _exitOverlay.parentNode) {
            _exitOverlay.parentNode.removeChild(_exitOverlay);
        }
        _exitOverlay = null;

        FocusManager.unregisterZone('exit-dialog');

        // Restore previous focus zone
        if (_exitPreviousZone) {
            FocusManager.setActiveZone(_exitPreviousZone);
        } else {
            FocusManager.setActiveZone('sidebar');
        }
    }

    function _exitApp() {
        // Tizen exit
        if (typeof tizen !== 'undefined' && tizen.application) {
            try {
                tizen.application.getCurrentApplication().exit();
            } catch (e) {
                log('App', 'Tizen exit failed: ' + e.message);
            }
        } else {
            // Browser fallback
            window.close();
            // If window.close() doesn't work (common in browser), dismiss and show toast
            _dismissExitDialog();
            showToast('Close this tab to exit');
        }
    }

    /**
     * Internal: perform the actual screen transition.
     */
    function _navigateToScreen(screenName, params) {
        var screen = _screens[screenName];
        if (!screen) return;

        var previousScreen = _currentScreen;

        // Deactivate current screen
        if (_currentScreen && _screens[_currentScreen]) {
            _screens[_currentScreen].deactivate();
        }

        // Clear content focus zones
        FocusManager.clearContentZones();

        // Hide colour hints on screen change
        hideColourHints();

        // Clear content area
        _contentArea.textContent = '';

        // P5.7 — Now Playing bar slide animation (P6.2: visibility + np-active)
        // P7.1 — Also collapse NP bar + hint bar from layout so NP screen fills 100%
        var npBar = document.getElementById('now-playing-bar');
        var hintBar = document.getElementById('colour-hint-bar');
        if (npBar) {
            if (screenName === 'nowplaying') {
                // Entering NP: add np-active, hide bar from layout entirely
                _contentArea.classList.add('np-active');
                npBar.style.display = 'none';
                if (hintBar) hintBar.style.display = 'none';
            } else if (previousScreen === 'nowplaying') {
                // Leaving NP: remove np-active, restore bar
                _contentArea.classList.remove('np-active');
                npBar.style.display = '';
                npBar.classList.remove('np-bar-hidden');
                if (hintBar) hintBar.style.display = '';
            }
        }

        // P5.8 — Fullbleed mode for Now Playing screen
        if (screenName === 'nowplaying') {
            _contentArea.classList.add('fullbleed');
        } else {
            _contentArea.classList.remove('fullbleed');
        }

        // Render new screen
        screen.render(_contentArea);

        // Update state
        _currentScreen = screenName;

        // Update sidebar active indicator
        _updateSidebarActive(screenName);

        // Activate new screen (registers focus zones, fetches data, etc.)
        screen.activate(params);

        // Ensure a content focus zone is active after activation
        // (screens with async data will set this themselves after data loads)
        if (!FocusManager.getActiveZone()) {
            FocusManager.setActiveZone('content', 0);
        }

        log('App', 'Navigated to: ' + screenName);
    }

    /**
     * Update sidebar active/inactive classes to match current screen.
     */
    function _updateSidebarActive(screenName) {
        var navIndex = _navScreens.indexOf(screenName);

        _sidebarItems.forEach(function(item, i) {
            if (i === navIndex) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    /**
     * Show login screen (called by Settings logout).
     */
    function showLogin() {
        _showLogin();
    }

    /**
     * Get the API instance (convenience for screens).
     */
    function getApi() {
        return AuthManager.getApi();
    }

    /**
     * Return the current screen name (or null before first navigation).
     */
    function getCurrentScreen() {
        return _currentScreen;
    }

    // =========================================
    //  Bootstrap
    // =========================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        init: init,
        navigateTo: navigateTo,
        goBack: goBack,
        showLogin: showLogin,
        showAppShell: _showAppShell,
        getApi: getApi,
        getCurrentScreen: getCurrentScreen,
        showToast: showToast,
        showColourHints: showColourHints,
        hideColourHints: hideColourHints,
        applyAccentColor: applyAccentColor,
        saveAccentColor: saveAccentColor,
        resetAccentColor: resetAccentColor,
        getAccentColor: getAccentColor,
        getAccentRgb: getAccentRgb,
        DEFAULT_ACCENT_HEX: DEFAULT_ACCENT_HEX,
        DEFAULT_ACCENT_RGB: DEFAULT_ACCENT_RGB
    };
})();
