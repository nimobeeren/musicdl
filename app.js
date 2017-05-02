const routes = require('./routes');
const spotify = require('./spotify');
const youtube = require('./youtube');

const interval = 10000;

function transferPlaylist() {
    if (!spotify.ready || !youtube.ready) {
        console.log('Not yet authenticated');
        return;
    }

    spotify.list().then(tracks => {
        tracks.forEach(track => {
            let query = track.artists[0].name + ' - ' + track.name;
            // console.log('Searching for: ' + query);
            youtube.search(query).then(result => {
                let id = result.items[0].id.videoId;
                // console.log('Result: ' + id);
                youtube.add(id).then(data => {
                    console.log('Added to YouTube', id);
                }, console.error);
            }, console.error);
        });

        spotify.remove(tracks).then(data => {
            console.log('Removed tracks from Spotify');
        });
    }, console.error);
}

setInterval(transferPlaylist, interval);
