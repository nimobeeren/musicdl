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
let interval, outputDir, spUsername, spListId, ytListId, useMonthSubdir, useFfmpeg;

/**
 * Moves all tracks from a Spotify playlist to a YouTube playlist, using YouTube's search
 * @param spListId Spotify playlist ID
 * @param ytListId YouTube playlist ID
 */
function transferPlaylist(spListId, ytListId) {
    return new Promise((resolve, reject) => {
        if (!spotify.ready) {
            console.log("Spotify not ready");
        }
        if (!youtube.ready) {
            console.log("YouTube not ready");
        }
        if (!spotify.ready || !youtube.ready) {
            // TODO: Test with throw new Error()
            reject("Services not ready");
            return;
        }

        spotify.list(spUsername, spListId)
            .then(tracks => {
                let processed = 0; // amount of tracks added to YouTube so far
                let removed = false; // whether tracks have been removed from Spotify

                // Check if playlist is empty
                if (tracks.length === 0) {
                    // TODO: Test without resolve, just return
                    resolve();
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
                        }, err => {
                            throw err;
                        })
                        .then(() => {
                            // TODO: Don't do this if youtube.search fails
                            // If all tracks have been added to YouTube and removed from Spotify, we're done
                            console.log(`Added to YouTube: ${title} (${id})`);
                            if (++processed === tracks.length && removed) resolve(tracks);
                        }, reject);
                });

                spotify.remove(spUsername, spListId, tracks)
                    .then(() => {
                        removed = true;
                        if (processed === tracks.length) resolve(tracks);
                    }, err => {
                        // If removing fails, user intervention is required
                        throw err;
                    });
            }, reject);
    });
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
// TODO: Fix operation not permitted when opening video file
function downloadPlaylist(ytListId) {
    return new Promise((resolve, reject) => {
        // Get YouTube playlist content
        youtube.list(ytListId)
            .then(playlist => {
                let processed = 0; // how many tracks have been processed so far (including duplicates)
                let removed = false; // whether tracks have been removed from YouTube

                // Check if playlist is empty
                if (playlist.items.length === 0) {
                    // TODO: Test without resolve, just return
                    resolve();
                    return;
                }

                console.log("Retrieved new tracks from YouTube");
                playlist.items.forEach((track, index) => {
                    // TODO: Check for illegal characters in video title
                    const title = track.snippet.title;                      // YouTube video title
                    const id = track.snippet.resourceId.videoId;            // YouTube video ID
                    const videoFile = path.join(os.tmpdir(), id + '.mp4');  // Filename for temporary video file
                    const audioFile = title + '.m4a';                       // Filename for final audio file

                    // Remove track from the YouTube playlist
                    youtube.remove(track)
                        .then(() => {
                            removed = true;
                            if (processed === playlist.items.length) resolve();
                        }, err => {
                            // Ignore 404 errors
                            if (err.code !== 404) reject(err);
                        });

                    // Make sure we don't download duplicates
                    // TODO: Test this
                    for (let i = 0; i < playlist.items.length; i++) {
                        // Find first item in the list that has the same ID as this one
                        if (id === playlist.items[i].snippet.resourceId.videoId) {
                            if (index === i) {
                                // If this item is the first one, continue as usual
                                break;
                            } else {
                                // Resolve if we're done
                                if (++processed === playlist.items.length && removed) resolve();

                                // If this item is not the first one, don't process it
                                return;
                            }
                        }
                    }

                    // Download each track
                    console.log("Downloading " + title);
                    downloadVideo(track, videoFile)
                        .then(() => {
                            console.log("Finished " + title);
                            return getTags(track);
                        }, reject)
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
                                // TODO: Error reporting when parent dir does not exist
                                fs.mkdirSync(path.join(outputDir, subDir));
                            } catch (err) {
                                // Ignore error if dir already exists
                                // TODO: Reject or throw?
                                if (err.code !== 'EEXIST') throw err;
                            }

                            return extractAudio(videoFile, finalPath, tags);
                        }, reject)
                        .then(() => {
                            // Delete temporary video file
                            fs.unlink(videoFile);

                            // Resolve if we're done
                            if (++processed === playlist.items.length && removed) resolve();
                        }, reject);
                });
            }, reject);
    });
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
            }, reject);
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
        // TODO: Discard (official video) and such
        // TODO: Discard {Genre}
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
    transferPlaylist(spListId, ytListId)
        .then(() => {
            return downloadPlaylist(ytListId);
        }, console.error)
        .then(() => {
        }, console.error);
}

// Load config file
const config = ini.parse(fs.readFileSync('./config.ini', 'utf-8'));
interval = config['General']['Interval'] * 1000;
outputDir = config['General']['OutputDir'];
spUsername = config['General']['SpotifyUsername'];
spListId = config['General']['SpotifyListID'];
ytListId = config['General']['YouTubeListID'];
useMonthSubdir = config['General']['UseMonthSubdir'];
useFfmpeg = config['General']['UseFFMPEG'];
console.log("Read config file");

// Check playlists repeatedly
setInterval(repeat, interval); // TODO: caching/ETags
