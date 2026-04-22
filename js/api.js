/* ============================================
   Sonance — Subsonic API Client
   ============================================ */

var SubsonicAPI = (function() {
    'use strict';

    var log = SonanceUtils.log;
    var warn = SonanceUtils.warn;
    var error = SonanceUtils.error;

    // --- Response Cache ---
    var _cache = {};
    var CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    // --- Helper: ensure value is array ---
    function _ensureArray(val) {
        if (!val) return [];
        if (Array.isArray(val)) return val;
        return [val];
    }

    function SubsonicAPI(config) {
        this.serverUrl = config.serverUrl.replace(/\/+$/, ''); // strip trailing slashes
        this.username = config.username;
        this.password = config.password;

        log('API', 'Initialized for ' + this.serverUrl + ' as ' + this.username);
    }

    // Build full URL with auth params
    SubsonicAPI.prototype._buildUrl = function(endpoint, params) {
        var salt = SonanceUtils.generateSalt(12);
        var token = SonanceUtils.md5(this.password + salt);

        var url = this.serverUrl + '/rest/' + endpoint;
        var queryParts = [
            'u=' + encodeURIComponent(this.username),
            't=' + token,
            's=' + salt,
            'v=1.16.1',
            'c=Sonance',
            'f=json'
        ];

        if (params) {
            Object.keys(params).forEach(function(key) {
                if (params[key] !== undefined && params[key] !== null) {
                    queryParts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
                }
            });
        }

        return url + '?' + queryParts.join('&');
    };

    // Fetch wrapper with error handling and timeout
    SubsonicAPI.prototype._request = function(endpoint, params) {
        var url = this._buildUrl(endpoint, params);
        log('API', 'Request: ' + endpoint);

        return new Promise(function(resolve, reject) {
            var timeoutId = setTimeout(function() {
                reject(new Error('Request timed out. Check your server connection.'));
            }, 10000);

            fetch(url).then(function(response) {
                clearTimeout(timeoutId);
                if (!response.ok) {
                    throw new Error('Server returned HTTP ' + response.status);
                }
                return response.json();
            }).then(function(data) {
                var subResponse = data['subsonic-response'];
                if (!subResponse) {
                    throw new Error('Invalid response from server');
                }
                if (subResponse.status !== 'ok') {
                    var errMsg = (subResponse.error && subResponse.error.message) || 'Unknown server error';
                    var errCode = (subResponse.error && subResponse.error.code) || 0;
                    throw new Error(errMsg + ' (code ' + errCode + ')');
                }
                resolve(subResponse);
            }).catch(function(err) {
                clearTimeout(timeoutId);
                error('API', endpoint + ' failed: ' + err.message);
                reject(err);
            });
        });
    };

    // Cached request — returns cached data if within TTL
    SubsonicAPI.prototype._cachedRequest = function(endpoint, params) {
        var key = endpoint + '|' + JSON.stringify(params || {});
        var cached = _cache[key];
        if (cached && (Date.now() - cached.time) < CACHE_TTL) {
            log('API', 'Cache hit: ' + endpoint);
            return Promise.resolve(cached.data);
        }
        return this._request(endpoint, params).then(function(data) {
            _cache[key] = { data: data, time: Date.now() };
            return data;
        });
    };

    // --- Public Methods ---

    SubsonicAPI.prototype.ping = function() {
        return this._request('ping.view').then(function() {
            return { ok: true };
        });
    };

    SubsonicAPI.prototype.getStreamUrl = function(songId) {
        return this._buildUrl('stream.view', { id: songId });
    };

    SubsonicAPI.prototype.getCoverArtUrl = function(id, size) {
        var params = { id: id };
        if (size) params.size = size;
        return this._buildUrl('getCoverArt.view', params);
    };

    // --- Album List ---
    // types: 'recent', 'frequent', 'newest', 'random', 'alphabeticalByName', 'alphabeticalByArtist', 'starred'
    SubsonicAPI.prototype.getAlbumList2 = function(type, size, offset) {
        var params = { type: type };
        if (size) params.size = size;
        if (offset) params.offset = offset;
        return this._cachedRequest('getAlbumList2.view', params).then(function(data) {
            var list = data && data.albumList2;
            return _ensureArray(list && list.album);
        });
    };

    // --- Single Album with tracks ---
    SubsonicAPI.prototype.getAlbum = function(id) {
        return this._cachedRequest('getAlbum.view', { id: id }).then(function(data) {
            var album = data && data.album;
            if (album && album.song) {
                album.song = _ensureArray(album.song);
            }
            return album || null;
        });
    };

    // --- Artists (ID3-based) ---
    SubsonicAPI.prototype.getArtists = function() {
        return this._cachedRequest('getArtists.view').then(function(data) {
            var indices = data && data.artists && data.artists.index;
            if (!indices) return [];
            var artists = [];
            _ensureArray(indices).forEach(function(idx) {
                _ensureArray(idx && idx.artist).forEach(function(a) {
                    artists.push(a);
                });
            });
            return artists;
        });
    };

    // --- Single Artist ---
    SubsonicAPI.prototype.getArtist = function(id) {
        return this._cachedRequest('getArtist.view', { id: id }).then(function(data) {
            var artist = data && data.artist;
            if (artist && artist.album) {
                artist.album = _ensureArray(artist.album);
            }
            return artist || null;
        });
    };

    // --- Artist Info (biography, images, similar artists) ---
    SubsonicAPI.prototype.getArtistInfo2 = function(id) {
        return this._cachedRequest('getArtistInfo2.view', { id: id }).then(function(data) {
            var info = data && data.artistInfo2;
            if (info && info.similarArtist) {
                info.similarArtist = _ensureArray(info.similarArtist);
            }
            return info || null;
        });
    };

    // --- Genres ---
    SubsonicAPI.prototype.getGenres = function() {
        return this._cachedRequest('getGenres.view').then(function(data) {
            var genres = data && data.genres;
            return _ensureArray(genres && genres.genre);
        });
    };

    // --- Playlists ---
    SubsonicAPI.prototype.getPlaylists = function() {
        return this._cachedRequest('getPlaylists.view').then(function(data) {
            var playlists = data && data.playlists;
            return _ensureArray(playlists && playlists.playlist);
        });
    };

    SubsonicAPI.prototype.getPlaylist = function(id) {
        return this._cachedRequest('getPlaylist.view', { id: id }).then(function(data) {
            return (data && data.playlist) || null;
        });
    };

    // --- Starred / Favourites ---
    SubsonicAPI.prototype.getStarred2 = function() {
        return this._cachedRequest('getStarred2.view').then(function(data) {
            var starred = data && data.starred2;
            return {
                album: _ensureArray(starred && starred.album),
                song: _ensureArray(starred && starred.song),
                artist: _ensureArray(starred && starred.artist)
            };
        });
    };

    // --- Random Songs ---
    SubsonicAPI.prototype.getRandomSongs = function(size) {
        var params = {};
        if (size) params.size = size;
        return this._cachedRequest('getRandomSongs.view', params).then(function(data) {
            var songs = data && data.randomSongs;
            return _ensureArray(songs && songs.song);
        });
    };

    // --- Search ---
    SubsonicAPI.prototype.search3 = function(query, params) {
        var p = { query: query || '' };
        if (params) {
            Object.keys(params).forEach(function(key) {
                p[key] = params[key];
            });
        }
        return this._cachedRequest('search3.view', p).then(function(data) {
            var result = data && data.searchResult3;
            return {
                artist: _ensureArray(result && result.artist),
                album: _ensureArray(result && result.album),
                song: _ensureArray(result && result.song)
            };
        });
    };

    // --- Songs By Genre ---
    SubsonicAPI.prototype.getSongsByGenre = function(genre, count, offset) {
        var params = { genre: genre };
        if (count) params.count = count;
        if (offset) params.offset = offset;
        return this._cachedRequest('getSongsByGenre.view', params).then(function(data) {
            var songs = data && data.songsByGenre;
            return _ensureArray(songs && songs.song);
        });
    };

    // --- Scrobble (not cached — write operation) ---
    SubsonicAPI.prototype.scrobble = function(id) {
        return this._request('scrobble.view', { id: id });
    };

    // --- Lyrics (OpenSubsonic) ---
    // Returns the raw subsonic-response. Use SonanceUtils.parseLyricsResponse to extract.
    SubsonicAPI.prototype.getLyricsBySongId = function(songId) {
        return this._cachedRequest('getLyricsBySongId.view', { id: songId });
    };

    // --- Star / Unstar (not cached — write operations) ---
    // type: 'song' | 'album' | 'artist' — selects which id param the server expects
    function _starParams(id, type) {
        if (type === 'album') return { albumId: id };
        if (type === 'artist') return { artistId: id };
        return { id: id };
    }

    SubsonicAPI.prototype.star = function(id, type) {
        return this._request('star.view', _starParams(id, type));
    };

    SubsonicAPI.prototype.unstar = function(id, type) {
        return this._request('unstar.view', _starParams(id, type));
    };

    // --- Static: clear cache ---
    SubsonicAPI.clearCache = function() {
        _cache = {};
        log('API', 'Cache cleared');
    };

    return SubsonicAPI;
})();
