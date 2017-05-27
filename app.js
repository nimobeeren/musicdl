const fs = require('fs');
const ini = require('ini');
const os = require('os');
const path = require('path');
const shell = require('shelljs');
const ytdl = require('ytdl-core');

const routes = require('./routes');
const spotify = require('./spotify');
const youtube = require('./youtube');

// Define config keys
let outputDir, spUsername, spListId, ytListId, useMonthSubdir, useFfmpeg;

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

    spotify.list(spUsername, spListId)
        .then(tracks => {
            // Check if playlist is empty
            if (tracks.length === 0) {
                return;
            }

            console.log("Retrieved new tracks from Spotify");
            tracks.forEach(track => {
                const query = track.artists[0].name + ' - ' + track.name;
                let id, title;
                youtube.search(query)
                    .then(result => {
                        id = result.items[0].id.videoId;
                        title = result.items[0].snippet.title;
                        return youtube.add(id, ytListId);
                    }, console.error)
                    .then(() => {
                        console.log(`Added to YouTube: ${title} (${id})`);
                    }, console.error);
            });

            spotify.remove(spUsername, spListId, tracks)
                .then(() => {
                    // Do nothing
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
 * Gets artist/title using RegExp
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

            console.log("Retrieved new tracks from YouTube");
            playlist.items.forEach(track => {
                // TODO: Check for illegal characters in video title
                const title = track.snippet.title;                      // YouTube video title
                const id = track.snippet.resourceId.videoId;            // YouTube video ID
                const videoFile = path.join(os.tmpdir(), id + '.mp4');  // Filename for temporary video file
                const audioFile = title + '.m4a';                       // Filename for final audio file

                // Download each track
                console.log("Downloading " + title);
                downloadVideo(track, videoFile)
                    .then(() => {
                        console.log("Finished " + title);
                        return getTags(track);
                    }, console.error)
                    .then(tags => {
                        let subDir = '';
                        let finalPath = '';

                        // Determine final output path
                        if (useMonthSubdir) {
                            // Use a subdirectory in format YYYY-MM if requested
                            const date = new Date();

                            if (date.getMonth() + 1 < 10) {
                                subDir = date.getFullYear() + '-0' + (date.getMonth() + 1);
                            } else {
                                subDir = date.getFullYear() + '-' + (date.getMonth() + 1);
                            }

                            finalPath = path.join(outputDir, subDir, audioFile);
                        } else {
                            finalPath = path.join(outputDir, audioFile);
                        }

                        // Make sure the directory exists
                        try {
                            fs.mkdirSync(path.join(outputDir, subDir));
                        } catch (err) {
                            if (err.code !== 'EEXIST') throw err;
                        }

                        return extractAudio(videoFile, finalPath, tags);
                    }, console.error)
                    .then(() => {
                        // Delete temporary video file
                        fs.unlink(videoFile);
                    }, console.error);

                // Clear the YouTube playlist
                youtube.remove(track)
                    .then(() => {
                        // Do nothing
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
        const id = track.snippet.resourceId.videoId;
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
                const downloader = ytdl(id, {format: format});

                // Write downloaded video to disk
                try {
                    downloader.pipe(fs.createWriteStream(outfile));
                } catch (err) {
                    reject(err);
                }

                // TODO: Communicate progress to web interface
                // Print progress every so often
                // let lastProgress = 0;
                // downloader.on('progress', (chunkLength, downloaded, total) => {
                //     let percent = downloaded / total * 100;
                //     if (percent >= lastProgress + 10) {
                //         console.log(percent + '%');
                //         lastProgress = percent;
                //     }
                // });

                // Resolve promise when download ends
                downloader.on('end', resolve);
            }, console.error);
    });
}

/**
 * Extracts audio from video file and optionally applies tags
 * @param infile Path to input video file
 * @param outfile Path to output audio file
 * @param tags {Object} Object with artist, title and genre properties (all optional)
 * to be applied to the file
 * @returns {Promise}
 */
function extractAudio(infile, outfile, tags = {}) {
    return new Promise((resolve, reject) => {
        let alias = 'avconv';
        if (useFfmpeg) {
            alias = 'ffmpeg'
        }
        shell.exec(`${alias} -i ${infile} -y -vn -acodec copy -metadata artist="${tags.artist || ''}" -metadata title="${tags.title || ''}" -metadata genre="${tags.genre || ''}" "${outfile}"`,
            {silent: true}, (code, stdout, stderr) => {
                code === 0 ? resolve(stdout) : reject(stderr);
            });
    });
}

/**
 * Generates tags for a YouTube track
 * @param track YouTube video object
 * @returns {Promise}
 */
function getTags(track) {
    return new Promise((resolve, reject) => {
        const title = track.snippet.title; // video title
        let tags = {};

        // Get artist and title using RegEx on video title
        // TODO: Fix discarding of [.*]
        const re = new RegExp(`(.*?)(?:\s*-\s*)(.*?)(?:\s*\[.*\])?$`);
        let result = re.exec(title);
        tags.artist = result[1].trim();
        tags.title = result[2].trim();

        // Set genre if channel appears in config file
        youtube.getChannelTitle(track)
            .then(channel => {
                for (let ch in config.Channels) {
                    if (config.Channels.hasOwnProperty(ch) && channel === ch) {
                        tags.genre = config.Channels[ch];
                    }
                }
                resolve(tags);
            }, reject);
    });
}

function repeat() {
    transferPlaylist(spListId, ytListId);
    downloadPlaylist(ytListId);
}

// Load config file
const config = ini.parse(fs.readFileSync('./config.ini', 'utf-8'));
outputDir = config['General']['OutputDir'];
spUsername = config['General']['SpotifyUsername'];
spListId = config['General']['SpotifyListID'];
ytListId = config['General']['YouTubeListID'];
useMonthSubdir = config['General']['UseMonthSubdir'];
useFfmpeg = config['General']['UseFFMPEG'];
console.log("Read config file");

// Check playlists repeatedly
setInterval(repeat, 5000); // TODO: Make an event listener/emitter?
