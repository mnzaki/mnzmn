// app.js
document.addEventListener('DOMContentLoaded', async function() {
    let appConfig = {};

    async function loadAppConfig() {
        try {
            const response = await fetch('config.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status} - Failed to load config.json.`);
            }
            appConfig = await response.json();
            console.log("Configuration loaded:", appConfig);
        } catch (error) {
            console.error("Fatal Error: Could not load appConfig from config.json.", error);
            const videoPlayerSection = document.getElementById('video-player-section');
            if (videoPlayerSection) {
                videoPlayerSection.innerHTML = `<p style="color: red; text-align: center;">Error: Application configuration could not be loaded. Please check config.json.</p>`;
            }
            throw error;
        }
    }

    try {
        await loadAppConfig();

        // Set current year in footer (can be done early)
        const currentYearSpan = document.getElementById('current-year');
        if (currentYearSpan) {
            currentYearSpan.textContent = new Date().getFullYear();
        }

        const videoPlayer = document.getElementById('main-video-player');
        let fullArchiveData = [];
        let currentMode = 'AUTO';
        let liveCheckIntervalId = null;
        const LIVE_CHECK_INTERVAL = 15000; // 15 seconds for checking live stream status

        function setVideoPlayerSource(sourceUrl, isArchive) {
            // videoPlayer is already defined in the outer scope
            if (!videoPlayer) {
                console.error("Video player element not found in setVideoPlayerSource.");
                return;
            }
            let fullSourceUrl = sourceUrl;
            if (isArchive && !sourceUrl.includes('#t=')) {
                fullSourceUrl = `${sourceUrl}#t=0`;
            }
            console.log(`Setting video source to: ${fullSourceUrl}`);
            videoPlayer.src = fullSourceUrl;
            videoPlayer.load();
            videoPlayer.play().then(() => {
                if (isArchive) console.log(`Playing archive: ${fullSourceUrl}`);
                else console.log(`Playing live: ${fullSourceUrl}`);
            }).catch(e => console.error(`Error playing ${fullSourceUrl}:`, e));
        }

        function playLiveStream() {
            if (!appConfig.LIVE_STREAM_URL) { // USE appConfig
                console.warn("playLiveStream called but LIVE_STREAM_URL is not set in appConfig.");
                return;
            }
            console.log("Attempting to switch to LIVE stream.");
            setVideoPlayerSource(appConfig.LIVE_STREAM_URL, false); // USE appConfig
        }

        function playArchiveFallback(reason) {
            console.log(`Switching to archive fallback. Reason: ${reason}`);
            if (!fullArchiveData || fullArchiveData.length === 0) {
                console.warn("playArchiveFallback called but fullArchiveData is empty.");
                if (videoPlayer) videoPlayer.poster = 'path/to/no_archive_data_poster.jpg';
                return;
            }
            const secondsNow = getSecondsIntoCurrentUTCHour();
            const playbackInfo = getPlaybackForSecond(secondsNow, fullArchiveData);
            if (playbackInfo && playbackInfo.recording && typeof playbackInfo.offset === 'number') {
                const sourceUrl = `recordings/${playbackInfo.recording.filename}#t=${playbackInfo.offset}`;
                setVideoPlayerSource(sourceUrl, true);
            } else {
                console.error("Could not determine archive video to play from playArchiveFallback.");
                if (videoPlayer) videoPlayer.poster = 'path/to/fallback_error_poster.jpg';
            }
        }

        async function checkLiveStream() {
            if (!appConfig.LIVE_STREAM_URL) { // USE appConfig
                return false;
            }
            try {
                const response = await fetch(appConfig.LIVE_STREAM_URL, { method: 'HEAD', cache: 'no-store', mode: 'cors' }); // USE appConfig
                return response.ok;
            } catch (error) {
                return false;
            }
        }

        async function updateAutoMode() {
            if (currentMode !== 'AUTO') return;
            if (!videoPlayer) {
                console.error("updateAutoMode: Video player not found.");
                return;
            }
            const isActuallyLive = await checkLiveStream();
            const isPlayingLiveCurrently = videoPlayer.currentSrc === appConfig.LIVE_STREAM_URL && appConfig.LIVE_STREAM_URL !== ""; // USE appConfig

            if (isActuallyLive) {
                if (!isPlayingLiveCurrently) {
                    console.log("updateAutoMode: Live stream is active and we are not playing it. Switching to live.");
                    playLiveStream();
                }
            } else {
                if (isPlayingLiveCurrently) {
                    console.log("updateAutoMode: Live stream is NOT active, but we were playing it. Switching to archive fallback.");
                    playArchiveFallback("Live stream ended or became unavailable");
                } else {
                    if (videoPlayer.paused || videoPlayer.ended || !videoPlayer.currentSrc.startsWith("recordings/")) {
                        const currentBaseSrc = videoPlayer.currentSrc.split('#')[0];
                        const isPlayingKnownArchive = fullArchiveData.some(rec => currentBaseSrc.endsWith(`recordings/${rec.filename}`));
                        if (!isPlayingKnownArchive || videoPlayer.ended) {
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
            if (liveCheckIntervalId) clearInterval(liveCheckIntervalId);
            updateAutoMode();
            liveCheckIntervalId = setInterval(updateAutoMode, LIVE_CHECK_INTERVAL);
            const archiveListItems = document.querySelectorAll('#archive-list li');
            archiveListItems.forEach(item => {
                item.classList.toggle('active-list-item', item.id === 'auto-mode-trigger');
            });
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
            setVideoPlayerSource(sourceUrl, true);
            const archiveListItems = document.querySelectorAll('#archive-list li');
            archiveListItems.forEach(item => item.classList.remove('active-list-item'));
            if (listItemElement) listItemElement.classList.add('active-list-item');
        }

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
              return (t >>> 0) / 4294967296;
            }
        }

        function hashTimestampToSeed(date) {
            const year = date.getUTCFullYear();
            const month = date.getUTCMonth();
            const day = date.getUTCDate();
            const hour = date.getUTCHours();
            let hash = 17;
            hash = hash * 31 + year;
            hash = hash * 31 + month;
            hash = hash * 31 + day;
            hash = hash * 31 + hour;
            return hash;
        }

        let prngForHour;

        function initializePrngWithCurrentHour() {
            const now = new Date();
            const seed = hashTimestampToSeed(now);
            prngForHour = sfc32(seed, seed >> 8, seed >> 16, seed >> 24);
            console.log(`PRNG initialized for UTC hour: ${now.getUTCHours()} with seed: ${seed}`);
        }

        initializePrngWithCurrentHour(); // Initialize PRNG after its definition

        function getPlaybackForHour(archive) {
            if (!archive || archive.length === 0) return null;
            if (typeof prngForHour !== 'function') initializePrngWithCurrentHour();
            const randomIndex = Math.floor(prngForHour() * archive.length);
            return archive[randomIndex];
        }

        async function loadAndDisplayArchive() {
            const archiveListElement = document.getElementById('archive-list');
            if (!archiveListElement) {
                console.error('Archive list element not found.');
                return;
            }
            archiveListElement.innerHTML = '';

            const nowPlayingItem = document.createElement('li');
            nowPlayingItem.textContent = 'NOW - Auto Program';
            nowPlayingItem.id = 'auto-mode-trigger';
            nowPlayingItem.classList.add('clickable');
            nowPlayingItem.addEventListener('click', () => {
                startAutoMode();
            });
            archiveListElement.appendChild(nowPlayingItem);

            let archiveData = [];

            try {
                const archiveSourceUri = appConfig.ARCHIVE_SOURCE;
                console.log("Attempting to load archive from:", archiveSourceUri);

                if (archiveSourceUri && archiveSourceUri.startsWith('file://')) {
                    const filePath = archiveSourceUri.substring('file://.'.length);
                    const response = await fetch(filePath);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status} - Failed to load local archive: ${filePath}`);
                    }
                    archiveData = await response.json();
                    console.log("Archive data loaded from local file:", archiveData);

                } else if (archiveSourceUri && archiveSourceUri.startsWith('gdrive://')) {
                    console.warn(`Google Drive source detected ('${archiveSourceUri}'), but GDrive fetching is not yet implemented.`);
                    archiveData = [];
                    const gdriveErrorLi = document.createElement('li');
                    gdriveErrorLi.textContent = 'Google Drive archive source not yet supported.';
                    gdriveErrorLi.style.color = 'orange';
                    archiveListElement.appendChild(gdriveErrorLi);

                } else {
                    throw new Error(`Unsupported or invalid ARCHIVE_SOURCE URI: ${archiveSourceUri}`);
                }

                if (!Array.isArray(archiveData)) {
                    console.error("Loaded archive data is not an array. Source:", archiveSourceUri, "Data:", archiveData);
                    throw new Error("Invalid archive data format: not an array.");
                }

                fullArchiveData = [...archiveData].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                const displaySortedArchive = [...archiveData].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

                displaySortedArchive.forEach(recording => {
                    const listItem = document.createElement('li');
                    listItem.classList.add('clickable');
                    const date = new Date(recording.timestamp);
                    const formattedTimestamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
                    listItem.textContent = `${formattedTimestamp} - ${recording.title}`;
                    listItem.dataset.filename = recording.filename;
                    listItem.addEventListener('click', (event) => {
                        playManualArchive(recording.filename, event.currentTarget);
                    });
                    archiveListElement.appendChild(listItem);
                });

            } catch (error) {
                console.error('Failed to load or display archive:', error);
                const errorLi = document.createElement('li');
                errorLi.textContent = `Error loading recordings: ${error.message}`;
                errorLi.style.color = 'red';
                archiveListElement.appendChild(errorLi);
                fullArchiveData = [];
            }

            // setupVideoPlayer() is called at the end of DOMContentLoaded try block
        }

        function getSecondsIntoCurrentUTCHour() {
            const now = new Date();
            return now.getUTCMinutes() * 60 + now.getUTCSeconds();
        }

        function getPlaybackForSecond(targetSecondsInHour, archive) {
            if (!archive || archive.length === 0) return null;
            const initialRandomRecording = getPlaybackForHour(archive);
            if (!initialRandomRecording) return null;
            console.log(`Initial random recording for hour: ${initialRandomRecording.title}`);
            let cumulativeDuration = 0;
            const startIndex = archive.findIndex(rec => rec.filename === initialRandomRecording.filename);
            if (startIndex === -1) return null;
            for (let i = 0; i < archive.length; i++) {
                const currentIndex = (startIndex + i) % archive.length;
                const currentRecording = archive[currentIndex];
                const recordingDuration = Number(currentRecording.duration);
                if (isNaN(recordingDuration) || recordingDuration <= 0) continue;
                if (cumulativeDuration + recordingDuration > targetSecondsInHour) {
                    const offset = targetSecondsInHour - cumulativeDuration;
                    console.log(`Selected recording: ${currentRecording.title}, offset: ${offset}`);
                    return { recording: currentRecording, offset: offset };
                }
                cumulativeDuration += recordingDuration;
            }
            const lastConsidered = archive[(startIndex + archive.length - 1) % archive.length];
            console.warn(`Target seconds ${targetSecondsInHour} is beyond total. Playing last: ${lastConsidered.title}`);
            return { recording: lastConsidered, offset: 0 };
        }

        function setupVideoPlayer() {
            console.log("Initial setup of video player complete. Starting Auto Mode.");
            startAutoMode();
        }

        // Start the application by loading and displaying the archive
        await loadAndDisplayArchive();

        // Attach play event listener after main setup
        if (videoPlayer) {
            videoPlayer.addEventListener('play', () => {
                if (currentMode === 'AUTO') {
                    const isPlayingLive = videoPlayer.currentSrc === appConfig.LIVE_STREAM_URL && appConfig.LIVE_STREAM_URL !== ""; // USE appConfig
                    const currentBaseSrcWithoutFragment = videoPlayer.currentSrc.split('#')[0];
                    const isPlayingKnownArchive = fullArchiveData.some(rec => currentBaseSrcWithoutFragment.endsWith(`recordings/${rec.filename}`));
                    if (!isPlayingLive && isPlayingKnownArchive) {
                        console.log("Play event in AUTO mode on archive. Recalculating ideal playback point.");
                        const secondsNow = getSecondsIntoCurrentUTCHour();
                        const playbackInfo = getPlaybackForSecond(secondsNow, fullArchiveData);
                        if (playbackInfo && playbackInfo.recording) {
                            const newTargetFile = `recordings/${playbackInfo.recording.filename}`;
                            const newTargetOffset = playbackInfo.offset;
                            const currentFile = currentBaseSrcWithoutFragment;
                            const currentOffset = videoPlayer.currentTime;
                            const offsetDifferenceThreshold = 15;
                            if (!currentFile.endsWith(newTargetFile) || Math.abs(currentOffset - newTargetOffset) > offsetDifferenceThreshold) {
                                console.log(`Significant difference detected. Updating source.`);
                                const newSourceUrl = `${newTargetFile}#t=${newTargetOffset}`;
                                setVideoPlayerSource(newSourceUrl, true);
                            }
                        }
                    }
                }
            });
        } else {
            console.error("Video player element not found for attaching 'play' event listener post-config.");
        }

    } catch (error) {
        console.error("Application initialization failed:", error);
    }
});
