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

        function playManualArchive(sourceIdentifier, listItemElement, isAbsoluteUrl = false) {
            console.log(`Switching to MANUAL_ARCHIVE mode. Identifier: ${sourceIdentifier}, IsAbsolute: ${isAbsoluteUrl}`);
            currentMode = 'MANUAL_ARCHIVE';

            if (liveCheckIntervalId) {
                clearInterval(liveCheckIntervalId);
                liveCheckIntervalId = null;
                console.log("Cleared live check interval due to manual selection.");
            }

            const videoSrc = isAbsoluteUrl ? sourceIdentifier : `recordings/${sourceIdentifier}`;
            setVideoPlayerSource(videoSrc, true); // Treat GDrive links as "archive" type for now

            const archiveListItems = document.querySelectorAll('#archive-list li');
            archiveListItems.forEach(item => {
                item.classList.remove('active-list-item');
            });
            if (listItemElement) {
                listItemElement.classList.add('active-list-item');
            }
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

        async function fetchDriveArchive(folderId, apiKey) {
            if (!folderId) {
                console.error("Google Drive fetch: folderId is missing.");
                throw new Error("Google Drive folderId is not configured.");
            }
            if (!apiKey) {
                console.error("Google Drive fetch: apiKey is missing.");
                throw new Error("Google Drive API key is not configured.");
            }

            const archiveItems = [];
            const query = `'${folderId}' in parents and mimeType contains 'video/' and trashed = false`;
            const fields = 'files(id, name, webViewLink, webContentLink, thumbnailLink, createdTime, modifiedTime, description, mimeType, properties, appProperties)';
            const orderBy = 'name';
            const apiUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&orderBy=${encodeURIComponent(orderBy)}&key=${apiKey}`;

            console.log(`Fetching GDrive archive from folder: ${folderId}`);

            try {
                const response = await fetch(apiUrl);
                if (!response.ok) {
                    const errorData = await response.json().catch(() => null);
                    console.error("Google Drive API Error:", response.status, response.statusText, errorData);
                    throw new Error(`Google Drive API request failed: ${response.status} ${response.statusText}`);
                }
                const data = await response.json();

                if (data.files && data.files.length > 0) {
                    for (const file of data.files) {
                        if (file.mimeType === 'application/vnd.google-apps.folder') {
                            continue;
                        }

                        let title = file.name;
                        const extIndex = title.lastIndexOf('.');
                        if (extIndex > 0) {
                            title = title.substring(0, extIndex);
                        }
                        title = title.replace(/[_-]/g, ' ').replace(/\s\s+/g, ' ').trim();

                        const timestamp = new Date(file.createdTime).toISOString();
                        const videoSrcUrl = file.webContentLink || file.webViewLink;
                        if (!videoSrcUrl) {
                            console.warn(`No playable/viewable link found for Drive file: ${file.name} (ID: ${file.id}). Skipping.`);
                            continue;
                        }

                        archiveItems.push({
                            id: file.id,
                            filename: file.name,
                            title: title,
                            timestamp: timestamp,
                            duration: 0,
                            thumbnail_reel_url: file.thumbnailLink || '',
                            videoSrcUrl: videoSrcUrl,
                            sourceType: 'gdrive'
                        });
                    }
                } else {
                    console.log("No video files found in the specified Google Drive folder.");
                }
                console.log(`Fetched ${archiveItems.length} items from Google Drive.`);
                return archiveItems;

            } catch (error) {
                console.error("Error in fetchDriveArchive:", error);
                throw error;
            }
        }

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
            let uiMessage = '';
            let messageType = 'info'; // 'info', 'warn', 'error'

            try {
                const archiveSourceUri = appConfig.ARCHIVE_SOURCE;
                console.log("Attempting to load archive from:", archiveSourceUri);

                if (!archiveSourceUri) {
                    throw new Error("ARCHIVE_SOURCE is not defined in config.json.");
                }

                if (archiveSourceUri.startsWith('file://')) {
                    const filePath = archiveSourceUri.substring('file://.'.length);
                    const response = await fetch(filePath);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status} - Failed to load local archive: ${filePath}`);
                    }
                    archiveData = await response.json();
                    console.log("Archive data loaded from local file:", archiveData);

                } else if (archiveSourceUri.startsWith('gdrive://')) {
                    if (!appConfig.GDRIVE_FOLDER_ID || !appConfig.GDRIVE_API_KEY) {
                        console.error("Google Drive configuration (GDRIVE_FOLDER_ID or GDRIVE_API_KEY) is missing in config.json.");
                        throw new Error("Google Drive is selected as source, but not fully configured in config.json (missing GDrive Folder ID or API Key).");
                    }
                    const loadingLi = document.createElement('li');
                    loadingLi.textContent = 'Loading recordings from Google Drive...';
                    loadingLi.id = 'gdrive-loading-message';
                    archiveListElement.appendChild(loadingLi);

                    archiveData = await fetchDriveArchive(appConfig.GDRIVE_FOLDER_ID, appConfig.GDRIVE_API_KEY);

                    const loadingMessageElement = document.getElementById('gdrive-loading-message');
                    if (loadingMessageElement) {
                        archiveListElement.removeChild(loadingMessageElement);
                    }

                    if (archiveData.length === 0) {
                        uiMessage = 'No video files found in the configured Google Drive folder.';
                        messageType = 'warn';
                    }
                    console.log("Archive data loaded from Google Drive:", archiveData);

                } else {
                    throw new Error(`Unsupported or invalid ARCHIVE_SOURCE URI: ${archiveSourceUri}`);
                }

                if (!Array.isArray(archiveData)) {
                    console.error("Loaded archive data is not an array. Source:", archiveSourceUri, "Data:", archiveData);
                    throw new Error("Invalid archive data format: not an array.");
                }

                fullArchiveData = [...archiveData].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                const displaySortedArchive = [...archiveData].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

                if (archiveData.length > 0) {
                    displaySortedArchive.forEach(recording => {
                        const listItem = document.createElement('li');
                        listItem.classList.add('clickable');
                        const date = new Date(recording.timestamp);
                        const formattedTimestamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

                        listItem.textContent = `${formattedTimestamp} - ${recording.title}`;

                        listItem.dataset.sourceType = recording.sourceType || 'local';
                        listItem.dataset.id = recording.id || recording.filename;

                        listItem.addEventListener('click', (event) => {
                            const source = event.currentTarget.dataset.sourceType;
                            const identifier = event.currentTarget.dataset.id;
                            if (source === 'gdrive') {
                                const gdriveRecording = fullArchiveData.find(r => r.id === identifier && r.sourceType === 'gdrive');
                                if (gdriveRecording && gdriveRecording.videoSrcUrl) {
                                    playManualArchive(gdriveRecording.videoSrcUrl, event.currentTarget, true);
                                }
                            } else {
                                playManualArchive(identifier, event.currentTarget, false);
                            }
                        });
                        archiveListElement.appendChild(listItem);
                    });
                }

            } catch (error) {
                console.error('Failed to load or display archive:', error);
                uiMessage = `Error loading recordings: ${error.message}`;
                messageType = 'error';
                fullArchiveData = [];
            }

            if (uiMessage) {
                const messageLi = document.createElement('li');
                messageLi.textContent = uiMessage;
                if (messageType === 'warn') messageLi.style.color = 'orange';
                if (messageType === 'error') messageLi.style.color = 'red';
                archiveListElement.appendChild(messageLi);
            }

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
