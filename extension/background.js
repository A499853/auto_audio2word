'use strict';

// Runs only on installation/update, never schedules product actions in a service worker.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('baiduLiveSettings').then(value => {
    if (!value.baiduLiveSettings) {
      return chrome.storage.local.set({baiduLiveSettings: {plan: '', intervalSeconds: 8, loop: true, followCurrent: true, selectors: {row: '', number: '', title: '', explain: '', nextPage: '', scrollContainer: ''}}});
    }
  }).catch(error => console.error('初始化设置失败', error));
});
