// Popup script - communicates with background service worker
// Uses addEventListener (inline onclick is blocked by Manifest V3 CSP)

document.addEventListener('DOMContentLoaded', () => {
    const connectBtn = document.getElementById('connectBtn');
    const disconnectBtn = document.getElementById('disconnectBtn');
    const urlInput = document.getElementById('serverUrl');

    connectBtn.addEventListener('click', () => {
        const url = urlInput.value.trim();
        chrome.runtime.sendMessage({ action: 'connect', serverUrl: url }, () => {
            setTimeout(refreshStatus, 1000);
        });
    });

    disconnectBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'disconnect' }, () => {
            refreshStatus();
        });
    });

    // Initial load
    refreshStatus();
    // Auto-refresh every 2s
    setInterval(refreshStatus, 2000);
});

function updateUI(status) {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    const connectBtn = document.getElementById('connectBtn');
    const disconnectBtn = document.getElementById('disconnectBtn');
    const urlInput = document.getElementById('serverUrl');

    if (status.connected) {
        dot.className = 'status-dot connected';
        text.className = 'status-text connected';
        text.textContent = '已连接 ✓';
        connectBtn.style.display = 'none';
        disconnectBtn.style.display = 'block';
    } else {
        dot.className = 'status-dot disconnected';
        text.className = 'status-text disconnected';
        text.textContent = '未连接';
        connectBtn.style.display = 'block';
        disconnectBtn.style.display = 'none';
    }

    if (status.serverUrl) {
        urlInput.value = status.serverUrl;
    }
}

function refreshStatus() {
    chrome.runtime.sendMessage({ action: 'getStatus' }, (status) => {
        if (status) updateUI(status);
    });
}
