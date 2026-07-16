import os from 'node:os';

const PORT = process.env.PORT || '3000';
const interfaces = os.networkInterfaces();
const addresses = [];

for (const [name, entries] of Object.entries(interfaces)) {
  for (const entry of entries ?? []) {
    if (entry.family === 'IPv4' && !entry.internal) {
      addresses.push({ name, address: entry.address });
    }
  }
}

if (addresses.length === 0) {
  console.log('Nao encontrei um IPv4 de rede local. Verifique se o Mac esta no Wi-Fi.');
  process.exit(0);
}

const preferred =
  addresses.find((item) => item.name === 'en0') ??
  addresses.find((item) => /wi-?fi|wireless/i.test(item.name)) ??
  addresses[0];

const allowedOrigins = new Set([`http://localhost:${PORT}`, `https://localhost:${PORT}`]);
for (const item of addresses) {
  allowedOrigins.add(`http://${item.address}:${PORT}`);
  allowedOrigins.add(`https://${item.address}:${PORT}`);
}

console.log(`Mac HTTP:      http://localhost:${PORT}`);
console.log(`Mac HTTPS:     https://localhost:${PORT}`);
console.log(`Celular HTTP:  http://${preferred.address}:${PORT}`);
console.log(`Celular HTTPS: https://${preferred.address}:${PORT}`);

if (addresses.length > 1) {
  console.log('\nOutros IPs encontrados:');
  for (const item of addresses) {
    if (item.address !== preferred.address) {
      console.log(`- ${item.name}: http://${item.address}:${PORT}`);
      console.log(`- ${item.name}: https://${item.address}:${PORT}`);
    }
  }
}

console.log('\nPrivy Allowed origins para dev mobile:');
for (const origin of allowedOrigins) console.log(`- ${origin}`);
