// TODO: Get IDs of YouTube playlist items
// Download video
// TODO: Extract audio
// TODO: Get titles of YouTube playlist items
// TODO: Get artist/title of tracks (regex)
// TODO: Tag tracks

const fs = require('fs');
const ytdl = require('ytdl-core');
const shell = require('shelljs');

const routes = require('./routes');
const spotify = require('./spotify');
const youtube = require('./youtube');

const interval = 5000;

function transferPlaylist() {
    if (!spotify.ready) {
        console.log("Spotify not ready");
    }
    if (!youtube.ready) {
        console.log("YouTube not ready")
    }
    if (!spotify.ready || !youtube.ready) {
        return;
    }

    spotify.list().then(tracks => {
        console.log("Retrieved tracks from Spotify");
        tracks.forEach(track => {
            let query = track.artists[0].name + ' - ' + track.name;
            youtube.search(query).then(result => {
                let id = result.items[0].id.videoId;
                youtube.add(id).then(data => {
                    console.log("Added track to YouTube (id: " +  id + ")");
                }, console.error);
            }, console.error);
        });

        spotify.remove(tracks).then(data => {
            console.log("Removed tracks from Spotify");
        }, console.error);
    }, console.error);
}

function downloadVideo(url) {
    let format = undefined;
    ytdl.getInfo(url, (err, info) => {
        info.formats.forEach(fmt => {
            // TODO: Decide if we want the best audiobitrate format without video, or just the best audiobitrate overall
            console.log(fmt.resolution, fmt.audioBitrate, fmt.audioEncoding);
            if (fmt.audioEncoding === 'aac' && (!format || fmt.audioBitrate > format.audioBitrate)) {
                format = fmt;
                // console.log('New best', format.resolution, format.audioEncoding, format.audioBitrate);
            }
        });
    });

    let track = ytdl(url, { format: format });
    track.pipe(fs.createWriteStream('track.mp4'));
    track.on('info', (info, fmt) => {
        console.log('Downloading', fmt.resolution, fmt.audioEncoding, fmt.audioBitrate);
    });
    track.on('progress', (chunkLength, downloaded, total) => console.log(downloaded / total * 100 + '%'));
    track.on('end', () => console.log('Done'));
}

function extractAudio(filepath) {
    shell.exec('ffmpeg');
}

// setInterval(transferPlaylist, interval); // TODO: Make an event listener/emitter?
downloadVideo('1nwgLz-_eOo');
