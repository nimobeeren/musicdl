// TODO: Find out when access token is automatically refreshed, and update local token

const fs = require('fs');
const google = require('googleapis');
const key = require('./credentials/yt-key.json');
const token = require('./credentials/yt-token.json');

let youtube = google.youtube('v3'),
    OAuth2 = google.auth.OAuth2,
    scope = 'https://www.googleapis.com/auth/youtube',
    clientId = key.web.client_id,
    clientSecret = key.web.client_secret,
    redirectUri = 'http://localhost:8000/yt-auth';

let oauth2Client = new OAuth2(clientId, clientSecret, redirectUri);

google.options({
    auth: oauth2Client
});

let authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // 'online' (default) or 'offline' (gets refresh_token)
    scope: scope,
    prompt: 'consent' // makes sure we get a refresh_token every time
});

module.exports = {
    authUrl: authUrl,
    ready: false,

    authorize: code => {
        return new Promise((resolve, reject) => {
            // TODO: promisify
            oauth2Client.getToken(code, (err, tokens) => {
                // Now tokens contains an access_token and an optional refresh_token. Save them.
                if (!err) {
                    // Store tokens locally
                    try {
                        fs.writeFile('./credentials/yt-token.json', JSON.stringify(tokens), 'utf-8', err => {
                            err && reject(err);
                        });
                    } catch (e) {
                        // TODO: Error handling
                        throw(e);
                    }

                    // Set the tokens on the API object to use it in later calls
                    oauth2Client.setCredentials(tokens);

                    // Reflect ready state
                    module.exports.ready = true;
                    resolve(tokens);
                } else {
                    reject(err);
                }
            });
        });
    },

    search: query => {
        return new Promise((resolve, reject) => {
            youtube.search.list({
                part: 'snippet',
                q: query,
                type: 'video'
            }, (err, data) => err ? reject(err) : resolve(data))
        });
    },

    list: listId => {
        return new Promise((resolve, reject) => {
            youtube.playlistItems.list({
                part: 'snippet',
                playlistId: listId,
            }, (err, data) => err ? reject(err) : resolve(data));
        });
    },

    add: (track, listId) => {
        return new Promise((resolve, reject) => {
            let id;
            if (typeof track === 'string') {
                id = track;
            } else {
                try {
                    id = track.id.videoId;
                } catch (e) {
                    reject(e);
                }
            }
            youtube.playlistItems.insert({
                part: 'snippet',
                resource: {
                    snippet: {
                        playlistId: listId,
                        resourceId: {
                            kind: 'youtube#video',
                            videoId: id
                        }
                    }
                }
            }, (err, data) => err ? reject(err) : resolve(data));
        });
    },

    remove: track => {
        return new Promise((resolve, reject) => {
           youtube.playlistItems.delete({id: track.id}, (err, data) => err ? reject(err) : resolve(data));
        });
    }
};

// Retrieves tokens from local storage and uses them
if (token['access_token'] || token['refresh_token']) {
    oauth2Client.setCredentials(token);
    console.log("Retrieved YouTube tokens from local storage");
    module.exports.ready = true;
} else {
    console.log("YouTube token is unknown format or damaged");
}
