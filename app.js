const fs = require('fs');
const ini = require('ini');
const path = require('path');
const shell = require('shelljs');
const ytdl = require('ytdl-core');

const routes = require('./routes');
const spotify = require('./spotify');
const youtube = require('./youtube');

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
        console.log("YouTube not ready");
    }
    if (!spotify.ready || !youtube.ready) {
        return;
    }

    spotify.list(config['general']['SpotifyUsername'], config['general']['SpotifyListID'])
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

            spotify.remove(config['general']['SpotifyUsername'], spListId, tracks)
                .then(() => {
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
        .then(playlist => {
            // Check if playlist is empty
            if (playlist.items.length === 0) {
                return;
            }

            console.log("Received new tracks from YouTube");
            playlist.items.forEach(track => {
                let title = track.snippet.title,            // YouTube video title
                    id = track.snippet.resourceId.videoId,  // YouTube video ID
                    videoFile = id + '.mp4',                // Filename for temporary video file
                    // TODO: Check for illegal characters in video title
                    audioFile = title + '.m4a';             // Filename for final audio file

                // Download each track
                console.log("Downloading " + title);
                downloadVideo(track, videoFile)
                    .then(() => {
                        console.log("Finished " + title);
                        return getTags(track);
                    }, console.error)
                    .then(tags => {
                        let outDir = config['general']['OutputDir'];
                        let subDir = '';
                        let finalPath = '';

                        // Determine final output path
                        if (config['general']['UseMonthSubdir']) {
                            // Use a subdirectory in format YYYY-MM if requested
                            let date = new Date();

                            if (date.getMonth() < 10) {
                                subDir = date.getFullYear() + '-0' + date.getMonth();
                            } else {
                                subDir = date.getFullYear() + '-' + date.getMonth();
                            }

                            finalPath = path.join(outDir, subDir, audioFile);
                        } else {
                            finalPath = path.join(outDir, audioFile);
                        }

                        // Make sure the directory exists
                        try {
                            fs.mkdirSync(path.join(outDir, subDir));
                        } catch (err) {
                            if (err.code !== 'EEXIST') throw err;
                        }

                        return extractAudio(videoFile, finalPath, tags);
                    }, console.error)
                    .then(() => {
                        console.log('Extracted audio');
                        fs.unlink(videoFile);
                    }, console.error);

                // Clear the YouTube playlist
                youtube.remove(track)
                    .then(() => {
                        console.log("Removed YouTube playlist item " + title);
                    }, console.error);
            });
        }, console.error);
}

/**
 * Downloads a YouTube video using the best audio format
 * @param track The track to download, must be playlistItem from YouTube Data API
 * @param outfile The path to the output video file
 * @returns {Promise}
 */
function downloadVideo(track, outfile) {
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
                    downloader.pipe(fs.createWriteStream(outfile));
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
        let alias = 'avconv';
        if (config['general']['UseFFMPEG']) {
            alias = 'ffmpeg'
        }
        shell.exec(`${alias} -i ${infile} -vn -acodec copy -metadata artist="${tags.artist || ''}" -metadata title="${tags.title || ''}" -metadata genre="${tags.genre || ''}" "${outfile}"`,
            {silent: true}, (code, stdout, stderr) => {
                code === 0 ? resolve(stdout) : reject(stderr);
            });
    });
}

function getTags(track) {
    return new Promise((resolve, reject) => {
        let title = track.snippet.title;
        let tags = {};

        let re = new RegExp('(.*?)(?:\s*-\s*)(.*?)(?:\s*\[.*\])?$');
        let result = re.exec(title);
        tags.artist = result[1];
        tags.title = result[2];

        youtube.getChannel(track)
            .then(data => {
                // TODO: Get channels and genres from config file
                let channel = data.items[0].snippet.channelTitle;
                console.log("Channel:" + channel);
                if (channel === "Liquicity") {
                    tags.genre = "Drum and Bass";
                }
                resolve(tags);
            }, reject);
    });
}

function repeat() {
    transferPlaylist(config['general']['SpotifyListID'], config['general']['YouTubeListID']);
    downloadPlaylist(config['general']['YouTubeListID']);
}

// Load config file
const config = ini.parse(fs.readFileSync('./config.ini', 'utf-8'));

// Check playlists repeatedly
setInterval(repeat, 5000); // TODO: Make an event listener/emitter?
