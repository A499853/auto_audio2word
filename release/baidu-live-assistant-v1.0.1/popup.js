'use strict';
const statusElement = document.getElementById('status');
const toggleButton = document.getElementById('toggle');

document.getElementById('open').addEventListener('click', () => {
  chrome.tabs.create({url: 'https://cecom.baidu.com/liveB/login#/home'}).catch(error => {statusElement.textContent = error.message;});
});

toggleButton.addEventListener('click', async () => {
  toggleButton.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id || !tab.url || new URL(tab.url).origin !== 'https://cecom.baidu.com') {
      statusElement.textContent = '请先切换到百度直播中控台页面，或点击下方按钮打开。';
      return;
    }
    try { await chrome.tabs.sendMessage(tab.id, {type: 'BAIDU_LIVE_PING'}); }
    catch {
      await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['lib/core.js', 'lib/adapter.js', 'content.js']});
    }
    await chrome.tabs.sendMessage(tab.id, {type: 'BAIDU_LIVE_TOGGLE'});
    statusElement.textContent = '面板已切换，请在页面中设置并开启讲解计划。';
  } catch (error) {
    statusElement.textContent = `无法连接页面，请刷新中控台后重试。${error.message}`;
  } finally { toggleButton.disabled = false; }
});
