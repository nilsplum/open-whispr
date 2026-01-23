const https = require('https');
const crypto = require('crypto');

const boundary = '----Boundary' + crypto.randomBytes(8).toString('hex');
const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.error('Please set OPENAI_API_KEY environment variable');
  process.exit(1);
}

// Create minimal WAV file (44 bytes header + some silence)
const wavHeader = Buffer.alloc(44);
wavHeader.write('RIFF', 0);
wavHeader.writeUInt32LE(36 + 100, 4);
wavHeader.write('WAVE', 8);
wavHeader.write('fmt ', 12);
wavHeader.writeUInt32LE(16, 16);
wavHeader.writeUInt16LE(1, 20);
wavHeader.writeUInt16LE(1, 22);
wavHeader.writeUInt32LE(16000, 24);
wavHeader.writeUInt32LE(32000, 28);
wavHeader.writeUInt16LE(2, 32);
wavHeader.writeUInt16LE(16, 34);
wavHeader.write('data', 36);
wavHeader.writeUInt32LE(100, 40);
const wavData = Buffer.concat([wavHeader, Buffer.alloc(100)]);

let body = '';
body += '--' + boundary + '\r\n';
body += 'Content-Disposition: form-data; name="model"\r\n\r\n';
body += 'whisper-1\r\n';
body += '--' + boundary + '\r\n';
body += 'Content-Disposition: form-data; name="file"; filename="test.wav"\r\n';
body += 'Content-Type: audio/wav\r\n\r\n';
const bodyStart = Buffer.from(body);
const bodyEnd = Buffer.from('\r\n--' + boundary + '--\r\n');
const fullBody = Buffer.concat([bodyStart, wavData, bodyEnd]);

console.log('Testing multipart POST to OpenAI transcriptions...');
console.log('Body size:', fullBody.length, 'bytes');

const req = https.request({
  hostname: 'api.openai.com',
  port: 443,
  path: '/v1/audio/transcriptions',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + apiKey,
    'Content-Type': 'multipart/form-data; boundary=' + boundary,
    'Content-Length': fullBody.length
  }
}, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('Response status:', res.statusCode);
    console.log('Response:', data);
  });
});

req.on('error', (e) => {
  console.error('Error:', e.message);
  console.error('Code:', e.code);
});

req.write(fullBody);
req.end();
