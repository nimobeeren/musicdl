let fs = require('fs'),
    google = require('googleapis'),
    key = require('./credentials/yt-key.json'),
    token = require('./credentials/yt-token.json');

let youtube = google.youtube('v3'),
    OAuth2 = google.auth.OAuth2,
    scope = 'https://www.googleapis.com/auth/youtube',
    clientId = key.web.client_id,
    clientSecret = key.web.client_secret,
    redirectUri = 'http://localhost:8000/yt-auth',
    // playlistId = 'PLwLvzZrbay3VIIGzAhJsQ4LWeVLA7tysk'; // real
    playlistId = 'PLwLvzZrbay3WqC63k3JJ7WicerCzT4BQ2'; // test

let oauth2Client = new OAuth2(clientId, clientSecret, redirectUri);

google.options({
    auth: oauth2Client
});

let authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // 'online' (default) or 'offline' (gets refresh_token)
    scope: scope
});

module.exports = {
    authUrl: authUrl,
    ready: false,

    authorize: code => {
        return new Promise((resolve, reject) => {
            // todo: promisify
            oauth2Client.getToken(code, (err, tokens) => {
                // Now tokens contains an access_token and an optional refresh_token. Save them.
                if (!err) {
                    oauth2Client.setCredentials(tokens);
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
            let result = youtube.search.list({
                part: 'snippet',
                q: query,
                type: 'video'
            }, (err, data) => err ? reject(err) : resolve(data))
        });
    },

    add: track => {
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
                        playlistId: playlistId,
                        resourceId: {
                            kind: 'youtube#video',
                            videoId: id
                        }
                    }
                }
            }, (err, data) => err ? reject(err) : resolve(data));
        });
    }
};
