const net = require('net');
const tls = require('tls');

function fetchJsonThroughProxy(urlStr, proxyIp, proxyPort, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const targetHost = url.hostname;
    const targetPort = url.port || 443;
    const path = url.pathname + url.search;

    const timer = setTimeout(() => {
      if (socket) socket.destroy();
      reject(new Error('Proxy connection timeout'));
    }, timeoutMs);

    let socket;
    try {
      socket = net.connect(proxyPort, proxyIp, () => {
        socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`);
      });

      let headerBuffer = '';
      let isTunnelEstablished = false;

      socket.on('data', (chunk) => {
        if (!isTunnelEstablished) {
          headerBuffer += chunk.toString('binary');
          const headerEnd = headerBuffer.indexOf('\r\n\r\n');
          if (headerEnd !== -1) {
            isTunnelEstablished = true;
            if (headerBuffer.startsWith('HTTP/1.1 200') || headerBuffer.startsWith('HTTP/1.0 200')) {
              // Tunnel established! Wrap in TLS
              socket.pause();
              
              const tlsSocket = tls.connect({
                socket: socket,
                servername: targetHost,
                rejectUnauthorized: false // Stips SSL might sometimes fail validation through proxies, disable check
              }, () => {
                // Send HTTPS request on the TLS socket
                const req = `GET ${path} HTTP/1.0\r\n` +
                            `Host: ${targetHost}\r\n` +
                            `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36\r\n` +
                            `Accept: application/json, text/plain, */*\r\n` +
                            `Connection: close\r\n\r\n`;
                tlsSocket.write(req);
              });

              let responseBuffer = Buffer.alloc(0);
              tlsSocket.on('data', (d) => {
                responseBuffer = Buffer.concat([responseBuffer, d]);
              });

              tlsSocket.on('end', () => {
                clearTimeout(timer);
                let body = '';
                try {
                  const respStr = responseBuffer.toString('utf8');
                  const bodyIndex = respStr.indexOf('\r\n\r\n');
                  if (bodyIndex === -1) {
                    reject(new Error('Invalid HTTP response from target'));
                    return;
                  }
                  const headers = respStr.substring(0, bodyIndex);
                  body = respStr.substring(bodyIndex + 4);
                  
                  // Check status code
                  const statusLine = headers.substring(0, headers.indexOf('\r\n'));
                  if (!statusLine.includes(' 200')) {
                    reject(new Error(`Target returned HTTP error: ${statusLine}`));
                    return;
                  }

                  if (headers.toLowerCase().includes('transfer-encoding: chunked')) {
                    body = dechunk(body);
                  }

                  resolve(JSON.parse(body));
                } catch (e) {
                  reject(new Error(`Failed to parse target response: ${e.message}. Body snippet: ${body.substring(0, 300)}`));
                }
              });

              tlsSocket.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
              });

              socket.resume();
            } else {
              clearTimeout(timer);
              socket.destroy();
              reject(new Error(`Proxy CONNECT failed: ${headerBuffer.substring(0, headerBuffer.indexOf('\r\n'))}`));
            }
          }
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

function dechunk(bodyStr) {
  let result = '';
  let index = 0;
  while (index < bodyStr.length) {
    const nextLine = bodyStr.indexOf('\r\n', index);
    if (nextLine === -1) break;
    const sizeStr = bodyStr.substring(index, nextLine).trim();
    if (sizeStr === '') {
      index = nextLine + 2;
      continue;
    }
    const size = parseInt(sizeStr, 16);
    if (isNaN(size)) {
      return bodyStr; // Fail-safe: return raw
    }
    if (size === 0) break;
    
    const chunkStart = nextLine + 2;
    result += bodyStr.substring(chunkStart, chunkStart + size);
    index = chunkStart + size + 2;
  }
  return result;
}

module.exports = { fetchJsonThroughProxy };
