const app = require("express")();
const spotify = require("./spotify");
const youtube = require("./youtube");

const port = process.env.PORT || 8000;

app.listen(port, () => {
  console.log("Server listening on port: " + port);
});

app.get("/", (req, res) => {
  let html = "";
  if (!spotify.ready) {
    html += '<a href="' + spotify.authUrl + '">Authorize Spotify</a><br>';
  }
  if (!youtube.ready) {
    html += '<a href="' + youtube.authUrl + '">Authorize YouTube</a><br>';
  }
  if (spotify.ready && youtube.ready) {
    html = "Authorization complete";
  }
  res.send(html);
});

app.get("/sp-auth", (req, res) => {
  // Get authorization code back from Spotify
  let code = req.query.code;

  // Authorize the app
  spotify.authorize(code).then(() => {
    res.send("Spotify ready");
  }, console.error);
});

app.get("/yt-auth", (req, res) => {
  // Get authorization code back from YouTube
  let code = req.query.code;

  // Authorize the app
  youtube.authorize(code).then(() => {
    res.send("YouTube ready");
  }, console.error);
});
