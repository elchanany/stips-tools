/**
 * Stips Download - API Client & Resilient Fetcher
 * Handles Stips API communication, pagination, network resilience, and timeouts.
 */

/**
 * Resilient fetch with timeout, exponential backoff, and abort signal support.
 */
async function resilientFetch(url, options = {}, onRetryStatus = null) {
  let failures = 0;
  const maxRetries = options.maxRetries || 25;

  while (true) {
    if (options.callerSignal && options.callerSignal.aborted) {
      const err = new Error('Operation aborted by user');
      err.name = 'AbortError';
      throw err;
    }

    let timeoutId = null;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 18000);

      // Link caller signal if provided
      if (options.callerSignal) {
        options.callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      failures = 0;
      return response;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);

      // Check if user initiated abort
      if (options.callerSignal && options.callerSignal.aborted) {
        const err = new Error('Operation aborted by user');
        err.name = 'AbortError';
        throw err;
      }

      failures++;
      if (failures > maxRetries) {
        throw new Error(`Exceeded maximum retries (${maxRetries}): ${error.message}`);
      }

      const wait = Math.min(30000, 1500 * Math.max(1, failures));
      if (typeof onRetryStatus === 'function') {
        onRetryStatus({
          failures,
          waitMs: wait,
          message: `החיבור נותק (${error.message}). ההתקדמות נשמרה, מנסה שוב בעוד ${(wait / 1000).toFixed(0)} שניות...`
        });
      }

      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

/**
 * Fetches messages batch from Stips API
 */
async function fetchMessagesBatch({ partnerId, cursor = null, isFirstLoad = true, callerSignal = null, onRetry = null }) {
  let params;
  if (isFirstLoad) {
    params = {
      userid: Number(partnerId),
      first_load: true
    };
  } else {
    params = {
      userid: Number(partnerId),
      msgid: Number(cursor),
      first_load: false,
      history: true
    };
  }

  const url = '/api?name=messages.from_user&api_params=' + encodeURIComponent(JSON.stringify(params));

  const response = await resilientFetch(
    url,
    {
      credentials: 'include',
      cache: 'no-store',
      callerSignal
    },
    onRetry
  );

  const json = await response.json();
  const rawList = Array.isArray(json?.data?.messages) ? json.data.messages : [];
  return rawList;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    resilientFetch,
    fetchMessagesBatch
  };
}
