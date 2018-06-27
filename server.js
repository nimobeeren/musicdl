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

// Holds information on tracks currently being processed
let queue = [];


/**
 * Moves all tracks from a Spotify playlist to a YouTube playlist, using YouTube's search
 * @param spListId Spotify playlist ID
 * @param ytListId YouTube playlist ID
 */
async function transferPlaylist(spListId, ytListId) {
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

    // Get tracks from the Spotify playlist
    const tracks = await spotify.list(spUsername, spListId);

    // Find tracks on YouTube and move them to the YouTube playlist sequentially
    for (let i = 0; i < tracks.length; i++) {
        // Make sure we don't transfer duplicates
        const duplicate = tracks.find(t => t.uri === tracks[i].uri) !== tracks[i];
        if (duplicate) {
            // If the same track appears somewhere before this one in the playlist, remove it
            await spotify.remove(spUsername, spListId, [tracks[i]]);
            continue;
        }

        // If this track is already being transferred, don't add it again
        const existsInQueue = queue.some(t => t.spId === tracks[i].uri);
        if (existsInQueue) {
            continue;
        }

        // Create an object containing some metadata of the track and add it to the queue
        let trackInfo = {
            spId: tracks[i].uri,
            state: 'move',
            added: Date.now(),
            title: tracks[i].name,
            artist: tracks[i].artists[0].name
        };
        queue.push(trackInfo);

        // Search for the track on YouTube
        const ytResult = await youtube.search(trackInfo.artist + ' - ' + trackInfo.title);

        // Add the search result to the YouTube playlist
        console.log("Transferring", trackInfo.artist + ' - ' + trackInfo.title);
        trackInfo.ytId = ytResult.items[0].id.videoId;
        await youtube.add(trackInfo.ytId, ytListId);

        // Remove the track from the Spotify playlist
        await spotify.remove(spUsername, spListId, tracks);

        // Indicate that transferring is done
        trackInfo.state = null;

        // TODO: Start downloading this track right away
    }
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
async function downloadPlaylist(ytListId) {
    const playlist = await youtube.list(ytListId);

    playlist.items.forEach(async track => {
        // Get some info about this track
        const title = track.snippet.title;                   // YouTube video title
        const id = track.snippet.resourceId.videoId;         // YouTube video ID
        let videoFile = path.join(os.tmpdir(), id + '.mp4'); // Filename for temporary video file
        let audioFile = title + '.m4a';                      // Filename for final audio file

        // Replace forbidden characters in filename
        audioFile = audioFile.replace(/[/\\%*:|"<>?]/, '_');

        // Make sure we don't download duplicates
        if (playlist.items.find(t => t.snippet.resourceId.videoId === id) !== track) {
            // If the same track appears somewhere before this one in the playlist, remove it
            await youtube.remove(track);
            return;
        }

        // If this track is already being downloaded/extracted, don't add it again
        if (queue.some(t => t.ytId === id && t.state === 'down' || t.state === 'extract')) {
            return;
        }

        // Find the track in the queue, or add it if it doesn't exist
        let trackInfo = queue.find(t => t.ytId === id);
        if (!trackInfo) {
            // Track was discovered on YouTube, so add it to the queue
            trackInfo = {
                // TODO: Get artist/title when adding to queue
                ytId: id,
                added: Date.now(),
                title: undefined,
                artist: undefined
            };
            queue.push(trackInfo);
        }
        trackInfo.state = 'down';
        console.log("Downloading", trackInfo.ytId);

        // Download the track
        await downloadVideo(track, videoFile);

        // Get tags before extracting audio
        const tags = await getTags(track);

        // Save tags and set track state to extract
        trackInfo.state = 'extract';
        trackInfo.title = tags.title;
        trackInfo.artist = tags.artist;
        if (tags.genre) trackInfo.genre = tags.genre;
        console.log(`Extracting ${trackInfo.artist} - ${trackInfo.title}`);

        // Determine final output path
        let subDir = '';
        if (useMonthSubdir) {
            // Use a subdirectory in format YYYY-MM if requested
            const date = new Date();
            if (date.getMonth() + 1 < 10) {
                subDir = date.getFullYear() + '-0' + (date.getMonth() + 1);
            } else {
                subDir = date.getFullYear() + '-' + (date.getMonth() + 1);
            }
        }
        let finalPath = path.join(outputDir, subDir, audioFile);

        // Make sure the directory exists
        try {
            // TODO: Error reporting when parent dir does not exist
            fs.mkdirSync(path.join(outputDir, subDir));
        } catch (err) {
            // Ignore error if dir already exists
            if (err.code !== 'EEXIST') throw err;
        }

        // Extract audio
        await extractAudio(videoFile, finalPath, tags);

        // Remove the track from the YouTube playlist
        try {
            await youtube.remove(track);
        } catch (e) {
            // If removing fails, user intervention is required
            // TODO: Make sure we do not continue when this happens
            if (e.code !== 404) throw e;
        }

        // Delete temporary video file
        fs.unlinkSync(videoFile);
        trackInfo.state = null;
        console.log(`Finished ${trackInfo.artist} - ${trackInfo.title}`);
    });
}

/**
 * Downloads a YouTube video using the best audio format
 * @param track The track to download, must be playlistItem from YouTube Data API
 * @param outfile The path to the output video file
 * @returns {Promise}
 */
async function downloadVideo(track, outfile) {
    const id = track.snippet.resourceId.videoId;
    let format = undefined;

    // Get track info, used for determining which format to download
    const info = await ytdl.getInfo(id);

    // Find the best format to download
    info.formats.forEach(fmt => {
        // TODO: Prioritize non-video streams with the same bitrate
        // TODO: Find out if we can use opus/vorbis and if it's better quality
        if (fmt.audioEncoding === 'aac' && (!format || fmt.audioBitrate > format.audioBitrate)) {
            format = fmt;
        }
    });

    // Create downloader object
    const downloader = ytdl(id, { format: format });

    // Write downloaded video to disk
    // TODO: Probably throws error when file is being written twice at the same time
    // (avoidable by not downloading twice)
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
    return new Promise((resolve, reject) => {
        downloader.on('end', () => {
            resolve();
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
    let alias = 'avconv';
    if (useFfmpeg) {
        alias = 'ffmpeg'
    }

    if (!fs.existsSync(infile)) {
        throw new Error('Video file does not exist');
    }

    return new Promise((resolve, reject) => {
        shell.exec(`${alias} -i ${infile} -y -vn -acodec copy -metadata artist="${tags.artist || ''}" -metadata title="${tags.title || ''}" -metadata genre="${tags.genre || ''}" "${outfile}"`,
            { silent: true }, (code, stdout, stderr) => {
                code === 0 ? resolve(stdout) : reject(stderr);
            });
    });
}

/**
 * Generates tags for a YouTube track
 * @param track YouTube video object
 * @returns {Promise}
 */
async function getTags(track) {
    const videoTitle = track.snippet.title;
    let tags = {};

    // Get artist and title using RegEx on video title
    // TODO: Discard (official video) and such
    // TODO: Discard {Genre}
    const re = /(.*?)\s*-\s*(.*?)(?:\s*\[.*\])?$/;
    let result = re.exec(videoTitle);

    if (result[2]) {
        tags.artist = result[1].trim();
        tags.title = result[2].trim();
    } else {
        // Fallback for when video title does not match RegEx
        tags.title = videoTitle;
    }

    // Set genre if channel appears in config file
    const channel = await youtube.getChannelTitle(track);
    for (let ch in config.Channels) {
        if (channel === ch && config.Channels.hasOwnProperty(ch)) {
            tags.genre = config.Channels[ch];
        }
    }
    return tags;
}

async function repeat() {
    try {
        await transferPlaylist(spListId, ytListId);
        await downloadPlaylist(ytListId);
    } catch (e) {
        console.error(e);
    }
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
