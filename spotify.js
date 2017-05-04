let fs = require('fs'),
    SpotifyWebApi = require('spotify-web-api-node'),
    key = require('./credentials/sp-key.json'),
    token = require('./credentials/sp-token.json');

let scopes = ['playlist-modify-private'],
    clientId = key.client_id,
    clientSecret = key.client_secret,
    redirectUri = 'http://localhost:8000/sp-auth',
    state = 'authorizing',
    username = '1126761403',
    // playlistId = '61NKK2St0qfHv2QgGya1VX'; // real
    playlistId = '6ZN2ExnpPHiFwaqib4wf0P'; // test

let spotify = new SpotifyWebApi({
    clientId: clientId,
    clientSecret: clientSecret,
    redirectUri: redirectUri
});

let authUrl = spotify.createAuthorizeURL(scopes, state);

module.exports = {
    authUrl: authUrl,
    ready: false,

    init: () => {
        if (token['access_token'] || token['refresh_token']) {
            spotify.setAccessToken(token['access_token']);
            spotify.setRefreshToken(token['refresh_token']);
            module.exports.ready = true;
            console.log("Retrieved Spotify tokens from local storage");
        } else {
            console.log("Spotify token is unknown format or damaged");
        }
    },

    /**
     * Authorizes the app
     * @param code Authorization code from Spotify
     */
    authorize: code => {
        return new Promise((resolve, reject) => {
            // Use code to get access and refresh tokens
            spotify.authorizationCodeGrant(code)
                .then(data => {
                    // Store tokens locally
                    try {
                        fs.writeFile('./credentials/sp-token.json', JSON.stringify(data.body), 'utf-8', err => {
                            err && console.error(err);
                        });
                    } catch (e) {
                        // TODO: Error handling
                        throw(e);
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
     * Gets an array of tracks from the specified playlist
     */
    list: () => {
        return new Promise((resolve, reject) => {
            // Get the playlist content
            spotify.getPlaylist(username, playlistId).then(data => {
                resolve(data.body.tracks.items.map(track => track.track));
            }, err => {
                // If an error occurs, refresh the access token and retry
                console.log("Access token expired, refreshing"); // TODO: Check if error is 'Unauthorized' or different
                spotify.refreshAccessToken().then(data => {
                    token['access_token'] = data.body['access_token'];
                    spotify.setAccessToken(token['access_token']);
                    try {
                        fs.writeFile('./credentials/sp-token.json', JSON.stringify(token), 'utf-8', err => {
                            err && console.error(err);
                        });
                    } catch (e) {
                        // TODO: Error handling
                        throw(e);
                    }

                    spotify.getPlaylist(username, playlistId).then(data => {
                        resolve(data.body.tracks.items.map(track => track.track));
                    }, reject);
                }, console.error);
            });
        });
    },

    /**
     * Removes a set of tracks from the specified playlist
     * @param tracks
     */
    remove: tracks => {
        return new Promise((resolve, reject) => {
            spotify.removeTracksFromPlaylist(username, playlistId, tracks, {}).then(resolve, err => {
                // If an error occurs, refresh the access token and retry
                console.log("Access token expired, refreshing"); // TODO: Check if error is 'Unauthorized' or different
                spotify.refreshAccessToken().then(data => {
                    token['access_token'] = data.body['access_token'];
                    spotify.setAccessToken(token['access_token']);
                    try {
                        fs.writeFile('./credentials/sp-token.json', JSON.stringify(token), 'utf-8', err => {
                            err && console.error(err);
                        });
                    } catch (e) {
                        // TODO: Error handling
                        throw(e);
                    }

                    spotify.removeTracksFromPlaylist(username, playlistId, tracks, {}).then(resolve, reject);
                }, console.error);
            });
        });
    }
};
