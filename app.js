// app.js
document.addEventListener('DOMContentLoaded', function() {
    // Set current year in footer
    const currentYearSpan = document.getElementById('current-year');
    if (currentYearSpan) {
        currentYearSpan.textContent = new Date().getFullYear();
    }

    const LIVE_STREAM_URL = ""; // Example: "https://example.com/live.m3u8"; Set to "" to test fallback
    let fullArchiveData = []; // To store archive data globally within this scope

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
    async function displayArchive() {
        const archiveListElement = document.getElementById('archive-list');
        if (!archiveListElement) {
            console.error('Archive list element not found.');
            return;
        }

        try {
            const response = await fetch('recordings/index.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const archiveData = await response.json();

            // Populate fullArchiveData, sorted oldest first for playback logic
            fullArchiveData = [...archiveData].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

            // Sort recordings for display by timestamp, newest first
            const displaySortedArchive = [...archiveData].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            archiveListElement.innerHTML = ''; // Clear existing items

            displaySortedArchive.forEach(recording => {
                const listItem = document.createElement('li');

                // Format timestamp: YYYY-MM-DD HH:MM
                const date = new Date(recording.timestamp);
                const formattedTimestamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

                listItem.textContent = `${formattedTimestamp} - ${recording.title}`;
                // Add a data attribute for the filename, could be useful later
                listItem.dataset.filename = recording.filename;
                archiveListElement.appendChild(listItem);
            });

            // After archive is loaded and processed:
            setupVideoPlayer(); // This function will be created next and will use getPlaybackForHour

        } catch (error) {
            console.error('Failed to load or display archive:', error);
            archiveListElement.innerHTML = '<li>Failed to load recordings.</li>';
        }
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

    function setupVideoPlayer() {
        const videoPlayer = document.getElementById('main-video-player');
        if (!videoPlayer) {
            console.error("Video player element not found.");
            return;
        }

        // Simulate checking if the live stream is active
        // In a real scenario, this could involve trying to fetch the stream manifest
        // or checking an API endpoint. For now, we'll rely on LIVE_STREAM_URL being non-empty.
        const isLiveStreamActive = LIVE_STREAM_URL && LIVE_STREAM_URL !== "";

        if (isLiveStreamActive) {
            console.log(`Attempting to play live stream: ${LIVE_STREAM_URL}`);
            if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) { // Basic HLS check
                videoPlayer.src = LIVE_STREAM_URL;
            } else if (videoPlayer.canPlayType('application/rtmp/mp4')) { // Basic RTMP check (though direct browser RTMP is rare)
                 videoPlayer.src = LIVE_STREAM_URL;
            }
            else {
                videoPlayer.src = LIVE_STREAM_URL; // General case
            }
            videoPlayer.load(); // Important to load the new source
            videoPlayer.play().catch(e => console.error("Error playing live stream:", e));
        } else {
            console.log("Live stream not active or URL not set. Using archive fallback.");
            if (fullArchiveData && fullArchiveData.length > 0) {
                const secondsNow = getSecondsIntoCurrentUTCHour();
                const playbackInfo = getPlaybackForSecond(secondsNow, fullArchiveData);

                if (playbackInfo && playbackInfo.recording) {
                    const sourceUrl = `recordings/${playbackInfo.recording.filename}#t=${playbackInfo.offset}`;
                    console.log(`Setting archive video source to: ${sourceUrl}`);
                    videoPlayer.src = sourceUrl;
                    videoPlayer.load();
                    videoPlayer.play().catch(e => console.error("Error playing archive video:", e));
                } else {
                    console.error("Could not determine archive video to play.");
                    videoPlayer.poster = 'path/to/default_poster_error.jpg'; // Optional: set a poster indicating an error
                }
            } else {
                console.warn("No archive data available for fallback.");
                // Optional: display a message or set a specific poster
                // videoPlayer.poster = 'path/to/default_poster_no_archive.jpg';
            }
        }
    }

    // Call displayArchive when the page loads
    displayArchive();

    // Other functions like setupVideoPlayer will be added later
});
