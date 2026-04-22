/* ============================================
   Sonance — Focus Manager
   D-Pad navigation system for Samsung TV remote
   ============================================ */

var FocusManager = (function() {
    'use strict';

    var log = SonanceUtils.log;

    // Zone registry: name → config object
    var _zones = {};
    // Per-zone remembered focus index
    var _focusIndex = {};
    // Currently active zone name
    var _activeZone = null;
    // Currently focused DOM element
    var _currentElement = null;
    // Input mode: suppresses d-pad handling while a native input has focus (Tizen IME)
    var _inputMode = false;

    function init() {
        log('Focus', 'FocusManager initialized');
        document.addEventListener('keydown', _handleKeyDown);
    }

    /**
     * Register a focus zone.
     * config: {
     *   selector: string,          // CSS selector for focusable elements
     *   getElements: function,     // Alternative: returns element array
     *   columns: number,           // Grid columns (1 = vertical list)
     *   onActivate: function(idx, el),  // Enter key handler
     *   onFocus: function(idx, el),     // Focus change handler
     *   neighbors: { up, down, left, right },  // Adjacent zone names
     *   defaultIndex: number       // Initial focus index
     * }
     */
    function registerZone(name, config) {
        _zones[name] = config;
        if (_focusIndex[name] === undefined) {
            _focusIndex[name] = config.defaultIndex || 0;
        }
        log('Focus', 'Zone registered: ' + name);
    }

    function unregisterZone(name) {
        delete _zones[name];
        delete _focusIndex[name];
        if (_activeZone === name) {
            _activeZone = null;
        }
    }

    /**
     * Clear all zones except sidebar and nowplaying-bar.
     * Called when navigating between screens.
     */
    function clearContentZones() {
        var toRemove = [];
        Object.keys(_zones).forEach(function(name) {
            if (name !== 'sidebar' && name !== 'nowplaying-bar') {
                toRemove.push(name);
            }
        });
        toRemove.forEach(function(name) {
            delete _zones[name];
            delete _focusIndex[name];
        });
        // If active zone was a content zone, reset it
        if (_activeZone && _activeZone !== 'sidebar' && _activeZone !== 'nowplaying-bar') {
            _activeZone = null;
            if (_currentElement) {
                _currentElement.classList.remove('focused');
                _currentElement = null;
            }
        }
    }

    /**
     * Set the active focus zone and optionally the focus index.
     */
    function setActiveZone(name, index) {
        if (!_zones[name]) {
            log('Focus', 'Zone not found: ' + name);
            return;
        }
        _activeZone = name;
        if (index !== undefined) {
            _focusIndex[name] = index;
        }
        _updateFocus();
    }

    /**
     * Get the DOM elements for a zone.
     */
    function _getElements(zone) {
        if (zone.getElements) {
            return zone.getElements();
        }
        if (zone.selector) {
            return Array.prototype.slice.call(document.querySelectorAll(zone.selector));
        }
        return [];
    }

    /**
     * Update the visual focus: remove old, apply new.
     */
    function _updateFocus() {
        // Remove previous focus class
        if (_currentElement) {
            _currentElement.classList.remove('focused');
        }

        var zone = _zones[_activeZone];
        if (!zone) return;

        var elements = _getElements(zone);
        if (elements.length === 0) return;

        // Clamp index to valid range
        var idx = _focusIndex[_activeZone];
        if (idx === undefined || idx === null || idx < 0) idx = 0;
        if (idx >= elements.length) idx = elements.length - 1;
        _focusIndex[_activeZone] = idx;

        // Apply focus
        _currentElement = elements[idx];
        _currentElement.classList.add('focused');

        // Blur any browser-focused input to prevent dual focus
        var activeEl = document.activeElement;
        if (activeEl && activeEl !== document.body && activeEl !== _currentElement) {
            if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') {
                activeEl.blur();
            }
        }

        // Scroll focused element into view
        try {
            _currentElement.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } catch (e) {
            _currentElement.scrollIntoView(false);
        }

        // Notify zone
        if (zone.onFocus) {
            zone.onFocus(idx, _currentElement);
        }
    }

    /**
     * Move focus in a direction within the current zone.
     * At zone edges, tries transitioning to a neighbor zone.
     */
    function moveFocus(direction) {
        var zone = _zones[_activeZone];
        if (!zone) return;

        // Allow zones to intercept directional input (e.g. seeking)
        if (zone.onKey && zone.onKey(direction) === true) return;

        var elements = _getElements(zone);
        if (elements.length === 0) return;

        var cols = zone.columns || 1;
        var idx = _focusIndex[_activeZone] || 0;
        var newIdx = idx;

        if (direction === 'up') {
            newIdx = idx - cols;
            if (newIdx < 0) {
                _tryTransition('up');
                return;
            }
        } else if (direction === 'down') {
            newIdx = idx + cols;
            if (newIdx >= elements.length) {
                _tryTransition('down');
                return;
            }
        } else if (direction === 'left') {
            if (cols > 1 && (idx % cols) > 0) {
                newIdx = idx - 1;
            } else {
                _tryTransition('left');
                return;
            }
        } else if (direction === 'right') {
            if (cols > 1 && (idx % cols) < cols - 1 && idx + 1 < elements.length) {
                newIdx = idx + 1;
            } else {
                _tryTransition('right');
                return;
            }
        }

        _focusIndex[_activeZone] = newIdx;
        _updateFocus();
    }

    /**
     * Try to transition focus to a neighbor zone.
     */
    function _tryTransition(direction) {
        var zone = _zones[_activeZone];
        if (!zone || !zone.neighbors) return;

        var neighborName = zone.neighbors[direction];
        if (!neighborName) return;

        var neighbor = _zones[neighborName];
        if (!neighbor) return;

        var elements = _getElements(neighbor);
        if (elements.length === 0) return;

        // Determine target index in neighbor zone
        var targetIdx;
        if (direction === 'up') {
            // Coming from below: land on last item
            targetIdx = elements.length - 1;
        } else if (direction === 'down') {
            // Coming from above: land on first item
            targetIdx = 0;
        } else {
            // Left/Right: preserve remembered position
            targetIdx = _focusIndex[neighborName] || 0;
        }

        targetIdx = Math.max(0, Math.min(targetIdx, elements.length - 1));
        _focusIndex[neighborName] = targetIdx;
        _activeZone = neighborName;
        _updateFocus();
    }

    /**
     * Activate (Enter key) the currently focused element.
     */
    function activateFocused() {
        var zone = _zones[_activeZone];
        if (!zone) return;

        var elements = _getElements(zone);
        var idx = _focusIndex[_activeZone] || 0;

        if (idx < elements.length && zone.onActivate) {
            zone.onActivate(idx, elements[idx]);
        }
    }

    function getCurrentFocused() {
        return _currentElement;
    }

    function getActiveZone() {
        return _activeZone;
    }

    /**
     * Set input mode — suppresses d-pad handling while a native input has focus.
     * Called by login screen (and any future input screens) on focus/blur.
     */
    function setInputMode(enabled) {
        _inputMode = !!enabled;
        log('Focus', 'Input mode: ' + (_inputMode ? 'ON' : 'OFF'));
    }

    /**
     * Central keyboard event handler.
     * Handles arrow keys, Enter, Back/Escape, and media keys.
     */
    function _handleKeyDown(e) {
        var keyCode = e.keyCode;

        // If focused in an input/textarea, don't intercept navigation keys
        var activeEl = document.activeElement;
        var isInput = activeEl && (
            activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'SELECT'
        );

        if (isInput || _inputMode) {
            // Only intercept Escape/Back in inputs to return to managed focus
            if (keyCode === 10009 || keyCode === 27) {
                e.preventDefault();
                if (activeEl && activeEl.blur) {
                    activeEl.blur();
                }
                _inputMode = false;
                if (_activeZone) {
                    _updateFocus();
                }
            }
            return; // Let input handle all other keys normally
        }

        // Back (Samsung 10009) / Escape (browser 27) — always handle, even without active zone
        if (keyCode === 10009 || keyCode === 27) {
            e.preventDefault();
            if (typeof App !== 'undefined' && App.goBack) {
                App.goBack();
            }
            return;
        }

        // If no active zone, don't intercept anything else
        if (!_activeZone) return;

        // Arrow keys
        if (keyCode === 38) { // Up
            e.preventDefault();
            moveFocus('up');
        } else if (keyCode === 40) { // Down
            e.preventDefault();
            moveFocus('down');
        } else if (keyCode === 37) { // Left
            e.preventDefault();
            moveFocus('left');
        } else if (keyCode === 39) { // Right
            e.preventDefault();
            moveFocus('right');
        }
        // Enter
        else if (keyCode === 13) {
            e.preventDefault();
            activateFocused();
        }
        // Media keys — forwarded to Player
        else if (keyCode === 10252) { // Play/Pause
            e.preventDefault();
            if (typeof Player !== 'undefined') Player.togglePlayPause();
        } else if (keyCode === 10253) { // Stop
            e.preventDefault();
            if (typeof Player !== 'undefined') Player.pause();
        } else if (keyCode === 10412) { // Rewind/Previous
            e.preventDefault();
            if (typeof Player !== 'undefined') Player.previous();
        } else if (keyCode === 10417) { // Fast Forward/Next
            e.preventDefault();
            if (typeof Player !== 'undefined') Player.next();
        }
        // Spacebar — Play/Pause (browser testing convenience)
        else if (keyCode === 32) {
            e.preventDefault();
            if (typeof Player !== 'undefined') Player.togglePlayPause();
        }
        // Samsung colour buttons (always handle)
        else if (keyCode === 403 || e.key === 'ColorF0Red') {
            e.preventDefault();
            _handleColourButton('red');
        } else if (keyCode === 404 || e.key === 'ColorF1Green') {
            e.preventDefault();
            _handleColourButton('green');
        } else if (keyCode === 405 || e.key === 'ColorF2Yellow') {
            e.preventDefault();
            _handleColourButton('yellow');
        } else if (keyCode === 406 || e.key === 'ColorF3Blue') {
            e.preventDefault();
            _handleColourButton('blue');
        }
        // Browser keyboard fallbacks (R/G/Y/B) — only if active zone supports colour buttons
        else if (_hasColourButtonSupport()) {
            if (e.key === 'r' || e.key === 'R') {
                e.preventDefault();
                _handleColourButton('red');
            } else if (e.key === 'g' || e.key === 'G') {
                e.preventDefault();
                _handleColourButton('green');
            } else if (e.key === 'y' || e.key === 'Y') {
                e.preventDefault();
                _handleColourButton('yellow');
            } else if (e.key === 'b' || e.key === 'B') {
                e.preventDefault();
                _handleColourButton('blue');
            }
        }
    }

    /**
     * Check if the active zone supports colour buttons.
     */
    function _hasColourButtonSupport() {
        var zone = _zones[_activeZone];
        return zone && typeof zone.onColourButton === 'function';
    }

    /**
     * Handle colour button press — delegates to the active zone's onColourButton handler.
     */
    function _handleColourButton(colour) {
        var zone = _zones[_activeZone];
        if (!zone || !zone.onColourButton) return;

        var elements = _getElements(zone);
        var idx = _focusIndex[_activeZone] || 0;
        if (idx < elements.length) {
            zone.onColourButton(colour, idx, elements[idx]);
        }
    }

    return {
        init: init,
        registerZone: registerZone,
        unregisterZone: unregisterZone,
        clearContentZones: clearContentZones,
        setActiveZone: setActiveZone,
        moveFocus: moveFocus,
        activateFocused: activateFocused,
        getCurrentFocused: getCurrentFocused,
        getActiveZone: getActiveZone,
        setInputMode: setInputMode
    };
})();
