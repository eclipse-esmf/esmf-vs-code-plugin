/* SPDX-License-Identifier: MPL-2.0 */

(() => {
    'use strict';

    const launcher = document.querySelector('.snippet-video-launcher a');
    const dialog = document.getElementById('snippet-video-dialog');

    // Preserve the ordinary attachment link when the popup cannot be initialized.
    if (!launcher || !dialog || typeof dialog.showModal !== 'function' || dialog.dataset.initialized === 'true') {
        return;
    }

    const video = dialog.querySelector('video');
    const status = dialog.querySelector('.snippet-video-dialog__status');
    const directLink = dialog.querySelector('.snippet-video-dialog__direct');

    if (!video || !status || !directLink) {
        return;
    }

    let playbackSession = 0;

    function setStatus(message) {
        status.textContent = message;
    }

    function showPlaybackError() {
        if (dialog.open) {
            setStatus('Video could not be played. Try opening it directly.');
        }
    }

    async function startPlayback(session) {
        try {
            await video.play();
        } catch (error) {
            // Closing or reopening the dialog can interrupt a pending play request.
            if (!dialog.open || session !== playbackSession || error.name === 'AbortError') {
                return;
            }

            if (error.name === 'NotAllowedError') {
                setStatus('Press Play in the video controls to start.');
            } else {
                showPlaybackError();
            }
        }
    }

    function openPlayer(event) {
        // Keep modified clicks and links opened in another tab working normally.
        if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
            return;
        }

        if (dialog.open) {
            event.preventDefault();
            return;
        }

        dialog.showModal();
        event.preventDefault();
        playbackSession += 1;
        directLink.href = launcher.href;
        directLink.hidden = false;
        setStatus('Loading video...');

        // Assigning the source only after activation prevents initial media requests.
        video.src = launcher.href;
        void startPlayback(playbackSession);
    }

    function releasePlayer() {
        // A queued close event must not clear a player that has already reopened.
        if (dialog.open) {
            return;
        }

        playbackSession += 1;
        video.pause();
        video.removeAttribute('src');
        video.load();
        setStatus('');
        launcher.focus({preventScroll: true});
    }

    function clearStatus() {
        if (dialog.open && !video.error) {
            setStatus('');
        }
    }

    launcher.addEventListener('click', openPlayer);
    dialog.addEventListener('close', releasePlayer);
    video.addEventListener('playing', clearStatus);
    video.addEventListener('error', showPlaybackError);
    dialog.dataset.initialized = 'true';
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.setAttribute('aria-controls', dialog.id);
})();
