// TODO: Find out when access token is automatically refreshed, and update local token

const fs = require("fs");
const google = require("googleapis");
// TODO: Handle missing files
let key = require("../credentials/youtubeKey.json");
let token = require("../credentials/youtubeToken.json");

const port = process.env.PORT || 8000;

const youtube = google.youtube("v3"),
  OAuth2 = google.auth.OAuth2,
  scope = "https://www.googleapis.com/auth/youtube",
  redirectUri = `http://localhost:${port}/yt-auth`;

// Get client ID and secret from file
let clientId, clientSecret;
if (key.web) {
  key = key.web;
}
if (key.client_id && key.client_secret) {
  clientId = key.client_id;
  clientSecret = key.client_secret;
} else {
  console.error(
    "No usable YouTube key found. Please download your API key from the Google API Console."
  );
}

// Set up OAuth2 client
let oauth2Client = new OAuth2(clientId, clientSecret, redirectUri);
google.options({
  auth: oauth2Client
});
let authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline", // 'online' (default) or 'offline' (gets refresh_token)
  scope: scope,
  prompt: "consent" // makes sure we get a refresh_token every time
});

module.exports = {
  authUrl: authUrl,
  ready: false,

  authorize: code => {
    return new Promise((resolve, reject) => {
      oauth2Client.getToken(code, (err, tokens) => {
        // Now tokens contains an access_token and an optional refresh_token. Save them.
        if (!err) {
          // Store tokens locally
          try {
            fs.writeFile(
              "./credentials/youtubeToken.json",
              JSON.stringify(tokens),
              "utf-8",
              err => {
                err && reject(err);
              }
            );
          } catch (err) {
            // TODO: Error handling
            throw err;
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
      youtube.search.list(
        {
          part: "snippet",
          q: query,
          type: "video"
        },
        (err, data) => (err ? reject(err) : resolve(data))
      );
    });
  },

  list: listId => {
    return new Promise((resolve, reject) => {
      youtube.playlistItems.list(
        {
          part: "snippet",
          playlistId: listId
        },
        (err, data) => (err ? reject(err) : resolve(data))
      );
    });
  },

  add: (track, listId) => {
    return new Promise((resolve, reject) => {
      let id;
      if (typeof track === "string") {
        id = track;
      } else {
        try {
          id = track.id.videoId;
        } catch (e) {
          reject(e);
        }
      }
      youtube.playlistItems.insert(
        {
          part: "snippet",
          resource: {
            snippet: {
              playlistId: listId,
              resourceId: {
                kind: "youtube#video",
                videoId: id
              }
            }
          }
        },
        (err, data) => (err ? reject(err) : resolve(data))
      );
    });
  },

  getChannelTitle: track => {
    return new Promise((resolve, reject) => {
      let id = track.snippet.resourceId.videoId;
      youtube.videos.list(
        {
          part: "snippet",
          id: id
        },
        (err, data) =>
          err ? reject(err) : resolve(data.items[0].snippet.channelTitle)
      );
    });
  },

  remove: track => {
    return new Promise((resolve, reject) => {
      youtube.playlistItems.delete({ id: track.id }, (err, data) =>
        err ? reject(err) : resolve(data)
      );
    });
  }
};

// Retrieve token from file and use it
if (token["access_token"] || token["refresh_token"]) {
  oauth2Client.setCredentials(token);
  console.log("Retrieved YouTube token from local storage");
  module.exports.ready = true;
} else {
  console.error("No usable YouTube token found. Please authorize the app.");
}
