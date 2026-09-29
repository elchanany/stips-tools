(function () {
  'use strict';
  console.log('[Understand Stips] MAIN World script loaded - God Mode v5 (Forms UI)!');

  const _origGetItem = Storage.prototype.getItem;
  Storage.prototype.getItem = function (key) {
    if (key && (key.toLowerCase().includes('switcheduser'))) {
      return '"moderatorAdmin"';
    }
    return _origGetItem.apply(this, arguments);
  };

  function applyGodMode(obj) {
    let modified = false;
    
    function makeGodPermissions(p) {
      if (!p) p = {};
      const godFlags = [
        'ban', 'delete', 'edit', 'showAdminMsgs', 'report', 
        'switchToUserModeratorAdmin', 'commentAllowed', 'editAllowed', 'deleteAllowed',
        'unban', 'cancelReport', 'isOwner', 'banAllowed', 
        'showAdminMsgsAllowed', 'reportAllowed', 'setAnonymous', 'restoreAllowed',
        'removeFromChannelAllowed'
      ];
      godFlags.forEach(f => p[f] = true);
      // 🔥 CRITICAL: We explicitly set these to FALSE to force Angular to render the Points/Reasons dropdown forms!
      p.deleteWithoutMsg = false;
      p.deleteWithoutMsgAllowed = false;
      return p;
    }

    function scan(node, depth, parentArray = false) {
      if (depth > 20 || !node || typeof node !== 'object') return;
      
      if ('moderator' in node && typeof node.moderator === 'string') {
        if (node.moderator === 'no' || node.moderator === 'regular') {
          node.moderator = 'senior';
          modified = true;
        }
      }

      if ('objType' in node || 'askId' in node || 'moderator' in node || 'items' in node || parentArray) {
        node.permissions = makeGodPermissions(node.permissions);
        modified = true;
      }
      
      if ('permissions' in node && typeof node.permissions === 'object' && node.permissions !== null) {
        node.permissions = makeGodPermissions(node.permissions);
        modified = true;
      }

      for (let key in node) {
        if (Object.prototype.hasOwnProperty.call(node, key)) {
          scan(node[key], depth + 1, Array.isArray(node));
        }
      }
    }
    
    scan(obj, 0);
    return modified;
  }

  const _origOpen = XMLHttpRequest.prototype.open;
  const _origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function () {
    return _origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('readystatechange', function () {
      if (this.readyState === 4 && this.responseText) {
        try {
          const data = JSON.parse(this.responseText);
          if (applyGodMode(data)) {
            const strData = JSON.stringify(data);
            Object.defineProperty(this, 'responseText', { get: () => strData, configurable: true });
            Object.defineProperty(this, 'response', { get: () => strData, configurable: true });
          }
        } catch (e) {}
      }
    });
    return _origSend.apply(this, arguments);
  };

  const _origFetch = window.fetch;
  window.fetch = async function () {
    const response = await _origFetch.apply(this, arguments);
    try {
      const clone = response.clone();
      const text = await clone.text();
      
      if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
        const data = JSON.parse(text);
        if (applyGodMode(data)) {
          return new Response(JSON.stringify(data), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        }
      }
    } catch (e) {}
    return response;
  };
})();
