const fs = require('fs');
const SpotifyWebApi = require('spotify-web-api-node');
// TODO: Handle missing files
const key = require('./credentials/spotifyKey.json');
const token = require('./credentials/spotifyToken.json');

let scopes = ['playlist-modify-private'],
    redirectUri = 'http://localhost:8000/sp-auth',
    state = 'authorizing';

// Get client ID and secret from file
let clientId, clientSecret;
if (key.client_id && key.client_secret) {
    clientId = key.client_id;
    clientSecret = key.client_secret;
} else {
    console.error("No usable Spotify key found. Please get your API credentials from Spotify for Developers.");
}

// Set up API client
let spotify = new SpotifyWebApi({
    clientId: clientId,
    clientSecret: clientSecret,
    redirectUri: redirectUri
});
let authUrl = spotify.createAuthorizeURL(scopes, state);

module.exports = {
    authUrl: authUrl,
    ready: false,

    /**
     * Authorizes the app.
     * @param code Authorization code from Spotify
     */
    authorize: code => {
        return new Promise((resolve, reject) => {
            // Use code to get access and refresh tokens
            spotify.authorizationCodeGrant(code)
                .then(data => {
                    // Store tokens locally
                    try {
                        fs.writeFile('./credentials/spotifyToken.json', JSON.stringify(data.body), 'utf-8', err => {
                            err && reject(err);
                        });
                    } catch (err) {
                        // TODO: Error handling
                        throw err;
                    }

                    // Set the tokens on the API object to use it in later calls
                    spotify.setAccessToken(data.body['access_token']);
                    spotify.setRefreshToken(data.body['refresh_token']);

                    // Reflect ready state
                    module.exports.ready = true;
                    resolve(data.body);
                }, reject);
        });
    },

    /**
     * Gets an array of tracks from the specified playlist.
     */
    list: (username, listId) => {
        // TODO: Handle 429 too many requests properly
        return new Promise((resolve, reject) => {
            // Get the playlist content
            spotify.getPlaylist(username, listId)
                .then(data => {
                    resolve(data.body.tracks.items.map(track => track.track));
                }, err => {
                    // If we are unauthorized, refresh the access token and retry
                    if (err.statusCode === 401) {
                        spotify.refreshAccessToken()
                            .then(data => {
                                token['access_token'] = data.body['access_token'];
                                spotify.setAccessToken(token['access_token']);
                                try {
                                    fs.writeFile('./credentials/spotifyToken.json', JSON.stringify(token), 'utf-8', err => {
                                        err && reject(err);
                                    });
                                } catch (err) {
                                    // TODO: Error handling
                                    throw err;
                                }

                                spotify.getPlaylist(username, listId)
                                    .then(data => {
                                        resolve(data.body.tracks.items.map(track => track.track));
                                    }, reject);
                            }, reject);
                    } else {
                        reject(err);
                    }
                });
        });
    },

    /**
     * Removes a set of tracks from the specified playlist.
     * @param username Spotify username
     * @param listId Spotify playlist ID
     * @param tracks
     */
    remove: (username, listId, tracks) => {
        return new Promise((resolve, reject) => {
            spotify.removeTracksFromPlaylist(username, listId, tracks, {})
                .then(resolve, err => {
                    // If we are unauthorized, refresh the access token and retry
                    if (err.statusCode === 401) {
                        spotify.refreshAccessToken()
                            .then(data => {
                                token['access_token'] = data.body['access_token'];
                                spotify.setAccessToken(token['access_token']);
                                try {
                                    fs.writeFile('./credentials/spotifyToken.json', JSON.stringify(token), 'utf-8', err => {
                                        err && reject(err);
                                    });
                                } catch (err) {
                                    // TODO: Error handling
                                    throw err;
                                }

                                spotify.removeTracksFromPlaylist(username, listId, tracks, {})
                                    .then(resolve, reject);
                            }, reject);
                    } else {
                        reject(err);
                    }
                });
        });
    }
};

// Retrieve tokens from local storage and uses them
if (token['access_token'] || token['refresh_token']) {
    spotify.setAccessToken(token['access_token']);
    spotify.setRefreshToken(token['refresh_token']);
    module.exports.ready = true;
    console.log("Retrieved Spotify token from local storage");
} else {
    console.log("No usable Spotify token found. Please authorize the app.");
}
