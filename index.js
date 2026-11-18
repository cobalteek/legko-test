#!/usr/bin/env node

const http = require('node:http');
const https = require('node:https');

const REQUEST_COUNT = 10;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

function printUsage() {
  console.log('Usage: node index.js <url>');
  console.log('Example: node index.js https://speed.hetzner.de/100MB.bin');
}

function parseUrl(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid URL: ${value}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are supported');
  }

  return url;
}

function download(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.get(
      url,
      {
        headers: {
          Accept: '*/*',
          'Accept-Encoding': 'identity',
          'User-Agent': 'internet-speed-test/1.0',
        },
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;

        if (
          [301, 302, 303, 307, 308].includes(statusCode) &&
          location
        ) {
          response.resume();

          if (redirectCount >= MAX_REDIRECTS) {
            reject(new Error(`Too many redirects (limit: ${MAX_REDIRECTS})`));
            return;
          }

          const nextUrl = new URL(location, url);
          if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
            reject(new Error('Redirect points to an unsupported protocol'));
            return;
          }

          download(nextUrl, redirectCount + 1).then(resolve, reject);
          return;
        }

        let bytes = 0;

        response.on('data', (chunk) => {
          bytes += chunk.length;
        });

        response.on('end', () => {
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`Request failed with HTTP ${statusCode}`));
            return;
          }

          resolve(bytes);
        });

        response.on('error', reject);
      },
    );

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS} ms`));
    });

    request.on('error', reject);
  });
}

function formatBytes(bytes) {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(2)} kB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

function formatSpeed(bitsPerSecond) {
  if (bitsPerSecond < 1_000) return `${bitsPerSecond.toFixed(2)} bit/s`;
  if (bitsPerSecond < 1_000_000) {
    return `${(bitsPerSecond / 1_000).toFixed(2)} kbit/s`;
  }
  if (bitsPerSecond < 1_000_000_000) {
    return `${(bitsPerSecond / 1_000_000).toFixed(2)} Mbit/s`;
  }
  return `${(bitsPerSecond / 1_000_000_000).toFixed(2)} Gbit/s`;
}

async function main() {
  const [inputUrl] = process.argv.slice(2);

  if (!inputUrl || inputUrl === '--help' || inputUrl === '-h') {
    printUsage();
    process.exitCode = inputUrl ? 0 : 1;
    return;
  }

  const url = parseUrl(inputUrl);
  let totalBytes = 0;
  let totalDurationNs = 0n;

  console.log(`Testing ${url.href}`);
  console.log(`Requests: ${REQUEST_COUNT}`);

  for (let requestNumber = 1; requestNumber <= REQUEST_COUNT; requestNumber += 1) {
    const startedAt = process.hrtime.bigint();

    try {
      const bytes = await download(url);
      const durationNs = process.hrtime.bigint() - startedAt;
      const durationMs = Number(durationNs) / 1_000_000;

      totalBytes += bytes;
      totalDurationNs += durationNs;

      console.log(
        `Request ${requestNumber}/${REQUEST_COUNT}: ${durationMs.toFixed(0)} ms, ${formatBytes(bytes)}`,
      );
    } catch (error) {
      throw new Error(`Request ${requestNumber}/${REQUEST_COUNT} failed: ${error.message}`);
    }
  }

  const totalDurationSeconds = Number(totalDurationNs) / 1_000_000_000;
  const averageDurationMs = totalDurationSeconds * 1_000 / REQUEST_COUNT;
  const speedBitsPerSecond = (totalBytes * 8) / totalDurationSeconds;

  console.log('\nResult:');
  console.log(`Average request time: ${averageDurationMs.toFixed(2)} ms`);
  console.log(`Total downloaded: ${formatBytes(totalBytes)}`);
  console.log(`Average download speed: ${formatSpeed(speedBitsPerSecond)}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
