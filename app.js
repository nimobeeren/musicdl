// TODO: Get IDs of YouTube playlist items
// Download video
// Extract audio
// TODO: Get titles of YouTube playlist items
// Get artist/title of tracks (regex)
// Tag tracks
// TODO: Remove tracks from YouTube playlist

const fs = require('fs');
const ytdl = require('ytdl-core');
const shell = require('shelljs');

const routes = require('./routes');
const spotify = require('./spotify');
const youtube = require('./youtube');

const interval = 5000;

// TODO: Parameterize playlist IDs
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

// TODO: Parameterize playlist ID
function downloadPlaylist() {
    youtube.list().then(data => {
        data.items.forEach(track => {
            // downloadVideo(track).then(data => {
            //
            // });
            youtube.remove(track).then(console.log, console.error);
        });
    }, console.error);
}

// TODO: Error handling
function downloadVideo(track) {
    return new Promise((resolve, reject) => {
        let id = track.resourceId.videoId;
        let format = undefined;
        // TODO: Promisify
        ytdl.getInfo(id, (err, info) => {
            info.formats.forEach(fmt => {
                // TODO: Decide if we want the best audiobitrate format without video, or just the best audiobitrate overall
                console.log(fmt.resolution, fmt.audioBitrate, fmt.audioEncoding);
                if (fmt.audioEncoding === 'aac' && (!format || fmt.audioBitrate > format.audioBitrate)) {
                    format = fmt;
                    // console.log('New best', format.resolution, format.audioEncoding, format.audioBitrate);
                }
            });
        });

        let track = ytdl(id, { format: format });
        track.pipe(fs.createWriteStream('track.mp4'));
        track.on('info', (info, fmt) => {
            console.log('Downloading', fmt.resolution, fmt.audioEncoding, fmt.audioBitrate);
        });
        track.on('progress', (chunkLength, downloaded, total) => console.log(downloaded / total * 100 + '%'));
        track.on('end', () => resolve());
    });
}

function extractAudio(filepath, tags) {
    return new Promise((resolve, reject) => {
        let filename = 'track.m4a'; // TODO: .m4a or .aac?
        shell.exec(`ffmpeg -i ${filepath} -vn -acodec copy -metadata artist="${tags.artist}" -metadata title="${tags.title}" -metadata genre="${tags.genre}" ${filename}`,
            {silent: true}, (code, stdout, stderr) => {
            code === 0 ? resolve(stdout) : reject(stderr);
        });
    });
}

function getTags(videoTitle) {
    let re = new RegExp('(.*?)(?:\s*-\s*)(.*?)(?:\s*\[.*\])?$');
    let result = re.exec(videoTitle);
    let tags = {
        artist: result[1],
        title: result[2],
        genre: ""
    };

    // TODO: Get genre based on channel (needs video obj as parameter)

    return tags;
}

// setInterval(transferPlaylist, interval); // TODO: Make an event listener/emitter?
// downloadVideo('1nwgLz-_eOo');
// let tags = getTags("Oh shit wadup - It's dat boi");
// extractAudio('track.mp4', tags).then(data => {
//     console.log('Done');
// }, console.error);
downloadPlaylist();