const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject_fetch.js');
(document.head || document.documentElement).appendChild(script);
