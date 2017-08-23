const fs = require('fs');
const ini = require('ini');
const os = require('os');
const path = require('path');
const shell = require('shelljs');
const ytdl = require('ytdl-core');

const routes = require('./routes');
const spotify = require('./spotify');
const youtube = require('./youtube');

// Define config values
let interval, outputDir, spUsername, spListId, ytListId, useMonthSubdir, useFfmpeg;

/**
 * Moves all tracks from a Spotify playlist to a YouTube playlist, using YouTube's search
 * @param spListId Spotify playlist ID
 * @param ytListId YouTube playlist ID
 */
function transferPlaylist(spListId, ytListId) {
    // TODO: Check for this only on startup
    // TODO: Log to console when services are indeed ready
    if (!spotify.ready && !youtube.ready) {
        throw new Error("Spotify and YouTube services not ready");
    }
    if (!spotify.ready) {
        throw new Error("Spotify service not ready");
    }
    if (!youtube.ready) {
        throw new Error("YouTube service not ready");
    }

    return spotify.list(spUsername, spListId)
        .then(tracks => {
            // Return if playlist is empty
            if (tracks.length === 0) {
                return;
            } else {
                console.log("Retrieved new tracks from Spotify");
            }

            // Find tracks on YouTube and move them to the YouTube playlist sequentially
            return new Promise(resolve => {
                let recurse = (i = 0) => {
                    if (i >= tracks.length) {
                        resolve(i);
                        return;
                    }

                    // Make sure we don't transfer duplicates
                    if (tracks.find(t => t.uri === tracks[i].uri) !== tracks[i]) {
                        // If the same track appears somewhere before this one in the playlist, remove it
                        spotify.remove(spUsername, spListId, [tracks[i]])
                            .then(() => {
                                recurse(++i);
                            }, err => {
                                throw err;
                            });
                        return;
                    }

                    const query = tracks[i].artists[0].name + ' - ' + tracks[i].name;
                    let id;

                    youtube.search(query)
                        .then(result => {
                            id = result.items[0].id.videoId;
                            console.log("Transferring", query);
                            return youtube.add(id, ytListId);
                        }, err => {
                            throw err;
                        })
                        .then(() => {
                            return spotify.remove(spUsername, spListId, [tracks[i]]);
                        }, err => {
                            throw err;
                        })
                        .then(() => {
                            recurse(++i);
                        }, err => {
                            throw err;
                        });
                };
                recurse();
            });
        }, err => {
            throw err;
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
// TODO: Will download some tracks twice if function runs again before finishing
function downloadPlaylist(ytListId) {
    return youtube.list(ytListId)
        .then(playlist => {
            // Check if playlist is empty
            if (playlist.items.length === 0) {
                return;
            } else {
                console.log("Retrieved new tracks from YouTube");
            }

            let removePromises = [], downloadPromises = [];

            playlist.items.forEach((track, index, arr) => {
                // TODO: Check for illegal characters in video title
                const title = track.snippet.title;                      // YouTube video title
                const id = track.snippet.resourceId.videoId;            // YouTube video ID
                const videoFile = path.join(os.tmpdir(), id + '.mp4');  // Filename for temporary video file
                const audioFile = title + '.m4a';                       // Filename for final audio file

                // Make sure we don't download duplicates
                if (playlist.items.find(t => t.snippet.resourceId.videoId === id) !== track) {
                    // If the same track appears somewhere before this one in the playlist, remove it
                    youtube.remove(track)
                        .catch(err => {
                            throw err;
                        });
                    return;
                }

                // Download the track
                console.log("Downloading " + title);
                downloadPromises.push(
                    downloadVideo(track, videoFile)
                        .then(() => {
                            // Remove the track after downloading
                            removePromises.push(
                                youtube.remove(track)
                                    .catch(err => {
                                        // If removing fails, user intervention is required
                                        // TODO: Make sure we do not continue when this happens
                                        if (err.code !== 404) throw err;
                                    })
                            );

                            // Get tags before extracting audio
                            return getTags(track);
                        }, err => {
                            throw err;
                        })
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
                                if (err.code !== 'EEXIST') throw err;
                            }

                            return extractAudio(videoFile, finalPath, tags);
                        }, err => {
                            throw err;
                        })
                        .then(() => {
                            // Delete temporary video file
                            fs.unlink(videoFile);
                            console.log("Finished " + title);
                        }, err => {
                            throw err;
                        })
                );
            });

            return Promise.all(downloadPromises.concat(removePromises));
        });
}

/**
 * Downloads a YouTube video using the best audio format
 * @param track The track to download, must be playlistItem from YouTube Data API
 * @param outfile The path to the output video file
 * @returns {Promise}
 */
function downloadVideo(track, outfile) {
    return new Promise(resolve => {
        const id = track.snippet.resourceId.videoId;
        let format = undefined;

        ytdl.getInfo(id)
            .then(info => {
                // Find the best format to download
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
                // TODO: Probably throws error when file is being written twice at the same time (avoidable by not downloading twice)
                downloader.pipe(fs.createWriteStream(outfile));

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
                downloader.on('end', () => {
                    resolve();
                });
            });
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

        if (!fs.existsSync(infile)) {
            throw new Error('Video file does not exist');
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
        // TODO: Fallback for tracks that don't match this pattern (!)
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
        .catch(console.error);
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
