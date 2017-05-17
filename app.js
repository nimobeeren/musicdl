const fs = require('fs');
const ytdl = require('ytdl-core');
const shell = require('shelljs');

const routes = require('./routes');
const spotify = require('./spotify');
const youtube = require('./youtube');

const interval = 5000;

// TODO: Use config file for playlist ID/username
// TODO: Attach these things to the module somehow
const spUsername = '1126761403';
// const spListId = '61NKK2St0qfHv2QgGya1VX'; // real
const spListId = '6ZN2ExnpPHiFwaqib4wf0P'; // test

// const ytListId = 'PLwLvzZrbay3VIIGzAhJsQ4LWeVLA7tysk'; // real
const ytListId = 'PLwLvzZrbay3WqC63k3JJ7WicerCzT4BQ2'; // test

// const outDir = '/home/pi/output';
const outDir = 'C:/Users/Nimo/Desktop';

/**
 * Moves all tracks from a Spotify playlist to a YouTube playlist, using YouTube's search
 * @param spListId Spotify playlist ID
 * @param ytListId YouTube playlist ID
 */
function transferPlaylist(spListId, ytListId) {
    if (!spotify.ready) {
        console.log("Spotify not ready");
    }
    if (!youtube.ready) {
        console.log("YouTube not ready")
    }
    if (!spotify.ready || !youtube.ready) {
        return;
    }

    spotify.list(spUsername, spListId)
        .then(tracks => {
            // Check if playlist is empty
            if (tracks.length === 0) {
                return;
            }

            console.log("Retrieved new tracks from Spotify");
            tracks.forEach(track => {
                let query = track.artists[0].name + ' - ' + track.name;
                youtube.search(query)
                    .then(result => {
                        let id = result.items[0].id.videoId;
                        return youtube.add(id, ytListId);
                    }, console.error)
                    .then(data => {
                        let id = data.snippet.resourceId.videoId;
                        console.log("Added track to YouTube (id: " + id + ")");
                    }, console.error);
            });

            spotify.remove(spUsername, spListId, tracks)
                .then(data => {
                    console.log("Removed tracks from Spotify");
                }, err => {
                    throw(err);
                });
        }, console.error);
}

/**
 * Gets IDs of YouTube playlist items
 * Downloads video
 * Extracts audio from video file
 * Gets titles of YouTube playlist items
 * Gets artist/title of tracks
 * Tags tracks
 * Removes tracks from YouTube playlist
 * @param ytListId YouTube playlist ID
 */
function downloadPlaylist(ytListId) {
    // Get YouTube playlist content
    youtube.list(ytListId)
        .then(data => {
            // Check if playlist is empty
            if (data.items.length === 0) {
                return;
            }

            console.log("Received new tracks from YouTube");
            data.items.forEach(track => {
                let title = track.snippet.title,            // YouTube video title
                    id = track.snippet.resourceId.videoId;  // YouTube video ID

                // Download each track
                console.log("Downloading " + title);
                downloadVideo(track)
                    .then(data => {
                        // Extract audio, generate and apply tags
                        console.log("Finished " + title);
                        let tags = getTags(title);
                        // TODO: Check for illegal characters in video title
                        return extractAudio(id + '.mp4', `${outDir}/${title}.m4a`, tags);
                    }, console.error)
                    .then(data => {
                        console.log('Extracted audio');
                        fs.unlink(id + '.mp4');
                    }, console.error);

                // Clear the YouTube playlist
                youtube.remove(track)
                    .then(data => {
                        console.log("Removed YouTube playlist item " + title);
                    }, console.error);
            });
        }, console.error);
}

/**
 * Downloads a YouTube video using the best audio format
 * @param track The track to download, must be playlistItem from YouTube Data API
 * @returns {Promise}
 */
function downloadVideo(track) {
    return new Promise((resolve, reject) => {
        let id = track.snippet.resourceId.videoId;
        let format = undefined;

        // Find the best format to download
        ytdl.getInfo(id)
            .then(info => {
                info.formats.forEach(fmt => {
                    // TODO: Prioritize non-video streams with the same bitrate
                    // TODO: Find out if we can use opus/vorbis and if it's better quality
                    if (fmt.audioEncoding === 'aac' && (!format || fmt.audioBitrate > format.audioBitrate)) {
                        format = fmt;
                    }
                });

                // Create downloader object
                let downloader = ytdl(id, {format: format});

                // Write downloaded video to disk
                try {
                    downloader.pipe(fs.createWriteStream(id + '.mp4'));
                } catch (err) {
                    reject(err);
                }

                // Print download info
                downloader.on('info', (info, fmt) => {
                    console.log('Format:', fmt.resolution, fmt.audioEncoding, fmt.audioBitrate);
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

function extractAudio(infile, outfile, tags = {}) {
    return new Promise((resolve, reject) => {
        shell.exec(`ffmpeg -i ${infile} -vn -acodec copy -metadata artist="${tags.artist || ''}" -metadata title="${tags.title || ''}" -metadata genre="${tags.genre || ''}" "${outfile}"`,
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
        title: result[2]
    };

    // TODO: Get genre based on channel (needs video obj as parameter)

    return tags;
}

function repeat() {
    transferPlaylist(spListId, ytListId);
    downloadPlaylist(ytListId);
}

setInterval(repeat, interval); // TODO: Make an event listener/emitter?
