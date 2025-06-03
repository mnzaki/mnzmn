// app.js
document.addEventListener('DOMContentLoaded', function() {
    // Set current year in footer
    const currentYearSpan = document.getElementById('current-year');
    if (currentYearSpan) {
        currentYearSpan.textContent = new Date().getFullYear();
    }

    const LIVE_STREAM_URL = ""; // Example: "https://example.com/live.m3u8"; Set to "" to test fallback
    let fullArchiveData = []; // To store archive data globally within this scope

    let currentMode = 'AUTO'; // Possible values: 'AUTO', 'MANUAL_ARCHIVE'
    let liveCheckIntervalId = null;
    const LIVE_CHECK_INTERVAL = 15000; // 15 seconds for checking live stream status

function setVideoPlayerSource(sourceUrl, isArchive) {
    const videoPlayer = document.getElementById('main-video-player');
    if (!videoPlayer) {
        console.error("Video player element not found in setVideoPlayerSource.");
        return;
    }

    let fullSourceUrl = sourceUrl;
    if (isArchive && !sourceUrl.includes('#t=')) {
        fullSourceUrl = `${sourceUrl}#t=0`; // Default to start if no time fragment
    }

    console.log(`Setting video source to: ${fullSourceUrl}`);
    videoPlayer.src = fullSourceUrl;
    videoPlayer.load(); // Load the new source
    videoPlayer.play().then(() => {
        if (isArchive) {
            console.log(`Playing archive: ${fullSourceUrl}`);
            // You could update a UI element here to show "Playing Archive"
        } else {
            console.log(`Playing live: ${fullSourceUrl}`);
            // You could update a UI element here to show "Playing Live"
        }
    }).catch(e => {
        console.error(`Error playing ${fullSourceUrl}:`, e);
        // Optionally set a poster or display an error message on the player
        // videoPlayer.poster = 'path/to/error_poster.jpg';
    });
}

function playLiveStream() {
    if (!LIVE_STREAM_URL) {
        console.warn("playLiveStream called but LIVE_STREAM_URL is not set.");
        return;
    }
    console.log("Attempting to switch to LIVE stream.");
    setVideoPlayerSource(LIVE_STREAM_URL, false);
    // Future: Update UI element to indicate "LIVE" status clearly
}

function playArchiveFallback(reason) {
    console.log(`Switching to archive fallback. Reason: ${reason}`);

    if (!fullArchiveData || fullArchiveData.length === 0) {
        console.warn("playArchiveFallback called but fullArchiveData is empty.");
        // Optionally set a poster or display an error message on the player
        const videoPlayer = document.getElementById('main-video-player');
        if (videoPlayer) videoPlayer.poster = 'path/to/no_archive_data_poster.jpg'; // Placeholder
        return;
    }

    const secondsNow = getSecondsIntoCurrentUTCHour();
    const playbackInfo = getPlaybackForSecond(secondsNow, fullArchiveData); // fullArchiveData is sorted oldest first

    if (playbackInfo && playbackInfo.recording && typeof playbackInfo.offset === 'number') {
        const sourceUrl = `recordings/${playbackInfo.recording.filename}#t=${playbackInfo.offset}`;
        setVideoPlayerSource(sourceUrl, true);
        // Future: Update UI element to indicate "Playing Archive Program" or similar
    } else {
        console.error("Could not determine archive video to play from playArchiveFallback.");
        // Optionally set a poster or display an error message on the player
        const videoPlayer = document.getElementById('main-video-player');
        if (videoPlayer) videoPlayer.poster = 'path/to/fallback_error_poster.jpg'; // Placeholder
    }
}

async function checkLiveStream() {
    if (!LIVE_STREAM_URL) {
        // console.log("checkLiveStream: LIVE_STREAM_URL is not set.");
        return false; // No URL, so definitely not live
    }

    try {
        // Using 'HEAD' can be lighter if server supports it and for simple up/down check.
        // However, 'GET' might be more reliable for some stream types if HEAD isn't well-supported.
        // For HLS/DASH, fetching a small part of the manifest or a segment might be better,
        // but for a generic URL, a HEAD or GET is a starting point.
        // 'no-store' attempts to bypass browser cache for this check.
        const response = await fetch(LIVE_STREAM_URL, { method: 'HEAD', cache: 'no-store', mode: 'cors' });

        // response.ok is true if status is 200-299.
        // Some live streams might return redirects (3xx) before actual content,
        // fetch handles redirects by default.
        if (response.ok) {
            // console.log("checkLiveStream: Live stream appears to be active.", response.status);
            return true;
        } else {
            // console.log("checkLiveStream: Live stream check failed or stream not active.", response.status, response.statusText);
            return false;
        }
    } catch (error) {
        // Network error, server down, CORS issue etc.
        // console.error("checkLiveStream: Error during live stream check:", error.message);
        return false;
    }
}

async function updateAutoMode() {
    if (currentMode !== 'AUTO') {
        // console.log("updateAutoMode: Not in AUTO mode, skipping check.");
        return;
    }

    // console.log("updateAutoMode: Checking stream status...");
    const videoPlayer = document.getElementById('main-video-player');
    if (!videoPlayer) {
        console.error("updateAutoMode: Video player not found.");
        return;
    }

    const isActuallyLive = await checkLiveStream();
    const isPlayingLiveCurrently = videoPlayer.currentSrc === LIVE_STREAM_URL && LIVE_STREAM_URL !== "";
    // A more robust check for "playing archive" might involve checking if currentSrc.startsWith('recordings/')
    // or matching against fullArchiveData filenames.
    // For now, we assume if not playing LIVE_STREAM_URL, it's either playing archive or nothing relevant to this logic.

    if (isActuallyLive) {
        if (!isPlayingLiveCurrently) {
            console.log("updateAutoMode: Live stream is active and we are not playing it. Switching to live.");
            playLiveStream();
        } else {
            // console.log("updateAutoMode: Live stream active and already playing it. No change.");
        }
    } else { // Stream is not live
        if (isPlayingLiveCurrently) {
            console.log("updateAutoMode: Live stream is NOT active, but we were playing it. Switching to archive fallback.");
            playArchiveFallback("Live stream ended or became unavailable");
        } else {
            // console.log("updateAutoMode: Live stream NOT active, and not currently playing it. Ensure archive is playing if player is idle or ended.");
            // This case handles if the player is idle (e.g. after a manual pause, or video ended)
            // and auto mode should ensure something is playing.
            // It also covers the initial startup scenario if live isn't immediately available.
            if (videoPlayer.paused || videoPlayer.ended || !videoPlayer.currentSrc.startsWith("recordings/")) {
                 // Or if currentSrc is not one of our archive videos (e.g. some error/blank page)
                 // Avoids repeatedly calling playArchiveFallback if it's already correctly playing an archive segment.
                 const currentBaseSrc = videoPlayer.currentSrc.split('#')[0];
                 const isPlayingKnownArchive = fullArchiveData.some(rec => `recordings/${rec.filename}` === currentBaseSrc);

                 if(!isPlayingKnownArchive || videoPlayer.ended) {
                    console.log("updateAutoMode: Player idle or ended on non-live content, ensuring archive fallback.");
                    playArchiveFallback("Ensuring archive playback in auto mode");
                 }
            }
        }
    }
}

function startAutoMode() {
    console.log("Starting AUTO mode.");
    currentMode = 'AUTO';

    if (liveCheckIntervalId) {
        clearInterval(liveCheckIntervalId);
        liveCheckIntervalId = null;
    }

    updateAutoMode(); // Call once immediately to set initial state

    liveCheckIntervalId = setInterval(updateAutoMode, LIVE_CHECK_INTERVAL);

    // UI Update: Highlight "NOW - Auto Program" and unhighlight others
    const archiveListItems = document.querySelectorAll('#archive-list li');
    archiveListItems.forEach(item => {
        if (item.id === 'auto-mode-trigger') { // Assuming 'auto-mode-trigger' is the ID for "NOW" item
            item.classList.add('active-list-item');
        } else {
            item.classList.remove('active-list-item');
        }
    });
    // If "NOW" item doesn't exist yet or has a different ID, this needs adjustment later
    // when the "NOW" item is dynamically added. For now, this is a placeholder for UI update.
}

function playManualArchive(recordingFilename, listItemElement) {
    console.log(`Switching to MANUAL_ARCHIVE mode. Playing: ${recordingFilename}`);
    currentMode = 'MANUAL_ARCHIVE';

    if (liveCheckIntervalId) {
        clearInterval(liveCheckIntervalId);
        liveCheckIntervalId = null;
        console.log("Cleared live check interval due to manual selection.");
    }

    const sourceUrl = `recordings/${recordingFilename}`;
    // setVideoPlayerSource will append #t=0 by default if not present
    setVideoPlayerSource(sourceUrl, true);

    // UI Update: Highlight the selected item and unhighlight others
    const archiveListItems = document.querySelectorAll('#archive-list li');
    archiveListItems.forEach(item => {
        item.classList.remove('active-list-item');
    });
    if (listItemElement) {
        listItemElement.classList.add('active-list-item');
    }
}

    // PRNG (sfc32)
    function sfc32(a, b, c, d) {
        return function() {
          a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
          var t = (a + b) | 0;
          a = b ^ b >>> 9;
          b = c + (c << 3) | 0;
          c = (c << 21 | c >>> 11);
          d = d + 1 | 0;
          t = t + d | 0;
          c = c + t | 0;
          return (t >>> 0) / 4294967296; // Return number in [0,1)
        }
    }

    // Function to hash a timestamp to a seed for PRNG
    // Uses UTC year, month, day, hour
    function hashTimestampToSeed(date) {
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth(); // 0-11
        const day = date.getUTCDate();   // 1-31
        const hour = date.getUTCHours(); // 0-23

        // Simple hashing: these numbers are arbitrary primes for mixing
        let hash = 17;
        hash = hash * 31 + year;
        hash = hash * 31 + month;
        hash = hash * 31 + day;
        hash = hash * 31 + hour;
        return hash;
    }

    let prngForHour; // Will hold the seeded PRNG instance

    // Initialize PRNG based on the current UTC hour
    function initializePrngWithCurrentHour() {
        const now = new Date();
        const seed = hashTimestampToSeed(now);
        // Seed sfc32: needs 4 initial numbers. We can derive them from the single hash.
        // These derivations are simple, could be more sophisticated if needed.
        prngForHour = sfc32(seed, seed >> 8, seed >> 16, seed >> 24);
        console.log(`PRNG initialized for UTC hour: ${now.getUTCHours()} with seed: ${seed}`);
    }

    // Initialize the PRNG when script loads (or specifically, when DOM is ready)
    initializePrngWithCurrentHour();

    // Function to get a random recording for the current hour
    // Assumes prngForHour is already initialized
    function getPlaybackForHour(archive) {
        if (!archive || archive.length === 0) {
            console.error("Archive is empty or not provided to getPlaybackForHour.");
            return null;
        }
        if (typeof prngForHour !== 'function') {
            console.error("PRNG for hour not initialized.");
            // Fallback: initialize it now, though ideally it's done once per hour.
            initializePrngWithCurrentHour();
        }

        const randomIndex = Math.floor(prngForHour() * archive.length);
        return archive[randomIndex];
    }

    // Function to fetch and display archive
// Keep the existing `displayArchive` function structure, but make these modifications:
async function displayArchive() {
    const archiveListElement = document.getElementById('archive-list');
    if (!archiveListElement) {
        console.error('Archive list element not found.');
        return;
    }

    // Clear existing items, including any previous "NOW" item
    archiveListElement.innerHTML = '';

    // 1. Prepend "NOW - Auto Program" item
    const nowPlayingItem = document.createElement('li');
    nowPlayingItem.textContent = 'NOW - Auto Program';
    nowPlayingItem.id = 'auto-mode-trigger'; // ID for styling and selection by startAutoMode
    nowPlayingItem.classList.add('clickable'); // General class for clickable items
    nowPlayingItem.addEventListener('click', () => {
        startAutoMode(); // When clicked, start auto mode
    });
    archiveListElement.appendChild(nowPlayingItem);

    try {
        const response = await fetch('recordings/index.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const fetchedArchiveData = await response.json(); // Renamed to avoid conflict

        // Store the original fetched order or a specific sort order if needed for playback logic
        // For playback accumulation, we need oldest first.
        fullArchiveData = [...fetchedArchiveData].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        // Sort recordings by timestamp, newest first for display
        const displaySortedArchive = [...fetchedArchiveData].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        displaySortedArchive.forEach(recording => {
            const listItem = document.createElement('li');
            listItem.classList.add('clickable'); // General class for clickable items

            const date = new Date(recording.timestamp);
            const formattedTimestamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

            listItem.textContent = `${formattedTimestamp} - ${recording.title}`;
            listItem.dataset.filename = recording.filename;

            // 2. Modify event listener for archive items
            listItem.addEventListener('click', (event) => {
                playManualArchive(recording.filename, event.currentTarget); // Pass element for styling
            });
            archiveListElement.appendChild(listItem);
        });

        // After archive is loaded and processed:
        // setupVideoPlayer() will be called, which should then call startAutoMode()
        // This was the previous plan, ensure it still happens.
        // The actual call to setupVideoPlayer() should be outside displayArchive,
        // but called after displayArchive completes.
        // For now, let's assume setupVideoPlayer (which calls startAutoMode) is called after displayArchive.

    } catch (error) {
        console.error('Failed to load or display archive:', error);
        const errorLi = document.createElement('li');
        errorLi.textContent = 'Failed to load recordings.';
        archiveListElement.appendChild(errorLi); // Append after "NOW" item
    }

    // The call to setupVideoPlayer() which in turn calls startAutoMode()
    // should happen after displayArchive has successfully populated fullArchiveData.
    // This will be handled by the modification to setupVideoPlayer step.
    // For now, ensure displayArchive itself doesn't call it directly if it was moved out.
    // The original plan: displayArchive calls setupVideoPlayer. Let's stick to that for now
    // if setupVideoPlayer is light enough.
    // If setupVideoPlayer was already calling startAutoMode, that's fine.
    // Let's re-verify the call chain:
    // DOMContentLoaded -> displayArchive() -> at the end of displayArchive, call setupVideoPlayer()
    // setupVideoPlayer() (next step) will be modified to just call startAutoMode().
    // This seems correct.
    setupVideoPlayer(); // Ensure this is at the end of the try or after the try-catch.
}

    // Helper function to get seconds into the current UTC hour
    function getSecondsIntoCurrentUTCHour() {
        const now = new Date();
        return now.getUTCMinutes() * 60 + now.getUTCSeconds();
    }

    // Function to get the specific recording and offset for playback
    // based on seconds into the current UTC hour.
    // Uses fullArchiveData (sorted oldest to newest)
    function getPlaybackForSecond(targetSecondsInHour, archive) {
        if (!archive || archive.length === 0) {
            console.error("Archive is empty for getPlaybackForSecond.");
            return null;
        }

        const initialRandomRecording = getPlaybackForHour(archive); // Uses prngForHour
        if (!initialRandomRecording) {
            console.error("Could not get initial random recording.");
            return null;
        }

        console.log(`Initial random recording for hour: ${initialRandomRecording.title}`);

        let currentSecondMarker = 0;
        let cumulativeDuration = 0;

        // Find the initialRandomRecording in the chronologically sorted archive
        const startIndex = archive.findIndex(rec => rec.filename === initialRandomRecording.filename);
        if (startIndex === -1) {
            console.error("Initial random recording not found in the sorted archive. This shouldn't happen.");
            return null; // Should not happen if archive is consistent
        }

        // Loop through the archive starting from the initial random recording
        // to find the correct video and offset for targetSecondsInHour
        for (let i = 0; i < archive.length; i++) {
            const currentIndex = (startIndex + i) % archive.length; // Wrap around the archive
            const currentRecording = archive[currentIndex];

            const recordingDuration = Number(currentRecording.duration);
            if (isNaN(recordingDuration) || recordingDuration <= 0) {
                console.warn(`Invalid duration for ${currentRecording.filename}. Skipping.`);
                continue;
            }

            if (cumulativeDuration + recordingDuration > targetSecondsInHour) {
                // This is the recording to play
                const offset = targetSecondsInHour - cumulativeDuration;
                console.log(`Selected recording: ${currentRecording.title}, offset: ${offset}`);
                return {
                    recording: currentRecording,
                    offset: offset
                };
            }
            cumulativeDuration += recordingDuration;
        }

        // If loop completes, it means targetSecondsInHour is beyond the total accumulated duration
        // In this case, we might loop back to the beginning of what's available from the random start
        // or simply play the last segment of the last considered video.
        // For now, let's play the last considered video from its start if target is too large.
        // (This behavior might need refinement based on exact desired UX for > total length)
        const lastConsideredRecordingInLoop = archive[(startIndex + archive.length -1) % archive.length];
        console.warn(`Target seconds ${targetSecondsInHour} is beyond total accumulated duration from random start. Playing last considered: ${lastConsideredRecordingInLoop.title}`);
        return {
            recording: lastConsideredRecordingInLoop,
            offset: 0
        };
    }

// This function is called once after displayArchive successfully loads and processes archive data
function setupVideoPlayer() {
    console.log("Initial setup of video player complete. Starting Auto Mode.");
    // Any other one-time video player setup can go here if needed in the future (e.g. volume, events)

    startAutoMode(); // Default to auto mode on page load
}

    // Call displayArchive when the page loads
    displayArchive();

    // Other functions like setupVideoPlayer will be added later
});
