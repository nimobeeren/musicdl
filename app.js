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
                    console.log("Added track to YouTube (id: " + id + ")");
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
    // Get YouTube playlist content
    youtube.list().then(data => {
        console.log("Received YouTube playlist content");
        data.items.forEach(track => {
            // Download each track
            console.log("Downloading " + track.snippet.title);
            downloadVideo(track).then(data => {
                // Extract audio, generate and apply tags
                console.log("Finished " + track.snippet.title);
                let tags = getTags(track.snippet.title);
                extractAudio('track.mp4', tags).then(data => {
                    console.log('Extracted audio');
                }, console.error);
            }, console.error);

            // Clear the YouTube playlist
            youtube.remove(track).then(data => {
                console.log("Removed YouTube playlist item " + track.snippet.title);
            }, console.error);
        });
    }, console.error);
}

// TODO: Error handling
function downloadVideo(track) {
    return new Promise((resolve, reject) => {
        let id = track.snippet.resourceId.videoId;
        let format = undefined;

        // Find the best format to download
        ytdl.getInfo(id).then(info => {
            info.formats.forEach(fmt => {
                // TODO: prioritize non-video streams with the same bitrate
                if (fmt.audioEncoding === 'aac' && (!format || fmt.audioBitrate > format.audioBitrate)) {
                    format = fmt;
                }
            });

            // Create downloader object
            let downloader = ytdl(id, {format: format});

            // Write downloaded video to disk
            try {
                downloader.pipe(fs.createWriteStream('track.mp4'));
            } catch (err) {
                reject(err);
            }

            // Print download info
            downloader.on('info', (info, fmt) => {
                console.log('Format: ' + fmt.resolution + fmt.audioEncoding + fmt.audioBitrate);
            });

            // Print progress every so often
            let lastProgress = 0;
            downloader.on('progress', (chunkLength, downloaded, total) => {
                let percent = downloaded / total * 100;
                if (percent >= lastProgress + 10) {
                    console.log(percent + '%');
                    lastProgress = percent;
                }
            });

            // Resolve promise when download ends
            downloader.on('end', resolve);
        }, console.error);
    });
}

// TODO: Make tags param optional and support partial
function extractAudio(filepath, tags) {
    return new Promise((resolve, reject) => {
        let filename = 'track.m4a';
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
downloadVideo({
    snippet: {
        resourceId: {
            videoId: 'Bs7yv3G2bSo'
        }
    }
}).then(data => {
    extractAudio('track.mp4', {artist: '', title: '', genre: ''});
}, console.error);
