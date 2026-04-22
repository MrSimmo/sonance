/* ============================================
   Sonance — Auth Manager
   ============================================ */

var AuthManager = (function() {
    'use strict';

    var log = SonanceUtils.log;
    var error = SonanceUtils.error;

    var KEYS = {
        SERVER_URL: 'sonance_server_url',
        USERNAME: 'sonance_username',
        PASSWORD: 'sonance_password',
        LOGGED_IN: 'sonance_logged_in'
    };

    var _apiInstance = null;

    function isLoggedIn() {
        return localStorage.getItem(KEYS.LOGGED_IN) === 'true';
    }

    function getCredentials() {
        return {
            serverUrl: localStorage.getItem(KEYS.SERVER_URL) || '',
            username: localStorage.getItem(KEYS.USERNAME) || '',
            password: localStorage.getItem(KEYS.PASSWORD) || ''
        };
    }

    function login(serverUrl, username, password) {
        log('Auth', 'Attempting login to ' + serverUrl + ' as ' + username);

        // Normalize server URL — strip trailing slashes
        serverUrl = serverUrl.replace(/\/+$/, '');

        var api = new SubsonicAPI({
            serverUrl: serverUrl,
            username: username,
            password: password
        });

        return api.ping().then(function() {
            // Store credentials
            localStorage.setItem(KEYS.SERVER_URL, serverUrl);
            localStorage.setItem(KEYS.USERNAME, username);
            localStorage.setItem(KEYS.PASSWORD, password);
            localStorage.setItem(KEYS.LOGGED_IN, 'true');

            // Cache API instance
            _apiInstance = api;

            log('Auth', 'Login successful');
            return { ok: true };
        });
    }

    function logout() {
        log('Auth', 'Logging out');
        Object.keys(KEYS).forEach(function(key) {
            localStorage.removeItem(KEYS[key]);
        });
        _apiInstance = null;
        if (typeof StarredCache !== 'undefined') {
            StarredCache.clear();
        }
    }

    function getApi() {
        if (_apiInstance) return _apiInstance;

        var creds = getCredentials();
        if (!creds.serverUrl || !creds.username) {
            return null;
        }

        _apiInstance = new SubsonicAPI(creds);
        return _apiInstance;
    }

    function getServerDisplay() {
        var url = localStorage.getItem(KEYS.SERVER_URL) || '';
        return url.replace(/^https?:\/\//, '');
    }

    function getUsername() {
        return localStorage.getItem(KEYS.USERNAME) || '';
    }

    return {
        isLoggedIn: isLoggedIn,
        getCredentials: getCredentials,
        login: login,
        logout: logout,
        getApi: getApi,
        getServerDisplay: getServerDisplay,
        getUsername: getUsername
    };
})();
